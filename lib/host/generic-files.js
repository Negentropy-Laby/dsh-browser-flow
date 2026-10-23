/** User-selected, snapshot-bound files. This module has no site or business rules. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { digest, privateDirectory, localPath, readBounded, bindingKey } from "./file-core.js";
import { parseWorkbookData } from "./workbook-core.js";
export class GenericFiles {
    entries = new Map();
    preparing = new Set();
    pending = new Set();
    closed = false;
    live(entry, lease) { if (this.closed || lease.state !== 'active' || entry.lease !== lease || entry.binding !== bindingKey(lease))
        throw new Error('file-binding-changed'); }
    prune() { for (const [id, e] of this.entries)
        if (e.lease.state !== 'active' || e.binding !== bindingKey(e.lease))
            this.entries.delete(id); }
    current(lease) { this.prune(); return [...this.entries.values()].find(e => e.lease === lease); }
    own(f) { const p = f(); this.pending.add(p); return p.finally(() => this.pending.delete(p)); }
    prepare(lease, path) {
        return this.own(async () => {
            this.prune();
            if (this.closed || !lease.evidenceRoot || lease.state !== 'active' || this.preparing.has(lease) || this.current(lease))
                throw new Error('file-preparation-unavailable');
            const binding = bindingKey(lease);
            this.preparing.add(lease);
            try {
                const source = localPath(path), bytes = await readBounded(source), ext = extname(source).toLowerCase();
                const format = ext === '.xlsx' ? 'xlsx' : ext === '.json' ? 'json' : ['.txt', '.csv', '.tsv'].includes(ext) ? 'text' : 'binary';
                const rows = format === 'xlsx' ? parseWorkbookData(bytes).sheets.reduce((n, s) => n + s.rows.length, 0) : 0;
                if (format === 'json')
                    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
                if (format === 'text')
                    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                const root = localPath(lease.evidenceRoot);
                await privateDirectory(root);
                const dir = await mkdtemp(join(root, 'file-'));
                await privateDirectory(dir);
                const snapshot = join(dir, 'original.bin'), sha256 = digest(bytes);
                await writeFile(snapshot, bytes, { flag: 'wx', mode: 0o600 });
                if (digest(await readBounded(snapshot)) !== sha256)
                    throw new Error('snapshot-readback-mismatch');
                const entry = { id: randomUUID(), lease, binding, path: source, snapshot, sha256, bytes: bytes.length, name: basename(source), format, state: 'prepared' };
                this.live(entry, lease);
                this.entries.set(entry.id, entry);
                return { fileGrantId: entry.id, path: source, name: entry.name, sha256, bytes: bytes.length, rows, kind: 'generic', format, boundary: 'selected_file_only' };
            }
            finally {
                this.preparing.delete(lease);
            }
        });
    }
    confirm(lease, id) { const e = this.entries.get(id); if (!e)
        throw new Error('file-grant-missing'); this.live(e, lease); if (e.state !== 'prepared')
        throw new Error('file-grant-already-confirmed'); e.state = 'confirmed'; }
    dispatch(lease, id) {
        return this.own(async () => {
            const e = this.entries.get(id);
            if (!e)
                throw new Error('file-grant-missing');
            this.live(e, lease);
            if (e.state !== 'confirmed')
                throw new Error('file-grant-not-confirmed-or-consumed');
            e.state = 'consumed';
            const source = await readBounded(e.path), snapshot = await readBounded(e.snapshot);
            this.live(e, lease);
            if (digest(source) !== e.sha256 || digest(snapshot) !== e.sha256)
                throw new Error('source-or-snapshot-changed');
            return { fileGrantId: e.id, name: e.name, sha256: e.sha256, bytes: e.bytes, base64: snapshot.toString('base64') };
        });
    }
    async close() { this.closed = true; this.entries.clear(); await Promise.allSettled([...this.pending]); }
}
