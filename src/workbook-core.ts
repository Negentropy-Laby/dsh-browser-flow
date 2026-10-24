/** Bounded, site-neutral XLSX package reader. Never evaluates formulas or macros. */
import AdmZip from 'adm-zip'
import { SaxesParser } from 'saxes'
import { posix } from 'node:path'
import { FILE_LIMIT } from './file-core.ts'
export type XmlNode={name:string;attrs:Record<string,string>;text:string;children:XmlNode[]}
function reject(reason:string):never {throw new Error(reason)}
/** @param {Uint8Array} bytes - one admitted XML part. @returns {XmlNode} bounded tree. */
export function xml(bytes: Uint8Array) : XmlNode {
  const parser = new SaxesParser({ xmlns: true })
   const stack: XmlNode[] = []
   let root: XmlNode | undefined
  let count = 0
  parser.on('doctype', () => reject('xml-doctype-unsupported'))
  parser.on('opentag', tag => {
    if (++count > 250_000 || stack.length > 32) reject('xml-resource-limit')
     const node: XmlNode = { name: tag.local, attrs: {}, text: '', children: [] }
    for (const attr of Object.values(tag.attributes)) node.attrs[attr.name] = attr.value
    if (stack.length) stack[stack.length - 1].children.push(node); else root = node
    stack.push(node)
  })
  parser.on('text', value => { if (stack.length) stack[stack.length - 1].text += value })
  parser.on('cdata', value => { if (stack.length) stack[stack.length - 1].text += value })
  parser.on('closetag', () => { stack.pop() })
  try { parser.write(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).close() } catch { reject('invalid-workbook-xml') }
  return root ?? reject('empty-workbook-xml')
}
/** @param {XmlNode} node - root. @param {string} name - local name. @returns {XmlNode[]} descendants. */
export function descendants(node: XmlNode, name: string) : XmlNode[] { return node.children.flatMap(child => [...(child.name === name ? [child] : []), ...descendants(child, name)]) }
/** @param {XmlNode} node - root. @param {string} name - direct child name. @returns {XmlNode} unique child. */
export function one(node: XmlNode, name: string) : XmlNode { const found = node.children.filter(child => child.name === name); return found.length === 1 ? found[0] : reject('ambiguous-workbook-structure') }

export function workbookParts(bytes:Uint8Array):Map<string,Buffer> {
  if (bytes.byteLength === 0 || bytes.byteLength > FILE_LIMIT) reject('file-size-invalid')
   let entries: import('adm-zip').IZipEntry[]
  try { entries = new AdmZip(Buffer.from(bytes)).getEntries() } catch { return reject('invalid-workbook-zip') }
  if (entries.length > 1000) reject('zip-resource-limit')
  const names = new Set(); let total = 0
   const files: Map<string, Buffer> = new Map()
  for (const entry of entries) {
    const name = entry.entryName
    if (!name || names.has(name.toLowerCase()) || name.includes('\\') || name.startsWith('/') || name.split('/').some(segment => segment === '..' || segment === '.')) reject('ambiguous-zip-path')
    names.add(name.toLowerCase())
    if (entry.isDirectory) continue
    total += entry.header.size
    if (entry.header.size <= 0 || entry.header.size > 32 * 1024 * 1024 || total > 64 * 1024 * 1024) reject('zip-resource-limit')
    if (/vbaProject|externalLinks/iu.test(name)) reject('unsupported-workbook-feature')
    let data
    try { data = entry.getData() } catch { return reject('invalid-workbook-zip') }
    if (data.length !== entry.header.size) reject('zip-size-mismatch')
    files.set(name, data)
  }
  return files
}

export interface WorkbookCell {ref:string;type:string;value:string|number|boolean|null;formula?:string}
export interface WorkbookSheet {name:string;visibility:string;rows:{index:number;hidden:boolean;cells:WorkbookCell[]}[];merges:string[]}
export interface RawWorkbookCell {ref:string;column:string;rawType:string|undefined;text:string;formula?:string}
export interface WorkbookReadPolicy {singleVisible?:boolean;noFormulas?:boolean;noHiddenColumns?:boolean;noHiddenRows?:boolean}
/** One package/relationship/row/cell walk retains lexical values for policy layers. */
export function walkWorkbook(bytes:Uint8Array,policy:WorkbookReadPolicy={}) {
  const files=workbookParts(bytes),part=(name:string)=>xml(files.get(name)??reject('missing-workbook-part'))
  if(!descendants(part('[Content_Types].xml'),'Override').some(n=>n.attrs.PartName==='/xl/workbook.xml'&&n.attrs.ContentType==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'))reject('unsupported-workbook-format')
  const declared=descendants(part('xl/workbook.xml'),'sheet'),relations=descendants(part('xl/_rels/workbook.xml.rels'),'Relationship')
  if(policy.singleVisible&&(declared.length!==1||declared[0].attrs.state&&declared[0].attrs.state!=='visible'))reject('ambiguous-or-hidden-sheets')
  if(!declared.length||declared.length>32)reject('unsupported-workbook-relationship')
  if(relations.some(r=>r.attrs.TargetMode==='External'))reject('external-workbook-relationship')
  const strings=files.has('xl/sharedStrings.xml')?descendants(part('xl/sharedStrings.xml'),'si').map(si=>descendants(si,'t').map(t=>t.text).join('')):[]
  let count=0;const names=new Set<string>(),targets=new Set<string>()
  return declared.map(sheet=>{
    const name=sheet.attrs.name;if(!name)reject('missing-sheet-name');if(names.has(name))reject('ambiguous-sheet-name');names.add(name)
    const links=relations.filter(r=>r.attrs.Id===sheet.attrs['r:id']&&r.attrs.Type?.endsWith('/worksheet'))
    if(links.length!==1)reject('ambiguous-sheet-relationship')
    const target=links[0].attrs.Target??reject('missing-sheet-target'),path=target.startsWith('/')?target.slice(1):posix.normalize(posix.join('xl',target))
    if(!path.startsWith('xl/worksheets/')||targets.has(path))reject('unsupported-sheet-target');targets.add(path)
    const doc=part(path);let previous=0
    if(policy.noFormulas&&descendants(doc,'f').length)reject('formula-workbook')
    if(policy.noHiddenColumns&&descendants(doc,'col').some(c=>['1','true'].includes(c.attrs.hidden)))reject('hidden-workbook-columns')
    const rows=one(doc,'sheetData').children.map(row=>{
      const index=Number(row.attrs.r),hidden=['1','true'].includes(row.attrs.hidden)
      if(policy.noHiddenRows&&(row.name!=='row'||hidden))reject('unsupported-or-hidden-row')
      if(row.name!=='row'||!Number.isSafeInteger(index)||index<=previous||index>1048576)reject('ambiguous-row-order');previous=index
      const seen=new Set<string>()
      const cells=row.children.map((c:XmlNode):RawWorkbookCell=>{
        const ref=c.attrs.r,match=/^([A-Z]{1,3})([1-9]\d*)$/.exec(ref??'')
        if(c.name!=='c'||!match||Number(match[2])!==index||seen.has(ref)||++count>100000)reject('ambiguous-cell-address');seen.add(ref)
        const values=c.children.filter(x=>x.name==='v'),formulas=c.children.filter(x=>x.name==='f')
        if(values.length>1||formulas.length>1)reject('ambiguous-cell-value')
        let text=values[0]?.text??'';const type=c.attrs.t
        if(type==='inlineStr')text=descendants(one(c,'is'),'t').map(t=>t.text).join('')
        if(type==='s'){const n=Number(text);if(!/^\d+$/.test(text)||!Number.isSafeInteger(n)||strings[n]===undefined)reject('invalid-shared-string');text=strings[n]}
        return {ref,column:match[1],rawType:type,text,...(formulas.length?{formula:formulas[0].text}:{})}
      })
      return {index,hidden,cells}
    })
    return {name,visibility:sheet.attrs.state??'visible',rows,merges:descendants(doc,'mergeCell').map(c=>c.attrs.ref??'')}
  })
}
export function parseWorkbookData(bytes:Uint8Array):{format:'xlsx';sheets:WorkbookSheet[]} {
  const sheets=walkWorkbook(bytes).map(sheet=>({...sheet,rows:sheet.rows.map(row=>({...row,cells:row.cells.map((cell):WorkbookCell=>{
    const {ref,rawType:type,text:raw}=cell
    if(cell.formula!==undefined)return {ref,type:'formula',value:null,formula:cell.formula}
    if(['inlineStr','s','str','d'].includes(type??''))return {ref,type:'text',value:raw}
    if(type==='b'){if(!['0','1'].includes(raw))reject('invalid-boolean-cell');return {ref,type:'boolean',value:raw==='1'}}
    if(type==='e')return {ref,type:'error',value:raw}
    if(type!==undefined&&type!=='n')reject('unsupported-cell-type')
    if(raw==='')return {ref,type:'blank',value:null}
    const number=Number(raw);if(!Number.isFinite(number))reject('invalid-number-cell')
    return {ref,type:'number',value:number}
  })}))}))
  return {format:'xlsx',sheets}
}
