/** Shared public bounds; aggregate journal limits apply in addition to field limits. */
export declare const EXPLORATION_LIMITS: Readonly<{
    atoms: 32;
    sources: 64;
    refs: 32;
    nodes: 32;
    edges: 256;
    commandChars: 100000;
    eventChars: 200000;
}>;
