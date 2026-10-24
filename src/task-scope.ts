export type TaskId = string & {
    readonly __browserTaskId: "TaskId";
};
export type ProfileId = string & {
    readonly __browserProfileId: "ProfileId";
};
export type RunId = string & {
    readonly __browserRunId: "RunId";
};
export type TaskScope = {
    profileId: ProfileId;
    taskId: TaskId;
    ownerSessionId: string;
    scopeRevision: number;
};
export type RunScope = TaskScope & {
    runId: RunId;
    workflowRef: string;
};

/** Stable Host identity bytes; changing this field order changes existing IDs. */
export function runIdentity(run: RunScope): readonly [ProfileId, TaskId, string, number, RunId, string] {
  return [run.profileId,run.taskId,run.ownerSessionId,run.scopeRevision,run.runId,run.workflowRef]
}
/** Go's Scope struct field order for the separate direct-IPC fallback encoding. */
export function orderedRunScope(run: RunScope): RunScope {
  const [profileId,taskId,ownerSessionId,scopeRevision,runId,workflowRef]=runIdentity(run)
  return {profileId,taskId,ownerSessionId,scopeRevision,runId,workflowRef}
}

/** Browser Flow v3 task and run identifiers, shared by Host and Client. */

/** @param {unknown} value - JSON value. @returns {value is Record<string, unknown>} object. */
const scopeRecord = (value: unknown) : value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
/** @param {unknown} value - scope from disk/wire. @returns {value is TaskScope} validated public identifiers. */
export function validTaskScope(value: unknown) : value is TaskScope {
  return scopeRecord(value) && typeof value.profileId === 'string' && /^profile-[a-f0-9]{32}$/.test(value.profileId)
    && typeof value.taskId === 'string' && /^task-[a-f0-9-]{36}$/.test(value.taskId)
    && typeof value.ownerSessionId === 'string' && value.ownerSessionId.length > 0 && value.ownerSessionId.length <= 200
    && Number.isSafeInteger(value.scopeRevision) && Number(value.scopeRevision) >= 1
}
/** @param {unknown} value - run scope. @returns {value is RunScope} complete run identity. */
export function validRunScope(value: unknown) : value is RunScope {
  return validTaskScope(value) && 'runId' in value && typeof value.runId === 'string' && /^run-[a-f0-9-]{36}$/.test(value.runId)
    && 'workflowRef' in value && typeof value.workflowRef === 'string' && value.workflowRef.length > 0 && value.workflowRef.length <= 100
}
/** @param {TaskScope} left - one scope. @param {TaskScope} right - another scope. @returns {boolean} exact task ownership/revision. */
export function sameTaskScope(left: TaskScope, right: TaskScope) : boolean {
  return left.profileId === right.profileId && left.taskId === right.taskId && left.ownerSessionId === right.ownerSessionId && left.scopeRevision === right.scopeRevision
}
/** @param {RunScope} left - one run. @param {RunScope} right - another run. @returns {boolean} exact task/run. */
export function sameRunScope(left: RunScope, right: RunScope) : boolean { return sameTaskScope(left,right) && left.runId === right.runId && left.workflowRef === right.workflowRef }

/** Host capability; a workflow name alone never selects file authority. */
export type FileMode='generic'|'legacy_import'|'none'
export function taskFileMode(m:{schemaVersion?:number;adapter:string;workflowRef:string}):FileMode {
  if(m.schemaVersion===2&&m.adapter==='generic'&&m.workflowRef==='exploration')return 'generic'
  return m.adapter==='bjrsj'&&m.workflowRef==='import'?'legacy_import':'none'
}
