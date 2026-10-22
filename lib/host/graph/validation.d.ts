import type { GraphInput, JsonRecord } from './protocol.ts';
/** @param value - worker payload. @param input - original safe input. @param hash - projection identity. @returns Closed owned view with no generated authority fields. */
export declare function validateView(value: unknown, input: GraphInput, hash: string): JsonRecord;
/** @param value - detail reply. @param ref - requested reference. @param input - original safe input. @param hash - projection identity. @returns Owned immutable detail. */
export declare function validateDetail(value: unknown, ref: string, input: GraphInput, hash: string): unknown;
