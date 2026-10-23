export type XmlNode = {
    name: string;
    attrs: Record<string, string>;
    text: string;
    children: XmlNode[];
};
/** @param {Uint8Array} bytes - one admitted XML part. @returns {XmlNode} bounded tree. */
export declare function xml(bytes: Uint8Array): XmlNode;
/** @param {XmlNode} node - root. @param {string} name - local name. @returns {XmlNode[]} descendants. */
export declare function descendants(node: XmlNode, name: string): XmlNode[];
/** @param {XmlNode} node - root. @param {string} name - direct child name. @returns {XmlNode} unique child. */
export declare function one(node: XmlNode, name: string): XmlNode;
export declare function workbookParts(bytes: Uint8Array): Map<string, Buffer>;
export interface WorkbookCell {
    ref: string;
    type: string;
    value: string | number | boolean | null;
    formula?: string;
}
export interface WorkbookSheet {
    name: string;
    visibility: string;
    rows: {
        index: number;
        hidden: boolean;
        cells: WorkbookCell[];
    }[];
    merges: string[];
}
export declare function parseWorkbookData(bytes: Uint8Array): {
    format: 'xlsx';
    sheets: WorkbookSheet[];
};
