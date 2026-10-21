/** Owned task workers. Failures cannot alter journals, permissions or business facts. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sameRunScope, validRunScope } from '../task-scope.js';
import { validateView, validateDetail } from "./validation.js";
import { Frames, GraphError, frame, record } from "./protocol.js";
/** @param bytes - complete input. @returns SHA-256 identity. */
export function graphHash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
/** @returns A verified Windows x64 package artifact. */
export function packagedBinary() {
    if (process.platform !== 'win32' || process.arch !== 'x64')
        throw new GraphError('unsupported_platform');
    const root = dirname(createRequire(import.meta.url).resolve('@negentropy/dsh-browser-flow/package.json'));
    const path = join(root, 'lib', 'native', 'win32-x64', 'browser-flow-graph.exe');
    try {
        const manifest = JSON.parse(readFileSync(join(root, 'lib', 'native', 'manifest.json'), 'utf8'));
        if (!record(manifest) || manifest.protocolVersion !== 1 || manifest.kernelVersion !== '1' || manifest.rulesVersion !== 'structural-v1' || manifest.sha256 !== graphHash(readFileSync(path)))
            throw new GraphError('binary_mismatch');
    }
    catch (error) {
        if (error instanceof GraphError)
            throw error;
        throw new GraphError('binary_unavailable');
    }
    return { path, cwd: root };
}
class Worker {
    config;
    generation = randomUUID();
    handle;
    scope;
    closing = false;
    busy = false;
    pending;
    counter = 0;
    idle;
    stopping;
    decoder;
    onData;
    onEnd;
    onError;
    cached;
    flight;
    /** @param runtime - actual Host service. @param config - resolved limits. @param binary - verified package artifact. @param input - initial run. */
    constructor(runtime, config, binary, input) {
        this.config = config;
        this.scope = { ...input.scope };
        this.handle = runtime.spawn({ argv: [binary.path, '--max-frame', String(config.graphMaxFrameBytes)], cwd: binary.cwd, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: config.graphStderrBytes } }, graceMs: config.graphTerminateGraceMs });
        this.decoder = new Frames(config.graphMaxFrameBytes, value => this.receive(value));
        this.onData = chunk => { try {
            this.decoder.push(chunk);
        }
        catch {
            this.fail('invalid_response');
        } };
        this.onEnd = () => this.fail(this.decoder.incomplete ? 'truncated_frame' : 'worker_exit');
        this.onError = () => this.fail('worker_io');
        this.handle.stdout?.on('data', this.onData);
        this.handle.stdout?.on('end', this.onEnd);
        this.handle.stdout?.on('error', this.onError);
        this.handle.stdin?.on('error', this.onError);
        void this.handle.done.then(() => this.fail('worker_exit'), () => this.fail('worker_exit'));
    }
    fail(code) { this.pending?.reject(new GraphError(code)); void this.stop().catch(() => { }); }
    receive(value) {
        const pending = this.pending;
        if (!pending || !record(value) || Object.keys(value).some(key => !['protocolVersion', 'id', 'generation', 'scope', 'version', 'tailHash', 'inputHash', 'ok', 'code', 'value'].includes(key)))
            throw new GraphError('invalid_response');
        const q = pending.request;
        if (value.protocolVersion !== 1 || value.id !== q.id || value.generation !== q.generation || !validRunScope(value.scope) || !sameRunScope(value.scope, q.scope) || value.version !== q.version || value.tailHash !== q.tailHash || value.inputHash !== q.inputHash || typeof value.ok !== 'boolean')
            throw new GraphError('binding_mismatch');
        this.pending = undefined;
        clearTimeout(pending.timer);
        if (!value.ok) {
            pending.reject(new GraphError('kernel_rejected'));
            void this.stop().catch(() => { });
            return;
        }
        pending.resolve(value.value);
    }
    /** @param op - fixed RPC. @param input - safe snapshot. @param hash - its identity. @param budget - view size. @param deadline - Host monotonic deadline. @param ref - scoped projection detail. @returns Validated envelope payload. */
    async rpc(op, input, hash, budget, deadline, ref) {
        if (this.closing || this.pending)
            throw new GraphError('graph_busy');
        const remaining = Math.floor(deadline - performance.now());
        if (remaining <= 0)
            throw new GraphError('graph_timeout');
        clearTimeout(this.idle);
        this.busy = true;
        const q = { protocolVersion: 1, id: String(++this.counter), generation: this.generation, scope: this.scope, version: input.version, tailHash: input.tailHash, inputHash: hash, op, budgetMs: remaining, budget, ...(op === 'project' ? { input } : {}), ...(ref ? { ref } : {}) };
        const encoded = frame(q, this.config.graphMaxFrameBytes);
        try {
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => this.fail('graph_timeout'), remaining);
                this.pending = { request: q, resolve, reject, timer };
                if (!this.handle.stdin || !this.handle.stdout) {
                    this.fail('worker_io');
                    return;
                }
                this.handle.stdin.write(encoded, error => { if (error)
                    this.fail('worker_io'); });
            });
        }
        finally {
            this.busy = false;
            if (!this.closing) {
                this.idle = setTimeout(() => { void this.stop().catch(() => { }); }, this.config.graphIdleMs);
                this.idle.unref();
            }
        }
    }
    /** @returns Completion only after the managed range is empty. */
    stop() {
        if (this.stopping)
            return this.stopping;
        this.closing = true;
        this.cached = undefined;
        clearTimeout(this.idle);
        if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending.reject(new GraphError('worker_stopped'));
            this.pending = undefined;
        }
        this.stopping = (async () => { this.handle.terminate(); if (!await this.handle.waitForExit())
            throw new GraphError('cleanup_failed'); await this.handle.done.catch(() => { }); this.handle.stdout?.off('data', this.onData); this.handle.stdout?.off('end', this.onEnd); this.handle.stdout?.off('error', this.onError); this.handle.stdin?.off('error', this.onError); })();
        return this.stopping;
    }
}
/** Task-scoped registry. Missing services affect graph reads, never permission withdrawal. */
export class GraphWorkers {
    config;
    binary;
    runtime;
    workers = new Map();
    closed = false;
    acquisition = Promise.resolve();
    /** @param config - resolved settings. @param binary - package resolver; tests may supply an owned helper. */
    constructor(config, binary = packagedBinary) {
        this.config = config;
        this.binary = binary;
    }
    /** @param runtime - newly mounted service. @returns Disposal joined before the provider is released. */
    attach(runtime) { this.runtime = runtime; return async () => { if (this.runtime === runtime)
        this.runtime = undefined; await this.acquisition; await this.stopAll(); }; }
    async stopAll() { const entries = [...this.workers.values()]; const results = await Promise.allSettled(entries.map(worker => worker.stop())); if (results.some(row => row.status === 'rejected'))
        throw new GraphError('cleanup_failed'); this.workers.clear(); }
    worker(input, deadline) {
        const result = this.acquisition.then(() => this.acquire(input, deadline));
        this.acquisition = result.then(() => { }, () => { });
        return result;
    }
    async acquire(input, deadline) {
        if (this.closed)
            throw new GraphError('graph_closed');
        if (!this.runtime)
            throw new GraphError('subprocess_unavailable');
        const key = input.scope.taskId;
        let worker = this.workers.get(key);
        if (worker && (worker.closing || !sameRunScope(worker.scope, input.scope))) {
            await worker.stop();
            if (this.workers.get(key) === worker)
                this.workers.delete(key);
            worker = undefined;
        }
        if (worker)
            return { worker, fresh: false };
        for (const [id, entry] of this.workers)
            if (entry.closing) {
                await entry.stop();
                this.workers.delete(id);
            }
        if (this.workers.size >= this.config.graphMaxWorkers)
            throw new GraphError('graph_capacity');
        if (this.closed || !this.runtime)
            throw new GraphError('graph_closed');
        if (performance.now() >= deadline)
            throw new GraphError('graph_timeout');
        // No await between the capacity check and claiming this task's worker.
        const entry = new Worker(this.runtime, this.config, this.binary(), input);
        this.workers.set(key, entry);
        return { worker: entry, fresh: true };
    }
    /** @param input - complete sanitized snapshot. @param budget - display limit. @param current - recheck after every asynchronous operation. @param signal - caller cancellation. @returns Four derived modules; no Host facts. */
    async project(input, budget, current, signal) {
        const deadline = performance.now() + this.config.graphRequestTimeoutMs;
        const hash = graphHash(JSON.stringify(input));
        const { worker, fresh } = await this.worker(input, deadline);
        if (!current() || signal?.aborted) {
            if (fresh)
                await worker.stop();
            throw new GraphError('stale_projection');
        }
        const key = hash + ':' + budget;
        if (worker.cached?.hash === hash && worker.cached.budget === budget)
            return worker.cached.value;
        let promise;
        if (worker.flight) {
            if (worker.flight.key !== key)
                throw new GraphError('graph_busy');
            promise = worker.flight.promise;
        }
        else {
            promise = (async () => {
                try {
                    if (fresh) {
                        const hello = await worker.rpc('hello', input, hash, budget, deadline);
                        if (!record(hello) || hello.kernelVersion !== '1' || hello.rulesVersion !== 'structural-v1')
                            throw new GraphError('protocol_mismatch');
                    }
                    const value = validateView(await worker.rpc('project', input, hash, budget, deadline), input, hash);
                    if (worker.closing || !current())
                        throw new GraphError('stale_projection');
                    worker.cached = { hash, budget, value };
                    return value;
                }
                catch (error) {
                    await worker.stop();
                    throw error;
                }
                finally {
                    worker.flight = undefined;
                }
            })();
            worker.flight = { key, promise };
        }
        const value = await this.cancelable(promise, signal);
        if (worker.closing || !current())
            throw new GraphError('stale_projection');
        return value;
    }
    /** @param input - current snapshot. @param ref - task-owned projection reference. @param current - current binding check. @param signal - caller cancellation. @returns Sanitized immutable detail. */
    async detail(input, ref, current, signal) {
        await this.project(input, 8000, current, signal);
        const worker = this.workers.get(input.scope.taskId);
        if (!worker)
            throw new GraphError('graph_unavailable');
        const hash = graphHash(JSON.stringify(input)), deadline = performance.now() + this.config.graphRequestTimeoutMs;
        try {
            const value = await this.cancelable(worker.rpc('detail', input, hash, 8000, deadline, ref), signal);
            if (worker.closing || !current())
                throw new GraphError('stale_projection');
            return validateDetail(value, ref, input, hash);
        }
        catch (error) {
            await worker.stop();
            throw error;
        }
    }
    async cancelable(promise, signal) {
        if (!signal)
            return promise;
        if (signal.aborted)
            throw new GraphError('graph_cancelled');
        let abort = () => { };
        try {
            return await Promise.race([promise, new Promise((_, reject) => { abort = () => reject(new GraphError('graph_cancelled')); signal.addEventListener('abort', abort, { once: true }); })]);
        }
        finally {
            signal.removeEventListener('abort', abort);
        }
    }
    /** @param taskId - owned task being ended or revised. @returns Quiescent worker disposal. */
    async retire(taskId) { const worker = this.workers.get(taskId); if (worker) {
        await worker.stop();
        this.workers.delete(taskId);
    } }
    /** @returns All workers have stopped before plugin disposal completes. */
    async close() { this.closed = true; this.runtime = undefined; await this.acquisition; await this.stopAll(); }
}
