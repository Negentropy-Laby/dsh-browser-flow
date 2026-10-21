export interface TabDefinition {id:string;kind:string;multiple:boolean;keepMounted:boolean;title:()=>string;guide:{id:string;order:number;title:()=>string;description:()=>string}[]}
export interface SlotSpec {name:string;key:string;locale?:string}
export type ClientContext = {
    effect: (callback: () => (() => void) | void, label?: string) => void;
    locale: {
        register: (namespace: string, copy: typeof COPY) => () => void;
        bind: (namespace: string) => (key: string) => string;
    };
    sidebarRightTabs: {
        register: (definition: TabDefinition) => () => void;
    };
    slots: {
        inject: (name: string, callback: () => unknown) => unknown;
        register: (options: SlotSpec, component: (props:{sessionId:string})=>unknown) => () => void;
    };
};

/**
 * Browser Flow panel — the client bundle entry.
 *
 * `scripts/build-client.ts` inlines `src/panel.ts`, `src/pagecode.ts` and
 * `src/clientcore.ts` into the shipped `lib/client.js`, the lazy-CJS factory
 * the Harness browser loads. The panel is a normal ES module so the tests can
 * import it; the build only removes the module syntax and folds the imports in.
 *
 * The panel registers one Sidebar tab type plus its body and title. That is the
 * only additive panel seat: `rightbar` and `rightbar.session` are single-kind
 * and already occupied, and a second same-priority registration throws.
 */

import { COPY, NS, createPanel } from './panel.ts'

/** Package name: also the loader row id and the tab type id. */
export const PLUGIN_ID = '@negentropy/dsh-browser-flow'
/** Tab kind opened through `ctx.sidebarRight.openTab`. */
export const TAB_KIND = 'browser-flow'



/**
 * Register the panel's locale, tab type, body and title.
 *
 * A tab type only appears in the right sidebar through its `guide` entries: the
 * pane seeds its default page from `tabs.guide()`, and a type that omits `guide`
 * stays off the guide page entirely. Registering the type alone is therefore
 * invisible — the mistake this file used to make — so the guide entry is part of
 * the same registration.
 *
 * Every registration is an effect, so unloading the plugin removes the UI with
 * it; nothing is registered at module scope.
 * @param {ClientContext} ctx - client root context.
 * @param {import('./panel.ts').ReactLike} React - platform React instance.
 * @returns {void}
 */
export function registerPanel(ctx: ClientContext, React: import('./panel.ts').ReactLike) : void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, COPY), 'browser-flow: copy')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID,
    kind: TAB_KIND,
    multiple: false,
    keepMounted: true,
    title: () => t('title'),
    guide: [{
      id: 'open',
      order: 60,
      title: () => t('title'),
      description: () => t('guideDescription'),
    }],
  }), 'browser-flow: tab type')
  const Panel = createPanel({ React, t })
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLUGIN_ID,
    locale: NS,
  }, Panel))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: PLUGIN_ID,
  }, () => t('title')))
}
