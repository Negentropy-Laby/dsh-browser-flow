/** Cross-process output validation against the exact sanitized replay input. */
import { GraphError, record } from "./protocol.js";
function bad() { throw new GraphError('invalid_projection'); }
function object(value) { return record(value) ? value : bad(); }
function list(value) { return Array.isArray(value) ? value : bad(); }
function keys(value, allowed) { if (Object.keys(value).some(key => !allowed.includes(key)))
    bad(); }
function integer(value) { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    bad(); }
function equal(a, b) { if (record(a) && record(b)) {
    const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
    return equal(ak, bk) && ak.every(k => equal(a[k], b[k]));
} ; if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i])); return a === b; }
function expected(input) {
    const result = new Map(), edges = new Map(), goal = (s) => `goal-${s.taskId}-r${s.scopeRevision}`;
    const add = (id, node) => { const prior = result.get(id); if (prior) {
        prior.data = node.data;
        prior.sourceSeq = node.sourceSeq;
    }
    else
        result.set(id, node); };
    const link = (id, from, to, relation, sourceSeq) => {
        if (!result.has(from) || !result.has(to))
            return;
        if (edges.has(id))
            bad();
        edges.set(id, { id, taskId: input.scope.taskId, from, to, relation, sourceSeq });
    };
    for (const e of input.events) {
        const run = JSON.stringify([e.run.profileId, e.run.taskId, e.run.ownerSessionId, e.run.scopeRevision, e.run.runId, e.run.workflowRef]);
        if (e.type === 'created' || e.type === 'revise')
            add(goal(e.run), { kind: 'goal', source: 'user_declared', sourceSeq: e.seq, data: { goal: e.goal }, run });
        if (e.type === 'asset' && e.id)
            add(e.id, { kind: e.kind ?? '', source: e.source ?? '', sourceSeq: e.seq, data: e.kind === 'page' ? { documentToken: e.documentToken ?? '' } : {}, run });
        if (e.type === 'attempt' && e.id) {
            add(e.id, { kind: 'intent', source: 'model_intent', sourceSeq: e.seq, data: { action: e.action, status: 'pending', businessSuccess: false }, run });
            link(`intent-edge-${e.seq}`, e.id, goal(e.run), 'attempts', e.seq);
        }
        if (e.type === 'receipt' && e.id) {
            const a = result.get(e.id);
            if (a)
                a.data.status = e.outcome;
            const id = `receipt-${input.scope.taskId}-${e.seq}`;
            add(id, { kind: 'receipt', source: 'host', sourceSeq: e.seq, data: { outcome: e.outcome }, run });
            link(`receipt-edge-${e.seq}`, id, e.id, 'records', e.seq);
        }
        if (e.type === 'edge')
            link(e.id ?? '', e.from ?? '', e.to ?? '', e.relation ?? '', e.seq);
    }
    const run = JSON.stringify([input.scope.profileId, input.scope.taskId, input.scope.ownerSessionId, input.scope.scopeRevision, input.scope.runId, input.scope.workflowRef]);
    add(goal(input.scope), { kind: 'goal', source: 'user_declared', sourceSeq: 1, data: { goal: input.goal }, run });
    for (const c of input.criteria) {
        add(c.id, { kind: 'criterion', source: c.source, sourceSeq: 1, data: { label: c.label, status: c.status, validatorId: c.validatorId ?? '', validatorVersion: c.version ?? 0 }, run });
        if (c.source === 'code_verified' && c.status === 'passed')
            link(`proof-edge-${input.proofSeq}-${c.id}`, input.proofRef, c.id, 'proves', input.proofSeq);
    }
    return { refs: result, edges };
}
function metadata(value, refs, asset = false) {
    const row = object(value);
    keys(row, ['id', 'kind', 'source', 'sourceSeq', ...(asset ? ['documentToken'] : [])]);
    if (typeof row.id !== 'string')
        bad();
    const source = refs.get(row.id);
    if (!source || row.kind !== source.kind || row.source !== source.source || row.sourceSeq !== source.sourceSeq)
        bad();
    if (asset && source.kind === 'page') {
        if (row.documentToken !== source.data.documentToken)
            bad();
    }
    else if ('documentToken' in row)
        bad();
}
function digests(value, refs, input, hash) {
    const all = new Map(), covered = new Set(), protectedRefs = new Set(input.protected);
    for (const valueRow of list(value)) {
        const row = object(valueRow);
        keys(row, ['id', 'members', 'anchors', 'outcomes', 'sourceSeqs', 'signature']);
        if (typeof row.signature !== 'string' || !/^[a-f0-9]{64}$/.test(row.signature) || row.id !== `digest-${hash}-${row.signature}`)
            bad();
        const members = list(row.members), memberSet = new Set(members), anchors = list(row.anchors);
        if (members.length < input.minGroup)
            bad();
        let run;
        const outcomes = {}, seqs = [];
        for (const id of members) {
            if (typeof id !== 'string' || covered.has(id) || protectedRefs.has(id))
                bad();
            const node = refs.get(id);
            if (!node || !['intent', 'receipt'].includes(node.kind) || ['pending', 'unknown_outcome'].includes(String(node.data.status ?? node.data.outcome)))
                bad();
            if (run && run !== node.run)
                bad();
            run = node.run;
            covered.add(id);
            seqs.push(node.sourceSeq);
            if (node.kind === 'receipt') {
                const outcome = String(node.data.outcome);
                outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
            }
        }
        for (const id of anchors)
            if (typeof id !== 'string' || !refs.has(id) || memberSet.has(id))
                bad();
        if (!equal(outcomes, row.outcomes) || !equal(seqs.sort((a, b) => a - b), row.sourceSeqs))
            bad();
        if (all.has(String(row.id)))
            bad();
        all.set(String(row.id), { row, members: memberSet });
    }
    return all;
}
function edge(value, input, refs, ds, edges) {
    const row = object(value);
    keys(row, ['id', 'taskId', 'from', 'to', 'relation', 'sourceSeq']);
    if (row.taskId !== input.scope.taskId || typeof row.from !== 'string' || typeof row.to !== 'string' || !refs.has(row.to))
        bad();
    if (row.relation === 'covers') {
        const d = ds.get(row.from);
        if (!d || !d.members.has(row.to) || row.id !== row.from + ':' + row.to || row.sourceSeq !== 0)
            bad();
        return;
    }
    if (typeof row.id !== 'string' || !equal(row, edges.get(row.id)))
        bad();
}
function attempt(value, refs, frontier) {
    const row = object(value);
    keys(row, ['id', 'action', 'status', 'sourceSeq', 'source', 'businessSuccess']);
    if (typeof row.id !== 'string')
        bad();
    const n = refs.get(row.id);
    if (!n || n.kind !== 'intent' || row.action !== n.data.action || row.status !== n.data.status || row.sourceSeq !== n.sourceSeq || row.source !== 'model_intent' || row.businessSuccess !== false)
        bad();
    if (frontier && !['pending', 'unknown_outcome'].includes(String(row.status)))
        bad();
}
/** @param value - worker payload. @param input - original safe input. @param hash - projection identity. @returns Closed owned view with no generated authority fields. */
export function validateView(value, input, hash) {
    const v = object(value);
    if (Object.keys(v).sort().join(',') !== 'active_context,knowledge_graph,procedural_law_index,technical_law_index')
        bad();
    const p = object(v.procedural_law_index), t = object(v.technical_law_index), g = object(v.knowledge_graph), a = object(v.active_context), { refs, edges: expectedEdges } = expected(input);
    keys(p, ['goal', 'constraints', 'criteria', 'intents', 'frontier', 'details', 'criteriaRef']);
    keys(t, ['assets', 'total', 'byKind']);
    keys(g, ['nodes', 'edges', 'totalEdges', 'totalNodes', 'digests', 'digestCount', 'details']);
    keys(a, ['recentAssets', 'round', 'complete', 'truncated']);
    if (p.goal !== undefined && !equal(p.goal, { text: input.goal, source: 'user_declared' }))
        bad();
    if (p.constraints !== undefined && !equal(p.constraints, input.constraints))
        bad();
    if (p.criteria !== undefined && !equal(p.criteria, input.criteria))
        bad();
    for (const row of p.intents === undefined ? [] : list(p.intents))
        attempt(row, refs, false);
    for (const row of p.frontier === undefined ? [] : list(p.frontier))
        attempt(row, refs, true);
    for (const row of t.assets === undefined ? [] : list(t.assets))
        metadata(row, refs, true);
    for (const row of a.recentAssets === undefined ? [] : list(a.recentAssets))
        metadata(row, refs, true);
    for (const row of g.nodes === undefined ? [] : list(g.nodes))
        metadata(row, refs);
    const ds = digests(g.digests ?? [], refs, input, hash);
    for (const row of g.edges === undefined ? [] : list(g.edges))
        edge(row, input, refs, ds, expectedEdges);
    for (const row of [t.total, g.totalEdges, g.totalNodes, g.digestCount, a.round])
        if (row !== undefined)
            integer(row);
    if (t.byKind !== undefined) {
        const counts = object(t.byKind);
        keys(counts, ['page', 'file', 'unit_check', 'import_result', 'evidence']);
        for (const count of Object.values(counts))
            integer(count);
    }
    if (typeof a.complete !== 'boolean' || (a.truncated !== undefined && typeof a.truncated !== 'boolean'))
        bad();
    if ((g.details !== undefined && g.details !== 'graph') || (p.details !== undefined && p.details !== 'goal') || (p.criteriaRef !== undefined && p.criteriaRef !== 'criteria'))
        bad();
    return v;
}
/** @param value - detail reply. @param ref - requested reference. @param input - original safe input. @param hash - projection identity. @returns Owned immutable detail. */
export function validateDetail(value, ref, input, hash) {
    const v = object(value), { refs, edges: expectedEdges } = expected(input);
    const node = (value, ds) => {
        const n = object(value);
        keys(n, ['id', 'taskId', 'kind', 'source', 'sourceSeq', 'data']);
        if (n.taskId !== input.scope.taskId || typeof n.id !== 'string')
            bad();
        if (n.kind === 'digest') {
            const d = ds.get(n.id);
            if (!d || n.source !== 'derived' || !equal(n.data, { signature: d.row.signature }))
                bad();
            return;
        }
        const original = refs.get(n.id);
        if (!original || n.kind !== original.kind || n.source !== original.source || n.sourceSeq !== original.sourceSeq || !equal(n.data, original.data))
            bad();
    };
    if (ref === 'graph') {
        keys(v, ['nodes', 'edges', 'digests']);
        const ds = digests(v.digests, refs, input, hash);
        const nodes = list(v.nodes), edges = list(v.edges), nodeIds = new Set(), edgeIds = new Set();
        for (const n of nodes) {
            node(n, ds);
            const id = object(n).id;
            if (nodeIds.has(id))
                bad();
            nodeIds.add(id);
        }
        if (nodeIds.size !== refs.size + ds.size)
            bad();
        for (const e of edges) {
            edge(e, input, refs, ds, expectedEdges);
            const id = object(e).id;
            if (edgeIds.has(id))
                bad();
            edgeIds.add(id);
        }
        const expectedCount = expectedEdges.size + [...ds.values()].reduce((sum, d) => sum + d.members.size, 0);
        if (edgeIds.size !== expectedCount)
            bad();
    }
    else if (ref.startsWith('digest-')) {
        if (v.id !== ref)
            bad();
        digests([v], refs, input, hash);
    }
    else {
        if (v.id !== ref)
            bad();
        node(v, new Map());
    }
    return v;
}
