// Debug buildPoolUrl
function buildPoolUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl
  const has = (k: string) => rawUrl.includes(`${k}=`)
  const extras: string[] = []
  if (!has('connection_limit')) extras.push('connection_limit=5')
  if (!has('pool_timeout')) extras.push('pool_timeout=30')
  const isPooler = /\.pooler\.supabase\.com/.test(rawUrl)
  if (isPooler && !has('pgbouncer')) extras.push('pgbouncer=true')
  if (extras.length === 0) return rawUrl
  const sep = rawUrl.includes('?') ? '&' : '?'
  return `${rawUrl}${sep}${extras.join('&')}`
}

const raw = process.env.DATABASE_URL ?? ''
console.log('raw:', JSON.stringify(raw))
console.log('raw slice 0..15:', JSON.stringify(raw.slice(0, 15)))
const built = buildPoolUrl(raw)
console.log('built:', JSON.stringify(built))
console.log('built slice 0..15:', JSON.stringify(built.slice(0, 15)))
console.log('starts with postgresql://?', built.startsWith('postgresql://'))
