export type UserWaitRequest = {
    kind: string;
    reason: string;
    resumeCondition: string;
};
export type UserWait = UserWaitRequest & {
    id: string;
    owner: "user";
    source: "model_declared";
    run: import("./task-scope.ts").RunScope;
};

/** Human dependencies are model declarations; resolution never grants browser authority. */
/** Supported user-owned dependencies; they do not select a business workflow. */
export const USER_WAIT_KINDS = Object.freeze(['login','page_authorization','file_input','file_confirmation','real_table','real_batch','other_user_input'])

/** @param {unknown} value - model JSON. @returns {value is UserWaitRequest} bounded declaration with no authority or result fields. */
export function validUserWait(value: unknown) : value is UserWaitRequest {
  if(value===null||typeof value!=='object'||Array.isArray(value))return false
  const row=(value as Record<string, unknown>)
  return Object.keys(row).every(key=>['kind','reason','resumeCondition'].includes(key))&&USER_WAIT_KINDS.includes(String(row.kind))
    &&typeof row.reason==='string'&&row.reason.trim().length>0&&row.reason.length<=1000
    &&typeof row.resumeCondition==='string'&&row.resumeCondition.trim().length>0&&row.resumeCondition.length<=1000
}
