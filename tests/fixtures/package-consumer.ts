/** Compile-only installed-package usage under a Node library configuration. */
import {apply,type HostContext} from '@negentropy/dsh-browser-flow'
import {validateCommand,PROTOCOL_VERSION,readBoolean,commandEnvelope} from '@negentropy/dsh-browser-flow/protocol'
import {createControlState,type CommandEntry,type InFlightRecord} from '@negentropy/dsh-browser-flow/state'
import {actProgram,findProgram,identityProgram,prelude} from '@negentropy/dsh-browser-flow/pagecode'
const ctx:HostContext={agents:{get:id=>({id})},tools:{register:definition=>{const name:string=definition.name;const meta=definition.output.presentationMeta({},{});void [name,meta];return()=>{}}}}
const start:typeof apply=apply
void ctx
const revision:3=PROTOCOL_VERSION
const command=validateCommand({})
if(command.ok){const sequence:number=command.command.sequence;void sequence}
const code:string=actProgram({documentToken:'synthetic',elementRef:'el-1',action:'type',value:'synthetic'})
const found:string=findProgram({by:'text',value:'literal'},1)
const identity:string=identityProgram()
const state=createControlState()
const inspectEntry=(entry:CommandEntry,record:InFlightRecord)=>{
 const dispatched:boolean=entry.dispatched,sequence:number=entry.sequence,taken:boolean=record.taken
 return {dispatched,sequence,taken}
}
const setup:string=prelude(),flag:boolean|undefined=readBoolean({},'flag')
// @ts-expect-error A typed action cannot omit its value.
actProgram({documentToken:'synthetic',elementRef:'el-1',action:'type'})
void [start,revision,code,found,identity,state,inspectEntry,setup,flag,commandEnvelope]
