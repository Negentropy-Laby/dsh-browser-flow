/** Bounded derived values only. A hit never establishes source availability. */
export declare class DerivedCache {
    private maxBytes;
    private maxEntries;
    private entries;
    private bytes;
    constructor(maxBytes: number, maxEntries?: number);
    get<T>(key: string): T | undefined;
    set(key: string, owner: string, value: unknown, bytes: number): void;
    clear(owner?: string): void;
}
export declare function immutableValue<T>(value: T): T;
