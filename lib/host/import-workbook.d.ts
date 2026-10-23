export type { XmlNode } from './workbook-core.ts';
/** @param {Uint8Array} bytes - frozen workbook. @returns {{ sheetName: string, firstRow: number, lastRow: number, people: import('./import-rules.ts').Person[] }} complete supported input. */
export declare function parseWorkbook(bytes: Uint8Array): {
    sheetName: string;
    firstRow: number;
    lastRow: number;
    people: import('./import-rules.ts').Person[];
};
