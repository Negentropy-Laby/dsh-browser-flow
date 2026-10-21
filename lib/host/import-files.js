/** Private, lease-bound file preparation. Confirmation never supplies bytes or an Agent identity. */
import { createHash, randomUUID } from 'node:crypto';
import { open, lstat, realpath, mkdir, mkdtemp, chmod, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve, join, extname, basename } from 'node:path';
import { FILE_LIMIT, importScope } from "./import-rules.js";
import { parseWorkbook } from "./import-workbook.js";
/** @param {Uint8Array} bytes - owned bytes. @returns {string} complete SHA-256. */
export function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
/** @param {FileLease} lease - exact lease. @returns {string} versioned binding key. */
function bindingKey(lease) { return JSON.stringify([lease.task, lease.id, lease.sessionId, lease.connectionInstanceId, lease.connectionGeneration, lease.epoch, lease.documentToken]); }
/** @param {unknown} path - user-supplied local path. @returns {string} absolute path. */
function localPath(path) {
    if (typeof path !== 'string' || path.length > 4096 || !isAbsolute(path) || /^(?:\\\\|\/\/)|[\x00-\x1f]/.test(path)
        || (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(path) || path.slice(2).includes(':'))))
        throw new Error('local-path-required');
    return resolve(path);
}
/** @param {string} path - owned directory. @returns {Promise<void>} private ACL verified before raw writes. */
export async function privateDirectory(path) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if ((await lstat(path)).isSymbolicLink())
        throw new Error('private-root-link');
    if (process.platform === 'win32') {
        const script = `$ErrorActionPreference='Stop'; $p=$env:BROWSER_FLOW_PRIVATE_ROOT; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $v=Get-Acl -LiteralPath $p; $safe=$v.AreAccessRulesProtected; $seen=@(); foreach($r in $v.Access){$id=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($id -notin @($s,'S-1-5-18','S-1-5-32-544') -or $r.IsInherited -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne 'FullControl' -or ($r.InheritanceFlags -band 3) -ne 3 -or $r.PropagationFlags -ne 'None'){$safe=$false}; $seen+=$id}; if(($seen|Sort-Object -Unique).Count -ne 3 -or $seen.Count -ne 3){$safe=$false}; [pscustomobject]@{sid=$s;safe=[bool]$safe}|ConvertTo-Json -Compress`;
        const systemRoot = process.env.SystemRoot;
        if (!systemRoot)
            throw new Error('windows-system-root-required');
        const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const query = () => JSON.parse(execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...process.env, BROWSER_FLOW_PRIVATE_ROOT: path }, windowsHide: true, encoding: 'utf8', stdio: 'pipe', timeout: 15_000 }));
        try {
            let acl = query();
            if (acl.safe !== true) {
                if (typeof acl.sid !== 'string' || !/^S-\d+(?:-\d+)+$/.test(acl.sid))
                    throw new Error('sid');
                execFileSync(join(systemRoot, 'System32', 'icacls.exe'), [path, '/inheritance:r', '/grant:r', ...[acl.sid, 'S-1-5-18', 'S-1-5-32-544'].map(sid => '*' + sid + ':(OI)(CI)F')], { windowsHide: true, stdio: 'pipe', timeout: 15_000 });
                acl = query();
            }
            if (acl.safe !== true)
                throw new Error('acl');
        }
        catch {
            throw new Error('private-acl-unverified');
        }
    }
    else {
        await chmod(path, 0o700);
        if (((await lstat(path)).mode & 0o077) !== 0)
            throw new Error('private-mode-unverified');
    }
}
/** @param {string} path - local regular file. @returns {Promise<Buffer>} bounded owned bytes. */
async function readBounded(path) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > FILE_LIMIT)
        throw new Error('file-size-or-type-invalid');
    const resolved = await realpath(path);
    if ((process.platform === 'win32' ? resolved.toLowerCase() !== path.toLowerCase() : resolved !== path))
        throw new Error('file-link-refused');
    const handle = await open(path, 'r');
    try {
        const current = await handle.stat();
        if (!current.isFile() || current.dev !== info.dev || current.ino !== info.ino)
            throw new Error('file-replaced');
        const bytes = Buffer.alloc(FILE_LIMIT + 1);
        let length = 0;
        while (length < bytes.length) {
            const read = await handle.read(bytes, length, bytes.length - length, length);
            if (read.bytesRead === 0)
                break;
            length += read.bytesRead;
        }
        if (length === 0 || length > FILE_LIMIT || length !== current.size)
            throw new Error('file-size-invalid');
        return Buffer.from(bytes.subarray(0, length));
    }
    finally {
        await handle.close();
    }
}
/** One instance owns all private grant state; revoked objects are pruned, never restored. */
export class ImportFiles {
    root;
    entries;
    preparing;
    closed;
    tasks;
    /** @param {string | undefined} root - profile-private root; absence disables preparation. */
    constructor(root) {
        this.root = root;
        this.entries = new Map();
        this.preparing = new Set();
        this.closed = false;
        this.tasks = new Set();
    }
    /** @param {Prepared} entry - retained preparation. @param {FileLease} lease - current exact lease. @returns {void} validates ownership. */
    assertLive(entry, lease) {
        if (this.closed || lease.state !== 'active' || entry.lease !== lease || entry.binding !== bindingKey(lease))
            throw new Error('file-binding-changed');
    }
    /** @returns {void} release references for retired leases. */
    prune() {
        for (const [id, entry] of this.entries) {
            if (entry.lease.state !== 'active' || entry.binding !== bindingKey(entry.lease))
                this.entries.delete(id);
        }
    }
    /** @param {FileLease} lease - current lease. @returns {Prepared | undefined} same-document preparation. */
    current(lease) { this.prune(); return [...this.entries.values()].find(entry => entry.lease === lease); }
    /** @param {FileLease} lease - exact page grant. @param {unknown} path - panel-supplied path. @param {unknown} rawScope - panel scope. @returns {Promise<{ fileGrantId: string, path: string, name: string, sha256: string, bytes: number, rows: number, kind: string, boundary: string }>} private panel preview. */
    prepare(lease, path, rawScope) {
        const task = this.prepareOwned(lease, path, rawScope);
        this.tasks.add(task);
        return task.finally(() => this.tasks.delete(task));
    }
    /** @param {FileLease} lease - exact page grant. @param {unknown} path - panel path. @param {unknown} rawScope - raw scope. @returns {Promise<{fileGrantId:string,path:string,name:string,sha256:string,bytes:number,rows:number,kind:string,boundary:string}>} owned preparation. */
    async prepareOwned(lease, path, rawScope) {
        const privateRoot = lease.evidenceRoot ?? this.root;
        if (!privateRoot)
            throw new Error('private-root-required');
        this.prune();
        if (this.closed || lease.state !== 'active' || this.preparing.has(lease) || this.current(lease))
            throw new Error('file-preparation-unavailable');
        const source = localPath(path);
        const scope = importScope(rawScope);
        if (extname(source).toLowerCase() !== '.xlsx')
            throw new Error('xlsx-required');
        const binding = bindingKey(lease);
        this.preparing.add(lease);
        try {
            const bytes = await readBounded(source);
            const input = parseWorkbook(bytes);
            if (input.firstRow !== scope.firstRow || input.lastRow !== scope.lastRow)
                throw new Error('input-row-range-mismatch');
            const sha256 = digest(bytes);
            const root = localPath(privateRoot);
            await privateDirectory(root);
            const runDir = await mkdtemp(join(root, 'import-'));
            await privateDirectory(runDir);
            const snapshot = join(runDir, 'input.xlsx');
            await writeFile(snapshot, bytes, { flag: 'wx', mode: 0o600 });
            if (digest(await readBounded(snapshot)) !== sha256)
                throw new Error('snapshot-readback-mismatch');
            const entry = { id: randomUUID(), lease, binding, path: source, runDir, snapshot, bytes, sha256, scope, input, state: 'prepared' };
            this.assertLive(entry, lease);
            await this.write(entry, 'prepared.json', { sha256, bytes: bytes.length, scope, rows: input.people.length, binding });
            this.assertLive(entry, lease);
            this.entries.set(entry.id, entry);
            return { fileGrantId: entry.id, path: source, name: basename(source), sha256, bytes: bytes.length, rows: input.people.length, kind: scope.kind, boundary: 'import_confirmed' };
        }
        finally {
            this.preparing.delete(lease);
        }
    }
    /** @param {FileLease} lease - current lease. @param {string} id - preview reference. @returns {void} confirms exactly the previewed preparation. */
    confirm(lease, id) {
        const entry = this.entries.get(id);
        if (!entry)
            throw new Error('file-grant-missing');
        this.assertLive(entry, lease);
        if (entry.state !== 'prepared')
            throw new Error('file-grant-already-confirmed');
        entry.state = 'confirmed';
    }
    /** @param {FileLease} lease - current lease. @param {string} id - confirmed reference. @returns {Promise<{ fileGrantId: string, name: string, expectedIdentity: {unitId:string,legalIdentity:string}, sha256: string, base64: string, bytes: number, kind: import('./import-rules.ts').BatchKind }>} one-attempt wire payload. */
    dispatch(lease, id) {
        const task = this.dispatchOwned(lease, id);
        this.tasks.add(task);
        return task.finally(() => this.tasks.delete(task));
    }
    /** @param {FileLease} lease - exact grant. @param {string} id - confirmed file. @returns {Promise<{fileGrantId:string,name:string,expectedIdentity:{unitId:string,legalIdentity:string},sha256:string,base64:string,bytes:number,kind:import('./import-rules.ts').BatchKind}>} owned single delivery. */
    async dispatchOwned(lease, id) {
        const entry = this.entries.get(id);
        if (!entry)
            throw new Error('file-grant-missing');
        this.assertLive(entry, lease);
        if (entry.state !== 'confirmed')
            throw new Error(entry.state === 'consumed' ? 'file-grant-consumed' : 'file-grant-not-confirmed');
        // Consume before asynchronous reads, so concurrent calls cannot both acquire it.
        entry.state = 'consumed';
        const source = await readBounded(entry.path);
        const snapshot = await readBounded(entry.snapshot);
        this.assertLive(entry, lease);
        if (digest(source) !== entry.sha256)
            throw new Error('source-changed');
        if (digest(snapshot) !== entry.sha256 || digest(entry.bytes) !== entry.sha256)
            throw new Error('snapshot-changed');
        await this.write(entry, 'dispatch.json', { fileGrantId: id, sha256: entry.sha256, binding: entry.binding, boundary: 'import_confirmed' });
        this.assertLive(entry, lease);
        return { fileGrantId: id, name: basename(entry.path), expectedIdentity: { unitId: entry.scope.unitId, legalIdentity: entry.scope.legalIdentity }, sha256: entry.sha256, base64: entry.bytes.toString('base64'), bytes: entry.bytes.length, kind: entry.scope.kind };
    }
    /** @param {Prepared} entry - owned run. @param {string} name - internal fixed artifact basename. @param {unknown} value - private data. @returns {Promise<void>} read-back-verified artifact. */
    async write(entry, name, value) {
        const bytes = Buffer.from(JSON.stringify(value) + '\n');
        const path = join(entry.runDir, name);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        const handle = await open(path, 'r');
        try {
            if (digest(await handle.readFile()) !== digest(bytes))
                throw new Error('evidence-readback-mismatch');
        }
        finally {
            await handle.close();
        }
    }
    /** @returns {Promise<void>} detach grants and await owned file I/O without deleting evidence. */
    async close() { this.closed = true; this.entries.clear(); await Promise.allSettled([...this.tasks]); }
}
