import { REGISTER_FIELDS, REGISTER_COLUMNS, displayRegisterValue, type GovernmentRegister, type RegisterField, type RegisterColumn } from './register'
const esc=(v: unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
/** No logos, developer credit, scripts, or unescaped document content on official paper. */
export function renderGovernmentRegister(form: GovernmentRegister): string {
  const field=(key: RegisterField)=>`<div class="rf-field" data-field="${key}"><span>${REGISTER_FIELDS.find(f=>f[0]===key)![1]}</span><b>${esc(form.fields[key])}</b></div>`
  const pages:string[]=[]
  for(let offset=0;offset<form.rows.length;offset+=3){
    const rows=form.rows.slice(offset,offset+3),last=offset+rows.length===form.rows.length
    pages.push(`<section class="official-register-page" aria-label="ทะเบียนคุมทรัพย์สิน หน้า ${pages.length+1}"><div class="register-title rf-title">ทะเบียนคุมทรัพย์สิน</div><div class="rf-org">${field('organization')}${field('department')}</div><div class="rf-fields"><div class="rf-line rf-line-1">${field('type')}${field('code')}</div><div class="rf-line rf-line-2">${field('description')}${field('model')}</div><div class="rf-line rf-line-3">${field('location')}${field('vendor')}</div><div class="rf-line rf-line-4">${field('address')}${field('phone')}</div><div class="rf-line rf-line-5">${field('gfmis')}${field('po')}${field('serial')}${field('warranty')}</div><div class="rf-line rf-line-6">${field('fiscalYear')}${field('fund')}${field('method')}</div></div><table class="register-table rf-table"><colgroup>${[7.13,8.55,14.13,4.34,8.67,9.98,4.28,8.92,8.61,8.92,9.17,7.3].map(w=>`<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${['วันเดือนปี','ที่เอกสาร','รายการ','จำนวน<br>หน่วย','ราคาต่อ<br>หน่วย','มูลค่ารวม','อายุใช้<br>งาน','อัตราค่าเสื่อมราคา<br>/ประจำเดือน','ค่าเสื่อมราคา<br>ประจำปี','ค่าเสื่อมราคา<br>สะสม','มูลค่าสุทธิ','หมายเหตุ'].map(s=>`<th>${s}</th>`).join('')}</tr></thead><tbody>${rows.map((r,i)=>`<tr>${REGISTER_COLUMNS.map(([key])=>`<td><div class="rf-cell-value">${esc(displayRegisterValue(key,r[key]))}</div>${last&&i===rows.length-1&&(key==='date'||['annual','accumulated','net'].includes(key))?`<div class="rf-cell-total">${key==='date'?esc(form.fields.fiscalYear):esc(displayRegisterValue(key,form.summary[key as keyof GovernmentRegister['summary']]))}</div>`:''}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`)
  }
  return pages.join('')
}
export function governmentPrintHtml(form: GovernmentRegister,origin: string): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>ทะเบียนคุมทรัพย์สิน ${esc(form.fields.code)}</title><link rel="icon" href="data:,"><link rel="stylesheet" href="${esc(origin)}/government/register-form.css"></head><body class="register-print">${renderGovernmentRegister(form)}</body></html>`
}
