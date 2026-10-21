/** Bounded, declarative local definitions. Invalid entries are isolated from plugin startup. */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { IMPORT_ORIGIN } from './import-rules.js'

/** @typedef {{ id: string, skill: string, description: string, instructions: string[], resources: string[], stopBoundary: string }} Workflow */
/** @typedef {{ schemaVersion: 1, id: string, version: string, adapter: string, adapterVersion: number, origins: string[], resources: string[], workflows: Workflow[] }} Definition */
/** @typedef {{ definition: Definition, files: Record<string, string>, digest: string }} DefinitionSnapshot */
/** @typedef {{ name: string, description: string, source: 'runtime', invocation: { modelInvocable: false, userInvocable: true }, content: string }} LocalSkill */
/** @typedef {{ name: string, home: string }} Profile */

/** @param {unknown} value - JSON value. @returns {value is Record<string, unknown>} object. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
/** @param {unknown} value - identifier. @returns {value is string} bounded portable identifier. */
export const localId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)
/** @param {unknown} value - path. @returns {value is string} relative path inside a definition. */
function resourcePath(value) {
  return typeof value === 'string' && value.length < 240 && !isAbsolute(value) && !/[\\:\x00-\x1f]/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}
/** @param {unknown} value - origin list. @returns {value is string[]} exact HTTP(S) origins. */
export function validOrigins(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 16 && value.every(item => {
    if (typeof item !== 'string' || item.length>512) return false
    try { const url = new URL(item); return ['http:', 'https:'].includes(url.protocol) && url.origin === item && !url.username && !url.password } catch { return false }
  }) && new Set(value).size === value.length
}
/** @param {unknown} raw - durable declaration. @returns {Definition} validated local data, never executable modules. */
export function validateDefinition(raw) {
  if (!object(raw) || Object.keys(raw).some(key => !['schemaVersion','id','version','adapter','adapterVersion','origins','resources','workflows'].includes(key))
    || raw.schemaVersion !== 1 || !localId(raw.id) || !localId(raw.version) || !['generic','bjrsj'].includes(String(raw.adapter))
    || raw.adapterVersion !== 1 || !validOrigins(raw.origins) || !Array.isArray(raw.resources) || raw.resources.length > 32
    || !raw.resources.every(resourcePath) || new Set(raw.resources).size !== raw.resources.length
    || !Array.isArray(raw.workflows) || raw.workflows.length > 16) throw new Error('task-definition-invalid')
  if (raw.adapter === 'bjrsj' && (raw.origins.length !== 1 || raw.origins[0] !== IMPORT_ORIGIN)) throw new Error('task-adapter-origin-mismatch')
  const resources = raw.resources
  const workflows = raw.workflows.map(row => {
    if (!object(row) || Object.keys(row).some(key => !['id','skill','description','instructions','resources','stopBoundary'].includes(key))
      || !localId(row.id) || typeof row.skill!=='string' || row.skill.length>100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.skill) || typeof row.description !== 'string' || !row.description || row.description.length > 500
      || !Array.isArray(row.instructions) || row.instructions.length === 0 || !Array.isArray(row.resources)
      || ![...row.instructions,...row.resources].every(path => resourcePath(path) && resources.includes(path))
      || typeof row.stopBoundary !== 'string' || row.stopBoundary.length > 200) throw new Error('task-workflow-invalid')
    return /** @type {Workflow} */ (row)
  })
  if(raw.adapter==='bjrsj' && workflows.some(row=>!['navigation','import'].includes(row.id) || row.stopBoundary!==(row.id==='navigation'?'before_file_selection':'import_confirmed')))throw new Error('task-adapter-workflow-mismatch')
  if (new Set(workflows.map(row => row.id)).size !== workflows.length || new Set(workflows.map(row => row.skill)).size !== workflows.length) throw new Error('task-workflow-duplicate')
  return /** @type {Definition} */ ({...raw, workflows})
}
/** @param {string} configured - absolute config or empty. @param {Profile | undefined} profile - actual dsh profile. @returns {string | undefined} root independent of CWD and package location. */
export function tasksRoot(configured, profile) {
  return configured || (profile ? join(profile.home, 'browser-flow', 'tasks') : undefined)
}
/** @param {string} root - local root. @param {string} path - descendant. @returns {void} reject links in every existing component. */
export function noLinks(root, path) {
  const absolute = resolve(path)
  const rel = relative(resolve(root), absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('task-path-escape')
  let current = absolute
  while (true) {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error('task-path-link')
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const actual = realpathSync(absolute)
  if ((process.platform === 'win32' ? actual.toLowerCase() : actual) !== (process.platform === 'win32' ? absolute.toLowerCase() : absolute)) throw new Error('task-path-link')
}
/** @param {string} root - root. @param {string} path - owned file. @param {number} limit - byte limit. @returns {string} complete bounded UTF-8 bytes. */
function readLocal(root, path, limit) {
  noLinks(root, path)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > limit) throw new Error('task-resource-invalid')
  const bytes = readFileSync(path)
  if (bytes.length !== stat.size || bytes.length > limit || !bytes.equals(Buffer.from(bytes.toString('utf8')))) throw new Error('task-resource-changed')
  return bytes.toString('utf8')
}
/** @param {string} root - task root. @param {string} id - directory identifier. @param {string} [expectedId] - immutable snapshot definition identity. @returns {DefinitionSnapshot} stable exact content for a new task. */
export function loadDefinition(root, id, expectedId = id) {
  if (!localId(id)) throw new Error('task-definition-unavailable')
  const dir = join(root, id)
  const definitionText = readLocal(root, join(dir, 'definition.json'), 64_000)
  const definition = validateDefinition(JSON.parse(definitionText))
  if (definition.id !== expectedId) throw new Error('task-definition-id-mismatch')
  /** @type {Record<string, string>} */ const files = { 'definition.json': definitionText }
  let total = Buffer.byteLength(definitionText)
  for (const resource of definition.resources) {
    files[resource] = readLocal(dir, join(dir, resource), 200_000)
    total += Buffer.byteLength(files[resource])
    if (total > 1_000_000) throw new Error('task-definition-too-large')
  }
  return { definition, files, digest: createHash('sha256').update(JSON.stringify(files)).digest('hex') }
}
/** @param {string | undefined} root - optional local directory. @param {(id: string) => void} [invalid] - sanitized invalid-entry notice. @returns {DefinitionSnapshot[]} available definitions; absence is normal. */
export function listDefinitions(root, invalid) {
  if (!root) return []
  let names
  try { noLinks(root, root); names = readdirSync(root, {withFileTypes:true}) } catch { return [] }
  const result = []
  for (const name of names) {
    if (!name.isDirectory() || !localId(name.name)) continue
    try { result.push(loadDefinition(root, name.name)) } catch { invalid?.(name.name) }
  }
  return result
}
/** @param {DefinitionSnapshot} snapshot - validated snapshot. @returns {LocalSkill[]} optional user-only entrypoints; task instructions must be read from the bound task view. */
export function definitionSkills(snapshot) {
  return snapshot.definition.workflows.map(workflow => ({
    name: workflow.skill, description: workflow.description, source: 'runtime',
    invocation: {modelInvocable:false,userInvocable:true},
    content: `Use browser_observe with view="task" first. Require the bound task definition ${snapshot.definition.id}, workflow ${workflow.id}. Follow only that task's snapshotted instructions. If unavailable or different, stop; ask the user to create the intended task in Browser Flow. Never grant control or select a file implicitly.\n`,
  }))
}
