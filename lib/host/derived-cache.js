/** Bounded derived values only. A hit never establishes source availability. */
export class DerivedCache {
    maxBytes;
    maxEntries;
    entries = new Map();
    bytes = 0;
    constructor(maxBytes, maxEntries = 32) {
        this.maxBytes = maxBytes;
        this.maxEntries = maxEntries;
    }
    get(key) {
        const e = this.entries.get(key);
        if (!e)
            return undefined;
        this.entries.delete(key);
        this.entries.set(key, e);
        return e.value;
    }
    set(key, owner, value, bytes) {
        const old = this.entries.get(key);
        if (old) {
            this.bytes -= old.bytes;
            this.entries.delete(key);
        }
        if (bytes > this.maxBytes || bytes < 0)
            return;
        this.entries.set(key, { owner, value, bytes });
        this.bytes += bytes;
        while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
            const first = this.entries.keys().next().value;
            this.bytes -= this.entries.get(first).bytes;
            this.entries.delete(first);
        }
    }
    clear(owner) {
        for (const [key, e] of this.entries)
            if (owner === undefined || e.owner === owner) {
                this.entries.delete(key);
                this.bytes -= e.bytes;
            }
    }
}
export function immutableValue(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const v of Object.values(value))
            immutableValue(v);
        Object.freeze(value);
    }
    return value;
}
