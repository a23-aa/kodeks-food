import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { Miniflare } from 'miniflare'
import { startGoogle, finishGoogle } from '../worker/identity.js'

test('Worker: файлы, D1, аккаунт, заказ, права администратора',async()=>{
  const mf=new Miniflare({
    modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-03-01',d1Databases:['DB'],
    bindings:{ADMIN_EMAIL:'admin@example.test',ADMIN_SETUP_EXPIRES:new Date(Date.now()+3600000).toISOString(),ADMIN_SETUP_TOKEN_HASH:createHash('sha256').update('a'.repeat(64)).digest('hex')}
  })
  try {
    const db=await mf.getD1Database('DB')
    for (const name of ['0000_initial','0001_identity']) {
      const migration=await readFile('drizzle/'+name+'.sql','utf8')
      await db.batch(migration.split('--> statement-breakpoint').map(sql=>db.prepare(sql.trim())))
    }
    const base='https://kodeks.test'
    const response=await mf.dispatchFetch(base+'/')
    assert.equal(response.status,200)
    assert.match(await response.text(),/Доставка|доставка/)
    function browser() {
      let cookie=''
      return async (route,method='GET',body)=>{
        const headers={Origin:base,Cookie:cookie}
        if (body) headers['Content-Type']='application/json'
        const response=await mf.dispatchFetch(base+'/api'+route,{method,headers,body:body?JSON.stringify(body):undefined})
        if (response.headers.has('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0]
        return {status:response.status,data:await response.json()}
      }
    }
    const buyer=browser(), manager=browser()
    const catalog=await buyer('/catalog')
    assert.equal(catalog.status,200,JSON.stringify(catalog.data))
    assert.equal(catalog.data.restaurants.length,8)
    assert.equal((await buyer('/admin/data')).status,403)
    const credentials={email:'customer@example.test',password:'test-customer-password'}
    assert.equal((await buyer('/register','POST',{...credentials,name:'Покупатель'})).status,200)
    assert.equal((await buyer('/logout','POST')).status,200)
    assert.equal((await buyer('/login','POST',credentials)).status,200)
    assert.equal((await buyer('/admin/data')).status,403)
    assert.equal(catalog.data.settings.city,'Казань')
    assert.equal(catalog.data.settings.cities,undefined)
    assert.equal((await buyer('/auth/options')).data.google,false)
    assert.equal((await buyer('/register','POST',{email:'admin@example.test',password:'some-password',name:'Клиент'})).status,409)
    assert.equal((await manager('/auth/admin/setup','POST',{token:'b'.repeat(64),password:'test-admin-password'})).status,403)
    assert.equal((await manager('/auth/admin/setup','POST',{token:'a'.repeat(64),password:'test-admin-password'})).data.role,'admin')
    assert.equal((await buyer('/auth/admin/setup','POST',{token:'a'.repeat(64),password:'another-password'})).status,409)
    assert.equal((await manager('/logout','POST')).status,200)
    const cart=[{id:catalog.data.dishes[0].id,qty:1,addons:[]}]
    const qualifies=[{...cart[0],qty:3}]
    const eligible=await buyer('/quote','POST',{cart:qualifies})
    assert.equal(eligible.data.subtotal,1287)
    assert.equal(eligible.data.items.filter(item=>item.gift).length,1)
    assert.equal(eligible.data.items.find(item=>item.gift).total,0)
    assert.equal(eligible.data.total,1287)
    assert.equal((await buyer('/quote','POST',{cart})).data.items.some(item=>item.gift),false)
    assert.equal((await buyer('/me','PATCH',{cart})).status,200)
    const payload={cart,city:'Казань',promo:'KODEKS10',name:'Покупатель',phone:'+79990000000',address:{city:'Казань',street:'Пушкина',house:'15'},time:'',payment:'demo',saveAddress:true,requestKey:randomUUID()}
    assert.equal((await buyer('/quote','POST',payload)).data.total,387)
    const created=await buyer('/orders','POST',payload)
    assert.equal(created.status,201,JSON.stringify(created.data))
    assert.equal((await buyer('/orders','POST',payload)).data.id,created.data.id)
    assert.equal((await buyer('/orders')).data.length,1)
    const me=(await buyer('/me')).data
    assert.equal(me.cart.length,0)
    assert.equal(me.addresses[0].street,'Пушкина')
    assert.equal((await manager('/login','POST',{email:'admin@example.test',password:'test-admin-password'})).status,200)
    assert.equal((await manager('/admin/data')).data.orders.length,1)
    assert.equal((await manager('/admin/orders/'+created.data.id,'PATCH',{status:1,expected:0})).status,200)
    assert.equal((await manager('/admin/orders/'+created.data.id,'PATCH',{status:1,expected:0})).status,409)
    assert.equal((await manager('/admin/orders/'+created.data.id,'PATCH',{status:4,expected:1})).status,200)
    assert.equal((await buyer('/orders/'+created.data.id)).data.status,4)
    const giftOrder=await buyer('/orders','POST',{...payload,cart:qualifies,promo:'',requestKey:randomUUID()})
    assert.equal(giftOrder.status,201,JSON.stringify(giftOrder.data))
    assert.equal(giftOrder.data.items.filter(item=>item.gift).length,1)
    assert.equal(giftOrder.data.total,1287)
  } finally {await mf.dispose()}
})

test('Google: PKCE, nonce, callback и проверка state до обмена кода',async()=>{
  const origin='https://test.example'
  const env={GOOGLE_CLIENT_ID:'client.example'}
  const {url,flow}=await startGoogle(env,origin)
  const auth=new URL(url)
  assert.equal(auth.origin,'https://accounts.google.com')
  assert.equal(auth.searchParams.get('redirect_uri'),origin+'/api/auth/google/callback')
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256')
  const [state,nonce,verifier]=flow.split('.')
  assert.equal(auth.searchParams.get('state'),state)
  assert.equal(auth.searchParams.get('nonce'),nonce)
  assert.equal(verifier.length,43)
  const bogus=new Request(origin+'/api/auth/google/callback?code=fake&state=wrong',{headers:{Cookie:'kodeks_google='+flow}})
  await assert.rejects(finishGoogle(env,bogus,origin),/state mismatch/)
})
