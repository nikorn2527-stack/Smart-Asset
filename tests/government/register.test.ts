import {describe,it,expect} from 'vitest'
import {REGISTER_FIELDS,emptyRegisterRow,validateRegister,fiscalYear,thaiDocumentDate,registerStorageKey} from '@/lib/government/register'
import {governmentPrintHtml,renderGovernmentRegister} from '@/lib/government/register-render'
import {financialProfileError} from '@/lib/government/profile-validation'
function fixture(){return {fields:Object.fromEntries(REGISTER_FIELDS.map(([k])=>[k,''])),rows:[{...emptyRegisterRow(),description:'ครุภัณฑ์ทดสอบ',annual:'50',accumulated:'100',net:'900'}],summary:{annual:'50',accumulated:'100',net:'900'}}}
describe('official register contract',()=>{
 it('keeps unknown values blank and separates summary from ledger arithmetic',()=>{const f=fixture();f.rows.push({...emptyRegisterRow(),annual:'50',accumulated:'150',net:'850'});const parsed=validateRegister(f);expect(parsed.fields.gfmis).toBe('');expect(parsed.summary).toEqual(f.summary)})
 it.each(['-1','NaN','Infinity','1,000','1e8','<script>'])('rejects invalid amounts %s',value=>{const f=fixture();f.rows[0].total=value;expect(()=>validateRegister(f)).toThrow()})
 it('rejects unbounded documents',()=>{const f=fixture();f.rows=Array.from({length:13},emptyRegisterRow);expect(()=>validateRegister(f)).toThrow();f.rows=[];expect(()=>validateRegister(f)).toThrow()})
 it('escapes all user content including footer summaries',()=>{const f=fixture();f.fields.description='<img src=x onerror=alert(1)>';f.rows[0].description='<script>alert(1)</script>';const html=renderGovernmentRegister(validateRegister(f));expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<img')})
 it('uses 12 columns and repeats the official header for each page',()=>{const f=fixture();f.rows=Array.from({length:7},emptyRegisterRow);const html=renderGovernmentRegister(validateRegister(f));expect(html.match(/official-register-page/g)).toHaveLength(3);expect(html.match(/<th>/g)).toHaveLength(36);expect(html.match(/ทะเบียนคุมทรัพย์สิน<\/div>/g)).toHaveLength(3)})
 it('has no developer brand, logo or auth token in printable output',()=>{const html=governmentPrintHtml(validateRegister(fixture()),'https://assets.example');expect(html).not.toMatch(/POWER BY|PNG TEAM|Bearer|<script|<img/);expect(html).toContain('/government/register-form.css')})
 it('keeps identifiers independent of editable asset codes and unambiguous across orgs',()=>{expect(registerStorageKey('org-A','device-1')).not.toBe(registerStorageKey('org-B','device-1'));expect(registerStorageKey('a:b','c')).not.toBe(registerStorageKey('a','b:c'))})
 it('handles Thai dates and October-based fiscal years without changing the acquisition year',()=>{expect(thaiDocumentDate('2025-10-15')).toBe('15 ต.ค. 2568');expect(fiscalYear('2025-10-15',10)).toBe('2569');expect(fiscalYear('2025-09-30',10)).toBe('2568');expect(fiscalYear(null,10)).toBe('')})
})
describe('financial profile inputs',()=>{
 it('accepts the government fiscal policy without guessing a threshold',()=>{expect(financialProfileError({fiscalYearStartMonth:10,assetTerminology:'ครุภัณฑ์',defaultCapitalizeThreshold:null})).toBeNull()})
 it.each([{fiscalYearStartMonth:13},{fiscalYearStartMonth:0},{fiscalYearStartMonth:'10'},{defaultCapitalizeThreshold:-1},{defaultCapitalizeThreshold:Infinity},{assetTerminology:''}])('rejects invalid policy %j',value=>expect(financialProfileError(value)).not.toBeNull())
})
