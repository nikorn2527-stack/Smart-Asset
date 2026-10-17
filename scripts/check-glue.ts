// scripts/check-glue.ts
// Regression guard for the TH->EN "glued-English" corruption (commit 9af0bd7).
// Scans UI source files for known corruption tokens listed in glue-watchlist.json.
// A hit only counts when the token stands alone (word boundaries), so identifiers
// like `fmtDateTime` / `printSingleSticker` / `onCreateCycle` are NOT flagged.
// Exit 1 if any standalone token is found; exit 0 otherwise. CI-safe.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const WATCHLIST = 'scripts/glue-watchlist.json'
const SCAN_DIRS = ['src']
const EXTS = new Set(['.ts', '.tsx'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git'])

type Token = { glue: string; thai: string }

function loadWatchlist(): Token[] {
  const raw = readFileSync(WATCHLIST, 'utf8')
  return JSON.parse(raw) as Token[]
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (EXTS.has(extname(name))) acc.push(p)
  }
  return acc
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function main(): never {
  const tokens = loadWatchlist()
  const files = SCAN_DIRS.flatMap((d) => walk(d))
  const hits: Array<{ file: string; line: number; glue: string; thai: string; text: string }> = []

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const lines = content.split(/\r?\n/)
    for (const { glue, thai } of tokens) {
      // Boundary rule: char before AND after the token must NOT be [A-Za-z0-9_].
      const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(glue)}([^A-Za-z0-9_]|$)`)
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push({ file, line: i + 1, glue, thai, text: lines[i].trim().slice(0, 140) })
        }
      }
    }
  }

  if (hits.length === 0) {
    console.log(`check-glue: OK - watched ${tokens.length} tokens, 0 hits across ${files.length} files`)
    process.exit(0)
  }

  console.error(`check-glue: FAIL - ${hits.length} glued-English token(s) found`)
  const byFile = new Map<string, typeof hits>()
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, [])
    byFile.get(h.file)!.push(h)
  }
  for (const [file, list] of byFile) {
    console.error(`\n${file}`)
    for (const h of list) console.error(`  L${h.line}: [${h.glue} -> ${h.thai}] ${h.text}`)
  }
  process.exit(1)
}

main()
