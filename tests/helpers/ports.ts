/** Structural test ports for the plugin-owned Host APIs. */
import type {HostContext} from '../../src/index.ts'
export type {HostContext,FetchRoute,ControlStore,LiveAgent,ToolExec} from '../../src/index.ts'
export type {ToolDefinition} from '../../src/tools.ts'
export type {PanelPage,ControlLease,InFlightRecord} from '../../src/state.ts'
export type {PageOperation} from '../../src/protocol.ts'
export type Dispose=()=>void|Promise<void>
/** Synthetic dependency lookup is not the profile getter consumed by production. */
export function hostPort(ctx:Omit<HostContext,'get'>):HostContext {return {...ctx,get:undefined}}
