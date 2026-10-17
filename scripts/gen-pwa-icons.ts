// One-shot script: generate PWA icons (192 + 512) from an inline SVG using sharp.
// Usage: bun run scripts/gen-pwa-icons.ts
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <rect x="24" y="24" width="464" height="464" rx="80" fill="none" stroke="#f97316" stroke-width="6" opacity="0.4"/>
  <!-- Package / box icon -->
  <g transform="translate(96 116)">
    <path d="M160 0 L320 80 L320 240 L160 320 L0 240 L0 80 Z" fill="#f97316"/>
    <path d="M0 80 L160 160 L320 80" fill="none" stroke="#0f172a" stroke-width="10" stroke-linejoin="round"/>
    <path d="M160 160 L160 320" fill="none" stroke="#0f172a" stroke-width="10"/>
    <!-- Tag label -->
    <circle cx="160" cy="80" r="14" fill="#0f172a"/>
  </g>
  <!-- ITAM text -->
  <text x="256" y="466" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="700" fill="#f97316" letter-spacing="8">ITAM</text>
</svg>`

const OUT_DIR = join(process.cwd(), 'public')

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const svgBuf = Buffer.from(ICON_SVG, 'utf8')
  // Save the source SVG too (useful as a favicon)
  writeFileSync(join(OUT_DIR, 'icon.svg'), svgBuf)
  for (const size of [192, 512]) {
    const out = join(OUT_DIR, `icon-${size}.png`)
    await sharp(svgBuf).resize(size, size).png().toFile(out)
    console.log('wrote', out)
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
