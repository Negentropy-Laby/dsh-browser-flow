/** @param {unknown} value - scope from disk/wire. @returns {value is TaskScope} validated public identifiers. */
export function validTaskScope(value: unknown): value is TaskScope;
/** @param {unknown} value - run scope. @returns {value is RunScope} complete run identity. */
export function validRunScope(value: unknown): value is RunScope;
/** @param {TaskScope} left - one scope. @param {TaskScope} right - another scope. @returns {boolean} exact task ownership/revision. */
export function sameTaskScope(left: TaskScope, right: TaskScope): boolean;
/** @param {RunScope} left - one run. @param {RunScope} right - another run. @returns {boolean} exact task/run. */
export function sameRunScope(left: RunScope, right: RunScope): boolean;
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
