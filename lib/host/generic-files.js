import { FileGrants } from "./file-grants.js";
/** User-selected, snapshot-bound files. This module has no site or business rules. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { digest, privateDirectory, localPath, readBounded, bindingKey } from "./file-core.js";
import { parseWorkbookData } from "./workbook-core.js";
export class GenericFiles extends FileGrants {
    prepare(lease, path) {
        return this.own(async () => {
            if (!lease.evidenceRoot)
                throw new Error('file-preparation-unavailable');
            const binding = bindingKey(lease);
            this.beginPrepare(lease);
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
                this.assertLive(entry, lease);
                this.entries.set(entry.id, entry);
                return { fileGrantId: entry.id, path: source, name: entry.name, sha256, bytes: bytes.length, rows, kind: 'generic', format, boundary: 'selected_file_only' };
            }
            finally {
                this.preparing.delete(lease);
            }
        });
    }
    dispatch(lease, id) {
        return this.own(async () => {
            const e = this.consume(lease, id);
            const source = await readBounded(e.path), snapshot = await readBounded(e.snapshot);
            this.assertLive(e, lease);
            if (digest(source) !== e.sha256 || digest(snapshot) !== e.sha256)
                throw new Error('source-or-snapshot-changed');
            return { fileGrantId: e.id, name: e.name, sha256: e.sha256, bytes: e.bytes, base64: snapshot.toString('base64') };
        });
    }
}
