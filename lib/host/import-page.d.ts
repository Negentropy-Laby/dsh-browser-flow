import type { ImportInput, PagePolicy } from './page/types.ts';
/** @param scope - code-owned restriction. @returns Fixed policy declaration for program composition. */
export declare function importActionPolicy(scope: PagePolicy | undefined): string;
/** @param input - validated owner, mode and relative lifetime. @returns Self-contained passive observation program. */
export declare function importProgram(input: ImportInput): string;
