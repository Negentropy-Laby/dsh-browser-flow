/** One successful artifact verification per plugin instance, followed by identity checks. */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GraphError, record } from "./protocol.js";
function identity(path) {
    const info = statSync(path, { bigint: true });
    if (!info.isFile())
        throw new GraphError('binary_unavailable');
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
}
/** Verification state belongs to one loaded plugin, so reloading permits a paired upgrade. */
export class BinaryVerifier {
    root;
    read;
    verified;
    /** @param root - resolved package root. @param read - artifact byte reader. */
    constructor(root, read = readFileSync) {
        this.root = root;
        this.read = read;
    }
    /** @returns Verified artifact; replacement requires plugin reload. */
    resolve() {
        const path = join(this.root, 'lib', 'native', 'win32-x64', 'browser-flow-graph.exe'), manifestPath = join(this.root, 'lib', 'native', 'manifest.json');
        try {
            const before = identity(path) + '|' + identity(manifestPath);
            if (this.verified !== undefined) {
                if (this.verified !== before)
                    throw new GraphError('binary_changed_reload_required');
                return { path, cwd: this.root };
            }
            const manifest = JSON.parse(this.read(manifestPath).toString('utf8'));
            if (!record(manifest) || manifest.protocolVersion !== 2 || manifest.kernelVersion !== '5' || manifest.rulesVersion !== 'structural-v1' || manifest.sha256 !== createHash('sha256').update(this.read(path)).digest('hex'))
                throw new GraphError('binary_mismatch');
            if (before !== identity(path) + '|' + identity(manifestPath))
                throw new GraphError('binary_changed_reload_required');
            this.verified = before;
            return { path, cwd: this.root };
        }
        catch (error) {
            if (error instanceof GraphError)
                throw error;
            throw new GraphError('binary_unavailable');
        }
    }
}
