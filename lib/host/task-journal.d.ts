/** @param {unknown} raw - manifest from disk. @param {boolean} [legacy] - accept the predecessor's missing version only for inspection. @returns {raw is import('./task-store.js').Manifest} supported manifest fields. */
export function validTaskManifest(raw: unknown, legacy?: boolean): raw is import("./task-store.js").Manifest;
/** @param {string} type - event discriminator. @param {Record<string,unknown>} row - disk payload. @param {import('./task-store.js').Manifest} manifest - preceding manifest. @param {string | undefined} pending - original pending write. @param {import('./task-wait.js').UserWait} [waiting] - active human dependency. @param {{kind:string,inputRef:string}} [waitInput] - input observed after the wait. @returns {boolean} understood event semantics. */
export function validTaskEvent(type: string, row: Record<string, unknown>, manifest: import("./task-store.js").Manifest, pending: string | undefined, waiting?: import("./task-wait.js").UserWait, waitInput?: {
    kind: string;
    inputRef: string;
}): boolean;
/** The first explicit task storage generation; unversioned predecessors are read-only. */
export const TASK_FORMAT_VERSION: 1;
export function taskRecord(value: unknown): value is Record<string, unknown>;
