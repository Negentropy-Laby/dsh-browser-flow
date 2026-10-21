/**
 * Host-side control state: identity, binding, leases, sequencing and deadlines.
 *
 * The state machine is deliberately free of I/O and of Cordis so it can be
 * exercised directly: every security property this plugin claims is a decision
 * this module makes. The service in `lib/index.js` is a thin adapter over it.
 *
 * Invariants enforced here:
 *
 * 1. A control lease exists only for one exact live Agent object, one Session,
 *    one physical page (`lease` + `partition`) and one panel connection
 *    generation.
 * 2. Only the connection generation that established the lease may deliver its
 *    results; an older or newer generation is refused, never migrated.
 * 3. Commands are serialized per lease and sequenced strictly per lease: a
 *    result whose sequence is not the next expected one is refused and the
 *    lease's epoch advances, because the page's state can no longer be trusted.
 * 4. A command whose dispatch window closed before the panel took it is never
 *    executed and is reported as a failure; a command the panel took whose
 *    result never arrives is `unknown_outcome` and is never re-sent.
 * 5. Revocation and invalidation only detach control. Nothing here closes a
 *    page or clears storage.
 *
 * @module @negentropy/dsh-browser-flow/state
 */
import { sameRunScope, validRunScope } from "./task-scope.js";
import { PROTOCOL_VERSION, ERROR_CODES, failure, success } from "./protocol.js";
/**
 * One page the panel reports, as the Host remembers it.
 * @typedef {object} PanelPage
 * @property {string} lease - guest lease the webview carries as its `name`.
 * @property {string} partition - guest partition.
 * @property {string} url - redacted address, for display only.
 * @property {string} documentToken - page-minted document identity.
 * @property {string} [tabId] - plugin tab alias, for display only.
 * @property {string} [title] - page title, for display only.
 */
/**
 * One registered panel connection (one live panel instance at one generation).
 * @typedef {object} PanelConnection
 * @property {string} instanceId - panel instance identity.
 * @property {number} generation - connection generation.
 * @property {string} sessionId - Session the panel belongs to.
 * @property {PanelPage[]} pages - pages the panel can see.
 * @property {number} lastSeen - monotonic time of the last poll.
 */
/**
 * One queued or in-flight command.
 * @typedef {object} CommandEntry
 * @property {string} id - command identity.
 * @property {object} op - validated operation.
 * @property {(value: object) => void} resolve - settles the caller.
 * @property {AbortSignal | undefined} signal - caller cancellation.
 * @property {(() => void) | undefined} abortListener - registered abort listener.
 * @property {boolean} settled - whether the caller has been answered.
 * @property {boolean} dispatched - whether the panel took the command.
 * @property {number} deadlineAt - monotonic deadline.
 * @property {number} sequence - assigned on dispatch.
 */
/**
 * One dispatched command awaiting its result.
 *
 * Keyed by command id. `command` is the wire envelope handed to the panel;
 * `entry` is the local caller's record.
 * @typedef {object} InFlightRecord
 * @property {CommandEntry} entry - the command.
 * @property {object} command - wire envelope for the panel.
 * @property {number} command.deadlineAt - monotonic deadline.
 * @property {number} command.sequence - the command's sequence.
 * @property {number} command.budgetMs - remaining execution budget at delivery.
 * @property {'pending' | 'settled' | 'unknown_outcome' | 'dropped'} outcome - result state.
 * @property {boolean} taken - whether the panel has taken it.
 * @property {{ instanceId: string, generation: number, epoch: number } | undefined} delivery - immutable recipient recorded on take.
 */
/**
 * One control lease: the authorization to operate one page for one Agent.
 * @typedef {object} ControlLease
 * @property {string} id - control lease identity.
 * @property {import('./task-scope.ts').RunScope} [task] - verified immutable task/run binding.
 * @property {string} sessionId - authorized Session.
 * @property {string} agentInstanceToken - plugin-minted token of the exact Agent.
 * @property {object} agent - the exact live Agent object.
 * @property {string} connectionInstanceId - panel instance that authorized it.
 * @property {number} connectionGeneration - generation that authorized it.
 * @property {string} lease - guest lease.
 * @property {string} partition - guest partition.
 * @property {string} documentToken - document identity at authorization.
 * @property {string} tabId - plugin tab alias.
 * @property {number} epoch - observation epoch.
 * @property {'active' | 'revoked'} state - lease state.
 * @property {number} nextSequence - next accepted result sequence.
 * @property {Set<string>} abandoned - ids the Host settled without a result.
 * @property {CommandEntry[]} queue - commands waiting to dispatch.
 * @property {Map<string, InFlightRecord>} inFlight - dispatched commands by command id.
 * @property {string | undefined} lastCompletedCommandId - last settled command.
 * @property {string | undefined} revokedReason - why control ended, when revoked.
 */
/** Events that invalidate part of the binding. */
/** How many revoked leases stay describable before the oldest are dropped. */
const REVOKED_RETENTION = 32;
/** How many Host-abandoned command ids a lease remembers, so late results are ignored rather than treated as violations. */
const ABANDONED_LIMIT = 32;
export const INVALIDATION_EVENTS = Object.freeze([
    'cross_origin_navigation',
    'same_origin_navigation',
    'document_replaced',
    'page_replaced',
    'page_destroyed',
    'connection_lost',
    'agent_replaced',
    'session_changed',
    'revoked',
]);
/**
 * Control effect of one invalidation event.
 *
 * `keep` advances the observation epoch and keeps the control lease;
 * `invalidate` revokes control, because the object the user authorized is gone.
 */
const INVALIDATION_EFFECTS = Object.freeze({
    cross_origin_navigation: 'invalidate',
    same_origin_navigation: 'keep',
    document_replaced: 'keep',
    page_replaced: 'invalidate',
    page_destroyed: 'invalidate',
    connection_lost: 'invalidate',
    agent_replaced: 'invalidate',
    session_changed: 'invalidate',
    revoked: 'invalidate',
});
/**
 * Monotonic clock used for deadlines.
 * @returns {number} milliseconds on a monotonic scale.
 */
export function monotonicNow() {
    return performance.now();
}
/**
 * Create one control-state store.
 * @param {object} [options] - store options.
 * @param {() => number} [options.now] - monotonic clock injection for tests.
 * @returns {object} the store.
 */
export function createControlState(options = {}) {
    const now = options.now ?? monotonicNow;
    /** @type {Map<string, ControlLease>} */
    const leases = new Map();
    /** @type {Map<string, PanelConnection>} */
    const connections = new Map();
    let nextLease = 1;
    let nextCommand = 1;
    let closed = false;
    /**
     * Register or refresh one panel connection.
     *
     * A higher generation from the same panel instance retires the previous
     * generation and every lease bound to it.
     * @param {object} hello - validated hello envelope.
     * @param {number} hello.connectionGeneration - panel generation.
     * @param {string} hello.sessionId - Session the panel belongs to.
     * @param {{ instanceId: string, pages: PanelPage[] }} hello.panel - panel identity and pages.
     * @returns {object} registration verdict.
     */
    function registerConnection(hello) {
        if (closed)
            return failure('connection_stale', 'the browser control service was unloaded');
        const instanceId = hello.panel.instanceId;
        const existing = connections.get(instanceId);
        if (existing !== undefined && hello.connectionGeneration < existing.generation) {
            return failure('connection_stale', 'a newer panel connection already registered for this panel instance');
        }
        if (existing !== undefined && hello.connectionGeneration === existing.generation) {
            if (hello.sessionId !== existing.sessionId) {
                return failure('connection_stale', 'a panel must open a new generation before changing Session');
            }
            existing.lastSeen = now();
            existing.sessionId = hello.sessionId;
            existing.pages = hello.panel.pages;
            return success({ generation: existing.generation });
        }
        if (existing !== undefined)
            retireConnection(existing, 'connection_lost');
        const connection = {
            instanceId,
            generation: hello.connectionGeneration,
            sessionId: hello.sessionId,
            pages: hello.panel.pages,
            lastSeen: now(),
        };
        connections.set(instanceId, connection);
        return success({ generation: connection.generation });
    }
    /**
     * Connections registered for one Session.
     * @param {string} sessionId - Session.
     * @returns {object[]} connections.
     */
    function connectionsFor(sessionId) {
        return [...connections.values()].filter(connection => connection.sessionId === sessionId);
    }
    /**
     * Keep the revoked leases bounded.
     *
     * A revoked lease is kept briefly so a late caller sees "revoked" rather than
     * "no such lease", but nothing removes it. Each one holds its command queue and
     * a strong reference to the Agent object that held it, so an unbounded map both
     * grows for the life of the Host and keeps disposed Agents alive. Newest are
     * retained; oldest go first.
     * @returns {void}
     */
    function pruneRevokedLeases() {
        let revoked = 0;
        for (const lease of leases.values())
            if (lease.state !== 'active')
                revoked += 1;
        if (revoked <= REVOKED_RETENTION)
            return;
        for (const [id, lease] of leases) {
            if (lease.state === 'active')
                continue;
            leases.delete(id);
            revoked -= 1;
            if (revoked <= REVOKED_RETENTION)
                return;
        }
    }
    /**
     * Retire one connection and invalidate every lease bound to it.
     * @param {PanelConnection} connection - connection to retire.
     * @param {string} event - invalidation event.
     * @returns {void}
     */
    function retireConnection(connection, event) {
        connections.delete(connection.instanceId);
        for (const lease of leases.values()) {
            if (lease.connectionInstanceId !== connection.instanceId)
                continue;
            if (lease.state !== 'active')
                continue;
            applyInvalidation(lease, event);
        }
    }
    /**
     * Drop every connection that has not polled within the idle window.
     * @param {number} idleMs - idle window in milliseconds.
     * @returns {string[]} instance ids that were dropped.
     */
    function expireIdleConnections(idleMs) {
        const expired = [];
        const at = now();
        for (const connection of [...connections.values()]) {
            if (at - connection.lastSeen <= idleMs)
                continue;
            expired.push(connection.instanceId);
            retireConnection(connection, 'connection_lost');
        }
        return expired;
    }
    /**
     * Bind an authorization to one exact Agent, Session and page.
     * @param {object} input - binding inputs.
     * @param {string} input.connectionInstanceId - panel instance that authorizes.
     * @param {number} input.connectionGeneration - its generation.
     * @param {import('./task-scope.ts').RunScope} [input.task] - verified task/run.
   * @param {string} input.sessionId - authorized Session.
     * @param {string} input.agentInstanceToken - token of the exact Agent.
     * @param {object} input.agent - the exact live Agent object.
     * @param {string} input.lease - guest lease.
     * @param {string} input.partition - guest partition.
     * @param {string} input.documentToken - document identity.
     * @param {string} [input.tabId] - plugin tab alias.
     * @returns {object} binding verdict.
     */
    function authorize(input) {
        if (closed)
            return failure('connection_stale', 'the browser control service was unloaded');
        const connection = connections.get(input.connectionInstanceId);
        if (connection === undefined || connection.generation !== input.connectionGeneration) {
            return failure('connection_stale', 'the panel connection is not the current generation; reopen the panel');
        }
        if (connection.sessionId !== input.sessionId) {
            return failure('connection_stale', 'the panel connection belongs to another Session');
        }
        const page = connection.pages.find(candidate => candidate.lease === input.lease);
        if (page === undefined) {
            return failure('page_unavailable', 'the panel no longer reports that page; select the page again');
        }
        if (page.partition !== input.partition) {
            return failure('page_replaced', 'the page partition changed; authorize the page again');
        }
        // One physical page carries one control lease, however many times the panel
        // re-authorizes it. Keying on the connection as well would mint a second
        // lease whenever the panel remounts (a new instance id), leaving the same
        // guest listed twice with control split between the two.
        const existing = [...leases.values()].find(lease => lease.state === 'active' && lease.lease === input.lease && lease.partition === input.partition);
        if (existing !== undefined && (existing.agent !== input.agent
            || existing.agentInstanceToken !== input.agentInstanceToken || existing.sessionId !== input.sessionId)) {
            return failure('not_authorized', 'another Agent instance already controls this page; revoke it first');
        }
        // Validate the new target before retiring the caller's previous selection.
        for (const selected of leases.values()) {
            if (selected.state !== 'active' || selected === existing)
                continue;
            if (selected.agent !== input.agent || selected.agentInstanceToken !== input.agentInstanceToken
                || selected.sessionId !== input.sessionId)
                continue;
            applyInvalidation(selected, 'revoked');
        }
        if (existing !== undefined) {
            applyInvalidation(existing, 'document_replaced', input.documentToken);
            // Re-authorizing the same Agent and page refreshes the document identity
            // and rebinds the lease to the panel instance that just asked for it, so
            // results are accepted from the connection that is actually live.
            existing.task = input.task;
            existing.documentToken = input.documentToken;
            existing.connectionInstanceId = input.connectionInstanceId;
            existing.connectionGeneration = input.connectionGeneration;
            existing.tabId = input.tabId ?? existing.tabId;
            return success({
                controlLeaseId: existing.id,
                epoch: existing.epoch,
                documentToken: existing.documentToken,
                sessionId: existing.sessionId,
                tabId: existing.tabId,
                nextSequence: existing.nextSequence,
            });
        }
        const id = `lease-${nextLease++}`;
        /** @type {ControlLease} */
        const lease = {
            id,
            sessionId: input.sessionId,
            ...(input.task ? { task: Object.freeze({ ...input.task }) } : {}),
            agentInstanceToken: input.agentInstanceToken,
            agent: input.agent,
            connectionInstanceId: input.connectionInstanceId,
            connectionGeneration: input.connectionGeneration,
            lease: input.lease,
            partition: input.partition,
            documentToken: input.documentToken,
            tabId: input.tabId ?? input.lease,
            epoch: 0,
            state: 'active',
            nextSequence: 0,
            queue: [],
            inFlight: new Map(),
            lastCompletedCommandId: undefined,
            // Ids the Host settled without a result (expired or cancelled). A late
            // result for one of them is not a protocol violation: the panel was still
            // working when the Host gave up.
            abandoned: new Set(),
            revokedReason: undefined,
        };
        leases.set(id, lease);
        return success({
            controlLeaseId: id,
            epoch: lease.epoch,
            documentToken: lease.documentToken,
            sessionId: lease.sessionId,
            tabId: lease.tabId,
            nextSequence: lease.nextSequence,
        });
    }
    /**
     * Retire the active leases of a Session that a previous Agent instance holds.
     *
     * A lease belongs to one exact Agent object and cannot be reused after the
     * Host replaces it. Retiring those leases prevents the previous owner from
     * occupying the page; the replacement still requires explicit authorization.
     * @param {string} sessionId - Session being authorized.
     * @param {object} liveAgent - the Session's current live Agent object.
     * @returns {string[]} ids of the leases retired.
     */
    function retireLeasesOfReplacedAgents(sessionId, liveAgent) {
        const retired = [];
        for (const lease of leases.values()) {
            if (lease.state !== 'active')
                continue;
            if (lease.sessionId !== sessionId)
                continue;
            if (lease.agent === liveAgent)
                continue;
            applyInvalidation(lease, 'agent_replaced');
            retired.push(lease.id);
        }
        return retired;
    }
    /**
     * Count the active leases of one Session, whatever Agent holds them.
     *
     * This separates two failures that look identical to a caller: nothing was
     * ever authorized, and something was authorized for a different Agent
     * instance. The plan requires re-authorization when the Agent is disposed or
     * recreated, so the second case must say so rather than claim nothing is
     * authorized.
     * @param {string} sessionId - Session to inspect.
     * @returns {number} how many active leases the Session has.
     */
    function leaseCountForSession(sessionId) {
        let count = 0;
        for (const lease of leases.values()) {
            if (lease.state === 'active' && lease.sessionId === sessionId)
                count += 1;
        }
        return count;
    }
    /**
     * Find the active lease bound to one exact Agent object, token and Session.
     * @param {object} agent - the exact live Agent object of the caller.
     * @param {string} agentInstanceToken - that Agent's plugin-minted token.
     * @param {string} sessionId - caller Session.
     * @returns {object | undefined} the lease when it is still valid for that caller.
     */
    function leaseFor(agent, agentInstanceToken, sessionId) {
        for (const lease of leases.values()) {
            if (lease.state !== 'active')
                continue;
            if (lease.agent !== agent)
                continue;
            if (lease.agentInstanceToken !== agentInstanceToken)
                continue;
            if (lease.sessionId !== sessionId)
                continue;
            return lease;
        }
        return undefined;
    }
    /**
     * List pages one connection reports, with authorization state.
     * @param {string} instanceId - panel instance.
     * @param {number} generation - panel generation.
     * @returns {object} page list verdict.
     */
    function listPages(instanceId, generation) {
        const connection = connections.get(instanceId);
        if (connection === undefined)
            return failure('page_unavailable', 'the plugin panel is not connected');
        if (connection.generation !== generation) {
            return failure('connection_stale', 'the panel connection was replaced; reopen the panel');
        }
        return success({
            pages: connection.pages.map(page => {
                // One guest carries at most one authorization, whoever is looking. The
                // lookup deliberately spans the Session rather than the reporting
                // instance: a remounted panel is a different instance reporting the same
                // guests, and it must see the authorization the user already granted.
                const lease = [...leases.values()].find(candidate => candidate.state === 'active' && candidate.sessionId === connection.sessionId && candidate.lease === page.lease);
                return {
                    // `lease` is the guest identity the caller de-duplicates on. Omitting
                    // it collapses every candidate page onto one entry.
                    lease: page.lease,
                    tabId: lease?.tabId ?? page.tabId ?? page.lease,
                    url: page.url,
                    title: page.title ?? '',
                    authorized: lease !== undefined,
                    ...(lease === undefined ? {} : { controlLeaseId: lease.id, epoch: lease.epoch }),
                };
            }),
        });
    }
    /**
     * Apply one invalidation event to a lease.
     * @param {ControlLease} lease - affected lease.
     * @param {string} event - invalidation event.
     * @param {string} [documentToken] - the document now in the guest, when known.
     * @returns {void}
     */
    function applyInvalidation(lease, event, documentToken = undefined) {
        const effect = /** @type {Record<string, string>} */ (INVALIDATION_EFFECTS)[event] ?? 'invalidate';
        if (effect === 'keep') {
            // The control survives, but every observation made before the change is
            // stale, so a command in flight has an unknowable outcome and a queued one
            // must never be dispatched against the old document. The document itself
            // changed, so the lease adopts the new identity; keeping the old one would
            // make every later result look like it came from another document.
            lease.documentToken = documentToken === undefined ? '' : documentToken;
            lease.epoch += 1;
            for (const entry of lease.queue.splice(0)) {
                finish(entry, failure('stale_observation', `the page changed (${event}) before this command was dispatched; observe again`));
            }
            endInFlight(lease, 'stale_observation', `the page changed (${event})`);
            return;
        }
        lease.state = 'revoked';
        lease.revokedReason = event;
        pruneRevokedLeases();
        for (const entry of lease.queue.splice(0)) {
            finish(entry, failure('revoked', `control ended (${event}); authorize the page again`));
        }
        endInFlight(lease, 'revoked', `control ended (${event})`);
    }
    /**
     * End pending commands without claiming untaken work could have executed.
     * @param {ControlLease} lease - affected lease.
     * @param {string} code - refusal for commands not taken by the panel.
     * @param {string} reason - reason control or observations changed.
     * @returns {void}
     */
    function endInFlight(lease, code, reason) {
        for (const record of lease.inFlight.values()) {
            if (record.outcome !== 'pending')
                continue;
            record.outcome = record.taken ? 'unknown_outcome' : 'dropped';
            finish(record.entry, record.taken
                ? failure('unknown_outcome', `${reason} after the panel took the command`)
                : failure(code, `${reason} before the panel took the command`));
        }
        lease.inFlight.clear();
    }
    /**
     * Report an invalidation event observed by the panel for one page.
     * @param {string} instanceId - reporting panel instance.
     * @param {number} generation - reporting generation.
     * @param {string} guestLease - webview guest lease the event is about.
     * @param {string} event - invalidation event name.
     * @param {string} [documentToken] - the document now in the guest, when the panel knows it.
     * @returns {object} applied invalidations.
     */
    function reportInvalidation(instanceId, generation, guestLease, event, documentToken) {
        const connection = connections.get(instanceId);
        if (connection === undefined || connection.generation !== generation) {
            return failure('connection_stale', 'the panel connection is not the current generation');
        }
        if (!INVALIDATION_EVENTS.includes(event))
            return failure('invalid_request', `unknown invalidation event ${event}`);
        const affected = [];
        for (const candidate of leases.values()) {
            if (candidate.connectionInstanceId !== instanceId || candidate.lease !== guestLease)
                continue;
            if (candidate.state !== 'active')
                continue;
            applyInvalidation(candidate, event, documentToken);
            affected.push({ controlLeaseId: candidate.id, state: candidate.state, epoch: candidate.epoch });
        }
        return success({ affected });
    }
    /**
     * Revoke control for one lease or for every lease of one Session.
     *
     * Revocation only detaches control: no page operation is emitted and the
     * page keeps running.
     * @param {object} input - which leases to revoke.
     * @param {string} [input.controlLeaseId] - one lease.
     * @param {string} [input.sessionId] - every lease of one Session.
     * @param {string} reason - why control ended.
     * @returns {object} revoked lease ids.
     */
    function revoke(input, reason) {
        const revoked = [];
        for (const lease of leases.values()) {
            if (lease.state !== 'active')
                continue;
            const matches = input.controlLeaseId !== undefined
                ? lease.id === input.controlLeaseId
                : lease.sessionId === input.sessionId;
            if (!matches)
                continue;
            applyInvalidation(lease, 'revoked');
            lease.revokedReason = reason;
            revoked.push(lease.id);
        }
        if (revoked.length === 0)
            return failure('not_authorized', 'no active control lease matches this request');
        return success({ revoked, pageRetained: true });
    }
    /**
     * Enqueue one operation for a lease and dispatch it when the lease is idle.
     *
     * The deadline covers queueing: a command that waited too long is never
     * dispatched, which is the only point where "not executed" is provable.
     * @param {ControlLease} lease - target lease.
     * @param {object} op - validated operation payload.
     * @param {import('./config.ts').BrowserFlowConfig} limits - resolved config.
     * @param {AbortSignal} [signal] - caller cancellation.
     * @returns {Promise<object>} settled outcome.
     */
    function run(lease, op, limits, signal) {
        if (lease.state !== 'active') {
            return Promise.resolve(failure('not_authorized', 'control for this page was revoked; authorize it again'));
        }
        if (signal?.aborted === true) {
            return Promise.resolve(failure('deadline_exceeded', 'the call was cancelled before dispatch'));
        }
        if (lease.queue.length + lease.inFlight.size >= limits.queueLimit) {
            return Promise.resolve(failure('queue_full', `this page already has ${String(limits.queueLimit)} pending operations`));
        }
        return new Promise(resolve => {
            const entry = {
                id: `cmd-${nextCommand++}`,
                op,
                resolve,
                signal,
                /** @type {(() => void) | undefined} */
                abortListener: undefined,
                settled: false,
                dispatched: false,
                deadlineAt: now() + limits.commandBudgetMs,
                sequence: -1,
            };
            lease.queue.push(entry);
            if (signal !== undefined) {
                const abort = () => { settleCancelled(lease, entry); };
                entry.abortListener = abort;
                signal.addEventListener('abort', abort, { once: true });
            }
            pump(lease, limits);
        });
    }
    /**
     * Settle a queued command as cancelled, or an already-dispatched one as unknown.
     * @param {ControlLease} lease - owning lease.
     * @param {CommandEntry} entry - queued entry.
     * @returns {void}
     */
    function settleCancelled(lease, entry) {
        if (entry.settled)
            return;
        const index = lease.queue.indexOf(entry);
        if (index >= 0) {
            lease.queue.splice(index, 1);
            finish(entry, failure('deadline_exceeded', 'the call was cancelled before it reached the page'));
            return;
        }
        const record = lease.inFlight.get(entry.id);
        if (record === undefined)
            return;
        if (!record.taken) {
            lease.inFlight.delete(entry.id);
            record.outcome = 'dropped';
            finish(entry, failure('deadline_exceeded', 'the call was cancelled before the panel took it'));
            return;
        }
        record.outcome = 'unknown_outcome';
        finish(entry, failure('unknown_outcome', 'the call was cancelled after dispatch; the page may have changed'));
    }
    /**
     * Settle one entry exactly once.
     * @param {CommandEntry} entry - entry to settle.
     * @param {object} outcome - settled value.
     * @returns {void}
     */
    function finish(entry, outcome) {
        if (entry.settled)
            return;
        entry.settled = true;
        if (entry.signal !== undefined && entry.abortListener !== undefined) {
            entry.signal.removeEventListener('abort', entry.abortListener);
        }
        entry.resolve(outcome);
    }
    /**
     * Dispatch the next queued command when the lease is idle.
     * @param {ControlLease} lease - lease to pump.
     * @param {import('./config.ts').BrowserFlowConfig} limits - resolved config.
     * @returns {void}
     */
    function pump(lease, limits) {
        if (lease.state !== 'active')
            return;
        if (lease.inFlight.size > 0)
            return;
        // Reauthorization explicitly selects the connection that may take work.
        const connection = liveConnectionFor(lease);
        for (;;) {
            const entry = lease.queue.shift();
            if (entry === undefined)
                return;
            if (connection === undefined) {
                finish(entry, failure('connection_stale', 'the plugin panel disconnected; authorize the page again'));
                continue;
            }
            if (now() >= entry.deadlineAt) {
                finish(entry, failure('deadline_exceeded', 'the call expired while queued and was not dispatched'));
                continue;
            }
            // The sequence is assigned when the panel takes the command, not here.
            // A command that expires before anyone takes it never reaches the panel,
            // so consuming its sequence here would leave the panel's counter behind
            // the Host's for every later command.
            entry.sequence = -1;
            const command = {
                id: entry.id,
                protocolVersion: PROTOCOL_VERSION,
                ...(lease.task ? { task: lease.task } : {}),
                leaseId: lease.id,
                connectionGeneration: connection.generation,
                epoch: lease.epoch,
                sequence: entry.sequence,
                // Absolute on this process's monotonic clock, kept for the Host's own
                // expiry check; budgetMs is the same deadline expressed as time left,
                // which is the only form another process can honour.
                deadlineAt: entry.deadlineAt,
                budgetMs: Math.max(0, entry.deadlineAt - now()),
                op: entry.op,
            };
            lease.inFlight.set(entry.id, { entry, command, outcome: 'pending', taken: false, delivery: undefined });
            return;
        }
    }
    /**
     * The live panel connection that may carry one lease's commands.
     *
     * A lease belongs to the panel instance that authorized it, and re-authorizing
     * rebinds it. That is exactly the lifetime of the panel's own binding: a
     * remounted panel has no authorization at all until the user grants one
     * again, so serving it the old lease's commands could only be refused. Being
     * strict also keeps a second panel from taking commands for a page it does not
     * control.
     * @param {ControlLease} lease - lease to deliver for.
     * @returns {PanelConnection | undefined} the connection that may carry it.
     */
    function liveConnectionFor(lease) {
        const recorded = connections.get(lease.connectionInstanceId);
        if (recorded === undefined || recorded.sessionId !== lease.sessionId
            || recorded.generation !== lease.connectionGeneration)
            return undefined;
        return recorded;
    }
    /**
     * Pump every lease.
     * @param {import('./config.ts').BrowserFlowConfig} limits - resolved config.
     * @returns {void}
     */
    function pumpAll(limits) {
        for (const lease of leases.values())
            pump(lease, limits);
    }
    /**
     * Take the commands one connection should execute now.
     *
     * A command the panel has not taken yet and whose deadline passed is dropped
     * without dispatch; a command already taken is never re-sent.
     * @param {string} instanceId - polling panel instance.
     * @param {number} generation - polling generation.
     * @param {import('./config.ts').BrowserFlowConfig} limits - resolved config.
     * @returns {object} commands and dropped ids.
     */
    function takeCommands(instanceId, generation, limits) {
        const connection = connections.get(instanceId);
        if (connection === undefined)
            return failure('page_unavailable', 'the plugin panel is not connected');
        if (connection.generation !== generation)
            return failure('connection_stale', 'the panel connection is not the current generation');
        // Settle overdue in-flight records before dispatching, so a stalled command
        // frees its slot in the same poll instead of holding the page busy.
        const dropped = expireInFlight();
        pumpAll(limits);
        const commands = [];
        for (const lease of leases.values()) {
            if (lease.state !== 'active')
                continue;
            // Deliver each lease's commands to one chosen panel, and only that panel
            // may take them. Handing them to whichever connection polls would let a
            // panel serving a different page pick up a command it cannot run, and the
            // sequence charged on take would then be spent on a refusal.
            const target = liveConnectionFor(lease);
            if (target === undefined)
                continue;
            if (target.instanceId !== instanceId)
                continue;
            for (const [id, record] of lease.inFlight) {
                if (record.outcome !== 'pending')
                    continue;
                if (record.taken)
                    continue;
                const remaining = record.command.deadlineAt - now();
                if (remaining <= 0) {
                    expireRecord(lease, id, record);
                    dropped.push(id);
                    continue;
                }
                record.command.budgetMs = remaining;
                record.taken = true;
                record.entry.dispatched = true;
                record.delivery = { instanceId, generation, epoch: lease.epoch };
                record.command.sequence = lease.nextSequence++;
                commands.push(record.command);
            }
        }
        return success({ commands, dropped });
    }
    /**
     * Settle in-flight records whose deadline has passed.
     *
     * A command the panel never took is dropped with `deadline_exceeded`; one it
     * took and never answered is `unknown_outcome`, because the page may already
     * have acted. Leaving either pending would keep the slot occupied for as long
     * as the panel kept polling, which is not the declared command budget.
     * @returns {string[]} ids settled this pass.
     */
    function expireInFlight() {
        const settled = [];
        for (const lease of leases.values()) {
            if (lease.state !== 'active')
                continue;
            for (const [id, record] of lease.inFlight) {
                if (record.outcome !== 'pending' && record.outcome !== 'unknown_outcome')
                    continue;
                if (now() < record.command.deadlineAt)
                    continue;
                expireRecord(lease, id, record);
                settled.push(id);
            }
        }
        return settled;
    }
    /**
     * Settle an expired command and remember its id for late replies.
     * @param {ControlLease} lease - owning lease.
     * @param {string} id - expired command id.
     * @param {InFlightRecord} record - expired entry and delivery state.
     * @returns {void}
     */
    function expireRecord(lease, id, record) {
        lease.inFlight.delete(id);
        lease.abandoned.add(id);
        if (lease.abandoned.size > ABANDONED_LIMIT) {
            const oldest = lease.abandoned.values().next().value;
            if (oldest !== undefined)
                lease.abandoned.delete(oldest);
        }
        if (record.taken) {
            record.outcome = 'unknown_outcome';
            finish(record.entry, failure('unknown_outcome', 'the panel took the command but did not report back in time'));
        }
        else {
            record.outcome = 'dropped';
            finish(record.entry, failure('deadline_exceeded', 'the command expired before the panel could take it'));
        }
    }
    /**
     * Accept one Client result and settle its command.
     *
     * A result that does not match the next expected sequence advances the epoch
     * and refuses the result: after a gap or a duplicate, the page's state cannot
     * be trusted.
     * @param {object} result - validated result envelope.
     * @param {import('./task-scope.ts').RunScope} [result.task] - immutable task/run echo.
   * @param {string} result.leaseId - control lease the result belongs to.
     * @param {number} result.connectionGeneration - panel generation that produced it.
     * @param {number} result.epoch - observation epoch the command ran under.
     * @param {number} result.sequence - the command's sequence.
     * @param {string} result.id - command id.
     * @param {string} result.instanceId - panel instance that produced it.
     * @param {'ok' | 'failed' | 'unknown_outcome' | 'dropped'} result.outcome - what the panel reports.
     * @param {object} [result.payload] - page value on success.
     * @param {{ code: string, message: string }} [result.error] - failure detail.
     * @param {import('./config.ts').BrowserFlowConfig} limits - resolved config.
     * @returns {object} settlement verdict.
     */
    function settle(result, limits) {
        const lease = leases.get(result.leaseId);
        if (lease === undefined)
            return failure('stale_observation', 'the control lease no longer exists');
        if (lease.state !== 'active')
            return failure('revoked', 'control for this page was revoked');
        if (lease.task && (!validRunScope(result.task) || !sameRunScope(lease.task, result.task)))
            return failure('task_scope_mismatch', 'receipt task/run does not own this command');
        const connection = connections.get(result.instanceId);
        if (connection === undefined || connection.sessionId !== lease.sessionId
            || result.instanceId !== lease.connectionInstanceId
            || connection.generation !== result.connectionGeneration
            || result.connectionGeneration !== lease.connectionGeneration) {
            return failure('connection_stale', 'the result is not from the authorized panel connection');
        }
        if (result.epoch !== lease.epoch) {
            return failure('stale_observation', 'the result belongs to another authorization epoch');
        }
        const record = lease.inFlight.get(result.id);
        if (record === undefined) {
            if (lease.lastCompletedCommandId === result.id) {
                return failure('protocol_violation', 'this result was already applied; duplicates are refused');
            }
            // The Host already gave up on this one (expired, or cancelled after
            // dispatch). The panel answering late is expected, not a protocol
            // violation, so control is kept rather than reset.
            if (lease.abandoned.has(result.id)) {
                return success({ settled: result.id, outcome: 'ignored' });
            }
            applyInvalidation(lease, 'document_replaced');
            return failure('protocol_violation', 'the result names no command in flight; control was reset');
        }
        const delivery = record.delivery;
        if (delivery === undefined || delivery.instanceId !== result.instanceId
            || delivery.generation !== result.connectionGeneration || delivery.epoch !== result.epoch) {
            return failure('connection_stale', 'the command was not delivered to this panel connection and epoch');
        }
        if (record.command.sequence !== result.sequence) {
            lease.inFlight.delete(result.id);
            applyInvalidation(lease, 'document_replaced');
            finish(record.entry, failure('protocol_violation', 'results arrived out of sequence; control was reset'));
            pump(lease, limits);
            return failure('protocol_violation', 'the result sequence is not the expected next sequence; control was reset');
        }
        lease.inFlight.delete(result.id);
        lease.lastCompletedCommandId = result.id;
        // The panel also compares the document identity before acting, but a
        // navigation can land between that check and the reply. A successful result
        // naming a different document is therefore not a result for this
        // authorization: retire the lease rather than hand its content to the
        // caller under an authorization granted for the previous page.
        /** @type {any} */
        const payload = result.payload;
        const reportedToken = result.outcome === 'ok' ? payload?.documentToken : undefined;
        // An empty lease token means the Host has not been told which document is
        // current, so it cannot prove a mismatch and must not invent one.
        if (typeof reportedToken === 'string' && reportedToken.length > 0
            && typeof lease.documentToken === 'string' && lease.documentToken.length > 0
            && reportedToken !== lease.documentToken) {
            applyInvalidation(lease, 'document_replaced');
            finish(record.entry, failure(/** @type {{kind?:string}} */ (record.entry.op).kind === 'act' ? 'unknown_outcome' : 'stale_observation', 'the page navigated during the command; authorize it again'));
            pump(lease, limits);
            return success({ settled: result.id, outcome: 'document_replaced' });
        }
        if (result.outcome === 'ok') {
            finish(record.entry, success(result.payload ?? {}));
        }
        else if (result.outcome === 'unknown_outcome') {
            finish(record.entry, failure('unknown_outcome', result.error?.message ?? 'the page outcome is unknown'));
        }
        else if (result.outcome === 'dropped') {
            finish(record.entry, failure('deadline_exceeded', result.error?.message ?? 'the page did not take the command'));
        }
        else {
            const reported = result.error?.code;
            const code = typeof reported === 'string' && ERROR_CODES.includes(reported) ? reported : 'internal';
            finish(record.entry, failure(code, result.error?.message ?? 'the page reported a failure'));
        }
        pump(lease, limits);
        return success({ settled: result.id, outcome: result.outcome });
    }
    /**
     * Describe one lease for diagnostics, without the Agent object.
     * @param {string} controlLeaseId - lease id.
     * @returns {object | undefined} description.
     */
    function describeLease(controlLeaseId) {
        const lease = leases.get(controlLeaseId);
        if (lease === undefined)
            return undefined;
        return {
            controlLeaseId: lease.id,
            state: lease.state,
            epoch: lease.epoch,
            sessionId: lease.sessionId,
            tabId: lease.tabId,
            guestLease: lease.lease,
            queueLength: lease.queue.length,
            inFlight: lease.inFlight.size,
            ...(lease.revokedReason === undefined ? {} : { revokedReason: lease.revokedReason }),
        };
    }
    /** @returns {number} number of registered connections. */
    function connectionCount() {
        return connections.size;
    }
    /** @returns {number} number of leases in any state. */
    function leaseCount() {
        return leases.size;
    }
    /**
     * End all calls and permanently discard the store's panel and Agent bindings.
     * @returns {void}
     */
    function close() {
        closed = true;
        for (const lease of leases.values()) {
            if (lease.state === 'active')
                applyInvalidation(lease, 'connection_lost');
        }
        leases.clear();
        connections.clear();
    }
    return {
        close,
        registerConnection,
        connectionsFor,
        expireIdleConnections,
        authorize,
        leaseFor,
        leaseCountForSession,
        retireLeasesOfReplacedAgents,
        listPages,
        reportInvalidation,
        revoke,
        run,
        pumpAll,
        takeCommands,
        settle,
        describeLease,
        connectionCount,
        leaseCount,
    };
}
