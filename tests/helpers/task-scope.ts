import { validRunScope } from '../../src/task-scope.ts'
/** Synthetic wire scope for Client-only tests; no filesystem or user task data. */
const candidate: unknown = Object.freeze({profileId:'profile-'+'a'.repeat(32),taskId:'task-00000000-0000-4000-8000-000000000001',ownerSessionId:'session-1',scopeRevision:1,runId:'run-00000000-0000-4000-8000-000000000002',workflowRef:'synthetic'})
if (!validRunScope(candidate)) throw new Error('invalid synthetic task scope')
export const TASK = candidate
export const TASK_VIEW={task:TASK,state:'active',adapter:'bjrsj',goal:'Synthetic task',origins:['https://example.test'],writeBlocked:false}
