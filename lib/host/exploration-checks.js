import { isRecord as object } from "./object.js";
/** Bounded source-backed assertions. No eval, executable paths, or business ontology. */
import { canonical, ExplorationError } from "./task-exploration.js";
import { EXPLORATION_LIMITS as LIMIT } from "./exploration-limits.js";
const bad = () => { throw new ExplorationError('invalid_request', 'provide at most 32 source-backed assertions with bounded paths and values'); };
function operand(v, sourceOnly = false) {
    if (!object(v))
        return false;
    if (!sourceOnly && Object.keys(v).length === 1 && 'value' in v)
        return JSON.stringify(v).length <= 32000;
    return Object.keys(v).every(k => ['ref', 'path'].includes(k)) && typeof v.ref === 'string' && v.ref.startsWith('asset-') && v.ref.length <= 100 && Array.isArray(v.path) && v.path.length <= 16 && v.path.every(p => typeof p === 'number' ? Number.isSafeInteger(p) && p >= 0 : typeof p === 'string' && p.length <= 120 && !['__proto__', 'constructor', 'prototype'].includes(p));
}
export function validateAssertion(v) {
    const atom = (a) => object(a) && Object.keys(a).every(k => ['op', 'left', 'right'].includes(k)) && ['exists', 'equals', 'contains', 'count', 'setEquals'].includes(String(a.op)) && operand(a.left, true) && (a.op === 'exists' ? a.right === undefined : operand(a.right));
    if (!object(v))
        return bad();
    if (['all', 'any'].includes(String(v.op))) {
        if (Object.keys(v).some(k => !['op', 'checks'].includes(k)) || !Array.isArray(v.checks) || !v.checks.length || v.checks.length > LIMIT.atoms || !v.checks.every(atom))
            bad();
    }
    else if (!atom(v))
        bad();
}
export function assertionRefs(assertion) {
    const atoms = 'checks' in assertion ? assertion.checks : [assertion];
    return [...new Set(atoms.flatMap(a => [a.left.ref, ...(a.right && 'ref' in a.right ? [a.right.ref] : [])]))];
}
const absent = Symbol('absent');
function resolve(op, values) {
    if ('value' in op)
        return op.value;
    let v = values.get(op.ref);
    if (!values.has(op.ref))
        return absent;
    for (const key of op.path) {
        if ((!object(v) && !Array.isArray(v)) || !Object.hasOwn(v, key))
            return absent;
        v = v[key];
    }
    return v;
}
export function evaluateAssertion(assertion, values) {
    const atoms = ('checks' in assertion ? assertion.checks : [assertion]).map(a => {
        const left = resolve(a.left, values), right = a.right ? resolve(a.right, values) : undefined;
        if (a.op === 'exists')
            return left !== absent && left !== null;
        if (left === absent || right === absent)
            return false;
        if (a.op === 'equals')
            return canonical(left) === canonical(right);
        if (a.op === 'contains')
            return typeof left === 'string' && typeof right === 'string' ? left.includes(right) : Array.isArray(left) && left.some(v => canonical(v) === canonical(right));
        if (a.op === 'count')
            return (Array.isArray(left) || typeof left === 'string') && typeof right === 'number' && left.length === right;
        if (a.op === 'setEquals')
            return Array.isArray(left) && Array.isArray(right) && canonical([...new Set(left.map(canonical))].sort()) === canonical([...new Set(right.map(canonical))].sort());
        return false;
    });
    return { passed: 'checks' in assertion && assertion.op === 'any' ? atoms.some(Boolean) : atoms.every(Boolean), atoms };
}
