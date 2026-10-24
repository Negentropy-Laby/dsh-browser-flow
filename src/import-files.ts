import type {FileLease} from './file-core.ts'
export type {FileLease} from './file-core.ts'
import {FileGrants} from './file-grants.ts'
export type Prepared = {
    id: string;
    lease: FileLease;
    binding: string;
    path: string;
    snapshot: string;
    runDir: string;
    bytes: Buffer;
    sha256: string;
    scope: import("./import-rules.ts").ImportScope;
    input: ReturnType<typeof parseWorkbook>;
    assetRef?: string;
    identityVerified?: boolean;
    selectionAcknowledged?: boolean;
    selectionAttemptId?: string;
    state: "prepared" | "confirmed" | "consumed";
};

/** Private, lease-bound file preparation. Confirmation never supplies bytes or an Agent identity. */
import { randomUUID } from 'node:crypto'
import { open, mkdtemp, writeFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { FILE_LIMIT, importScope } from './import-rules.ts'
import { parseWorkbook } from './import-workbook.ts'
import { digest, privateDirectory, bindingKey, localPath, readBounded } from './file-core.ts'
export { digest, privateDirectory } from './file-core.ts'

/** One instance owns all private grant state; revoked objects are pruned, never restored. */
export class ImportFiles extends FileGrants<Prepared> {
  constructor(readonly root:string|undefined){super()}
  /** @param {FileLease} lease - exact page grant. @param {unknown} path - panel-supplied path. @param {unknown} rawScope - panel scope. @returns {Promise<{ fileGrantId: string, path: string, name: string, sha256: string, bytes: number, rows: number, kind: string, boundary: string }>} private panel preview. */
  prepare(lease: FileLease, path: unknown, rawScope: unknown) : Promise<{
    fileGrantId: string;
    path: string;
    name: string;
    sha256: string;
    bytes: number;
    rows: number;
    kind: string;
    boundary: string;
}> {
    return this.own(()=>this.prepareOwned(lease,path,rawScope))
  }
  /** @param {FileLease} lease - exact page grant. @param {unknown} path - panel path. @param {unknown} rawScope - raw scope. @returns {Promise<{fileGrantId:string,path:string,name:string,sha256:string,bytes:number,rows:number,kind:string,boundary:string}>} owned preparation. */
  async prepareOwned(lease: FileLease, path: unknown, rawScope: unknown) : Promise<{
    fileGrantId: string;
    path: string;
    name: string;
    sha256: string;
    bytes: number;
    rows: number;
    kind: string;
    boundary: string;
}> {
    const privateRoot=lease.evidenceRoot ?? this.root
    if (!privateRoot) throw new Error('private-root-required')

    const source = localPath(path); const scope = importScope(rawScope)
    if (extname(source).toLowerCase() !== '.xlsx') throw new Error('xlsx-required')
    const binding = bindingKey(lease)
    this.beginPrepare(lease)
    try {
      const bytes = await readBounded(source, FILE_LIMIT)
      const input = parseWorkbook(bytes)
      if (input.firstRow !== scope.firstRow || input.lastRow !== scope.lastRow) throw new Error('input-row-range-mismatch')
      const sha256 = digest(bytes)
      const root = localPath(privateRoot)
      await privateDirectory(root)
      const runDir = await mkdtemp(join(root, 'import-'))
      await privateDirectory(runDir)
      const snapshot = join(runDir, 'input.xlsx')
      await writeFile(snapshot, bytes, { flag: 'wx', mode: 0o600 })
      if (digest(await readBounded(snapshot, FILE_LIMIT)) !== sha256) throw new Error('snapshot-readback-mismatch')
       const entry: Prepared = { id: randomUUID(), lease, binding, path: source, runDir, snapshot, bytes, sha256, scope, input, state: 'prepared' }
      this.assertLive(entry, lease)
      await this.write(entry, 'prepared.json', { sha256, bytes: bytes.length, scope, rows: input.people.length, binding })
      this.assertLive(entry, lease)
      this.entries.set(entry.id, entry)
      return { fileGrantId: entry.id, path: source, name: basename(source), sha256, bytes: bytes.length, rows: input.people.length, kind: scope.kind, boundary: 'import_confirmed' }
    } finally { this.preparing.delete(lease) }
  }
  /** @param {FileLease} lease - current lease. @param {string} id - confirmed reference. @returns {Promise<{ fileGrantId: string, name: string, expectedIdentity: {unitId:string,legalIdentity:string}, sha256: string, base64: string, bytes: number, kind: import('./import-rules.ts').BatchKind }>} one-attempt wire payload. */
  dispatch(lease: FileLease, id: string) : Promise<{
    fileGrantId: string;
    name: string;
    expectedIdentity: {
        unitId: string;
        legalIdentity: string;
    };
    sha256: string;
    base64: string;
    bytes: number;
    kind: import('./import-rules.ts').BatchKind;
}> {
    return this.own(()=>this.dispatchOwned(lease,id))
  }
  /** @param {FileLease} lease - exact grant. @param {string} id - confirmed file. @returns {Promise<{fileGrantId:string,name:string,expectedIdentity:{unitId:string,legalIdentity:string},sha256:string,base64:string,bytes:number,kind:import('./import-rules.ts').BatchKind}>} owned single delivery. */
  async dispatchOwned(lease: FileLease, id: string) : Promise<{
    fileGrantId: string;
    name: string;
    expectedIdentity: {
        unitId: string;
        legalIdentity: string;
    };
    sha256: string;
    base64: string;
    bytes: number;
    kind: import('./import-rules.ts').BatchKind;
}> {
    const entry=this.consume(lease,id)
    const source = await readBounded(entry.path, FILE_LIMIT)
    const snapshot = await readBounded(entry.snapshot, FILE_LIMIT)
    this.assertLive(entry, lease)
    if (digest(source) !== entry.sha256) throw new Error('source-changed')
    if (digest(snapshot) !== entry.sha256 || digest(entry.bytes) !== entry.sha256) throw new Error('snapshot-changed')
    await this.write(entry, 'dispatch.json', { fileGrantId: id, sha256: entry.sha256, binding: entry.binding, boundary: 'import_confirmed' })
    this.assertLive(entry, lease)
    return { fileGrantId: id, name: basename(entry.path), expectedIdentity: {unitId:entry.scope.unitId,legalIdentity:entry.scope.legalIdentity}, sha256: entry.sha256, base64: entry.bytes.toString('base64'), bytes: entry.bytes.length, kind: entry.scope.kind }
  }
  /** @param {Prepared} entry - owned run. @param {string} name - internal fixed artifact basename. @param {unknown} value - private data. @returns {Promise<void>} read-back-verified artifact. */
  async write(entry: Prepared, name: string, value: unknown) : Promise<void> {
    const bytes = Buffer.from(JSON.stringify(value) + '\n')
    const path = join(entry.runDir, name)
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    const handle = await open(path, 'r')
    try { if (digest(await handle.readFile()) !== digest(bytes)) throw new Error('evidence-readback-mismatch') } finally { await handle.close() }
  }
}
