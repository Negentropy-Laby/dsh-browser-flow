/** Shared ownership, confirmation and single-use lifecycle; file policies stay in callers. */
import { bindingKey } from "./file-core.js";
export class FileGrants {
    entries = new Map();
    preparing = new Set();
    tasks = new Set();
    closed = false;
    assertLive(entry, lease) {
        if (this.closed || lease.state !== 'active' || entry.lease !== lease || entry.binding !== bindingKey(lease))
            throw new Error('file-binding-changed');
    }
    prune() { for (const [id, e] of this.entries)
        if (e.lease.state !== 'active' || e.binding !== bindingKey(e.lease))
            this.entries.delete(id); }
    current(lease) { this.prune(); return [...this.entries.values()].find(e => e.lease === lease); }
    own(f) { const p = f(); this.tasks.add(p); return p.finally(() => this.tasks.delete(p)); }
    beginPrepare(lease) {
        this.prune();
        if (this.closed || lease.state !== 'active' || this.preparing.has(lease) || this.current(lease))
            throw new Error('file-preparation-unavailable');
        this.preparing.add(lease);
    }
    confirm(lease, id) {
        const e = this.entries.get(id);
        if (!e)
            throw new Error('file-grant-missing');
        this.assertLive(e, lease);
        if (e.state !== 'prepared')
            throw new Error('file-grant-already-confirmed');
        e.state = 'confirmed';
    }
    consume(lease, id) {
        const e = this.entries.get(id);
        if (!e)
            throw new Error('file-grant-missing');
        this.assertLive(e, lease);
        if (e.state !== 'confirmed')
            throw new Error(e.state === 'consumed' ? 'file-grant-consumed' : 'file-grant-not-confirmed');
        e.state = 'consumed';
        return e;
    }
    async close() { this.closed = true; this.entries.clear(); await Promise.allSettled([...this.tasks]); }
}
/** Every Host lifecycle point retires both strategies through this one collection. */
export class FileGrantCollection {
    members;
    constructor(members) {
        this.members = members;
    }
    prune() { for (const member of this.members)
        member.prune(); }
    async close() { await Promise.all(this.members.map(m => m.close())); }
}
