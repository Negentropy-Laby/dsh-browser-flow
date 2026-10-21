import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function run(script, args = [], overrides = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
    cwd: root,
    env: { ...process.env, DSH_BF_APP_ASAR: '', DSH_BF_SMOKE_ELECTRON: '', DSH_BF_SMOKE_CLI: '', ...overrides },
    encoding: 'utf8', timeout: 10_000,
  })
}

it('requires an explicit installed archive instead of assuming a machine path', () => {
  const result = run('extract-installed-host.mjs')
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Provide an app\.asar path/)
})

it('reads application and Electron identity from the supplied synthetic installation', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bf-distribution-'))
  try {
    const resources = join(scratch, 'carrier', 'resources')
    mkdirSync(resources, { recursive: true })
    const body = Buffer.from(JSON.stringify({ name: 'synthetic-desktop', version: '0.0.0-test', dshBuildCommit: '0'.repeat(40) }))
    const header = Buffer.from(JSON.stringify({ files: { 'package.json': { offset: '0', size: body.length } } }))
    const prefix = Buffer.alloc(16)
    prefix.writeUInt32LE(8 + header.length, 4)
    prefix.writeUInt32LE(header.length, 12)
    const archive = join(resources, 'app.asar')
    writeFileSync(archive, Buffer.concat([prefix, header, body]))
    writeFileSync(join(scratch, 'carrier', 'version'), '99.1.2\n')
    const output = join(scratch, 'extracted')
    const result = run('extract-installed-host.mjs', [archive, output])
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    const identity = JSON.parse(readFileSync(join(output, 'desktop-app-manifest.json'), 'utf8'))
    assert.equal(identity.name, 'synthetic-desktop')
    assert.equal(identity.version, '0.0.0-test')
    assert.equal(identity.electronVersion, '99.1.2')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

it('requires explicit smoke carrier paths before launching a process', () => {
  const result = run('live-host-smoke.mjs')
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Set DSH_BF_SMOKE_ELECTRON and DSH_BF_SMOKE_CLI/)
})

it('rejects relative smoke carrier paths', () => {
  const result = run('live-host-smoke.mjs', [], { DSH_BF_SMOKE_ELECTRON: 'relative-electron', DSH_BF_SMOKE_CLI: 'relative-cli' })
  assert.equal(result.error, undefined)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /must identify existing absolute carrier paths/)
})
