/**
 * Live-Host smoke: boot an isolated Host with the plugin installed, then verify
 * the panel channel and the safety refusals over real HTTP.
 *
 * This is the strongest automated check available without taking over the user's
 * Desktop session. It exercises, on the *installed* application runtime:
 *
 * - the real `dsh plugin` install path writing the profile manifest;
 * - the real Loader composing the plugin row from `cordis.patch.yml`;
 * - the real Host mounting the plugin, its six tools, and its `/api` routes;
 * - the real client bundle served at the boot graph's combo URL;
 * - the protocol refusals for an unauthorized caller.
 *
 * It does not cover the Electron webview, a logged-in page, or a model turn.
 * Supply DSH_BF_SMOKE_ELECTRON and DSH_BF_SMOKE_CLI for the installed carrier.
 *
 * Usage: `node --import tsx/esm scripts/live-host-smoke.ts [--keep]`
 * Exit code 0 means every assertion held.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function field(value:unknown,...keys:string[]):unknown {
 let cursor=value
 for(const key of keys){if(cursor===null||typeof cursor!=='object'||Array.isArray(cursor))return undefined;cursor=(cursor as Record<string,unknown>)[key]}
 return cursor
}
function listField(value:unknown,...keys:string[]):unknown[]|undefined {const list=field(value,...keys);return Array.isArray(list)?list:undefined}
function requireEnv(name:string):string {const value=process.env[name];if(!value)throw new Error('Set DSH_BF_SMOKE_ELECTRON and DSH_BF_SMOKE_CLI to the installed carrier paths; no installation path is assumed.');return value}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Isolated home so the user's real profile is never touched. */
const scratch = join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh-bf-smoke')
/** Installed Electron binary; the carrier CLI is a `.cmd` wrapper around it. */
const electron = requireEnv('DSH_BF_SMOKE_ELECTRON')
/** The carrier's own CLI entry inside the packaged payload. */
const carrierCli = requireEnv('DSH_BF_SMOKE_CLI')
if (!electron || !carrierCli) throw new Error('Set DSH_BF_SMOKE_ELECTRON and DSH_BF_SMOKE_CLI to the installed carrier paths; no installation path is assumed.')
if (!isAbsolute(electron) || !isAbsolute(carrierCli) || !existsSync(electron) || !existsSync(carrierCli)) {
  throw new Error('DSH_BF_SMOKE_ELECTRON and DSH_BF_SMOKE_CLI must identify existing absolute carrier paths.')
}
/** Port used by the smoke Host. */
const port = Number(process.env.DSH_BF_SMOKE_PORT ?? 62993)

/**
 * Run the installed carrier CLI.
 *
 * `dsh.cmd` only sets `ELECTRON_RUN_AS_NODE=1` and invokes the Electron binary
 * on the carrier entry, so the smoke does the same. That avoids `cmd.exe`
 * quoting entirely, which matters because the install path contains spaces.
 * @param {string[]} args - carrier arguments.
 * @param {object} env - environment.
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>} result.
 */
function runCarrier(args:string[], env:NodeJS.ProcessEnv):Promise<{code:number|null;stdout:string;stderr:string}> {
  return new Promise(resolve => {
    const child = spawn(electron, ['--expose-internals', carrierCli, ...args], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

/** Wait until the Host prints its authenticated URL. */
async function waitForUrl(logPath:string, deadlineMs:number) {
  const started = Date.now()
  while (Date.now() - started < deadlineMs) {
    try {
      const text = await import('node:fs').then(module => module.readFileSync(logPath, 'utf8'))
      const match = text.match(/dsh web: (http:\/\/\S+)/)
      if (match !== null) return match[1]
    } catch { /* the log file appears when the Host writes its first line */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('the Host did not report a URL in time')
}

/**
 * Authenticate and return a cookie header.
 * @param {string} url - authenticated launch URL.
 * @returns {Promise<string>} cookie header value.
 */
async function authenticate(url:string) {
  const response = await fetch(url, { redirect: 'manual' })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) throw new Error(`the Host did not issue a cookie (status ${String(response.status)})`)
  return setCookie.split(';')[0]
}

/** POST one JSON body and parse the JSON answer. */
async function post(base:string, cookie:string, path:string, body:unknown) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { protocolVersion: 3, ...body } : body),
  })
  const data:unknown=await response.json()
  return {status:response.status,body:data}
}

/** One assertion with a printable name. */
const results:{name:string;ok:boolean;detail?:string}[] = []
function check(name:string, condition:boolean, detail?:string) {
  results.push({ name, ok: condition, detail })
  process.stdout.write(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition || detail === undefined ? '' : ` — ${detail}`}\n`)
}

async function main() {
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  const env = { ...process.env, DSH_HOME: scratch }

  // 1. Install through the real carrier CLI.
  const install = await runCarrier(['plugin', '--profile', 'web', 'add', `link:${root}`], env)
  const manifestPath = join(scratch, 'profiles', 'web', 'package.json')
  const installLog = `${install.stdout}\n${install.stderr}`
  if (!(await import('node:fs').then(module => module.existsSync(manifestPath)))) {
    throw new Error(`the carrier CLI did not create the profile manifest.\n${installLog}`)
  }
  const manifest:unknown = JSON.parse(await import('node:fs').then(module => module.readFileSync(manifestPath, 'utf8')))
  check('the carrier CLI installs the package',
    install.code === 0, `exit ${String(install.code)}\n${installLog.slice(-800)}`)
  check('the install adds the package as a dependency',
    typeof field(manifest,'dependencies','@negentropy/dsh-browser-flow') === 'string')
  check('the install adds the bundle to dsh.profile.bundles',
    listField(manifest,'dsh','profile','bundles')?.includes('@negentropy/dsh-browser-flow')===true)

  // 2. Boot the isolated Host.
  const logPath = join(scratch, 'smoke.log')
  const errorPath = join(scratch, 'smoke.err.log')
  const log = await import('node:fs').then(module => module.openSync(logPath, 'w'))
  const errorLog = await import('node:fs').then(module => module.openSync(errorPath, 'w'))
  const host = spawn(electron, ['--expose-internals', carrierCli, '--profile', 'web', '--no-open', '--port', String(port)], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', log, errorLog],
  })
  let base
  try {
    const url = await waitForUrl(logPath, 60_000)
    base = new URL(url).origin
    const cookie = await authenticate(url)

    // 3. The boot graph carries the plugin's client row.
    const index = await (await fetch(base + '/', { headers: { cookie } })).text()
    const bootMatch = index.match(/__DSH_BOOT__"\]\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)
    const boot:unknown = bootMatch === null ? undefined : JSON.parse(bootMatch[1])
    const entries=field(boot,'entries')
    const entry=Array.isArray(entries)?entries.find((candidate:unknown)=>field(candidate,'id')==='@negentropy/dsh-browser-flow'):undefined
    check('the Loader composes the plugin into the boot graph', entry !== undefined)
    if (entry !== undefined) {
      const bundleResponse = await fetch(`${base}/${String(field(entry,'url'))}`, { headers: { cookie } })
      const bundleText = bundleResponse.status === 200 ? await bundleResponse.text() : ''
      check('the Host serves the plugin client bundle', bundleResponse.status === 200, `status ${String(bundleResponse.status)}`)
      check('the served bundle registers under the package name', bundleText.includes("id: '@negentropy/dsh-browser-flow'"))
    }

    // 4. The panel channel answers with the six tools and explicit capabilities.
    const hello = await post(base, cookie, '/api/browser-flow/hello', {
      kind: 'hello', protocolVersion: 3, connectionGeneration: 1, sessionId: 'smoke-session',
      panel: {
        instanceId: 'smoke-panel',
        pages: [{ lease: 'g1', partition: 'p1', url: 'https://example.test/a?token=leak', documentToken: 'd1' }],
      },
    })
    check('the panel channel answers', hello.status === 200, `status ${String(hello.status)}`)
    check('all six tools are live', listField(hello.body,'value','tools')?.length===6,
      JSON.stringify(field(hello.body,'value','tools')))
    check('unsupported capabilities are declared', field(hello.body,'value','capabilities','screenshot') === 'unsupported'
      && field(hello.body,'value','capabilities','visual') === 'unsupported')

    // 5. Safety refusals on the real Host.
    const authorize = await post(base, cookie, '/api/browser-flow/authorize', {
      instanceId: 'smoke-panel', connectionGeneration: 1, sessionId: 'smoke-session',
      lease: 'g1', partition: 'p1', documentToken: 'd1',
    })
    check('authorization is refused without a live Agent', authorize.status === 409 && field(authorize.body,'error','code') === 'no_live_agent',
      `${String(authorize.status)} ${String(field(authorize.body,'error','code'))}`)

    const stale = await post(base, cookie, '/api/browser-flow/poll', {
      instanceId: 'smoke-panel', connectionGeneration: 0, sessionId: 'smoke-session', pages: [],
    })
    check('a superseded connection generation is refused', stale.status === 409 && field(stale.body,'error','code') === 'connection_stale',
      `${String(stale.status)} ${String(field(stale.body,'error','code'))}`)

    const unknownLease = await post(base, cookie, '/api/browser-flow/result', {
      kind: 'result', task:{profileId:'profile-'+'a'.repeat(32),taskId:'task-00000000-0000-4000-8000-000000000001',ownerSessionId:'smoke-session',scopeRevision:1,runId:'run-00000000-0000-4000-8000-000000000002',workflowRef:'synthetic'}, instanceId: 'smoke-panel', id: 'x', leaseId: 'lease-x', connectionGeneration: 1,
      epoch: 0, sequence: 0, outcome: 'ok', payload: {},
    })
    check('a result for an unknown lease is refused', unknownLease.status === 409 && field(unknownLease.body,'error','code') === 'stale_observation',
      `${String(unknownLease.status)} ${String(field(unknownLease.body,'error','code'))}`)

    const malformed = await fetch(base + '/api/browser-flow/hello', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: base }, body: '{not json',
    })
    check('a malformed body is refused without crashing', malformed.status === 400, `status ${String(malformed.status)}`)

    const status = await fetch(`${base}/api/browser-flow/status?instanceId=smoke-panel&connectionGeneration=1&sessionId=smoke-session`, { headers: { cookie } })
    const statusBody:unknown = await status.json()
    check('the page list reports no live Agent', field(statusBody,'value','liveAgent') === false)
  } finally {
    host.kill()
    await new Promise(resolve => setTimeout(resolve, 1_500))
    if (process.argv.includes('--keep')) {
      process.stdout.write(`smoke home kept at ${scratch}\n`)
    } else {
      rmSync(scratch, { recursive: true, force: true })
    }
  }

  const failed = results.filter(result => !result.ok)
  mkdirSync(join(root, '.evidence'), { recursive: true })
  writeFileSync(join(root, '.evidence', 'live-host-smoke.json'), `${JSON.stringify({
    recordedAt: new Date().toISOString(),
    host: 'installed Desktop runtime via resources/runtime/cli/bin/dsh.cmd',
    profile: 'web (isolated DSH_HOME)',
    port,
    checks: results,
  }, undefined, 2)}\n`)
  process.stdout.write(`\n${String(results.length - failed.length)}/${String(results.length)} checks passed\n`)
  if (failed.length > 0) process.exitCode = 1
}

await main()
