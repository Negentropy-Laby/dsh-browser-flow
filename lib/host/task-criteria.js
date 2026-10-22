/** Trusted predicates over task-owned originals; labels alone never prove a criterion. */
import { sameRunScope, validRunScope } from "./task-scope.js";
import { taskRecord } from "./task-journal.js";
import { navigationVerdict } from "./task-adapters.js";
import { decodeImportEvidence } from "./import-evidence.js";
import { importScope, extractIdentity, judgeIdentity, judgeImport } from "./import-rules.js";
import { parseWorkbook } from "./import-workbook.js";
/** @param {unknown} value - disk reference. @returns {value is Artifact} bounded, relative evidence file reference. */
export function validArtifact(value) {
    return taskRecord(value) && typeof value.role === 'string' && typeof value.path === 'string' && value.path.length < 512
        && value.path.split('/').every(part => part !== '' && part !== '.' && part !== '..') && !/[\\:\x00-\x1f]/.test(value.path)
        && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 16_000_000;
}
/** @param {import('./task-store.ts').Manifest} manifest - current owner. @returns {{id:string,validatorId:string,version:number,label:string} | undefined} code-owned criterion. */
export function trustedCriterion(manifest) {
    if (manifest.adapter !== 'bjrsj' || manifest.adapterVersion !== 1 || !['navigation', 'import'].includes(manifest.workflowRef))
        return undefined;
    const validatorId = manifest.workflowRef === 'navigation' ? 'bjrsj-navigation-entry' : 'bjrsj-import-confirmed';
    return { id: `criterion-${manifest.scope.taskId}-r${manifest.scope.scopeRevision}-${validatorId}`, validatorId, version: 1, label: manifest.workflowRef === 'navigation' ? 'Reach the verified upload entry' : 'Confirm the scoped import' };
}
/** @param {import('./task-store.ts').TaskData} task - opened task. @param {string} id - local reference. @param {string} kind - required kind. @param {import('./task-scope.ts').RunScope} run - exact run. @returns {Record<string,unknown> | undefined} owned current asset. */
function assetData(task, id, kind, run) {
    const row = task.events.find(event => event.type === 'asset' && event.data.id === id)?.data;
    return row?.kind === kind && validRunScope(row.run) && sameRunScope(row.run, run) && taskRecord(row.data) ? row.data : undefined;
}
/** @param {import('./task-store.ts').TaskData} task - opened task. @param {Record<string,unknown>} row - journal judgment. @returns {string} verified current verdict or unverified. */
export function evidenceVerdict(task, row) {
    const criterion = trustedCriterion(task.manifest), run = { ...task.manifest.scope, runId: task.manifest.runId, workflowRef: task.manifest.workflowRef };
    if (!criterion || task.readOnly || task.unhealthy || task.blocked || row.source !== 'code_verified' || row.criterionId !== criterion.id || row.validatorId !== criterion.validatorId || row.validatorVersion !== criterion.version
        || !validRunScope(row.run) || !sameRunScope(row.run, run) || typeof row.proofRef !== 'string')
        return 'unverified';
    const checked = task.checkedProofs?.get(row.proofRef), proof = checked?.value;
    if (!proof || !assetData(task, row.proofRef, 'evidence', run) || proof.schemaVersion !== 1 || !validRunScope(proof.run) || !sameRunScope(proof.run, run))
        return 'unverified';
    try {
        if (proof.kind === 'navigation' && criterion.validatorId === 'bjrsj-navigation-entry' && typeof proof.pageRef === 'string') {
            const page = assetData(task, proof.pageRef, 'page', run);
            return page && navigationVerdict(task.manifest, page).verdict === 'entry_reached' && row.verdict === 'entry_reached' ? 'entry_reached' : 'unverified';
        }
        if (proof.kind !== 'import' || criterion.validatorId !== 'bjrsj-import-confirmed' || row.verdict !== 'import_confirmed' || row.qualified !== true || typeof proof.fileRef !== 'string' || typeof proof.attemptId !== 'string' || typeof proof.fileGrantId !== 'string')
            return 'unverified';
        const file = assetData(task, proof.fileRef, 'file', run), result = typeof proof.resultRef === 'string' ? assetData(task, proof.resultRef, 'import_result', run) : undefined;
        const attempt = task.events.find(event => event.type === 'attempt' && event.data.attemptId === proof.attemptId);
        const receipt = task.events.find(event => event.type === 'receipt' && event.data.attemptId === proof.attemptId);
        if (!file || !result || result.verdict !== 'import_confirmed' || result.qualified !== true || attempt?.data.action !== 'set_file' || !validRunScope(attempt.data.run) || !sameRunScope(attempt.data.run, run) || receipt?.data.outcome !== 'executed' || receipt.data.fileGrantId !== proof.fileGrantId)
            return 'unverified';
        const bytes = checked.files.get('snapshot'), dispatchBytes = checked.files.get('dispatch');
        if (!bytes || !dispatchBytes || !Array.isArray(proof.files))
            return 'unverified';
        const snapshot = proof.files.find(value => validArtifact(value) && value.role === 'snapshot');
        if (!validArtifact(snapshot) || file.sha256 !== snapshot.sha256 || file.bytes !== bytes.length)
            return 'unverified';
        const dispatch = JSON.parse(dispatchBytes.toString('utf8'));
        if (!taskRecord(dispatch) || dispatch.fileGrantId !== proof.fileGrantId || dispatch.sha256 !== snapshot.sha256 || typeof dispatch.binding !== 'string')
            return 'unverified';
        const binding = JSON.parse(dispatch.binding);
        if (!Array.isArray(binding) || !validRunScope(binding[0]) || !sameRunScope(binding[0], run) || binding[6] !== proof.documentToken)
            return 'unverified';
        const scope = importScope(proof.scope), input = parseWorkbook(bytes), evidence = decodeImportEvidence(proof.evidence);
        if (input.firstRow !== scope.firstRow || input.lastRow !== scope.lastRow || file.kind !== scope.kind || file.rows !== input.people.length || evidence.fileGrantId !== proof.fileGrantId || !evidence.coverage || !evidence.closed || evidence.cleanupFailed || evidence.unitPending !== 0)
            return 'unverified';
        const unitIds = new Set(), legalIdentities = new Set();
        for (const body of evidence.unitBodies) {
            const actual = extractIdentity(JSON.parse(body));
            actual.unitIds.forEach(id => unitIds.add(id));
            actual.legalIdentities.forEach(id => legalIdentities.add(id));
        }
        return judgeIdentity({ unitIds: [...unitIds], legalIdentities: [...legalIdentities] }, scope) === 'verified' && judgeImport(scope, input.people, evidence.facts).verdict === 'import_confirmed' ? 'import_confirmed' : 'unverified';
    }
    catch (error) {
        void error;
        return 'unverified';
    }
}
