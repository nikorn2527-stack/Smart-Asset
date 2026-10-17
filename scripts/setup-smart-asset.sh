#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
smart_bun=/workspace/.tools/node_modules/.bin/bun
if [ ! -x "$smart_bun" ]; then
  npm install --prefix /workspace/.tools bun@1.4.3 --no-audit --no-fund --cache /workspace/.cache/npm
fi
"$smart_bun" install --frozen-lockfile --ignore-scripts
mkdir -p /workspace/.itam
node <<'JS'
const fs=require('node:fs'),crypto=require('node:crypto');
const target='/workspace/.itam/development.env';
if(!fs.existsSync(target))fs.writeFileSync(target,'DATABASE_URL=file:/workspace/.itam/development.sqlite3\nDIRECT_DATABASE_URL=file:/workspace/.itam/development.sqlite3\nJWT_SECRET='+crypto.randomBytes(48).toString('hex')+'\n',{mode:0o600,flag:'wx'});
fs.closeSync(fs.openSync('/workspace/.itam/development.sqlite3','a',0o600));
const existing=fs.readFileSync(target,'utf8');
if(!/^DIRECT_DATABASE_URL=/m.test(existing))fs.appendFileSync(target,'\nDIRECT_DATABASE_URL=file:/workspace/.itam/development.sqlite3\n');
JS
# Local development only. Never run schema synchronization against an injected production URL.
export DATABASE_URL=file:/workspace/.itam/development.sqlite3
export DIRECT_DATABASE_URL="$DATABASE_URL"
node node_modules/prisma/build/index.js generate
node scripts/prepare-local-pm-index.mjs
node node_modules/prisma/build/index.js db push --skip-generate
