import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const local = name => fileURLToPath(new URL(name, import.meta.url))
const path = process.env.DB_PATH || local('data/kodeks.sqlite')
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
const db = new DatabaseSync(path)
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000')
const run = (sql, ...args) => db.prepare(sql).run(...args)
const get = (sql, ...args) => db.prepare(sql).get(...args)
const all = (sql, ...args) => db.prepare(sql).all(...args)
const transaction = callback => {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
const parse = JSON.parse
const json = JSON.stringify
const categories = ['Бургеры','Пицца','Суши','Шаурма','Завтраки','Десерты','Напитки','Комбо']
const icons = ['🍔','🍕','🍣','🌯','🥞','🧁','🥤','🍟']
const initialSettings = { name:'Кодекс', logo:'♔', contacts:'hello@example.com', cities:['Казань','Самара','Москва'], delivery:0, minimum:0 }
transaction(() => {
  if (get('PRAGMA user_version').user_version) return
  db.exec(readFileSync(local('db/001.sql'), 'utf8'))
  run('INSERT INTO settings VALUES(1,?)', json(initialSettings))
  const names = ['Бургер Бюро','Печь & Тесто','Рис и Рыба','Лаваш Lab','Утро рядом','Сахар и крем','Лимонадная','Комбо Клаб']
  const dishes = [
    [['Двойной Чеддер','Две говяжьи котлеты, чеддер, салат и фирменный соус',429],['Хрустящий Чикен','Куриное филе, огурчики и чесночный соус',349],['Картофель фри','Золотистый картофель с морской солью',169]],
    [['Пепперони','Пряная пепперони, моцарелла и томатный соус',649],['Маргарита','Томаты, базилик и нежная моцарелла',549]],
    [['Филадельфия','Лосось, сливочный сыр и огурец',579],['Калифорния','Краб, авокадо и тобико',499]],
    [['Классическая шаурма','Курица, овощи и чесночный соус',329]],
    [['Панкейки','Пышные панкейки с ягодным вареньем',319]],
    [['Шоколадный капкейк','Какао и воздушный сливочный крем',229]],
    [['Лимонад','Лимон, мята и газированная вода',199]],
    [['Бургер-комбо','Бургер, картофель фри и лимонад',599]]
  ]
  for (const city of initialSettings.cities) {
    names.forEach((name, index) => {
      const id = Number(run('INSERT INTO restaurants(name,description,category,city,rating,minutes,delivery,minimum,image) VALUES(?,?,?,?,?,?,?,?,?)',
        name, dishes[index][0][1], categories[index], city, 4.9 - index % 3 / 10, 25 + index * 3, index % 2 ? 79 : 0, 299, '/food-' + index + '.jpg').lastInsertRowid)
      for (const [title, description, price] of dishes[index]) {
        run('INSERT INTO dishes(restaurant_id,name,description,category,price,discount,weight,image,available,addons) VALUES(?,?,?,?,?,?,?,?,?,?)',
          id,title,description,categories[index],price,0,index === 6 ? '330 мл' : '250 г','/food-' + index + '.jpg',1,json(index === 0 ? [{name:'Дополнительный сыр',price:49},{name:'Соус',price:29}] : []))
      }
    })
  }
  run('INSERT INTO promos VALUES(?,?,?,?,?)','KODEKS10','percent',10,'2099-12-31',1000)
  db.exec('PRAGMA user_version=1')
})

transaction(() => {
  if (get('PRAGMA user_version').user_version >= 2) return
  db.exec(readFileSync(local('db/002.sql'), 'utf8'))
  db.exec('PRAGMA user_version=2')
})

const hash = (password, salt = randomBytes(16).toString('hex')) => salt + ':' + scryptSync(password,salt,64).toString('hex')
const matches = (password, stored) => timingSafeEqual(Buffer.from(hash(password,stored.split(':')[0])),Buffer.from(stored))
const dummyHash = hash(randomBytes(32).toString('hex'))
const email = z.email().max(254).transform(value => value.toLowerCase())
const password = z.string().min(10).max(128)
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  run("INSERT INTO users(email,password,name,role) VALUES(?,?,?,'admin') ON CONFLICT(email) DO NOTHING",
    email.parse(process.env.ADMIN_EMAIL),hash(password.parse(process.env.ADMIN_PASSWORD)),'Администратор')
}
const app = express()
app.disable('x-powered-by')
if (process.env.TRUST_PROXY === '1') app.set('trust proxy',1)
app.use(helmet({contentSecurityPolicy:{directives:{imgSrc:["'self'",'data:','https:'],upgradeInsecureRequests:process.env.PUBLIC_ORIGIN ? [] : null}},strictTransportSecurity:process.env.PUBLIC_ORIGIN ? undefined : false}))
app.use(express.json({limit:'1mb'}))
const settings = () => parse(get('SELECT data FROM settings WHERE id=1').data)
const digest = token => createHash('sha256').update(token).digest('hex')
const cookies = req => /(?:^|;\s*)kodeks=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
const api = express.Router()
app.use('/api',api)
api.use((req,res,next) => {
  res.set('Cache-Control','no-store')
  const origin = req.get('origin')
  if (origin && !['GET','HEAD'].includes(req.method) && origin !== (process.env.PUBLIC_ORIGIN || req.protocol + '://' + req.get('host'))) {
    return res.status(403).json({error:'Недопустимый источник запроса'})
  }
  const token = cookies(req)
  if (token) req.user = get('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',digest(token),Date.now())
  next()
})
const fail = (status,message) => { throw Object.assign(new Error(message),{status}) }
const auth = (req,res,next) => req.user ? next() : fail(401,'Войдите в аккаунт')
const admin = (req,res,next) => req.user?.role === 'admin' ? next() : fail(403,'Требуется роль администратора')
const profile = ({password,cart,favorites,addresses,...user}) => ({...user,cart:parse(cart),favorites:parse(favorites),addresses:parse(addresses)})
const cookieOptions = {httpOnly:true,sameSite:'lax',secure:!!process.env.PUBLIC_ORIGIN,path:'/'}
const session = (req,res,user) => {
  const old = cookies(req)
  if (old) run('DELETE FROM sessions WHERE token=?',digest(old))
  run('DELETE FROM sessions WHERE expires<=?',Date.now())
  const token = randomBytes(32).toString('hex')
  const maxAge = 14 * 86400000
  run('INSERT INTO sessions VALUES(?,?,?)',digest(token),user.id,Date.now()+maxAge)
  res.cookie('kodeks',token,{...cookieOptions,maxAge}).json(profile(user))
}
const loginLimit = rateLimit({windowMs:900000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много попыток. Попробуйте позже'}})
const short = z.string().trim().min(1).max(120)
const optional = z.string().trim().max(120).default('')
const money = z.int().min(0).max(100000)
const id = z.coerce.number().int().positive()
const phone = z.string().trim().max(22).refine(value=>/^\+?[\d ()-]+$/.test(value)&&/^\d{10,15}$/.test(value.replace(/\D/g,'')),'Укажите телефон')
api.get('/catalog',(req,res) => res.json({
  settings:settings(),categories,icons,restaurants:all('SELECT * FROM restaurants'),
  dishes:all('SELECT * FROM dishes WHERE available=1').map(dish=>({...dish,addons:parse(dish.addons)})),
  promos:all('SELECT code,kind,value,expires FROM promos WHERE expires>=? AND (max_uses=0 OR max_uses>(SELECT count(*) FROM orders WHERE promo=promos.code)) ORDER BY code LIMIT 12',new Date().toISOString().slice(0,10))
}))
api.get('/me',(req,res)=>res.json(req.user ? profile(req.user) : null))
api.post('/register',loginLimit,(req,res) => {
  const data = z.object({email,password,name:short}).parse(req.body)
  if (get('SELECT id FROM users WHERE email=?',data.email)) fail(409,'Этот адрес уже зарегистрирован')
  const {lastInsertRowid} = run('INSERT INTO users(email,password,name) VALUES(?,?,?)',data.email,hash(data.password),data.name)
  session(req,res,get('SELECT * FROM users WHERE id=?',lastInsertRowid))
})
api.post('/login',loginLimit,(req,res)=>{
  const data = z.object({email,password:z.string().max(128)}).parse(req.body)
  const user = get('SELECT * FROM users WHERE email=?',data.email)
  if (!matches(data.password,user?.password || dummyHash) || !user) fail(401,'Неверный адрес или пароль')
  session(req,res,user)
})
api.post('/logout',auth,(req,res)=>{
  run('DELETE FROM sessions WHERE token=?',digest(cookies(req)))
  res.clearCookie('kodeks',cookieOptions).json({ok:true})
})
const address = z.object({city:short,street:short,house:short,flat:optional,entry:optional,floor:optional,intercom:optional})
const line = z.object({id,qty:z.int().min(1).max(50),addons:z.array(short).max(12).default([])})
const cart = z.array(line).max(80)
api.patch('/me',auth,(req,res)=>{
  const schema = z.object({name:short,phone:z.union([phone,z.literal('')]),cart,favorites:z.array(id).max(500),addresses:z.array(address).max(30)}).partial()
  const data = schema.parse(req.body)
  for (const [column,value] of Object.entries(data)) run('UPDATE users SET '+column+'=? WHERE id=?',Array.isArray(value)?json(value):value,req.user.id)
  res.json(profile(get('SELECT * FROM users WHERE id=?',req.user.id)))
})
const quoteRequest = z.object({cart,city:short,promo:z.string().trim().max(40).default('').transform(value=>value.toUpperCase())})
function quote({cart,city,promo}) {
  const config = settings()
  if (!config.cities.includes(city)) fail(400,'Выберите город из списка')
  if (!cart.length) fail(400,'Корзина пуста')
  const restaurants = new Map()
  const items = cart.map(line=>{
    const dish = get('SELECT * FROM dishes WHERE id=? AND available=1',line.id)
    const restaurant = dish && get('SELECT * FROM restaurants WHERE id=? AND city=?',dish.restaurant_id,city)
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
    const rule = get('SELECT * FROM promos WHERE code=? AND expires>=?',promo,new Date().toISOString().slice(0,10))
    if (!rule || (rule.max_uses && get('SELECT count(*) AS n FROM orders WHERE promo=?',promo).n>=rule.max_uses)) fail(400,'Промокод недействителен или исчерпан')
    discount = Math.min(subtotal,rule.kind==='percent' ? Math.floor(subtotal*rule.value/100) : rule.value)
  }
  const warnings = groups.filter(group=>group.subtotal<group.minimum).map(group=>group.name+': минимальный заказ '+group.minimum+' ₽')
  if (subtotal<config.minimum) warnings.push('Минимальная сумма заказа '+config.minimum+' ₽')
  return {items,subtotal,delivery,discount,total:subtotal+delivery-discount,warnings,minutes:Math.max(...groups.map(group=>group.minutes))}
}
api.post('/quote',(req,res)=>res.json(quote(quoteRequest.parse(req.body))))
const orderData = quoteRequest.extend({name:short,phone,address,time:z.string().max(32),payment:z.enum(['demo','cash']),comment:z.string().max(500).default(''),saveAddress:z.boolean().default(false),requestKey:z.uuid().optional()})
const order = row => ({...row,items:parse(row.items),details:parse(row.details)})
api.post('/orders',auth,(req,res)=>{
  const input = orderData.parse(req.body)
  const result = transaction(()=>{
    const {cart,promo,city,saveAddress,requestKey,...details} = input
    if (requestKey) {
      const existing = get('SELECT * FROM orders WHERE user_id=? AND request_key=?',req.user.id,requestKey)
      if (existing) return order(existing)
    }
    if (details.address.city!==city) fail(400,'Город доставки отличается от города заказа')
    const q = quote({cart,promo,city})
    if (q.warnings.length) fail(400,q.warnings.join('. '))
    const now = Date.now()
    const scheduled = details.time ? Date.parse(details.time) : 0
    if (details.time && (!Number.isFinite(scheduled) || scheduled<now+q.minutes*60000 || scheduled>now+7*86400000)) fail(400,'Выберите доступное время доставки в ближайшие 7 дней')
    const {lastInsertRowid} = run('INSERT INTO orders(user_id,created,status,total,delivery,discount,promo,items,details,eta,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      req.user.id,new Date(now).toISOString(),0,q.total,q.delivery,q.discount,promo||null,json(q.items),json(details),new Date(scheduled||now+q.minutes*60000).toISOString(),requestKey||null)
    const addresses = parse(get('SELECT addresses FROM users WHERE id=?',req.user.id).addresses)
    if (saveAddress && !addresses.some(value=>json(value)===json(details.address))) addresses.unshift(details.address)
    run("UPDATE users SET cart='[]',addresses=? WHERE id=?",json(addresses.slice(0,30)),req.user.id)
    return order(get('SELECT * FROM orders WHERE id=?',lastInsertRowid))
  })
  res.status(201).json(result)
})
api.get('/orders',auth,(req,res)=>res.json(all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC',req.user.id).map(order)))
api.get('/orders/:id',auth,(req,res)=>{
  const row = get('SELECT * FROM orders WHERE id=? AND user_id=?',id.parse(req.params.id),req.user.id)
  if (!row) fail(404,'Заказ не найден')
  res.json(order(row))
})
api.use('/admin',admin)
const image = z.string().max(800000).refine(value=>/^\/(?!\/)[\w./-]+$|^https:\/\/[^\s]+$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value),'Укажите HTTPS-ссылку или загрузите PNG, JPEG либо WebP')
const restaurantSchema = z.object({name:short,description:z.string().max(1000),category:z.enum(categories),city:short,rating:z.number().min(0).max(5),minutes:z.int().min(1).max(300),delivery:money,minimum:money,image})
const dishSchema = z.object({restaurant_id:id,name:short,description:z.string().max(1200),category:z.enum(categories),price:money,discount:money,weight:short,image,available:z.int().min(0).max(1),addons:z.array(z.object({name:short,price:money})).max(12)}).refine(value=>value.discount<=value.price,'Скидка превышает цену')
const promoSchema = z.object({code:z.string().regex(/^[A-Z0-9_-]{2,40}$/),kind:z.enum(['percent','fixed']),value:money,expires:z.iso.date(),max_uses:money}).refine(value=>value.kind==='fixed'||value.value<=100,'Процент не может превышать 100')
const entities = {restaurants:[restaurantSchema,'id'],dishes:[dishSchema,'id'],promos:[promoSchema,'code']}
api.get('/admin/data',(req,res)=>res.json({
  settings:settings(),restaurants:all('SELECT * FROM restaurants'),dishes:all('SELECT * FROM dishes').map(value=>({...value,addons:parse(value.addons)})),
  promos:all('SELECT * FROM promos'),orders:all('SELECT * FROM orders ORDER BY id DESC').map(order),
  users:all('SELECT id,email,name,phone,role FROM users ORDER BY id DESC')
}))
api.put('/admin/settings',(req,res)=>{
  const schema = z.object({name:short,logo:z.string().max(800000).refine(value=>value.length<=12||image.safeParse(value).success),contacts:short,cities:z.array(short).min(1).max(100),delivery:money,minimum:money})
  const data = schema.parse(req.body)
  data.cities = [...new Set(data.cities)]
  run('UPDATE settings SET data=? WHERE id=1',json(data))
  res.json(data)
})
api.patch('/admin/orders/:id',(req,res)=>{
  const status = z.int().min(0).max(5).parse(req.body.status)
  if (!run('UPDATE orders SET status=? WHERE id=?',status,id.parse(req.params.id)).changes) fail(404,'Заказ не найден')
  res.json({ok:true})
})
api.patch('/admin/users/:id',(req,res)=>{
  const target = id.parse(req.params.id)
  const role = z.enum(['admin','customer']).parse(req.body.role)
  if (target===req.user.id) fail(400,'Нельзя менять собственную роль')
  if (!run('UPDATE users SET role=? WHERE id=?',role,target).changes) fail(404,'Пользователь не найден')
  res.json({ok:true})
})
api.put('/admin/:entity/:key',(req,res)=>{
  const table = req.params.entity
  if (!Object.hasOwn(entities,table)) fail(404,'Раздел не найден')
  const [schema,key] = entities[table]
  const data = schema.parse(req.body)
  if (table==='restaurants'&&!settings().cities.includes(data.city)) fail(400,'Город отсутствует в настройках')
  if (table==='dishes') data.addons=json(data.addons)
  const columns = Object.keys(data)
  const values = Object.values(data)
  if (req.params.key==='new') run('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',...values)
  else if (!run('UPDATE '+table+' SET '+columns.map(column=>column+'=?').join(',')+' WHERE '+key+'=?',...values,key==='id'?id.parse(req.params.key):req.params.key).changes) fail(404,'Запись не найдена')
  res.json({ok:true})
})
api.delete('/admin/:entity/:key',(req,res)=>{
  const table = req.params.entity
  if (!Object.hasOwn(entities,table)) fail(404,'Раздел не найден')
  const [,key] = entities[table]
  if (!run('DELETE FROM '+table+' WHERE '+key+'=?',key==='id'?id.parse(req.params.key):req.params.key).changes) fail(404,'Запись не найдена')
  res.json({ok:true})
})
api.use((req,res)=>res.status(404).json({error:'Маршрут не найден'}))
app.use(express.static(local('public')))
app.use((req,res)=>res.status(404).send('Страница не найдена'))
app.use((error,req,res,next)=>{
  if (error instanceof z.ZodError) return res.status(400).json({error:error.issues.map(issue=>issue.path.join('.')+' — '+issue.message).join('. ')})
  if (error.code==='ERR_SQLITE_ERROR' && (error.errcode & 255)===19) return res.status(409).json({error:'Запись уже существует или нарушает связи'})
  if (!error.status) console.error(error)
  res.status(error.status||500).json({error:error.status?error.message:'Ошибка сервера'})
})
if (process.argv[1]===local('server.mjs')) app.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Кодекс запущен на порту '+(process.env.PORT||3000)))
export {app}
