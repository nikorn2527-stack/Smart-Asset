/** Local development only. Creates an ignored .env without overwriting user settings. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const envPath=path.join(root,'.env');
if(!fs.existsSync(envPath)){
  const url='file:'+path.join(root,'prisma','smart-asset-local.db').replaceAll('\\','/');
  fs.writeFileSync(envPath,`DATABASE_URL="${url}"\nDIRECT_DATABASE_URL="${url}"\nJWT_SECRET=${crypto.randomBytes(48).toString('hex')}\n`,{flag:'wx',mode:0o600});
}
process.loadEnvFile(envPath);
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl?.startsWith('file:')||process.env.DIRECT_DATABASE_URL!==databaseUrl){
  throw new Error('Local setup requires matching SQLite DATABASE_URL and DIRECT_DATABASE_URL. Existing .env was preserved.');
}
if(process.env.NODE_ENV==='production')throw new Error('Use local setup in development only.');
const file=databaseUrl.slice(5);
const databasePath=path.isAbsolute(file)?file:path.resolve(root,'prisma',file);
fs.mkdirSync(path.dirname(databasePath),{recursive:true});
fs.closeSync(fs.openSync(databasePath,'a',0o600));
for(const args of [['generate'],['db','push','--skip-generate']]){
 if(args[0]==='db') await import('./prepare-local-pm-index.mjs');
 const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js',...args],{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
console.log('Local SQLite ready. Next: create your local account, then start Next.js (see docs/government/LOCAL-DEVELOPMENT.md).');
