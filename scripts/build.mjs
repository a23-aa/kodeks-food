import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg'}
const assets=Object.fromEntries(readdirSync('public').map(name=>['/'+name,{type:types[extname(name)],base64:readFileSync('public/'+name).toString('base64')}]))
rmSync('dist',{recursive:true,force:true})
mkdirSync('dist/server',{recursive:true})
cpSync('drizzle','dist/server/drizzle',{recursive:true})
const databaseId=process.env.D1_DATABASE_ID
if (databaseId&&!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(databaseId)) throw new Error('D1_DATABASE_ID must be a Cloudflare database UUID')
const config={
  name:process.env.WORKER_NAME||'kodeks-food',workers_dev:true,main:'index.js',compatibility_date:'2026-03-01',
  d1_databases:[{binding:'DB',database_name:'kodeks-food',database_id:process.env.D1_DATABASE_ID||'00000000-0000-0000-0000-000000000001',migrations_dir:'drizzle'}]
}
writeFileSync('dist/server/wrangler.json',JSON.stringify(config,null,2)+'\n')
await build({
  entryPoints:['worker/index.js'],bundle:true,format:'esm',outfile:'dist/server/index.js',minify:true,target:'es2022',
  plugins:[{name:'assets',setup(build){
    build.onResolve({filter:/assets\.generated\.js$/},()=>({path:'assets.generated.js',namespace:'assets'}))
    build.onLoad({filter:/.*/,namespace:'assets'},()=>({contents:'export const assets='+JSON.stringify(assets),loader:'js'}))
  }}]
})
