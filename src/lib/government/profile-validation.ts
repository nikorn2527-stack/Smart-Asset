/** Validate the financial document settings before passing them to Prisma. */
export function financialProfileError(body: Record<string,unknown>): string|null {
  if(body.assetTerminology!==undefined&&(typeof body.assetTerminology!=='string'||!body.assetTerminology.trim()||body.assetTerminology.length>80))return 'ชื่อเรียกครุภัณฑ์ต้องเป็นข้อความ 1–80 ตัวอักษร'
  if(body.fiscalYearStartMonth!==undefined&&(!Number.isInteger(body.fiscalYearStartMonth)||Number(body.fiscalYearStartMonth)<1||Number(body.fiscalYearStartMonth)>12))return 'เดือนเริ่มปีงบประมาณต้องเป็นเลข 1–12'
  if(body.defaultCapitalizeThreshold!==undefined&&body.defaultCapitalizeThreshold!==null&&(typeof body.defaultCapitalizeThreshold!=='number'||!Number.isFinite(body.defaultCapitalizeThreshold)||body.defaultCapitalizeThreshold<0||body.defaultCapitalizeThreshold>1e12))return 'เกณฑ์รับรู้สินทรัพย์ต้องเป็นตัวเลขไม่ติดลบหรือเว้นว่าง'
  return null
}
