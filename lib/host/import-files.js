/** Private, lease-bound file preparation. Confirmation never supplies bytes or an Agent identity. */
import { randomUUID } from 'node:crypto';
import { open, mkdtemp, writeFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { importScope } from "./import-rules.js";
import { parseWorkbook } from "./import-workbook.js";
import { digest, privateDirectory, bindingKey, localPath, readBounded } from "./file-core.js";
export { digest, privateDirectory } from "./file-core.js";
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
