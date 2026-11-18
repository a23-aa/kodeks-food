import { randomBytes, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const email=process.env.KODEKS_ADMIN_EMAIL?.trim().toLowerCase()
const dbId=process.env.D1_DATABASE_ID
if (!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Set KODEKS_ADMIN_EMAIL to the administrator email')
if (!dbId||dbId==='00000000-0000-0000-0000-000000000001') throw new Error('Set D1_DATABASE_ID to the remote database UUID')
const npm=(args,options={})=>{
  const result=spawnSync('npm',args,{encoding:'utf8',...options})
  if (result.error) throw result.error
  if (result.status!==0) process.exit(result.status||1)
  return result.stdout
}
npm(['run','build'],{stdio:'inherit'})
npm(['run','db:apply','--','--remote'],{stdio:'inherit'})
const token=randomBytes(32).toString('hex')
const secrets=JSON.stringify({
  ADMIN_EMAIL:email,
  ADMIN_SETUP_TOKEN_HASH:createHash('sha256').update(token).digest('hex'),
  ADMIN_SETUP_EXPIRES:new Date(Date.now()+86400000).toISOString()
})
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js')
const directory=mkdtempSync(join(tmpdir(),'kodeks-deploy-'))
let deployed
try {
  const file=join(directory,'secrets.json')
  writeFileSync(file,secrets,{mode:0o600,flag:'wx'})
  deployed=spawnSync(process.execPath,[wrangler,'deploy','--config','dist/server/wrangler.json','--secrets-file',file,'--keep-vars'],{encoding:'utf8'})
} finally {
  rmSync(directory,{recursive:true,force:true})
}
if (deployed.error) throw deployed.error
if (deployed.stdout) process.stdout.write(deployed.stdout)
if (deployed.stderr) process.stderr.write(deployed.stderr)
if (deployed.status!==0) process.exit(deployed.status||1)
const url=deployed.stdout.match(/https:\/\/[a-z\d.-]+\.workers\.dev\b/i)?.[0]
if (url) console.log('Одноразовая ссылка администратора: '+url+'/#admin-setup?token='+token)
else console.log('Токен первичной настройки: '+token)
