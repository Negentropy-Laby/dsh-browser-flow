/** The first explicit task storage generation; unversioned predecessors are read-only. */
export declare const TASK_FORMAT_VERSION = 1;
export declare const EXPLORATION_FORMAT_VERSION = 2;
export declare const supportedTaskFormat: (v: unknown) => v is 2 | 1;
/** @param {unknown} value - JSON. @returns {value is Record<string, unknown>} object. */
export declare const taskRecord: (value: unknown) => value is Record<string, unknown>;
/** @param {unknown} raw - manifest from disk. @param {boolean} [legacy] - accept the predecessor's missing version only for inspection. @returns {raw is import('./task-store.ts').Manifest} supported manifest fields. */
export declare function validTaskManifest(raw: unknown, legacy?: boolean): raw is import('./task-store.ts').Manifest;
/** @param {string} type - event discriminator. @param {Record<string,unknown>} row - disk payload. @param {import('./task-store.ts').Manifest} manifest - preceding manifest. @param {string | undefined} pending - original pending write. @param {import('./task-wait.ts').UserWait} [waiting] - active human dependency. @param {{kind:string,inputRef:string}} [waitInput] - input observed after the wait. @returns {boolean} understood event semantics. */
export declare function validTaskEvent(type: string, row: Record<string, unknown>, manifest: import('./task-store.ts').Manifest, pending: string | undefined, waiting?: import('./task-wait.ts').UserWait, waitInput?: {
    kind: string;
    inputRef: string;
}): boolean;
