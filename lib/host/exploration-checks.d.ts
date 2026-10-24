export interface SourceOperand {
    ref: string;
    path: (string | number)[];
}
type Operand = SourceOperand | {
    value: unknown;
};
export type Assertion = {
    op: 'all' | 'any';
    checks: Atom[];
} | Atom;
export type Atom = {
    op: 'exists' | 'equals' | 'contains' | 'count' | 'setEquals';
    left: SourceOperand;
    right?: Operand;
};
export declare function validateAssertion(v: unknown): asserts v is Assertion;
export declare function assertionRefs(assertion: Assertion): string[];
export declare function evaluateAssertion(assertion: Assertion, values: Map<string, unknown>): {
    passed: boolean;
    atoms: boolean[];
};
export {};
