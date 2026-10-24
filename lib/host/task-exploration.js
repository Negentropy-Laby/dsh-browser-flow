/** ARTEX-compatible task semantics. Host facts, never graph output, drive transitions. */
import { randomUUID } from 'node:crypto';
import { sameRunScope, validRunScope } from "./task-scope.js";
import { eventResourceDescriptor } from "./task-resources.js";
import { EXPLORATION_LIMITS as LIMIT } from "./exploration-limits.js";
export class ExplorationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 2000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const refs = (v, max = LIMIT.refs) => Array.isArray(v) && v.length <= max && v.every(x => text(x, 200)) && new Set(v).size === v.length;
export const isExploration = (m) => m.schemaVersion === 2 && m.adapter === 'generic' && m.workflowRef === 'exploration';
export const explorationRun = (task) => ({ ...task.manifest.scope, runId: task.manifest.runId, workflowRef: task.manifest.workflowRef });
export function canonical(value) {
    return JSON.stringify(value, (_k, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
function fail(message, code = 'invalid_request') { throw new ExplorationError(code, message); }
function node(id, kind, source, state, data, asset_ids = []) { return { id, kind, source, state, data, asset_ids }; }
export const originId = (manifest) => `fact-origin-${manifest.scope.taskId}-r${manifest.scope.scopeRevision}`;
export function seedExploration(manifest) {
    const suffix = `${manifest.scope.taskId}-r${manifest.scope.scopeRevision}`, origin = originId(manifest);
    const nodes = [node(`goal-${suffix}`, 'goal', 'user_declared', 'open', { text: manifest.goal, mandatory: true, original: true }), node(origin, 'fact', 'host', 'origin', { summary: manifest.goal, origins: manifest.origins, confidence: 'instruction' })];
    manifest.criteria.forEach((label, i) => nodes.push(node(`goal-condition-${suffix}-${i + 1}`, 'goal', 'user_declared', 'open', { text: label, mandatory: true, original: true })));
    manifest.constraints.forEach((label, i) => nodes.push(node(`hint-${suffix}-${i + 1}`, 'hint', 'user_declared', 'active', { text: label })));
    const edges = nodes.filter(n => n.kind === 'goal').map(n => ({ id: `seed-${n.id}`, from: origin, to: n.id, relation: 'spawns' }));
    return { nodes, edges, updates: [], round: false, completed: false };
}
/** Initial state and transition rules shared by replay and append preflight. */
function initialNode(n) {
    return n.kind === 'goal' ? n.state === 'open' : n.kind === 'intent' ? n.state === 'open' : n.kind === 'hint' ? n.state === 'active' : n.kind === 'fact' && (n.source === 'host' ? n.state === 'origin' : n.state === 'confirmed');
}
function updateAllowed(n, state) {
    return n.kind === 'goal' ? state === 'met' && ['open', 'met'].includes(n.state) : n.kind === 'intent' && (n.state === 'open' && state === 'running' || n.state === 'running' && ['done', 'blocked', 'exhausted', 'stopped'].includes(state));
}
function readonlyMap(map) {
    return Object.freeze({ get size() { return map.size; }, get: (k) => map.get(k), has: (k) => map.has(k), entries: () => map.entries(), keys: () => map.keys(), values: () => map.values(), [Symbol.iterator]: () => map[Symbol.iterator](), forEach: (f, thisArg) => map.forEach((v, k) => f.call(thisArg, v, k, readonlyMap(map))) });
}
function frozen(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const v of Object.values(value))
            frozen(v);
        Object.freeze(value);
    }
    return value;
}
function validateChange(state, change, assets) {
    const added = new Map(), updates = new Map();
    let running = state.currentIntent?.id;
    for (const n of change.nodes) {
        if (state.nodes.has(n.id) || added.has(n.id) || assets.has(n.id) || !initialNode(n))
            fail('invalid exploration node state or duplicate ID', 'task_unavailable');
        added.set(n.id, n);
    }
    for (const update of change.updates) {
        const n = updates.get(update.id) ?? added.get(update.id) ?? state.nodes.get(update.id);
        if (!n || !updateAllowed(n, update.state))
            fail('invalid exploration state transition', 'task_unavailable');
        updates.set(n.id, { ...n, state: update.state });
        if (n.kind === 'intent') {
            if (update.state === 'running') {
                if (running && running !== n.id)
                    fail('multiple running intents', 'task_unavailable');
                running = n.id;
            }
            else if (running === n.id)
                running = undefined;
        }
    }
    for (const edge of change.edges)
        if (![edge.from, edge.to].every(id => state.nodes.has(id) || added.has(id) || assets.has(id)))
            fail('missing or foreign exploration endpoint', 'task_unavailable');
}
function applyChange(state, change, seq, assets) {
    validateChange(state, change, assets);
    for (const n of change.nodes)
        state.nodes.set(n.id, frozen({ ...structuredClone(n), sourceSeq: seq }));
    for (const update of change.updates) {
        const n = state.nodes.get(update.id), next = frozen({ ...n, state: update.state });
        state.nodes.set(n.id, next);
        if (n.kind === 'intent')
            state.currentIntent = update.state === 'running' ? next : state.currentIntent?.id === n.id ? undefined : state.currentIntent;
    }
    for (const edge of change.edges)
        state.edges.push(frozen({ ...edge }));
    if (change.completed)
        for (const n of state.nodes.values())
            if (n.kind === 'intent' && n.state === 'open')
                state.nodes.set(n.id, frozen({ ...n, state: 'stopped' }));
    if (change.round)
        state.round++;
    state.phase = state.currentIntent ? 'worker' : 'planner';
}
/** One task owns one incremental derived index. Original journal data stays authoritative. */
function derivedIndex(task) {
    const run = explorationRun(task);
    let index = task.derivedIndex;
    if (!index || !sameRunScope(index.run, run) || index.processed > task.events.length || (index.processed ? task.events[index.processed - 1]?.hash : '') !== index.tail) {
        const state = { nodes: new Map(), edges: [], phase: 'planner', currentIntent: undefined, round: 0 }, resources = new Map(), assets = new Map(), currentAssets = new Set();
        if (isExploration(task.manifest))
            applyChange(state, seedExploration(task.manifest), 1, currentAssets);
        index = { run, processed: 0, tail: '', assets, currentAssets, state, resources, view: state, resourceView: readonlyMap(resources) };
        task.derivedIndex = index;
    }
    const changed = index.processed !== task.events.length || index.view === index.state;
    while (index.processed < task.events.length) {
        const event = task.events[index.processed], same = validRunScope(event.data.run) && sameRunScope(event.data.run, run);
        if (event.type === 'asset') {
            const id = String(event.data.id);
            index.assets.set(id, frozen(structuredClone(event)));
            if (same) {
                index.currentAssets.add(id);
                const d = eventResourceDescriptor(event, run), r = index.resources.get(d.id);
                index.resources.set(d.id, frozen({ id: d.id, kind: String(event.data.kind), snapshots: [...(r?.snapshots ?? []), id], run }));
            }
        }
        if (same && isExploration(task.manifest) && event.type === 'exploration')
            applyChange(index.state, event.data.changes, event.seq, index.currentAssets);
        index.processed++;
        index.tail = event.hash;
    }
    if (changed)
        index.view = Object.freeze({ ...index.state, nodes: readonlyMap(index.state.nodes), edges: Object.freeze([...index.state.edges]) });
    return index;
}
export function explorationState(task) { return derivedIndex(task).view; }
export function taskAsset(task, id, currentRunOnly = false) {
    const index = derivedIndex(task);
    return !currentRunOnly || index.currentAssets.has(id) ? index.assets.get(id) : undefined;
}
/** Validate only the proposed delta against the accepted prefix, without replay or mutation. */
export function assertExplorationChange(task, change) {
    const index = derivedIndex(task);
    validateChange(index.view, change, index.currentAssets);
}
export function validExplorationEvent(row) {
    if (!text(row.requestId, 100) || !Number.isSafeInteger(row.expectedVersion) || Number(row.expectedVersion) < 1 || !object(row.command) || !object(row.result) || !object(row.changes))
        return false;
    try {
        validateExplorationCommand(row.command);
    }
    catch {
        return false;
    }
    const c = row.changes;
    if (c.completed === true && row.command.op !== 'prove_goal')
        return false;
    if (Object.keys(c).some(k => !['nodes', 'edges', 'updates', 'round', 'completed'].includes(k)) || !Array.isArray(c.nodes) || !Array.isArray(c.edges) || !Array.isArray(c.updates) || c.nodes.length > LIMIT.nodes || c.edges.length > LIMIT.edges || c.updates.length > 33 || typeof c.round !== 'boolean' || typeof c.completed !== 'boolean')
        return false;
    if (!c.nodes.every(n => object(n) && Object.keys(n).every(k => ['id', 'kind', 'source', 'state', 'data', 'asset_ids'].includes(k)) && text(n.id, 200) && ['goal', 'intent', 'fact', 'hint'].includes(String(n.kind)) && n.source === 'agent' && text(n.state, 30) && object(n.data) && refs(n.asset_ids)))
        return false;
    if (!c.edges.every(e => object(e) && Object.keys(e).every(k => ['id', 'from', 'to', 'relation'].includes(k)) && text(e.id, 200) && text(e.from, 200) && text(e.to, 200) && ['spawns', 'derived_from', 'yields', 'proves', 'observed_on', 'validated_by'].includes(String(e.relation))))
        return false;
    if (!c.updates.every(u => object(u) && Object.keys(u).every(k => ['id', 'state'].includes(k)) && text(u.id, 200) && ['running', 'done', 'blocked', 'exhausted', 'stopped', 'met'].includes(String(u.state))))
        return false;
    return JSON.stringify(row).length <= LIMIT.eventChars;
}
/** Reject an entire planned batch before evidence reads or any durable effects. */
export function assertExplorationCapacity(row) {
    const edges = row.changes.edges.length, size = JSON.stringify(row).length;
    if (edges > LIMIT.edges)
        fail(`exploration batch has ${edges} edges; maximum ${LIMIT.edges}; split facts into smaller requests`);
    if (size > LIMIT.eventChars)
        fail(`exploration event has ${size} characters; maximum ${LIMIT.eventChars}; split or shorten facts`);
}
export const EXPLORATION_OPS = ['set_goals', 'add_hint', 'add_intent', 'claim_intent', 'finish_intent', 'record_fact', 'check_evidence', 'prove_goal'];
export function validateExplorationCommand(command) {
    if (!object(command) || !EXPLORATION_OPS.includes(command.op))
        fail('provide a bounded exploration operation');
    const size = JSON.stringify(command).length;
    if (size > LIMIT.commandChars)
        fail(`exploration command has ${size} characters; maximum ${LIMIT.commandChars}; split or shorten the request`);
    const fields = { set_goals: ['text', 'goals'], add_hint: ['text', 'asset_ids'], add_intent: ['summary', 'asset_ids', 'parent_ids', 'priority', 'intents'], claim_intent: ['intent_id'], finish_intent: ['intent_id', 'state', 'reason'], record_fact: ['summary', 'detail', 'evidence', 'confidence', 'intent_id', 'asset_ids', 'evidence_refs', 'check_refs', 'facts'], check_evidence: ['assertion'], prove_goal: ['goal_id', 'evidence_id', 'reason'] };
    if (Object.keys(command).some(k => k !== 'op' && !fields[String(command.op)].includes(k)))
        fail('unknown exploration argument');
}
export function currentResources(task) { return derivedIndex(task).resourceView; }
/** Explicit resource and exact-snapshot anchors share the same Host relation index. */
export function resourceAnchors(state, resources) {
    const anchors = new Map([...resources.keys()].map(id => [id, new Set()])), snapshots = new Map();
    for (const resource of resources.values())
        for (const ref of resource.snapshots)
            snapshots.set(ref, resource.id);
    for (const node of state.nodes.values())
        for (const id of node.asset_ids)
            anchors.get(id)?.add(node.id);
    for (const edge of state.edges)
        for (const [snapshot, node] of [[edge.from, edge.to], [edge.to, edge.from]]) {
            const resource = snapshots.get(snapshot);
            if (resource && state.nodes.has(node))
                anchors.get(resource).add(node);
        }
    return anchors;
}
export function planExploration(task, command, checkPassed, checkRef) {
    validateExplorationCommand(command);
    const state = explorationState(task), resources = currentResources(task), changes = { nodes: [], edges: [], updates: [], round: false, completed: false };
    const op = String(command.op), result = { op, businessInterpretation: 'agent' };
    const add = (kind, status, data, anchors = []) => {
        const n = node(`${kind}-${randomUUID()}`, kind, 'agent', status, data, anchors);
        changes.nodes.push(n);
        for (const id of anchors) {
            const snapshot = resources.get(id)?.snapshots.at(-1);
            if (snapshot)
                edge(snapshot, n.id, 'observed_on');
        }
        ;
        return n;
    };
    const edge = (from, to, relation) => changes.edges.push({ id: 'edge-' + randomUUID(), from, to, relation });
    const anchors = (raw) => { if (raw === undefined)
        return []; if (!refs(raw) || raw.some(id => !resources.has(id)))
        fail('asset_ids must be current task resource IDs'); return raw; };
    const planner = () => { if (state.phase !== 'planner')
        fail('finish the current intent before planning', 'task_busy'); };
    const one = (id, kind) => { if (!text(id, 200))
        fail(`provide ${kind} id`); const n = state.nodes.get(id); if (!n || n.kind !== kind)
        fail(`${kind} belongs to another task/run or is unavailable`, 'task_not_bound'); return n; };
    if (op === 'set_goals') {
        planner();
        const items = command.goals ?? [{ text: command.text }];
        if (!Array.isArray(items) || !items.length || items.length > 32)
            fail('provide 1 to 32 goals');
        result.ids = items.map(item => { if (!object(item) || Object.keys(item).some(k => k !== 'text') || !text(item.text))
            fail('goals require text'); const n = add('goal', 'open', { text: item.text, mandatory: true, original: false }); edge(originId(task.manifest), n.id, 'spawns'); return n.id; });
    }
    else if (op === 'add_hint') {
        if (!text(command.text))
            fail('hint text required');
        result.id = add('hint', 'active', { text: command.text }, anchors(command.asset_ids)).id;
    }
    else if (op === 'add_intent') {
        planner();
        const items = command.intents ?? [Object.fromEntries(Object.entries(command).filter(([k]) => k !== 'op'))];
        if (!Array.isArray(items) || !items.length || items.length > 4)
            fail('provide 1 to 4 exploration directions per planning round');
        result.ids = items.map(item => {
            if (!object(item) || Object.keys(item).some(k => !['summary', 'asset_ids', 'parent_ids', 'priority'].includes(k)) || !text(item.summary))
                fail('intent summary required');
            const priority = item.priority ?? 5;
            if (!Number.isInteger(priority) || Number(priority) < 0 || Number(priority) > 10)
                fail('priority must be 0 to 10; larger first');
            const parents = item.parent_ids ?? [];
            if (!refs(parents))
                fail('parent_ids must be fact references');
            for (const id of parents)
                one(id, 'fact');
            const n = add('intent', 'open', { summary: item.summary, priority }, anchors(item.asset_ids));
            for (const id of parents.length ? parents : [originId(task.manifest)])
                edge(id, n.id, 'derived_from');
            return n.id;
        });
    }
    else if (op === 'claim_intent') {
        planner();
        const n = command.intent_id === undefined ? [...state.nodes.values()].filter(n => n.kind === 'intent' && n.state === 'open').sort((a, b) => Number(b.data.priority) - Number(a.data.priority) || Number(a.sourceSeq) - Number(b.sourceSeq))[0] : one(command.intent_id, 'intent');
        if (!n || n.state !== 'open')
            fail('select an open intent', 'task_busy');
        changes.updates.push({ id: n.id, state: 'running' });
        changes.round = true;
        result.intent_id = n.id;
    }
    else if (op === 'finish_intent') {
        const n = one(command.intent_id ?? state.currentIntent?.id, 'intent'), status = command.state ?? 'done';
        if (n !== state.currentIntent || !['done', 'blocked', 'exhausted', 'stopped'].includes(String(status)))
            fail('only the running intent can finish');
        if (status === 'done' && ![...state.nodes.values()].some(f => f.kind === 'fact' && f.data.intent_id === n.id))
            fail('record the exploration result before finishing');
        if (status !== 'done' && !text(command.reason, 1000))
            fail('an unfinished direction requires a reason');
        changes.updates.push({ id: n.id, state: String(status) });
        result.intent_id = n.id;
        result.state = status;
    }
    else if (op === 'record_fact') {
        const intent = one(command.intent_id ?? state.currentIntent?.id, 'intent');
        if (intent !== state.currentIntent)
            fail('facts must belong to the running intent', 'task_busy');
        const items = command.facts ?? [Object.fromEntries(Object.entries(command).filter(([k]) => k !== 'op'))];
        if (!Array.isArray(items) || !items.length || items.length > 32)
            fail('provide bounded facts');
        result.ids = items.map(item => {
            if (!object(item) || Object.keys(item).some(k => !['summary', 'detail', 'evidence', 'confidence', 'intent_id', 'asset_ids', 'evidence_refs', 'check_refs'].includes(k)) || !text(item.summary) || !['observed', 'inferred'].includes(String(item.confidence)) || (item.detail !== undefined && !text(item.detail, 8000)) || (item.evidence !== undefined && !text(item.evidence, 2000)) || (item.intent_id !== undefined && item.intent_id !== intent.id))
                fail('provide a fact summary and observed/inferred confidence');
            const evidenceRefs = item.evidence_refs ?? [], checks = item.check_refs ?? [];
            if (!refs(evidenceRefs, LIMIT.sources) || !refs(checks) || (item.confidence === 'observed' && !evidenceRefs.length))
                fail('observed facts require at most 64 original snapshots and at most 32 check references');
            for (const id of evidenceRefs) {
                const e = taskAsset(task, id, true);
                if (!e || !['page', 'file'].includes(String(e.data.kind)) || !object(e.data.data) || e.data.data.contextOnly === true)
                    fail('fact evidence must be current original observations or files', 'task_not_bound');
            }
            for (const id of checks)
                if (!checkPassed(id, evidenceRefs))
                    fail('check is unavailable, failed or bound to different evidence');
            const n = add('fact', 'confirmed', { summary: item.summary, ...(item.detail ? { detail: item.detail } : {}), ...(item.evidence ? { evidence: item.evidence } : {}), confidence: item.confidence, intent_id: intent.id, evidence_refs: evidenceRefs, check_refs: checks }, anchors(item.asset_ids));
            edge(intent.id, n.id, 'yields');
            for (const id of evidenceRefs)
                edge(id, n.id, 'observed_on');
            for (const id of checks)
                edge(n.id, id, 'validated_by');
            return n.id;
        });
    }
    else if (op === 'check_evidence') {
        if (!checkRef)
            fail('source-backed evidence check unavailable');
        result.check_ref = checkRef;
    }
    else if (op === 'prove_goal') {
        planner();
        const goal = one(command.goal_id, 'goal'), fact = one(command.evidence_id, 'fact');
        if (!text(command.reason))
            fail('explain why this fact meets the goal');
        const checks = fact.data.check_refs, evidenceRefs = fact.data.evidence_refs;
        if (fact.data.confidence !== 'observed' || !refs(checks) || !checks.length || !refs(evidenceRefs, LIMIT.sources) || !evidenceRefs.length || !checks.every(id => checkPassed(id, evidenceRefs)))
            fail('goal proof requires an observed fact and currently passing source-backed checks');
        changes.updates.push({ id: goal.id, state: 'met' });
        edge(fact.id, goal.id, 'proves');
        result.goal_id = goal.id;
        result.evidence_id = fact.id;
        result.proofSource = 'agent';
        result.evidenceVerification = 'host_checked';
        changes.completed = [...state.nodes.values()].filter(n => n.kind === 'goal').every(n => n.id === goal.id || n.state === 'met') && !task.pendingWrite && !task.waiting && !task.blocked && !task.unhealthy;
    }
    return { changes, result };
}
/** Only semantic observed facts with source-backed checks can establish a goal. */
export function proofAvailable(state, goalId, check) {
    return state.edges.some(edge => {
        if (edge.to !== goalId || edge.relation !== 'proves')
            return false;
        const f = state.nodes.get(edge.from), evidence = f?.data.evidence_refs, checks = f?.data.check_refs;
        return f?.kind === 'fact' && f.data.confidence === 'observed' && refs(evidence, LIMIT.sources) && evidence.length > 0 && refs(checks) && checks.length > 0 && checks.every(id => check(id, evidence));
    });
}
export function explorationNodeView(n, state, check, compact = false) {
    const summary = String(n.data.summary ?? n.data.text ?? ''), data = compact ? { summary: summary.slice(0, 240), ...(n.kind === 'goal' ? { text: summary.slice(0, 240) } : {}), ...(typeof n.data.confidence === 'string' ? { confidence: n.data.confidence } : {}), ...(typeof n.data.priority === 'number' ? { priority: n.data.priority } : {}) } : n.data;
    return { ...n, data, summary: compact ? summary.slice(0, 160) : summary, ...(n.kind === 'goal' ? { text: compact ? summary.slice(0, 160) : summary, proofSource: n.state === 'met' ? 'agent' : null, evidenceVerification: n.state === 'met' ? proofAvailable(state, n.id, check) ? 'host_checked' : 'unavailable' : null } : {}), ...(compact ? { details: n.id } : {}) };
}
export function explorationOverview(task, state = explorationState(task), resources = currentResources(task), check = () => false) {
    const goals = [], facts = [], hints = [], open = [], running = [], done = [];
    for (const n of state.nodes.values()) {
        if (n.kind === 'goal')
            goals.push(n);
        else if (n.kind === 'fact' && n.id !== originId(task.manifest))
            facts.push(n);
        else if (n.kind === 'hint')
            hints.push(n);
        else if (n.kind === 'intent')
            (n.state === 'open' ? open : n.state === 'running' ? running : done).push(n);
    }
    const factIds = new Set(facts.map(n => n.id)), anchors = resourceAnchors(state, resources), explorable = [...resources.values()].filter(r => ['page', 'file'].includes(r.kind));
    const denominator = explorable.length, count = explorable.filter(r => [...anchors.get(r.id)].some(id => factIds.has(id))).length;
    const compact = (n) => explorationNodeView(n, state, check, true);
    return { phase: state.phase, currentIntent: state.currentIntent?.id ?? null, round: state.round, originRef: originId(task.manifest),
        goals: goals.slice(0, 8).map(compact), goals_total: goals.length, goals_unmet: goals.filter(n => n.state !== 'met').length, goals_details: { op: 'list_goals' },
        hints: hints.slice(-8).map(compact), open_intents: open.sort((a, b) => Number(b.data.priority) - Number(a.data.priority)).slice(0, 8).map(compact), running_intents: running.map(compact), recent_done_intents: done.slice(-8).map(compact), recent_facts: facts.slice(-8).map(compact), facts_total: facts.length,
        assetCoverage: { denominator, tested: count, pct: denominator ? count / denominator : null, note: 'Known task resources anchored by facts; not business success or all website functions.' },
        verification: 'last_checked; use explicit task reads to revalidate originals', details: 'graph:exploration' };
}
