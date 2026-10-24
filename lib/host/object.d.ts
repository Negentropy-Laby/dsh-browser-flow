/** Shared dependency-free JSON object shape guard; arrays and null are excluded. */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
