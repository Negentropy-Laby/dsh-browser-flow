/** Neutral bounded local-file and private-directory primitives. */
import { createHash } from 'node:crypto';
import { open, lstat, realpath, mkdir, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve, join } from 'node:path';
export const FILE_LIMIT = 16_000_000;
/** @param {Uint8Array} bytes - owned bytes. @returns {string} complete SHA-256. */
export function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
/** @param {FileLease} lease - exact lease. @returns {string} versioned binding key. */
export function bindingKey(lease) { return JSON.stringify([lease.task, lease.id, lease.sessionId, lease.connectionInstanceId, lease.connectionGeneration, lease.epoch, lease.documentToken]); }
/** @param {unknown} path - user-supplied local path. @returns {string} absolute path. */
export function localPath(path) {
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
export async function readBounded(path) {
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
