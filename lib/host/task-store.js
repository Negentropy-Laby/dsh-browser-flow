/** Profile-owned task store. Durable ownership never grants page control or replays commands. */
import { graphInput, taskView } from "./task-projections.js";
import { taskFacts, taskReferences } from "./task-facts.js";
import { GraphError } from "./graph/protocol.js";
import { graphHash } from "./graph/worker.js";
import { resolveConfig } from "./config.js";
import { validUserWait } from "./task-wait.js";
import { trustedCriterion, validArtifact } from "./task-criteria.js";
import { TASK_FORMAT_VERSION, validTaskManifest, validTaskEvent } from "./task-journal.js";
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { validTaskScope, validRunScope, sameTaskScope, sameRunScope } from "./task-scope.js";
import { withFileLock } from '@deepseek-ai/dsh-atomic-write';
import { privateDirectory } from './import-files.js';
import { loadDefinition, noLinks, validOrigins } from "./task-definitions.js";
/** Expected task failures are sanitized at the tool/HTTP boundary. */
export class TaskError extends Error {
    code;
    /** @param {string} code - machine identity. @param {string} message - public next step. */
    constructor(code, message) { super(message); this.code = code; }
}
/** @param {string | Uint8Array} value - complete content. @returns {string} digest. */
const hash = (value) => createHash('sha256').update(value).digest('hex');
/** @param {unknown} value - JSON value. @returns {value is Record<string, unknown>} record. */
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value - bounded user text. @param {number} max - limit. @returns {value is string} safe nonempty text. */
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
/** @param {unknown} value - list of conditions. @returns {value is string[]} bounded list. */
const conditions = (value) => Array.isArray(value) && value.length <= 32 && value.every(item => text(item, 1000));
/** The service owns one writer lease, access capabilities and a serialized append queue. */
export class TaskStore {
    graph;
    graphConfig;
    controlDocument;
    root;
    profileId;
    runtime;
    waitMs;
    tasks;
    bindings;
    handles;
    ready;
    writer;
    releaseWriter;
    abort;
    closed;
    writable;
    tail;
    /** @param {string | undefined} root - localTasksDir. @param {import('./task-definitions.ts').Profile | undefined} profile - actual dsh profile. @param {number} waitMs - bounded writer acquisition. @param {import('./graph/worker.ts').GraphWorkers|undefined} [graph] - optional derived view service. @param {import('./graph/protocol.ts').GraphConfig} [graphConfig] - resolved limits. */
    constructor(root, profile, waitMs, graph = undefined, graphConfig = resolveConfig(undefined)) {
        this.graph = graph;
        this.graphConfig = graphConfig;
        this.controlDocument = undefined;
        this.root = root;
        this.profileId = profile ? 'profile-' + hash(JSON.stringify([profile.name, resolve(profile.home)])).slice(0, 32) : undefined;
        this.runtime = root && this.profileId ? join(root, '.runtime', this.profileId) : undefined;
        this.waitMs = waitMs;
        this.tasks = new Map();
        this.bindings = new Map();
        this.handles = new WeakMap();
        this.ready = undefined;
        this.writer = undefined;
        this.releaseWriter = undefined;
        this.abort = new AbortController();
        this.closed = false;
        this.writable = false;
        this.tail = Promise.resolve();
    }
    /** @param {string} path - owned descendant. @returns {Promise<void>} private directory after all existing ancestors have passed link checks. */
    async directory(path) {
        if (!this.root)
            throw new TaskError('task_unavailable', 'task root unavailable');
        const rel = relative(resolve(this.root), resolve(path));
        if (rel.startsWith('..') || isAbsolute(rel))
            throw new TaskError('task_unavailable', 'task path escaped its root');
        let existing = path;
        for (;;) {
            try {
                await lstat(existing);
                break;
            }
            catch (error) {
                if (!record(error) || error.code !== 'ENOENT')
                    throw error;
                const parent = dirname(existing);
                if (parent === existing)
                    throw error;
                existing = parent;
            }
        }
        noLinks(existing, existing);
        await privateDirectory(path);
        noLinks(this.root, path);
    }
    /** @returns {Promise<void>} lazy initialization; failure prevents writes without impairing revocation. */
    initialize() {
        if (this.closed)
            return Promise.reject(new TaskError('task_unavailable', 'task storage is closed; hand off safely'));
        if (this.ready)
            return this.ready;
        this.ready = this.initializeOwned();
        return this.ready;
    }
    /** @returns {Promise<void>} writer ready after existing ownership and journals have been read. */
    async initializeOwned() {
        if (!this.root || !this.runtime || !this.profileId)
            throw new TaskError('task_unavailable', 'launch with a dsh profile and configure localTasksDir before creating a task');
        const runtime = this.runtime;
        try {
            await this.directory(runtime);
            noLinks(this.root, runtime);
            const namespace = join(runtime, 'writer-host.json');
            try {
                await this.writeNew(namespace, { platform: process.platform, hostname: hostname() });
            }
            catch (error) {
                if (!record(error) || error.code !== 'EEXIST')
                    throw error;
            }
            const host = JSON.parse(await readFile(namespace, 'utf8'));
            if (host.platform !== process.platform || host.hostname !== hostname())
                throw new Error('task-writer-host-mismatch');
            let readyResolve = () => { };
            let readyReject = () => { };
            const ready = new Promise((resolve, reject) => { readyResolve = () => resolve(undefined); readyReject = reject; });
            const lifetime = new Promise(resolve => { this.releaseWriter = () => resolve(undefined); });
            this.writer = withFileLock(join(runtime, 'writer'), async () => {
                if (this.closed)
                    throw new Error('task-store-closed');
                await this.recover();
                this.writable = true;
                readyResolve();
                await lifetime;
            }, { waitMs: this.waitMs, signal: this.abort.signal });
            void this.writer.catch(readyReject);
            await ready;
        }
        catch (error) {
            try {
                await this.recover();
                if (this.bindings.size > 0)
                    return;
            }
            catch (readError) {
                void readError;
            }
            throw new TaskError('task_unavailable', 'task storage could not establish exclusive private ownership; keep reads/revocation safe and correct the storage configuration');
        }
    }
    /** @param {string} path - owned new file. @param {unknown} value - complete JSON. @returns {Promise<void>} synced new content. */
    async writeNew(path, value) {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        if (this.root)
            noLinks(this.root, dirname(path));
        const handle = await open(path, 'wx', 0o600);
        try {
            await handle.writeFile(JSON.stringify(value) + '\n');
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    /** @template T @param {() => Promise<T>} operation - serialized mutation. @returns {Promise<T>} operation result. */
    serial(operation) {
        const result = this.tail.then(operation);
        this.tail = result.then(() => { }, () => { });
        return result;
    }
    /** @param {string} sessionId - caller's verified Session. @param {unknown} raw - user task declaration. @returns {Promise<TaskAccess>} newly created task, permanently owned by this Session. */
    async create(sessionId, raw) {
        await this.initialize();
        return this.serial(async () => {
            if (this.closed || !this.writable || !this.root || !this.runtime || !this.profileId)
                throw new TaskError('task_unavailable', 'task storage is closed');
            if (this.bindings.has(sessionId))
                throw new TaskError('task_bound', 'this Session already owns a task; use a new Session for another batch');
            if (!record(raw) || Object.keys(raw).some(key => !['definitionId', 'workflowRef', 'goal', 'constraints', 'criteria', 'origins'].includes(key)) || !text(raw.goal, 2000)
                || !conditions(raw.constraints ?? []) || !conditions(raw.criteria ?? []))
                throw new TaskError('invalid_request', 'supply a bounded goal, constraints and criteria');
            let snapshot;
            if (raw.definitionId !== undefined) {
                if (typeof raw.definitionId !== 'string')
                    throw new TaskError('definition_unavailable', 'local definition unavailable');
                try {
                    snapshot = loadDefinition(this.root, raw.definitionId);
                }
                catch {
                    throw new TaskError('definition_unavailable', 'local definition unavailable; correct it before creating this task');
                }
            }
            const workflow = snapshot?.definition.workflows.find(item => item.id === raw.workflowRef);
            if (snapshot && !workflow)
                throw new TaskError('definition_unavailable', 'select an available workflow in this definition');
            const origins = snapshot?.definition.origins ?? raw.origins;
            if (!validOrigins(origins) || (snapshot && raw.origins !== undefined))
                throw new TaskError('invalid_request', 'supply exact allowed origins for a generic task');
            const taskId = 'task-' + randomUUID();
            const scope = { profileId: this.profileId, taskId, ownerSessionId: sessionId, scopeRevision: 1 };
            const manifest = { schemaVersion: TASK_FORMAT_VERSION, scope, runId: 'run-' + randomUUID(), workflowRef: workflow?.id ?? 'generic', goal: raw.goal, constraints: (raw.constraints ?? []), criteria: (raw.criteria ?? []), origins: [...origins], adapter: snapshot?.definition.adapter ?? 'generic', adapterVersion: 1,
                ...(snapshot ? { definitionId: snapshot.definition.id, definitionDigest: snapshot.digest, definitionVersion: snapshot.definition.version } : {}) };
            const dir = join(this.runtime, 'tasks', taskId);
            await this.directory(dir);
            const data = { manifest, snapshot, dir, events: [], blocked: false, unhealthy: false, state: 'active' };
            if (snapshot)
                for (const [name, body] of Object.entries(snapshot.files)) {
                    const file = join(dir, 'definition-snapshot', name);
                    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
                    const handle = await open(file, 'wx', 0o600);
                    try {
                        await handle.writeFile(body);
                        await handle.sync();
                    }
                    finally {
                        await handle.close();
                    }
                }
            await this.writeNew(join(dir, 'manifest.json'), manifest);
            await this.appendOwned(data, 'created', { manifest });
            await this.writeNew(join(this.runtime, 'registry', hash(sessionId) + '.json'), { schemaVersion: TASK_FORMAT_VERSION, sessionId, taskId, profileId: this.profileId });
            this.tasks.set(taskId, data);
            this.bindings.set(sessionId, taskId);
            return this.access(data);
        });
    }
    /** @param {TaskData} data - owned data. @returns {TaskAccess} unforgeable in-process capability. */
    access(data) {
        const scope = Object.freeze({ ...data.manifest.scope });
        const handle = Object.freeze({ scope, run: Object.freeze({ ...scope, runId: data.manifest.runId, workflowRef: data.manifest.workflowRef }) });
        this.handles.set(handle, data);
        return handle;
    }
    /** @param {string} sessionId - actual caller. @param {unknown} [requested] - optional scope to compare, never an authority source. @returns {Promise<TaskAccess>} verified current ownership. */
    async forSession(sessionId, requested) {
        await this.initialize();
        const taskId = this.bindings.get(sessionId);
        const data = taskId ? this.tasks.get(taskId) : undefined;
        if (!data && taskId)
            throw new TaskError('task_unavailable', 'this Session retains its original task ownership, but the history cannot be decoded; revoke and hand off');
        if (!data || (requested !== undefined && (!validTaskScope(requested) || !sameTaskScope(requested, data.manifest.scope))))
            throw new TaskError('task_not_bound', 'no accessible task binding; create or open this Session’s own task in the panel');
        return this.access(data);
    }
    /** @param {string} sessionId - verified Session. @returns {TaskAccess | undefined} current in-memory binding; use forSession to recover after restart. */
    current(sessionId) {
        const id = this.bindings.get(sessionId);
        const data = id ? this.tasks.get(id) : undefined;
        return data ? this.access(data) : undefined;
    }
    /** @param {TaskAccess} access - store-issued capability. @param {boolean} [write] - operation can change a page or file authority. @returns {TaskData} private data available only after full verification. */
    openTask(access, write = false) {
        const data = this.handles.get(access);
        if (!data || !sameRunScope(access.run, { ...data.manifest.scope, runId: data.manifest.runId, workflowRef: data.manifest.workflowRef }) || this.closed)
            throw new TaskError('task_not_bound', 'task binding is no longer current');
        if (write && data.readOnly)
            throw new TaskError('task_read_only', 'this task uses unsupported or legacy storage; read its history, revoke and hand off in a new Session');
        if (write && !this.writable)
            throw new TaskError('task_unavailable', 'task storage is read-only; only read, revoke and hand off');
        if (write && (data.blocked || data.unhealthy))
            throw new TaskError('task_write_blocked', 'this task has an unknown write or damaged log; only read, revoke and hand off');
        if (write && data.state !== 'active')
            throw new TaskError('task_write_blocked', 'this task is ended or awaiting user action; only read, revoke and hand off');
        return data;
    }
    /** @param {TaskAccess} access - verified task. @param {string} url - actual page address. @returns {void} allowed source with supported adapter version. */
    assertPage(access, url) {
        const data = this.openTask(access);
        let origin;
        try {
            origin = new URL(url).origin;
        }
        catch {
            throw new TaskError('task_scope_mismatch', 'page is outside the task’s allowed sites');
        }
        if (data.readOnly)
            throw new TaskError('task_read_only', 'legacy history cannot acquire new page control; use a new Session');
        if (data.manifest.adapterVersion !== 1 || !data.manifest.origins.includes(origin))
            throw new TaskError('task_scope_mismatch', 'page is outside the task’s supported sites');
    }
    /** @param {TaskData} data - private task. @param {string} type - event category. @param {Record<string,unknown>} payload - bounded event facts. @returns {Promise<TaskEvent>} durable append. */
    async appendOwned(data, type, payload) {
        if (data.readOnly)
            throw new TaskError('task_read_only', 'legacy task history is immutable; read, revoke and hand off');
        if ((type === 'created' && data.events.length !== 0) || !validTaskEvent(type, payload, data.manifest, data.pendingWrite, data.waiting, data.waitInput))
            throw new TaskError('invalid_request', 'unsupported task event or invalid event payload');
        if (!this.writable && data.events.length > 0)
            throw new TaskError('task_unavailable', 'task storage has no writer; only read, revoke and hand off');
        if (data.unhealthy)
            throw new TaskError('task_storage_failed', 'the task journal is damaged; do not write again');
        const unsigned = { schemaVersion: TASK_FORMAT_VERSION, seq: data.events.length + 1, prev: data.events.at(-1)?.hash ?? '', type, data: payload };
        const event = { ...unsigned, hash: hash(JSON.stringify(unsigned)) };
        const bytes = Buffer.from(JSON.stringify(event) + '\n');
        if (bytes.length > 2_000_000)
            throw new TaskError('invalid_request', 'task record exceeds its bounded size');
        try {
            const dir = join(data.dir, 'basic_law_index');
            await mkdir(dir, { recursive: true, mode: 0o700 });
            if (this.root)
                noLinks(this.root, dir);
            const path = join(dir, 'events.jsonl');
            try {
                const info = await lstat(path);
                if (!info.isFile() || info.isSymbolicLink())
                    throw new Error('task-journal-link');
            }
            catch (error) {
                if (!record(error) || error.code !== 'ENOENT')
                    throw error;
            }
            const handle = await open(path, 'a', 0o600);
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            data.events.push(event);
            this.reduce(data, event);
            return event;
        }
        catch (error) {
            data.unhealthy = true;
            data.blocked = true;
            throw new TaskError('task_storage_failed', 'task log could not be synchronized; writes are blocked, revoke and hand off');
        }
    }
    /** @param {TaskData} data - recovered or live task. @param {TaskEvent} event - validated event. @returns {void} monotonic state projection. */
    reduce(data, event) {
        if (event.type === 'wait_requested') {
            data.waiting = event.data;
            delete data.waitInput;
        }
        if (event.type === 'wait_input')
            data.waitInput = { kind: String(event.data.kind), inputRef: String(event.data.inputRef) };
        if (event.type === 'wait_resolved') {
            delete data.waiting;
            delete data.waitInput;
        }
        if (event.type === 'attempt')
            data.pendingWrite = String(event.data.attemptId);
        if (event.type === 'receipt') {
            if (event.data.outcome === 'unknown_outcome')
                data.blocked = true;
            if (data.pendingWrite === event.data.attemptId)
                delete data.pendingWrite;
        }
        if (event.type === 'revise' && record(event.data.manifest))
            data.manifest = event.data.manifest;
        if (event.type === 'status' && typeof event.data.state === 'string')
            data.state = event.data.state;
    }
    /** @param {TaskAccess} access - capability. @param {string} type - event. @param {Record<string,unknown>} payload - facts. @returns {Promise<TaskEvent>} appended event. */
    append(access, type, payload) { return this.serial(() => this.appendOwned(this.openTask(access), type, payload)); }
    /** @param {TaskAccess} access - capability. @param {string} action - fixed action kind, never private text. @returns {Promise<string>} durable attempt id before any write-related work. */
    beginAttempt(access, action) {
        return this.serial(async () => {
            const data = this.openTask(access, true);
            if (data.waiting && !['prepare_file', 'confirm_file'].includes(action))
                throw new TaskError('awaiting_user', 'this task awaits user input; inspect view=task, read safely, revoke or hand off');
            if (data.pendingWrite)
                throw new TaskError('task_busy', 'another write is pending in this task');
            const attemptId = 'attempt-' + randomUUID();
            await this.appendOwned(data, 'attempt', { attemptId, action, run: access.run });
            return attemptId;
        });
    }
    /** @param {TaskAccess} access - original run. @param {string} attemptId - original attempt. @param {string} outcome - known result or unknown. @param {{fileGrantId?:string}} [details] - verified file acknowledgement binding. @returns {Promise<void>} durable settlement; unknown is sticky. */
    async receipt(access, attemptId, outcome, details = {}) {
        const data = this.openTask(access);
        if (outcome === 'unknown_outcome')
            data.blocked = true;
        await this.append(access, 'receipt', { attemptId, outcome, run: access.run, ...details });
    }
    /** @param {TaskAccess} access - current owner. @returns {void} page mutations require no outstanding human dependency. */
    assertReady(access) {
        if (this.openTask(access, true).waiting)
            throw new TaskError('awaiting_user', 'this task awaits user input; inspect view=task, read safely, revoke or hand off');
    }
    /** @param {TaskAccess} access - owner. @param {import('./task-wait.ts').UserWaitRequest} request - model declaration. @returns {Promise<import('./task-wait.ts').UserWait>} synchronized wait; identical repeats do not append. */
    declareWait(access, request) {
        return this.serial(async () => {
            const data = this.openTask(access, true);
            if (!validUserWait(request))
                throw new TaskError('invalid_request', 'provide a bounded user dependency, reason and resume condition');
            if (data.pendingWrite)
                throw new TaskError('task_busy', 'settle the pending write before declaring a user dependency');
            if (data.waiting) {
                if (data.waiting.kind === request.kind && data.waiting.reason === request.reason && data.waiting.resumeCondition === request.resumeCondition)
                    return data.waiting;
                throw new TaskError('task_busy', 'resolve or hand off the existing user dependency first');
            }
            const waiting = { ...request, id: 'wait-' + randomUUID(), owner: 'user', source: 'model_declared', run: access.run };
            await this.appendOwned(data, 'wait_requested', waiting);
            return waiting;
        });
    }
    /** @param {TaskAccess} access - owner. @param {string} kind - actual prerequisite supplied through the panel. @param {string} inputRef - exact current capability or file fingerprint. @returns {Promise<void>} task-owned new input, never an authorization itself. */
    noteWaitInput(access, kind, inputRef) {
        return this.serial(async () => {
            const data = this.openTask(access);
            if (data.waiting?.kind === kind && data.state === 'active')
                await this.appendOwned(data, 'wait_input', { waitId: data.waiting.id, kind, inputRef, source: 'host_verified', run: access.run });
        });
    }
    /** @param {TaskAccess} access - owner. @param {unknown} waitId - panel reference. @param {unknown} userInput - explicit human input for non-verifiable dependencies. @param {(kind:string,inputRef:string)=>boolean} current - Host rechecks current supplied capabilities. @returns {Promise<void>} records resolution without restoring page control. */
    resumeWait(access, waitId, userInput, current) {
        return this.serial(async () => {
            const data = this.openTask(access, true), waiting = data.waiting;
            if (!waiting || data.state !== 'active' || waitId !== waiting.id)
                throw new TaskError('task_not_bound', 'the user dependency is inaccessible or no longer current');
            if (data.pendingWrite)
                throw new TaskError('task_busy', 'a preparation is still pending');
            const verified = ['page_authorization', 'file_input', 'file_confirmation'].includes(waiting.kind);
            if (verified ? !data.waitInput || !current(waiting.kind, data.waitInput.inputRef) : !text(userInput, 1000) || !userInput.trim())
                throw new TaskError('awaiting_user', 'supply the requested new input before resuming; an acknowledgement cannot replace page or file authorization');
            await this.appendOwned(data, 'wait_resolved', { waitId, source: verified ? 'host_verified' : 'user_declared', ...(verified ? { inputRef: data.waitInput?.inputRef } : { userInput }), run: access.run });
        });
    }
    /** @param {TaskAccess} access - original run. @param {string} state - user task lifecycle request. @returns {Promise<TaskAccess>} status, never a business verdict. */
    async end(access, state) {
        if (!['cancelled', 'handed_off'].includes(state))
            throw new TaskError('invalid_request', 'ending a task records cancelled or handed_off, never business success');
        if (this.openTask(access).readOnly)
            return access;
        await this.append(access, 'status', { state, run: access.run });
        await this.graph?.retire(access.scope.taskId);
        return access;
    }
    /** @param {TaskAccess} access - user-owned task. @param {unknown} raw - explicit revised goal/scope or new run. @returns {Promise<TaskAccess>} new revision; unknown write remains blocked. */
    revise(access, raw) {
        return this.serial(async () => {
            const data = this.openTask(access);
            if (data.readOnly)
                throw new TaskError('task_read_only', 'legacy task history cannot be revised; use a new Session');
            if (data.waiting)
                throw new TaskError('awaiting_user', 'resolve the current human dependency or hand off before revising');
            if (data.pendingWrite)
                throw new TaskError('task_busy', 'a write is pending; revoke control and hand off before revising');
            if (!record(raw) || Object.keys(raw).some(key => !['goal', 'constraints', 'criteria', 'origins', 'newRun'].includes(key)) || (raw.goal !== undefined && !text(raw.goal, 2000))
                || (raw.constraints !== undefined && !conditions(raw.constraints)) || (raw.criteria !== undefined && !conditions(raw.criteria)) || (raw.origins !== undefined && (!validOrigins(raw.origins) || data.manifest.adapter !== 'generic')))
                throw new TaskError('invalid_request', 'task revision must be bounded and cannot change its adapter or definition');
            const manifest = { ...data.manifest, scope: { ...data.manifest.scope, scopeRevision: data.manifest.scope.scopeRevision + 1 }, runId: 'run-' + randomUUID(),
                ...(raw.goal === undefined ? {} : { goal: raw.goal }), ...(raw.constraints === undefined ? {} : { constraints: raw.constraints }), ...(raw.criteria === undefined ? {} : { criteria: raw.criteria }), ...(raw.origins === undefined ? {} : { origins: raw.origins }) };
            await this.appendOwned(data, 'revise', { manifest });
            await this.graph?.retire(access.scope.taskId);
            return this.access(data);
        });
    }
    /** @param {TaskAccess} access - capability. @param {number} budget - projection character limit. @param {AbortSignal} [signal] - caller cancellation. @returns {Promise<Record<string,unknown>>} current Host facts and optional derived graph. */
    async view(access, budget, signal = undefined) {
        await this.refreshEvidence(access);
        const data = this.openTask(access);
        data.liveDocumentToken = this.controlDocument?.(access);
        const input = graphInput(data, this.graphConfig), hash = graphHash(JSON.stringify(input));
        let derived, reason = 'subprocess_unavailable';
        const current = () => { try {
            const now = this.openTask(access);
            now.liveDocumentToken = this.controlDocument?.(access);
            return graphHash(JSON.stringify(graphInput(now, this.graphConfig))) === hash;
        }
        catch {
            return false;
        } };
        try {
            if (this.graph && !data.readOnly && !data.unhealthy) {
                derived = await this.graph.project(input, budget, current, signal);
                reason = 'ready';
            }
        }
        catch (error) {
            reason = error instanceof GraphError ? error.code : 'graph_failed';
        }
        this.openTask(access);
        data.liveDocumentToken = this.controlDocument?.(access);
        if (derived) {
            await this.refreshEvidence(access);
            if (!current()) {
                derived = undefined;
                reason = 'stale_projection';
            }
        }
        return taskView(data, budget, derived, reason, this.writable, derived ? hash : undefined);
    }
    /** @param {TaskAccess} access - owner. @param {Record<string,unknown>} value - private original facts. @returns {Promise<string>} task-local evidence reference. */
    async proof(access, value) {
        const data = this.openTask(access);
        const path = join('evidence', access.run.runId, 'proof-' + randomUUID() + '.json').replaceAll('\\', '/');
        await this.directory(join(data.dir, 'evidence', access.run.runId));
        await this.writeNew(join(data.dir, path), value);
        const bytes = await readFile(join(data.dir, path));
        return this.asset(access, 'evidence', { artifact: path, sha256: hash(bytes), bytes: bytes.length }, 'code_verified');
    }
    /** @param {TaskAccess} access - owner. @param {string} path - existing private original. @param {string} role - fixed evidence role. @returns {Promise<import('./task-criteria.ts').Artifact>} bound artifact without exposing its bytes. */
    async artifact(access, path, role) {
        const data = this.openTask(access), name = relative(data.dir, path).replaceAll('\\', '/');
        return this.readArtifact(data, { role, path: name, sha256: '', bytes: 0 }, false).then(bytes => ({ role, path: name, sha256: hash(bytes), bytes: bytes.length }));
    }
    /** @param {TaskData} data - owner. @param {import('./task-criteria.ts').Artifact} ref - relative reference. @param {boolean} [verify] - enforce recorded digest. @returns {Promise<Buffer>} complete bounded bytes. */
    async readArtifact(data, ref, verify = true) {
        if (!ref.path.startsWith('evidence/') || ref.path.split('/').some(part => !part || part === '.' || part === '..') || /[\\:\x00-\x1f]/.test(ref.path))
            throw new Error('task-evidence-path');
        const path = join(data.dir, ref.path);
        noLinks(data.dir, path);
        const info = await lstat(path);
        if (!info.isFile() || info.size <= 0 || info.size > 16_000_000)
            throw new Error('task-evidence-size');
        const bytes = await readFile(path);
        if (bytes.length !== info.size || (verify && (bytes.length !== ref.bytes || hash(bytes) !== ref.sha256)))
            throw new Error('task-evidence-mismatch');
        return bytes;
    }
    /** @param {TaskAccess} access - owner. @returns {Promise<void>} recheck recoverable originals before displaying proofs. */
    async refreshEvidence(access) {
        const data = this.openTask(access), checked = new Map(), issues = [];
        if (!data.readOnly && !data.unhealthy)
            for (const event of data.events) {
                const row = event.data;
                if (event.type !== 'asset' || row.kind !== 'evidence' || typeof row.id !== 'string' || !record(row.data) || typeof row.data.artifact !== 'string' || !validRunScope(row.run) || !sameRunScope(row.run, access.run))
                    continue;
                const ref = { role: 'proof', path: row.data.artifact, sha256: row.data.sha256, bytes: row.data.bytes };
                try {
                    if (!validArtifact(ref) || !ref.path.startsWith('evidence/' + access.run.runId + '/'))
                        throw new Error('task-evidence-reference');
                    const value = JSON.parse((await this.readArtifact(data, ref)).toString('utf8'));
                    if (!record(value))
                        throw new Error('task-evidence-object');
                    const files = new Map();
                    if (value.files !== undefined) {
                        if (!Array.isArray(value.files) || value.files.length > 2)
                            throw new Error('task-evidence-files');
                        for (const item of value.files) {
                            if (!validArtifact(item) || !item.path.startsWith('evidence/' + access.run.runId + '/') || files.has(item.role))
                                throw new Error('task-evidence-file');
                            files.set(item.role, await this.readArtifact(data, item));
                        }
                    }
                    checked.set(row.id, { value, files });
                }
                catch (error) {
                    void error;
                    issues.push(row.id);
                }
            }
        data.checkedProofs = checked;
        data.evidenceIssues = issues;
    }
    /** @param {TaskAccess} access - owner. @param {Record<string,unknown>} result - trusted validator result. @param {string} proofRef - private original reference. @returns {Promise<string>} independently checked current verdict. */
    async verdict(access, result, proofRef) {
        const criterion = trustedCriterion(this.openTask(access).manifest);
        if (!criterion)
            throw new TaskError('invalid_request', 'no trusted criterion exists for this workflow');
        await this.refreshEvidence(access);
        await this.append(access, 'business_verdict', { ...result, source: 'code_verified', run: access.run, proofRef, criterionId: criterion.id, validatorId: criterion.validatorId, validatorVersion: criterion.version });
        return taskFacts(this.openTask(access)).verdict;
    }
    /** @param {TaskAccess} access - capability. @param {string} kind - code-owned asset kind. @param {Record<string,unknown>} data - safe facts; raw personnel remain in private evidence. @param {'host'|'code_verified'} [source] - factual authority. @returns {Promise<string>} unique task-local reference, never deduplicated by name or content. */
    async asset(access, kind, data, source = 'host') {
        if (!['page', 'file', 'unit_check', 'import_result', 'evidence'].includes(kind))
            throw new TaskError('invalid_request', 'unsupported task asset');
        const id = 'asset-' + randomUUID();
        await this.append(access, 'asset', { id, kind, data, source, run: access.run });
        return id;
    }
    /** @param {TaskAccess} access - capability. @param {string} from - existing task asset. @param {string} to - existing task asset. @param {string} relation - fixed relation. @returns {Promise<string>} journaled relation after both ownership checks. */
    async relate(access, from, to, relation) {
        const references = taskReferences(this.openTask(access));
        if (!references.has(from) || !references.has(to))
            throw new TaskError('task_not_bound', 'one or more task references are inaccessible');
        if (!['observed_on', 'validated_by', 'derived_from', 'selected_from', 'proves', 'yields'].includes(relation))
            throw new TaskError('invalid_request', 'unsupported task relation');
        const id = 'edge-' + randomUUID();
        await this.append(access, 'edge', { id, from, to, relation, run: access.run });
        return id;
    }
    /** @param {TaskAccess} access - capability. @param {string} id - task-local detail. @param {number} offset - bounded text continuation. @param {number} budget - character budget. @returns {Promise<object>} scoped immutable detail or generic refusal. */
    async detail(access, id, offset, budget) {
        const data = this.openTask(access);
        const row = data.events.findLast(event => event.type === 'asset' && event.data.id === id);
        const asset = row ? { id, taskId: data.manifest.scope.taskId, kind: row.data.kind, source: row.data.source, sourceSeq: row.seq, data: row.data.data } : undefined;
        const criterion = taskFacts(data).criteria.find(item => item.id === id);
        let value;
        if (asset)
            value = asset.kind === 'evidence' ? { ...asset, data: { sha256: asset.data.sha256, bytes: asset.data.bytes, originalAvailable: data.checkedProofs?.has(asset.id) ?? false } } : asset;
        else if (id === 'waiting')
            value = { current: data.state === 'active' ? data.waiting ?? null : null, history: data.events.filter(event => ['wait_requested', 'wait_input', 'wait_resolved'].includes(event.type)).map(event => ({ sourceSeq: event.seq, type: event.type, ...event.data })) };
        else if (criterion)
            value = { id: criterion.id, kind: 'criterion', source: criterion.source, data: criterion };
        else if (id === 'criteria')
            value = taskFacts(data).criteria;
        else if (id === 'goal')
            value = { goal: data.manifest.goal, constraints: data.manifest.constraints, criteria: data.manifest.criteria, source: 'user_declared' };
        else if (data.snapshot?.definition.resources.includes(id))
            value = { name: id, text: data.snapshot.files[id], source: 'definition_snapshot', digest: data.manifest.definitionDigest };
        else {
            if (id !== 'graph' && !id.startsWith('digest-') && !taskReferences(data).has(id))
                throw new TaskError('task_not_bound', 'task reference is inaccessible');
            if (!this.graph)
                throw new TaskError('task_unavailable', 'graph component is unavailable');
            const input = graphInput(data, this.graphConfig), hash = graphHash(JSON.stringify(input));
            try {
                value = await this.graph.detail(input, id, () => { try {
                    return graphHash(JSON.stringify(graphInput(this.openTask(access), this.graphConfig))) === hash;
                }
                catch {
                    return false;
                } });
            }
            catch (error) {
                throw new TaskError(error instanceof GraphError && error.code === 'kernel_rejected' ? 'task_not_bound' : 'task_unavailable', 'projection reference is unavailable or expired');
            }
        }
        const serialized = JSON.stringify(value);
        return { task: access.run, contextVersion: data.events.length, ref: id, offset, totalChars: serialized.length, text: serialized.slice(offset, offset + budget), complete: offset + budget >= serialized.length };
    }
    /** @returns {Promise<void>} read immutable ownership plus complete validated journal prefixes; no commands or control are restored. */
    async recover() {
        if (!this.runtime || !this.profileId || !this.root)
            return;
        const registry = join(this.runtime, 'registry');
        try {
            await lstat(registry);
        }
        catch (error) {
            if (record(error) && error.code === 'ENOENT')
                return;
            throw error;
        }
        noLinks(this.root, registry);
        for (const file of await readdir(registry)) {
            if (!/^[a-f0-9]{64}\.json$/.test(file))
                throw new Error('task-registry-invalid');
            const path = join(registry, file);
            noLinks(this.root, path);
            const row = JSON.parse(await readFile(path, 'utf8'));
            if (!record(row) || !text(row.sessionId, 200) || typeof row.taskId !== 'string' || !/^task-[a-f0-9-]{36}$/.test(row.taskId) || row.profileId !== this.profileId || file !== hash(row.sessionId) + '.json')
                throw new Error('task-registry-invalid');
            this.bindings.set(row.sessionId, row.taskId);
            const dir = join(this.runtime, 'tasks', row.taskId);
            try {
                noLinks(this.root, dir);
                const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
                if (!validTaskManifest(manifest, true) || manifest.scope.ownerSessionId !== row.sessionId || manifest.scope.taskId !== row.taskId || manifest.scope.profileId !== this.profileId
                    || !validOrigins(manifest.origins) || !text(manifest.goal, 2000) || !conditions(manifest.constraints) || !conditions(manifest.criteria))
                    throw new Error('task-manifest-invalid');
                const data = { manifest: manifest, dir, events: [], blocked: false, unhealthy: false, state: 'active', readOnly: manifest.schemaVersion !== TASK_FORMAT_VERSION || row.schemaVersion !== TASK_FORMAT_VERSION, storageIssue: manifest.schemaVersion === undefined ? 'legacy_unversioned' : manifest.schemaVersion !== TASK_FORMAT_VERSION ? 'unsupported_manifest_version' : row.schemaVersion !== TASK_FORMAT_VERSION ? 'unsupported_ownership_version' : undefined };
                if (manifest.definitionId) {
                    const snapshot = loadDefinition(dir, 'definition-snapshot', String(manifest.definitionId));
                    if (snapshot.digest !== manifest.definitionDigest || snapshot.definition.version !== manifest.definitionVersion)
                        throw new Error('task-snapshot-changed');
                    data.snapshot = snapshot;
                }
                await this.recoverJournal(data);
                this.tasks.set(row.taskId, data);
                await this.refreshEvidence(this.access(data));
            }
            catch (error) {
                // Ownership is retained even when its task cannot be decoded: this Session cannot create a replacement task.
                void error;
            }
        }
    }
    /** @param {TaskData} data - task being recovered. @returns {Promise<void>} valid history prefix, conservatively blocked on truncation/unfinished writes. */
    async recoverJournal(data) {
        const path = join(data.dir, 'basic_law_index', 'events.jsonl');
        if (this.root)
            noLinks(this.root, path);
        const bytes = await readFile(path, 'utf8');
        const lines = bytes.split('\n');
        const tail = lines.pop();
        try {
            for (const line of lines) {
                const event = JSON.parse(line);
                if (!record(event) || event.seq !== data.events.length + 1 || event.prev !== (data.events.at(-1)?.hash ?? '') || typeof event.type !== 'string' || !record(event.data))
                    throw new Error('task-journal-invalid');
                const unsigned = data.readOnly && event.schemaVersion === undefined ? { seq: event.seq, prev: event.prev, type: event.type, data: event.data } : { schemaVersion: event.schemaVersion, seq: event.seq, prev: event.prev, type: event.type, data: event.data };
                if (event.hash !== hash(JSON.stringify(unsigned)))
                    throw new Error('task-journal-hash');
                if (!data.readOnly && (event.schemaVersion !== TASK_FORMAT_VERSION || (event.type === 'created' && event.seq !== 1) || !validTaskEvent(event.type, event.data, data.manifest, data.pendingWrite, data.waiting, data.waitInput)))
                    throw new Error('task-journal-unsupported-semantics');
                if (data.events.length === 0 && (event.type !== 'created' || JSON.stringify(event.data.manifest) !== JSON.stringify(data.manifest)))
                    throw new Error('task-journal-creation-mismatch');
                if (data.manifest.schemaVersion === undefined) {
                    const payload = { ...event.data, ...(event.data.manifest && record(event.data.manifest) ? { manifest: { ...event.data.manifest, schemaVersion: TASK_FORMAT_VERSION } } : {}), ...(event.type === 'status' && event.data.run === undefined ? { run: { ...data.manifest.scope, runId: data.manifest.runId, workflowRef: data.manifest.workflowRef } } : {}) };
                    if (!validTaskEvent(event.type, payload, { ...data.manifest, schemaVersion: TASK_FORMAT_VERSION }, data.pendingWrite, data.waiting, data.waitInput))
                        throw new Error('legacy-journal-unsupported-semantics');
                }
                const accepted = event;
                data.events.push(accepted);
                this.reduce(data, accepted);
            }
            if (tail !== '')
                throw new Error('task-journal-tail');
            if (data.events.length === 0 || data.events[0].type !== 'created')
                throw new Error('task-journal-missing');
        }
        catch (error) {
            data.unhealthy = true;
            data.blocked = true;
            data.storageIssue = 'invalid_or_unsupported_journal';
            void error;
        }
        if (data.pendingWrite)
            data.blocked = true;
    }
    /** @returns {Promise<void>} drain owned writes before releasing the profile writer lease. */
    async close() {
        this.closed = true;
        this.abort.abort();
        await Promise.allSettled([this.ready, this.tail]);
        this.releaseWriter?.();
        await this.writer?.catch(() => { });
        this.handles = new WeakMap();
    }
}
