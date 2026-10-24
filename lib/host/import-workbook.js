import { walkWorkbook } from "./workbook-core.js";
import { personKeys, FILE_LIMIT } from "./import-rules.js";
function reject(reason) { throw new Error(reason); }
/** @param {string} value - header. @returns {string} normalized header. */
const headerText = (value) => value.normalize('NFKC').trim().replace(/^\*\s*/u, '');
/** @param {Uint8Array} bytes - frozen workbook. @returns {{ sheetName: string, firstRow: number, lastRow: number, people: import('./import-rules.ts').Person[] }} complete supported input. */
export function parseWorkbook(bytes) {
    if (bytes.byteLength === 0 || bytes.byteLength > FILE_LIMIT)
        reject('file-size-invalid');
    const [sheet] = walkWorkbook(bytes, { singleVisible: true, noFormulas: true, noHiddenColumns: true, noHiddenRows: true });
    const rows = sheet.rows.map(row => ({ index: row.index, cells: new Map(row.cells.map(cell => {
            if (cell.rawType !== undefined && !['inlineStr', 's', 'n', 'str'].includes(cell.rawType))
                reject('unsupported-cell-type');
            return [cell.column, { value: cell.text, text: ['inlineStr', 's', 'str'].includes(cell.rawType ?? '') }];
        })) }));
    const idHeaders = new Set(['证件号码', '身份证号码', '身份证号']);
    const headers = rows.filter(row => [...row.cells.values()].some(cell => idHeaders.has(headerText(cell.value))) && [...row.cells.values()].some(cell => headerText(cell.value) === '姓名'));
    if (headers.length !== 1)
        reject('ambiguous-personnel-header');
    const header = headers[0];
    const ids = [...header.cells].filter(([, cell]) => idHeaders.has(headerText(cell.value))).map(([col]) => col);
    const namesColumns = [...header.cells].filter(([, cell]) => headerText(cell.value) === '姓名').map(([col]) => col);
    if (ids.length !== 1 || namesColumns.length !== 1)
        reject('ambiguous-personnel-header');
    if (rows.some(row => row.index < header.index && [...row.cells.values()].some(cell => /^(\d{17}[\dX]|\d{15})$/i.test(cell.value.trim()))))
        reject('personnel-before-header');
    /** @param {string} column - Excel column. @returns {number} one-based index. */
    const columnNumber = (column) => [...column].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    const ranges = [];
    for (const merge of sheet.merges) {
        const match = /^([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/.exec(merge);
        if (!match)
            reject('merged-personnel-data');
        const range = { left: columnNumber(match[1]), right: columnNumber(match[3]), top: Number(match[2]), bottom: Number(match[4]) };
        if (range.left > range.right || range.top > range.bottom || range.bottom > header.index || ranges.some(prior => range.left <= prior.right && range.right >= prior.left && range.top <= prior.bottom && range.bottom >= prior.top))
            reject('merged-personnel-data');
        if (range.bottom === header.index && [ids[0], namesColumns[0]].some(col => columnNumber(col) >= range.left && columnNumber(col) <= range.right))
            reject('merged-personnel-header');
        ranges.push(range);
    }
    const dataRows = rows.filter(row => row.index > header.index && [...row.cells.values()].some(cell => cell.value.trim()));
    const people = dataRows.map(row => {
        const name = row.cells.get(namesColumns[0]);
        const id = row.cells.get(ids[0]);
        if (!name?.text || !id?.text)
            return reject('incomplete-or-numeric-personnel');
        return { name: name.value.trim(), certificateNumber: id.value.normalize('NFKC').trim().toUpperCase() };
    });
    if (!people.length || !personKeys(people) || dataRows.some((row, index) => row.index !== header.index + index + 1))
        reject('incomplete-or-duplicate-personnel');
    return { sheetName: sheet.name, firstRow: dataRows[0].index, lastRow: dataRows[dataRows.length - 1].index, people };
}
