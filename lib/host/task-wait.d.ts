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
export declare const USER_WAIT_KINDS: readonly string[];
/** @typedef {{kind:string,reason:string,resumeCondition:string}} UserWaitRequest */
/** @typedef {UserWaitRequest & {id:string,owner:'user',source:'model_declared',run:import('./task-scope.ts').RunScope}} UserWait */
/** @param {unknown} value - model JSON. @returns {value is UserWaitRequest} bounded declaration with no authority or result fields. */
export declare function validUserWait(value: unknown): value is UserWaitRequest;
