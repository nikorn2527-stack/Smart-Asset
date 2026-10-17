/**
 * require-env.ts — Helper สำหรับตรวจ env var (Fail-Closed)
 * ตามที่ปรึกษา H-04 แนะนำ
 *
 * Usage:
 *   import { requireDatabaseUrl } from './require-env'
 *   const url = requireDatabaseUrl('SUPABASE_DATABASE_URL')
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`❌ ${name} env var is required.`)
    console.error(`   Set it via: export ${name}="..."`)
    process.exit(1)
  }
  return value
}

export function requireDatabaseUrl(name: string = 'SUPABASE_DATABASE_URL'): string {
  return requireEnv(name)
}

export function optionalEnv(name: string, defaultValue: string = ''): string {
  return process.env[name] ?? defaultValue
}
