/** @param {Uint8Array} bytes - frozen workbook. @returns {{ sheetName: string, firstRow: number, lastRow: number, people: import('./import-rules.js').Person[] }} complete supported input. */
export function parseWorkbook(bytes: Uint8Array): {
    sheetName: string;
    firstRow: number;
    lastRow: number;
    people: import("./import-rules.js").Person[];
};
export type XmlNode = {
    name: string;
    attrs: Record<string, string>;
    text: string;
    children: XmlNode[];
};
