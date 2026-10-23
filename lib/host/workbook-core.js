/** Bounded, site-neutral XLSX package reader. Never evaluates formulas or macros. */
import AdmZip from 'adm-zip';
import { SaxesParser } from 'saxes';
import { posix } from 'node:path';
import { FILE_LIMIT } from "./file-core.js";
function reject(reason) { throw new Error(reason); }
/** @param {Uint8Array} bytes - one admitted XML part. @returns {XmlNode} bounded tree. */
export function xml(bytes) {
    const parser = new SaxesParser({ xmlns: true });
    const stack = [];
    let root;
    let count = 0;
    parser.on('doctype', () => reject('xml-doctype-unsupported'));
    parser.on('opentag', tag => {
        if (++count > 250_000 || stack.length > 32)
            reject('xml-resource-limit');
        const node = { name: tag.local, attrs: {}, text: '', children: [] };
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
export function descendants(node, name) { return node.children.flatMap(child => [...(child.name === name ? [child] : []), ...descendants(child, name)]); }
/** @param {XmlNode} node - root. @param {string} name - direct child name. @returns {XmlNode} unique child. */
export function one(node, name) { const found = node.children.filter(child => child.name === name); return found.length === 1 ? found[0] : reject('ambiguous-workbook-structure'); }
export function workbookParts(bytes) {
    if (bytes.byteLength === 0 || bytes.byteLength > FILE_LIMIT)
        reject('file-size-invalid');
    let entries;
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
    const files = new Map();
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
    return files;
}
export function parseWorkbookData(bytes) {
    const files = workbookParts(bytes), part = (name) => xml(files.get(name) ?? reject('missing-workbook-part'));
    const declared = descendants(part('xl/workbook.xml'), 'sheet'), relations = descendants(part('xl/_rels/workbook.xml.rels'), 'Relationship');
    if (!declared.length || declared.length > 32 || relations.some(r => r.attrs.TargetMode === 'External'))
        reject('unsupported-workbook-relationship');
    if (!descendants(part('[Content_Types].xml'), 'Override').some(n => n.attrs.PartName === '/xl/workbook.xml' && n.attrs.ContentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'))
        reject('unsupported-workbook-format');
    const strings = files.has('xl/sharedStrings.xml') ? descendants(part('xl/sharedStrings.xml'), 'si').map(si => descendants(si, 't').map(t => t.text).join('')) : [];
    let count = 0;
    const names = new Set(), targets = new Set();
    const sheets = declared.map(sheet => {
        const name = sheet.attrs.name;
        if (!name || names.has(name))
            reject('ambiguous-sheet-name');
        names.add(name);
        const links = relations.filter(r => r.attrs.Id === sheet.attrs['r:id'] && r.attrs.Type?.endsWith('/worksheet'));
        if (links.length !== 1)
            reject('ambiguous-sheet-relationship');
        const target = links[0].attrs.Target ?? reject('missing-sheet-target'), path = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join('xl', target));
        if (!path.startsWith('xl/worksheets/') || targets.has(path))
            reject('unsupported-sheet-target');
        targets.add(path);
        const doc = part(path);
        let previous = 0;
        const rows = one(doc, 'sheetData').children.map(row => {
            const index = Number(row.attrs.r);
            if (row.name !== 'row' || !Number.isSafeInteger(index) || index <= previous || index > 1048576)
                reject('ambiguous-row-order');
            previous = index;
            const seen = new Set();
            const cells = row.children.map((c) => {
                const ref = c.attrs.r, match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref ?? '');
                if (c.name !== 'c' || !match || Number(match[2]) !== index || seen.has(ref) || ++count > 100000)
                    reject('ambiguous-cell-address');
                seen.add(ref);
                const values = c.children.filter(x => x.name === 'v'), formulas = c.children.filter(x => x.name === 'f');
                if (values.length > 1 || formulas.length > 1)
                    reject('ambiguous-cell-value');
                if (formulas.length)
                    return { ref, type: 'formula', value: null, formula: formulas[0].text };
                const raw = values[0]?.text ?? '', type = c.attrs.t;
                if (type === 'inlineStr')
                    return { ref, type: 'text', value: descendants(one(c, 'is'), 't').map(t => t.text).join('') };
                if (type === 's') {
                    const n = Number(raw);
                    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || strings[n] === undefined)
                        reject('invalid-shared-string');
                    return { ref, type: 'text', value: strings[n] };
                }
                if (type === 'str' || type === 'd')
                    return { ref, type: 'text', value: raw };
                if (type === 'b') {
                    if (!['0', '1'].includes(raw))
                        reject('invalid-boolean-cell');
                    return { ref, type: 'boolean', value: raw === '1' };
                }
                if (type === 'e')
                    return { ref, type: 'error', value: raw };
                if (type !== undefined && type !== 'n')
                    reject('unsupported-cell-type');
                if (raw === '')
                    return { ref, type: 'blank', value: null };
                const number = Number(raw);
                if (!Number.isFinite(number))
                    reject('invalid-number-cell');
                return { ref, type: 'number', value: number };
            });
            return { index, hidden: ['1', 'true'].includes(row.attrs.hidden), cells };
        });
        return { name, visibility: sheet.attrs.state ?? 'visible', rows, merges: descendants(doc, 'mergeCell').map(c => c.attrs.ref ?? '') };
    });
    return { format: 'xlsx', sheets };
}
