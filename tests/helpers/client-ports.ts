/** Wire handoff consumed only after evaluating the built bundle in a fixture realm. */
import type {ClientContext} from '../../src/client.ts'
export interface BundlePlugin {inject:string[];apply(ctx:ClientContext):void}
export interface BundleRegistration {id:string;factory(require:(name:string)=>unknown):BundlePlugin}
