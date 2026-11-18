import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

for (const file of ['server.mjs','public/app.js']) execFileSync(process.execPath,['--check',file],{stdio:'inherit'})
rmSync('dist',{recursive:true,force:true})
mkdirSync('dist')
for (const source of ['server.mjs','public','db','package.json','package-lock.json','.env.example']) {
  cpSync(source,'dist/'+source,{recursive:true})
}
console.log('Сборка готова в dist/')
