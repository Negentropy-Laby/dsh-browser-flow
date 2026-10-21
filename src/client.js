/**
 * Browser Flow panel — the client bundle entry.
 *
 * `scripts/build-client.mjs` inlines `src/panel.js`, `src/pagecode.ts` and
 * `src/clientcore.js` into the shipped `lib/client.js`, the lazy-CJS factory
 * the Harness browser loads. The panel is a normal ES module so the tests can
 * import it; the build only removes the module syntax and folds the imports in.
 *
 * The panel registers one Sidebar tab type plus its body and title. That is the
 * only additive panel seat: `rightbar` and `rightbar.session` are single-kind
 * and already occupied, and a second same-priority registration throws.
 */

import { COPY, NS, createPanel } from './panel.js'

/** Package name: also the loader row id and the tab type id. */
export const PLUGIN_ID = '@negentropy/dsh-browser-flow'
/** Tab kind opened through `ctx.sidebarRight.openTab`. */
export const TAB_KIND = 'browser-flow'

/**
 * The client root context this plugin registers into.
 *
 * Declared structurally: the plugin never imports the client services, it only
 * calls the documented registration methods.
 * @typedef {object} ClientContext
 * @property {(callback: () => (() => void) | void, label?: string) => void} effect - effect-scoped registration.
 * @property {{ register: (namespace: string, copy: object) => () => void, bind: (namespace: string) => (key: string) => string }} locale - locale registry.
 * @property {{ register: (definition: object) => () => void }} sidebarRightTabs - sidebar tab types.
 * @property {{ inject: (name: string, callback: () => unknown) => unknown, register: (options: object, component: Function) => () => void }} slots - slot registry.
 */

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
 * @param {import('./panel.js').ReactLike} React - platform React instance.
 * @returns {void}
 */
export function registerPanel(ctx, React) {
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
