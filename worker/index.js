import { Hono } from 'hono'
import { z } from 'zod'
import { seedCatalog, categories, icons } from './seed.js'
import { googleEnabled, startGoogle, finishGoogle } from './identity.js'
import { assets } from './assets.generated.js'

const parse = JSON.parse
const json = JSON.stringify
const email = z.email().max(254).transform(value=>value.toLowerCase())
const password = z.string().min(10).max(128)
const fail = (status,message) => {throw Object.assign(new Error(message),{status})}
const auth = req => {if (!req.user) fail(401,'Войдите в аккаунт')}
const admin = req => {if (req.user?.role!=='admin') fail(403,'Требуется роль администратора')}
const profile = ({password,cart,favorites,addresses,...user})=>({...user,cart:parse(cart),favorites:parse(favorites),addresses:parse(addresses)})
const encoder=new TextEncoder()
const digest=async value=>toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))))
const toHex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')
const randomHex=size=>toHex(crypto.getRandomValues(new Uint8Array(size)))
async function hash(value,salt=randomHex(16)) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(value),'PBKDF2',false,['deriveBits'])
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256)
  return salt+':'+toHex(new Uint8Array(bits))
}
const dummyHash='0'.repeat(32)+':'+'0'.repeat(64)
const secureEqual=(left,right)=>{
  if (left.length!==right.length) return false
  let diff=0
  for (let index=0;index<right.length;index++) diff|=left.charCodeAt(index)^right.charCodeAt(index)
  return diff===0
}
const matches=async (value,stored)=>secureEqual(await hash(value,stored.split(':')[0]),stored)
const cookies=req=>/(?:^|;\s*)kodeks=([a-f0-9]{64})(?:;|$)/.exec(req.request.headers.get('cookie')||'')?.[1]
const security={
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'
}

async function buildApi(env,request) {
  const db=env.DB
  const statement=(sql,...args)=>db.prepare(sql).bind(...args)
  const get=(sql,...args)=>statement(sql,...args).first()
  const all=async (sql,...args)=>(await statement(sql,...args).all()).results
  const run=async (sql,...args)=>{
    const {meta}=await statement(sql,...args).run()
    return {changes:meta.changes,lastInsertRowid:meta.last_row_id}
  }
  const settings=async ()=>{
    const config=parse((await get('SELECT data FROM settings WHERE id=1')).data)
    return {...config,city:config.city||config.cities?.[0]||'Казань'}
  }
  async function session(req,res,user) {
    const previous=cookies(req)
    const token=randomHex(32)
    const seconds=14*86400
    const writes=[statement('INSERT INTO sessions VALUES(?,?,?)',await digest(token),user.id,Date.now()+seconds*1000),
      statement('DELETE FROM sessions WHERE expires<=?',Date.now())]
    if (previous) writes.push(statement('DELETE FROM sessions WHERE token=?',await digest(previous)))
    await db.batch(writes)
    res.cookie(token,seconds).json(profile(user))
  }
  const loginLimit=async req=>{
    const bucket=await digest(req.request.headers.get('CF-Connecting-IP')||'unknown')
    const now=Date.now()
    const row=await get('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires<=? THEN 1 ELSE attempts+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING attempts',bucket,now+900000,now,now)
    if (row.attempts>20) fail(429,'Слишком много попыток. Попробуйте позже')
  }
  const app=new Hono().basePath('/api')
  function route(method,path,...handlers) {
    app.on(method,path,async context=>{
      const req={request,params:context.req.param(),user:null}
      const headers=new Headers({...security,'Cache-Control':'no-store'})
      const responseCookies=[]
      const secure=new URL(request.url).protocol==='https:'?'; Secure':''
      let result
      const res={
        status(code){context.status(code);return res},
        json(data){result=context.json(data);return result},
        cookie(token,maxAge){return res.append('Set-Cookie','kodeks='+token+'; Max-Age='+maxAge+'; Path=/; HttpOnly; SameSite=Lax'+secure)},
        append(key,value){if (key==='Set-Cookie') responseCookies.push(value);else headers.append(key,value);return res},
        redirect(location){result=context.redirect(location);return result},
        clearCookie(){return res.cookie('',0)}
      }
      const origin=request.headers.get('Origin')
      if (method!=='GET'&&origin&&origin!==(env.PUBLIC_ORIGIN||new URL(request.url).origin)) fail(403,'Недопустимый источник запроса')
      const token=cookies(req)
      if (token) req.user=await get('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',await digest(token),Date.now())
      if (path.startsWith('/admin/')) admin(req)
      if (['POST','PATCH','PUT'].includes(method)&&path!=='/logout') {
        if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415,'Требуется JSON')
        const body=await request.text()
        if (encoder.encode(body).byteLength>1000000) fail(413,'Запрос слишком велик')
        try {req.body=parse(body)} catch {fail(400,'Некорректный JSON')}
      }
      for (const handle of handlers) await handle(req,res)
      for (const [key,value] of headers) result.headers.set(key,value)
      for (const cookie of responseCookies) result.headers.append('Set-Cookie',cookie)
      return result
    })
  }
  const api={
    get:(...args)=>route('GET',...args),post:(...args)=>route('POST',...args),
    patch:(...args)=>route('PATCH',...args),put:(...args)=>route('PUT',...args),
    delete:(...args)=>route('DELETE',...args)
  }
  await seedCatalog(db)
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const target=email.parse(env.ADMIN_EMAIL)
    if (!await get('SELECT id FROM users WHERE email=?',target)) {
      await run("INSERT INTO users(email,password,name,role) VALUES(?,?,?,'admin') ON CONFLICT(email) DO NOTHING",
        target,await hash(password.parse(env.ADMIN_PASSWORD)),'Администратор')
    }
  }
  const short = z.string().trim().min(1).max(120)
  const optional = z.string().trim().max(120).default('')
  const money = z.int().min(0).max(100000)
  const id = z.coerce.number().int().positive()
  const phone = z.string().trim().max(22).refine(value=>/^\+?[\d ()-]+$/.test(value)&&/^\d{10,15}$/.test(value.replace(/\D/g,'')),'Укажите телефон')
  api.get('/catalog',async (req,res)=>{
    const {cities,...config}=await settings()
    res.json({
    settings:config,categories,icons,restaurants:await all('SELECT * FROM restaurants WHERE city=?',config.city),
    dishes:(await all('SELECT d.* FROM dishes d JOIN restaurants r ON r.id=d.restaurant_id WHERE d.available=1 AND r.city=?',config.city)).map(dish=>({...dish,addons:parse(dish.addons)})),
    promos:await all('SELECT code,kind,value,expires FROM promos WHERE expires>=? AND (max_uses=0 OR max_uses>(SELECT count(*) FROM orders WHERE promo=promos.code)) ORDER BY code LIMIT 12',new Date().toISOString().slice(0,10))
    })
  })
  api.get('/auth/options',(req,res)=>res.json({google:googleEnabled(env),adminSetup:Boolean(env.ADMIN_EMAIL&&env.ADMIN_SETUP_TOKEN_HASH)}))

  async function externalUser(provider,identity) {
    const select='SELECT u.* FROM users u JOIN external_identities x ON x.user_id=u.id WHERE x.provider=? AND x.subject=?'
    const existing=await get(select,provider,identity.subject)
    if (existing) return existing
    const principal=identity.email
    if (principal===env.ADMIN_EMAIL?.toLowerCase()) fail(409,'Этот адрес зарезервирован для администратора')
    if (await get('SELECT id FROM users WHERE email=?',principal)) fail(409,'Для этого адреса уже есть аккаунт')
    const marker='external:'+randomHex(32)
    await db.batch([
      statement('INSERT INTO users(email,password,name,role) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING',principal,marker,identity.name,'customer'),
      statement('INSERT INTO external_identities(provider,subject,user_id) SELECT ?,?,id FROM users WHERE email=? AND password=? ON CONFLICT DO NOTHING',provider,identity.subject,principal,marker),
      statement('DELETE FROM users WHERE email=? AND password=? AND NOT EXISTS(SELECT 1 FROM external_identities WHERE user_id=users.id)',principal,marker)
    ])
    const user=await get(select,provider,identity.subject)
    if (!user) fail(409,'Для этого адреса уже есть аккаунт')
    return user
  }

  api.post('/auth/admin/setup',loginLimit,async (req,res)=>{
    const expected=env.ADMIN_SETUP_TOKEN_HASH
    if (!env.ADMIN_EMAIL||!expected) fail(404,'Настройка администратора недоступна')
    const input=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password}).parse(req.body)
    if (!secureEqual(await digest(input.token),expected)) fail(403,'Код настройки недействителен')
    const expires=Date.parse(env.ADMIN_SETUP_EXPIRES)
    if (!Number.isFinite(expires)||Date.now()>=expires) fail(410,'Срок действия кода истёк')
    const target=email.parse(env.ADMIN_EMAIL)
    const {changes,lastInsertRowid}=await run("INSERT INTO users(email,password,name,role) VALUES(?,?,?,'admin') ON CONFLICT(email) DO NOTHING",target,await hash(input.password),'Администратор')
    if (!changes) fail(409,'Администратор уже настроен или этот адрес занят')
    return session(req,res,await get('SELECT * FROM users WHERE id=?',lastInsertRowid))
  })

  const googleCookie='kodeks_google'
  const googleCookieOptions='; Path=/api/auth/google; HttpOnly; SameSite=Lax; Secure'
  api.get('/auth/google',async (req,res)=>{
    if (!googleEnabled(env)) fail(404,'Вход через Google пока недоступен')
    const flow=await startGoogle(env,env.PUBLIC_ORIGIN||new URL(request.url).origin)
    res.append('Set-Cookie',googleCookie+'='+flow.flow+'; Max-Age=600'+googleCookieOptions)
    return res.redirect(flow.url)
  })
  api.get('/auth/google/callback',async (req,res)=>{
    if (!googleEnabled(env)) fail(404,'Вход через Google пока недоступен')
    res.append('Set-Cookie',googleCookie+'=; Max-Age=0'+googleCookieOptions)
    try {
      const identity=await finishGoogle(env,request,env.PUBLIC_ORIGIN||new URL(request.url).origin)
      email.parse(identity.email)
      const user=await externalUser('google',identity)
      await session(req,res,user)
      return res.redirect('/?google=ok#profile')
    } catch (error) {
      return res.redirect('/?google='+(error.status===409?'existing':'error')+'#home')
    }
  })

  api.get('/me',async (req,res) =>res.json(req.user ? profile(req.user) : null))
  api.post('/register',loginLimit,async (req,res) => {
    const data = z.object({email,password,name:short}).parse(req.body)
    if (data.email===env.ADMIN_EMAIL?.toLowerCase()) fail(409,'Этот адрес зарезервирован для администратора')
    if (await get('SELECT id FROM users WHERE email=?',data.email)) fail(409,'Этот адрес уже зарегистрирован')
    const {lastInsertRowid} = await run('INSERT INTO users(email,password,name) VALUES(?,?,?)',data.email,await hash(data.password),data.name)
    return session(req,res,await get('SELECT * FROM users WHERE id=?',lastInsertRowid))
  })
  api.post('/login',loginLimit,async (req,res) =>{
    const data = z.object({email,password:z.string().max(128)}).parse(req.body)
    const user = await get('SELECT * FROM users WHERE email=?',data.email)
    if (!await matches(data.password,user?.password?.includes('external:')?dummyHash:user?.password || dummyHash) || !user || user.password.startsWith('external:')) fail(401,'Неверный адрес или пароль')
    return session(req,res,user)
  })
  api.post('/logout',auth,async (req,res) =>{
    await run('DELETE FROM sessions WHERE token=?',await digest(cookies(req)))
    res.clearCookie().json({ok:true})
  })
  const address = z.object({city:optional,street:short,house:short,flat:optional,entry:optional,floor:optional,intercom:optional})
  const line = z.object({id,qty:z.int().min(1).max(50),addons:z.array(short).max(12).default([])})
  const cart = z.array(line).max(80)
  api.patch('/me',auth,async (req,res) =>{
    const schema = z.object({name:short,phone:z.union([phone,z.literal('')]),cart,favorites:z.array(id).max(500),addresses:z.array(address).max(30)}).partial()
    const data = schema.parse(req.body)
    for (const [column,value] of Object.entries(data)) await run('UPDATE users SET '+column+'=? WHERE id=?',Array.isArray(value)?json(value):value,req.user.id)
    res.json(profile(await get('SELECT * FROM users WHERE id=?',req.user.id)))
  })
  const quoteRequest = z.object({cart,promo:z.string().trim().max(40).default('').transform(value=>value.toUpperCase())})
  async function quote({cart,promo}) {
    const config = await settings()
    const {city}=config
    if (!cart.length) fail(400,'Корзина пуста')
    const restaurants = new Map()
    const placeholders=cart.map(()=>'?').join(',')
    const dishes=await all('SELECT * FROM dishes WHERE available=1 AND id IN ('+placeholders+')',...cart.map(line=>line.id))
    const available=new Map(dishes.map(dish=>[dish.id,dish]))
    const restaurantIds=[...new Set(dishes.map(dish=>dish.restaurant_id))]
    const restaurantRows=restaurantIds.length?await all('SELECT * FROM restaurants WHERE city=? AND id IN ('+restaurantIds.map(()=>'?').join(',')+')',city,...restaurantIds):[]
    const byId=new Map(restaurantRows.map(restaurant=>[restaurant.id,restaurant]))
    const items = cart.map(line=>{
      const dish = available.get(line.id)
      const restaurant = dish && byId.get(dish.restaurant_id)
      if (!restaurant) fail(409,'Одно из блюд больше недоступно в выбранном городе')
      const addons = [...new Set(line.addons)].map(name=>parse(dish.addons).find(addon=>addon.name===name))
      if (addons.some(addon=>!addon)) fail(409,'Набор доступных добавок изменился')
      const unit = dish.price - dish.discount + addons.reduce((sum,addon)=>sum+addon.price,0)
      const total = unit*line.qty
      const group = restaurants.get(restaurant.id) || {...restaurant,subtotal:0}
      group.subtotal += total
      restaurants.set(group.id,group)
      return {id:dish.id,name:dish.name,restaurant:restaurant.name,qty:line.qty,addons,unit,total}
    })
    const subtotal = items.reduce((sum,item)=>sum+item.total,0)
    const groups = [...restaurants.values()]
    const delivery = config.delivery + groups.reduce((sum,group)=>sum+group.delivery,0)
    let discount = 0
    if (promo) {
      const rule = await get('SELECT * FROM promos WHERE code=? AND expires>=?',promo,new Date().toISOString().slice(0,10))
      if (!rule || (rule.max_uses && (await get('SELECT count(*) AS n FROM orders WHERE promo=?',promo)).n>=rule.max_uses)) fail(400,'Промокод недействителен или исчерпан')
      discount = Math.min(subtotal,rule.kind==='percent' ? Math.floor(subtotal*rule.value/100) : rule.value)
    }
    const warnings = groups.filter(group=>group.subtotal<group.minimum).map(group=>group.name+': минимальный заказ '+group.minimum+' ₽')
    if (subtotal<config.minimum) warnings.push('Минимальная сумма заказа '+config.minimum+' ₽')
    if (subtotal>=1000) {
      const gift=await get("SELECT d.id,d.name,d.image,r.name AS restaurant FROM dishes d JOIN restaurants r ON r.id=d.restaurant_id WHERE d.available=1 AND d.category='Суши' AND r.city=? ORDER BY d.id LIMIT 1",city)
      if (gift) items.push({...gift,qty:1,addons:[],unit:0,total:0,gift:true})
    }
    return {items,subtotal,delivery,discount,total:subtotal+delivery-discount,warnings,minutes:Math.max(...groups.map(group=>group.minutes))}
  }
  api.post('/quote',async (req,res) =>res.json(await quote(quoteRequest.parse(req.body))))
  const orderData = quoteRequest.extend({name:short,phone,address,time:z.string().max(32),payment:z.enum(['demo','cash']),comment:z.string().max(500).default(''),saveAddress:z.boolean().default(false),requestKey:z.uuid().optional()})
  const order = row => ({...row,items:parse(row.items),details:parse(row.details)})
  api.post('/orders',auth,async (req,res)=>{
    const {cart,promo,saveAddress,requestKey=crypto.randomUUID(),...details}=orderData.parse(req.body)
    const userId=req.user.id
    const previous=await get('SELECT * FROM orders WHERE user_id=? AND request_key=?',userId,requestKey)
    if (previous) return res.status(201).json(order(previous))
    details.address.city=(await settings()).city
    const price=await quote({cart,promo})
    if (price.warnings.length) fail(400,price.warnings.join('. '))
    const now=Date.now()
    const scheduled=details.time?Date.parse(details.time):0
    if (details.time&&(!Number.isFinite(scheduled)||scheduled<now+price.minutes*60000||scheduled>now+7*86400000)) fail(400,'Выберите доступное время доставки в ближайшие 7 дней')
    const created=new Date(now).toISOString()
    const eta=new Date(scheduled||now+price.minutes*60000).toISOString()
    const addressJSON=json(details.address)
    const [inserted]=await db.batch([
      statement('INSERT INTO orders(user_id,created,status,total,delivery,discount,promo,items,details,eta,request_key) SELECT ?,?,0,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM promos WHERE code=? AND expires>=? AND (max_uses=0 OR max_uses>(SELECT count(*) FROM orders WHERE promo=?))) ON CONFLICT DO NOTHING RETURNING *',
        userId,created,price.total,price.delivery,price.discount,promo||null,json(price.items),json(details),eta,requestKey,promo||null,promo,created.slice(0,10),promo),
      statement("UPDATE users SET cart='[]',addresses=CASE WHEN ? AND json_array_length(addresses)<30 AND NOT EXISTS (SELECT 1 FROM json_each(addresses) WHERE json(value)=json(?)) THEN json_insert(addresses,'$[#]',json(?)) ELSE addresses END WHERE id=? AND changes()>0",
        saveAddress?1:0,addressJSON,addressJSON,userId)
    ])
    const row=inserted.results[0]||await get('SELECT * FROM orders WHERE user_id=? AND request_key=?',userId,requestKey)
    if (!row) fail(409,'Промокод недействителен или исчерпан')
    return res.status(201).json(order(row))
  })

  api.get('/orders',auth,async (req,res) =>res.json((await all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC',req.user.id)).map(order)))
  api.get('/orders/:id',auth,async (req,res) =>{
    const row = await get('SELECT * FROM orders WHERE id=? AND user_id=?',id.parse(req.params.id),req.user.id)
    if (!row) fail(404,'Заказ не найден')
    res.json(order(row))
  })
  const image = z.string().max(800000).refine(value=>/^\/(?!\/)[\w./-]+$|^https:\/\/[^\s]+$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value),'Укажите HTTPS-ссылку или загрузите PNG, JPEG либо WebP')
  const restaurantSchema = z.object({name:short,description:z.string().max(1000),category:z.enum(categories),city:short,rating:z.number().min(0).max(5),minutes:z.int().min(1).max(300),delivery:money,minimum:money,image})
  const dishSchema = z.object({restaurant_id:id,name:short,description:z.string().max(1200),category:z.enum(categories),price:money,discount:money,weight:short,image,available:z.int().min(0).max(1),addons:z.array(z.object({name:short,price:money})).max(12)}).refine(value=>value.discount<=value.price,'Скидка превышает цену')
  const promoSchema = z.object({code:z.string().regex(/^[A-Z0-9_-]{2,40}$/),kind:z.enum(['percent','fixed']),value:money,expires:z.iso.date(),max_uses:money}).refine(value=>value.kind==='fixed'||value.value<=100,'Процент не может превышать 100')
  const entities = {restaurants:[restaurantSchema,'id'],dishes:[dishSchema,'id'],promos:[promoSchema,'code']}
  api.get('/admin/data',async (req,res) =>res.json({
    settings:await settings(),restaurants:await all('SELECT * FROM restaurants WHERE city=?',(await settings()).city),dishes:(await all('SELECT d.* FROM dishes d JOIN restaurants r ON r.id=d.restaurant_id WHERE r.city=?',(await settings()).city)).map(value=>({...value,addons:parse(value.addons)})),
    promos:await all('SELECT * FROM promos'),orders:(await all('SELECT * FROM orders ORDER BY id DESC')).map(order),
    users:await all('SELECT id,email,name,phone,role FROM users ORDER BY id DESC')
  }))
  api.put('/admin/settings',async (req,res) =>{
    const schema = z.object({name:short,logo:z.string().max(800000).refine(value=>value.length<=12||image.safeParse(value).success),contacts:short,city:short,delivery:money,minimum:money})
    const data = schema.parse(req.body)
    const previous=(await settings()).city
    const writes=[]
    if (data.city!==previous&&!await get('SELECT id FROM restaurants WHERE city=? LIMIT 1',data.city)) {
      writes.push(statement('UPDATE restaurants SET city=? WHERE city=?',data.city,previous))
    }
    writes.push(statement('UPDATE settings SET data=? WHERE id=1',json(data)))
    await db.batch(writes)
    res.json(data)
  })
  api.patch('/admin/orders/:id',async (req,res) =>{
    const {status,expected}=z.object({status:z.int().min(0).max(5),expected:z.int().min(0).max(5).optional()}).parse(req.body)
    const orderId=id.parse(req.params.id)
    const updated=expected===undefined
      ? await run('UPDATE orders SET status=? WHERE id=?',status,orderId)
      : await run('UPDATE orders SET status=? WHERE id=? AND status=?',status,orderId,expected)
    if (!updated.changes) {
      if (expected!==undefined&&await get('SELECT id FROM orders WHERE id=?',orderId)) fail(409,'Статус уже изменился. Обновите список заказов.')
      fail(404,'Заказ не найден')
    }
    res.json({ok:true})
  })
  api.patch('/admin/users/:id',async (req,res) =>{
    const target = id.parse(req.params.id)
    const role = z.enum(['admin','customer']).parse(req.body.role)
    if (target===req.user.id) fail(400,'Нельзя менять собственную роль')
    if (!(await run('UPDATE users SET role=? WHERE id=?',role,target)).changes) fail(404,'Пользователь не найден')
    res.json({ok:true})
  })
  api.put('/admin/:entity/:key',async (req,res) =>{
    const table = req.params.entity
    if (!Object.hasOwn(entities,table)) fail(404,'Раздел не найден')
    const [schema,key] = entities[table]
    const currentCity=(await settings()).city
    const data = schema.parse(table==='restaurants'?{...req.body,city:currentCity}:req.body)
    if (table==='dishes'&&!await get('SELECT id FROM restaurants WHERE id=? AND city=?',data.restaurant_id,currentCity)) fail(400,'Ресторан недоступен')
    if (table==='dishes') data.addons=json(data.addons)
    const columns = Object.keys(data)
    const values = Object.values(data)
    if (req.params.key==='new') await run('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',...values)
    else if (!(await run('UPDATE '+table+' SET '+columns.map(column=>column+'=?').join(',')+' WHERE '+key+'=?',...values,key==='id'?id.parse(req.params.key):req.params.key)).changes) fail(404,'Запись не найдена')
    res.json({ok:true})
  })
  api.delete('/admin/:entity/:key',async (req,res) =>{
    const table = req.params.entity
    if (!Object.hasOwn(entities,table)) fail(404,'Раздел не найден')
    const [,key] = entities[table]
    if (!(await run('DELETE FROM '+table+' WHERE '+key+'=?',key==='id'?id.parse(req.params.key):req.params.key)).changes) fail(404,'Запись не найдена')
    res.json({ok:true})
  })
  app.notFound(context=>context.json({error:'Маршрут не найден'},404))
  app.onError((error,context)=>sendError(error,context))
  return app
}

function sendError(error,context) {
  let status=error.status||500
  let message=error.status?error.message:'Ошибка сервера'
  if (error instanceof z.ZodError) {
    status=400
    message=error.issues.map(issue=>issue.path.join('.')+' — '+issue.message).join('. ')
  } else if (/SQLITE_CONSTRAINT/.test(error?.cause?.message||error.message)) {
    status=409
    message='Запись уже существует или нарушает связи'
  } else if (status===500) console.error(error)
  const headers={...security,'Cache-Control':'no-store'}
  return context?context.json({error:message},status,headers):Response.json({error:message},{status,headers})
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname
    if (path.startsWith('/api/')) {
      try {const api=await buildApi(env,request);return await api.fetch(request,env)}
      catch(error){return sendError(error)}
    }
    const asset=assets[path==='/'?'/index.html':path]
    if (!asset || !['GET','HEAD'].includes(request.method)) return new Response('Страница не найдена',{status:404,headers:security})
    const body=request.method==='HEAD'?null:typeof Uint8Array.fromBase64==='function'?Uint8Array.fromBase64(asset.base64):Uint8Array.from(atob(asset.base64),char=>char.charCodeAt(0))
    return new Response(body,{headers:{...security,'Content-Type':asset.type,'Cache-Control':path==='/'?'no-cache':'public, max-age=300'}})
  }
}
