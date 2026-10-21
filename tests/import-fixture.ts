import AdmZip from 'adm-zip'

export const scope = { kind: 'add' as const, unitId: 'UNIT1', legalIdentity: '123456789012345678', firstRow: 2, lastRow: 2 }
export const people = [{ name: '测试甲', certificateNumber: '110101199001010011' }]
export function workbook(rows = people) {
  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from('<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'))
  zip.addFile('xl/workbook.xml', Buffer.from('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'))
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'))
  const escape = (text:string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  const row = (i:number, values:string[]) => `<row r="${i}">${values.map((v,j) => `<c r="${String.fromCharCode(65+j)}${i}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData>' + row(1, ['姓名', '证件号码']) + rows.map((p,i) => row(i+2, [p.name,p.certificateNumber])).join('') + '</sheetData></worksheet>'))
  return zip.toBuffer()
}
export function facts(kind = 'add') {
  return { requestCount: 1, pending: 0, interference: false,
    response: { requestId: 'request-1', responseRequestId: 'request-1', method: 'POST', url: 'https://fuwu.rsj.beijing.gov.cn/zhrs/api4/ggfw-server-yltc/CommonBusiness/' + (kind === 'modify' ? 'ThreeInOneModifyExcelCheck' : 'ThreeInOneExcelCheck'), status: 200, complete: true, body: JSON.stringify({ appcode: '0', map: { data: people.map(p => ({ ...p, validateStatus: '1', errorMessage: '' })) } }) },
    tables: { fresh: true, complete: true, accepted: [...people], rejected: [] }, summary: { total: 1, success: 1, failure: 0 } }
}
