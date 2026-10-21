/** Bounded XLSX parsing adapted from bjrsj-input-snapshot; no filesystem extraction. */
import AdmZip from 'adm-zip';
import { SaxesParser } from 'saxes';
import { posix } from 'node:path';
import { FILE_LIMIT, personKeys } from './import-rules.js';
/** @typedef {{ name: string, attrs: Record<string,string>, text: string, children: XmlNode[] }} XmlNode */
/** @param {string} reason - finite rejection. @returns {never} throws. */
function reject(reason) { throw new Error(reason); }
/** @param {Uint8Array} bytes - one admitted XML part. @returns {XmlNode} bounded tree. */
function xml(bytes) {
    const parser = new SaxesParser({ xmlns: true });
    /** @type {XmlNode[]} */ const stack = [];
    /** @type {XmlNode | undefined} */ let root;
    let count = 0;
    parser.on('doctype', () => reject('xml-doctype-unsupported'));
    parser.on('opentag', tag => {
        if (++count > 250_000 || stack.length > 32)
            reject('xml-resource-limit');
        /** @type {XmlNode} */ const node = { name: tag.local, attrs: {}, text: '', children: [] };
        for (const attr of Object.values(tag.attributes))
            node.attrs[attr.name] = attr.value;
        if (stack.length)
            stack[stack.length - 1].children.push(node);
        else
            root = node;
        stack.push(node);
    });
    parser.on('text', value => { if (stack.length)
        stack[stack.length - 1].text += value; });
    parser.on('cdata', value => { if (stack.length)
        stack[stack.length - 1].text += value; });
    parser.on('closetag', () => { stack.pop(); });
    try {
        parser.write(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).close();
    }
    catch {
        reject('invalid-workbook-xml');
    }
    return root ?? reject('empty-workbook-xml');
}
/** @param {XmlNode} node - root. @param {string} name - local name. @returns {XmlNode[]} descendants. */
function descendants(node, name) { return node.children.flatMap(child => [...(child.name === name ? [child] : []), ...descendants(child, name)]); }
/** @param {XmlNode} node - root. @param {string} name - direct child name. @returns {XmlNode} unique child. */
function one(node, name) { const found = node.children.filter(child => child.name === name); return found.length === 1 ? found[0] : reject('ambiguous-workbook-structure'); }
/** @param {string} value - header. @returns {string} normalized header. */
const headerText = value => value.normalize('NFKC').trim().replace(/^\*\s*/u, '');
/** @param {Uint8Array} bytes - frozen workbook. @returns {{ sheetName: string, firstRow: number, lastRow: number, people: import('./import-rules.js').Person[] }} complete supported input. */
export function parseWorkbook(bytes) {
    if (bytes.byteLength === 0 || bytes.byteLength > FILE_LIMIT)
        reject('file-size-invalid');
    /** @type {import('adm-zip').IZipEntry[]} */ let entries;
    try {
        entries = new AdmZip(Buffer.from(bytes)).getEntries();
    }
    catch {
        return reject('invalid-workbook-zip');
    }
    if (entries.length > 1000)
        reject('zip-resource-limit');
    const names = new Set();
    let total = 0;
    /** @type {Map<string, Buffer>} */ const files = new Map();
    for (const entry of entries) {
        const name = entry.entryName;
        if (!name || names.has(name.toLowerCase()) || name.includes('\\') || name.startsWith('/') || name.split('/').some(segment => segment === '..' || segment === '.'))
            reject('ambiguous-zip-path');
        names.add(name.toLowerCase());
        if (entry.isDirectory)
            continue;
        total += entry.header.size;
        if (entry.header.size <= 0 || entry.header.size > 32 * 1024 * 1024 || total > 64 * 1024 * 1024)
            reject('zip-resource-limit');
        if (/vbaProject|externalLinks/iu.test(name))
            reject('unsupported-workbook-feature');
        let data;
        try {
            data = entry.getData();
        }
        catch {
            return reject('invalid-workbook-zip');
        }
        if (data.length !== entry.header.size)
            reject('zip-size-mismatch');
        files.set(name, data);
    }
    /** @param {string} name - package part. @returns {XmlNode} parsed part. */
    const part = name => xml(files.get(name) ?? reject('missing-workbook-part'));
    if (!descendants(part('[Content_Types].xml'), 'Override').some(node => node.attrs.PartName === '/xl/workbook.xml' && node.attrs.ContentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'))
        reject('unsupported-workbook-format');
    const sheets = descendants(part('xl/workbook.xml'), 'sheet');
    if (sheets.length !== 1 || (sheets[0].attrs.state && sheets[0].attrs.state !== 'visible'))
        reject('ambiguous-or-hidden-sheets');
    const sheet = sheets[0];
    const relations = descendants(part('xl/_rels/workbook.xml.rels'), 'Relationship');
    if (relations.some(row => row.attrs.TargetMode === 'External'))
        reject('external-workbook-relationship');
    const links = relations.filter(row => row.attrs.Id === sheet.attrs['r:id'] && row.attrs.Type?.endsWith('/worksheet'));
    if (links.length !== 1)
        reject('ambiguous-sheet-relationship');
    const target = links[0].attrs.Target ?? reject('missing-sheet-target');
    const sheetPath = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join('xl', target));
    if (!sheetPath.startsWith('xl/worksheets/'))
        reject('unsupported-sheet-target');
    const doc = part(sheetPath);
    if (descendants(doc, 'f').length)
        reject('formula-workbook');
    if (descendants(doc, 'col').some(col => ['1', 'true'].includes(col.attrs.hidden)))
        reject('hidden-workbook-columns');
    const strings = files.has('xl/sharedStrings.xml') ? descendants(part('xl/sharedStrings.xml'), 'si').map(si => descendants(si, 't').map(t => t.text).join('')) : [];
    /** @type {{ index: number, cells: Map<string, { value: string, text: boolean }> }[]} */ const rows = [];
    for (const row of one(doc, 'sheetData').children) {
        if (row.name !== 'row' || ['1', 'true'].includes(row.attrs.hidden))
            reject('unsupported-or-hidden-row');
        const index = Number(row.attrs.r);
        if (!Number.isSafeInteger(index) || index < 1 || index > 1_048_576 || (rows.length && rows[rows.length - 1].index >= index))
            reject('ambiguous-row-order');
        /** @type {Map<string, { value: string, text: boolean }>} */ const cells = new Map();
        for (const cell of row.children) {
            const match = /^([A-Z]{1,3})([1-9]\d*)$/u.exec(cell.attrs.r ?? '');
            if (cell.name !== 'c' || !match || Number(match[2]) !== index || cells.has(match[1]))
                reject('ambiguous-cell-address');
            const type = cell.attrs.t;
            let value;
            if (type === 'inlineStr')
                value = descendants(one(cell, 'is'), 't').map(t => t.text).join('');
            else if (type === 's') {
                const reference = one(cell, 'v').text;
                const si = Number(reference);
                if (!/^\d+$/u.test(reference) || !Number.isSafeInteger(si) || strings[si] === undefined)
                    reject('invalid-shared-string');
                value = strings[si];
            }
            else if (type === undefined || type === 'n' || type === 'str') {
                const values = cell.children.filter(child => child.name === 'v');
                if (values.length > 1)
                    reject('ambiguous-cell-value');
                value = values[0]?.text ?? '';
            }
            else
                return reject('unsupported-cell-type');
            cells.set(match[1], { value, text: ['s', 'inlineStr', 'str'].includes(type) });
        }
        rows.push({ index, cells });
    }
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
    const columnNumber = column => [...column].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    /** @type {{ left: number, right: number, top: number, bottom: number }[]} */ const ranges = [];
    for (const merge of descendants(doc, 'mergeCell')) {
        const match = /^([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/.exec(merge.attrs.ref ?? '');
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
    return { sheetName: sheet.attrs.name ?? reject('missing-sheet-name'), firstRow: dataRows[0].index, lastRow: dataRows[dataRows.length - 1].index, people };
}
