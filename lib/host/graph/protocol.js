/** @param value - wire value. @returns Whether it is a non-array JSON record. */
export function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** Expected component failures are safe to expose without raw stderr or paths. */
export class GraphError extends Error {
    code;
    /** @param code - bounded code, never original process diagnostics. */
    constructor(code) {
        super(code);
        this.code = code;
    }
}
/** @param value - JSON message. @param limit - maximum payload bytes. @returns A length-prefixed UTF-8 frame. */
export function frame(value, limit) {
    const body = Buffer.from(JSON.stringify(value));
    if (body.length === 0 || body.length > limit)
        throw new GraphError('frame_limit');
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(body.length);
    return Buffer.concat([prefix, body]);
}
/** Bounded incremental decoder; allocation is rejected before reading the body. */
export class Frames {
    limit;
    receive;
    prefix = Buffer.alloc(4);
    prefixBytes = 0;
    body;
    bodyBytes = 0;
    /** @param limit - payload byte limit. @param receive - one complete JSON value. */
    constructor(limit, receive) {
        this.limit = limit;
        this.receive = receive;
    }
    /** @param chunk - raw stdout bytes. @returns Nothing; malformed data throws. */
    push(chunk) {
        let offset = 0;
        while (offset < chunk.length) {
            if (!this.body) {
                const take = Math.min(4 - this.prefixBytes, chunk.length - offset);
                chunk.copy(this.prefix, this.prefixBytes, offset, offset + take);
                this.prefixBytes += take;
                offset += take;
                if (this.prefixBytes < 4)
                    continue;
                const size = this.prefix.readUInt32BE();
                if (size === 0 || size > this.limit)
                    throw new GraphError('frame_limit');
                this.body = Buffer.alloc(size);
                this.bodyBytes = 0;
            }
            const take = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
            chunk.copy(this.body, this.bodyBytes, offset, offset + take);
            this.bodyBytes += take;
            offset += take;
            if (this.bodyBytes === this.body.length) {
                const body = this.body;
                this.body = undefined;
                this.prefixBytes = 0;
                this.bodyBytes = 0;
                let parsed;
                try {
                    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
                }
                catch {
                    throw new GraphError('invalid_json');
                }
                ;
                this.receive(parsed);
            }
        }
    }
    /** @returns Whether EOF would truncate a frame. */
    get incomplete() { return this.prefixBytes !== 0 || this.body !== undefined; }
}
