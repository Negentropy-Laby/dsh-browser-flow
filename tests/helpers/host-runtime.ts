/** Consumed interface of the pinned external Cordis Host artifacts in qualification fixtures. */
import type {HostContext} from '../../src/index.ts'
import type {ToolDefinition} from '../../src/tools.ts'
import type {SubprocessPort} from '../../src/graph/protocol.ts'
import type {LocalSkill} from '../../src/task-definitions.ts'
export interface PluginHandle extends PromiseLike<void> {dispose():Promise<void>}
export interface HostRuntime extends HostContext {
 provide(name:string,value:unknown):void
 plugin(plugin:unknown,config?:object):PluginHandle
 fiber:{dispose():Promise<void>}
 tools: {register(definition:ToolDefinition):()=>void;get(name:string):ToolDefinition|undefined;schemas():{name:string;description:string}[]}
 skills?: {register(skill:LocalSkill):()=>void;get(name:string):Promise<LocalSkill|undefined>}
 subprocess:SubprocessPort
}
