import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright-core'

process.env.DB_PATH = ':memory:'
process.env.ADMIN_EMAIL = 'admin@example.test'
process.env.ADMIN_PASSWORD = 'test-admin-password'
const { app } = await import('../server.mjs')
let server, base
before(async () => {
  server = app.listen(0,'127.0.0.1')
  await once(server,'listening')
  base = 'http://127.0.0.1:'+server.address().port
})
after(() => server.close())

function client() {
  let cookie
  return async (path,method='GET',data) => {
    const response=await fetch(base+'/api'+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined})
    if (response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0]
    return {status:response.status,data:await response.json()}
  }
}
test('Защита API, корзина, расчёт, повтор заказа и работа администратора',async()=>{
  const guest=client(), buyer=client(), admin=client()
  const {data:catalog}=await guest('/catalog')
  const dish=catalog.dishes[0]
  const cart=[{id:dish.id,qty:1,addons:[dish.addons[0].name]}]
  assert.equal((await guest('/admin/data')).status,403)
  assert.equal((await guest('/orders')).status,401)
  const email='buyer@example.test',password='test-buyer-password'
  const created=await buyer('/register','POST',{name:'Покупатель',email,password})
  assert.equal(created.status,200)
  assert.equal(created.data.password,undefined)
  assert.equal((await buyer('/admin/data')).status,403)
  assert.equal((await buyer('/me','PATCH',{cart})).status,200)
  await buyer('/logout','POST')
  assert.equal((await buyer('/login','POST',{email,password:'bad-password'})).status,401)
  assert.equal((await buyer('/login','POST',{email,password})).status,200)
  assert.deepEqual((await buyer('/me')).data.cart,cart)
  const quote={city:'Казань',cart,promo:'KODEKS10'}
  const price=await buyer('/quote','POST',quote)
  assert.equal(price.data.total,431)
  assert.equal((await buyer('/quote','POST',{...quote,city:'Самара'})).status,409)
  const payload={...quote,name:'Покупатель',phone:'+79990000000',address:{city:'Казань',street:'Пушкина',house:'15'},time:'',payment:'demo',total:1,saveAddress:true,requestKey:randomUUID()}
  const result=await buyer('/orders','POST',payload)
  assert.equal(result.status,201,JSON.stringify(result.data))
  assert.equal(result.data.total,price.data.total)
  assert.equal((await buyer('/orders','POST',payload)).data.id,result.data.id)
  assert.equal((await buyer('/orders')).data.length,1)
  assert.deepEqual((await buyer('/me')).data.cart,[])
  assert.equal((await buyer('/me')).data.addresses[0].street,'Пушкина')
  const other=client()
  await other('/register','POST',{name:'Другой',email:'other@example.test',password})
  assert.equal((await other('/orders/'+result.data.id)).status,404)
  assert.equal((await admin('/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD})).status,200)
  assert.equal((await admin('/admin/orders/'+result.data.id,'PATCH',{status:5})).status,200)
  assert.equal((await buyer('/orders/'+result.data.id)).data.status,5)
  const creation=await admin('/admin/restaurants/new','PUT',{name:'Тест',description:'Описание',category:'Пицца',city:'Казань',rating:5,minutes:20,delivery:0,minimum:0,image:'/food-1.jpg'})
  assert.equal(creation.status,200)
  const saved=(await admin('/admin/data')).data.restaurants.find(item=>item.name==='Тест')
  assert.ok(saved)
  assert.equal((await admin('/admin/restaurants/'+saved.id,'DELETE')).status,200)
})

test('Chromium: главная, каталог, вход, заказ, админ-панель и мобильная версия',{skip:!process.env.BROWSER_BIN},async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_BIN,args:['--no-sandbox']})
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1050}})
    const errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto(base)
    await page.getByRole('heading',{name:'Любимая еда. Уже в пути.'}).waitFor()
    if (process.env.SCREENSHOTS) {
      await mkdir('docs/screenshots',{recursive:true})
      await page.screenshot({path:'docs/screenshots/home-desktop.png',fullPage:true})
    }
    await page.getByRole('link',{name:'Выбрать ресторан →'}).click()
    await page.getByRole('heading',{name:'Рестораны',exact:true}).waitFor()
    await page.getByRole('link',{name:'Меню Бургер Бюро'}).click()
    await page.getByRole('button',{name:'Добавить Двойной Чеддер'}).click()
    await page.getByRole('checkbox',{name:/Дополнительный сыр/}).check()
    await page.getByRole('button',{name:'Добавить в корзину'}).click()
    await page.getByRole('link',{name:/Корзина · 1/}).click()
    await page.reload()
    await page.getByRole('link',{name:'Оформить заказ'}).click()
    await page.getByRole('button',{name:'Войти или зарегистрироваться'}).click()
    await page.getByRole('button',{name:'Создать аккаунт'}).click()
    const dialog=page.getByRole('dialog')
    await dialog.getByLabel('Имя',{exact:true}).fill('Тест браузера')
    await dialog.getByLabel('Электронная почта').fill('browser@example.test')
    await dialog.getByLabel('Пароль',{exact:true}).fill('browser-test-password')
    await dialog.getByRole('button',{name:'Создать аккаунт'}).click()
    await page.getByLabel('Телефон').fill('+79990000001')
    await page.getByLabel('Улица').fill('Пушкина')
    await page.getByLabel('Дом',{exact:true}).fill('15')
    await page.getByRole('checkbox',{name:'Сохранить адрес'}).check()
    if (process.env.SCREENSHOTS) await page.screenshot({path:'docs/screenshots/checkout.png',fullPage:true})
    await page.getByRole('button',{name:'Подтвердить заказ'}).click()
    await page.getByRole('heading',{name:/Заказ №/}).waitFor()
    await page.locator('.side-nav').getByRole('link',{name:'Заказы'}).click()
    await page.getByRole('link',{name:/Заказ №/}).click()
    await page.getByRole('heading',{name:'Заказ оформлен'}).waitFor()
    const manager=await browser.newPage()
    await manager.goto(base)
    await manager.getByRole('button',{name:'◉ Войти'}).click()
    await manager.getByLabel('Электронная почта').fill(process.env.ADMIN_EMAIL)
    await manager.getByLabel('Пароль').fill(process.env.ADMIN_PASSWORD)
    await manager.getByRole('dialog').getByRole('button',{name:'Войти',exact:true}).click()
    await manager.getByRole('link',{name:'◉ Администратор'}).click()
    await manager.getByRole('link',{name:'Админ-панель'}).click()
    await manager.getByRole('heading',{name:'Админ-панель'}).waitFor()
    await manager.locator('main').getByRole('link',{name:'Заказы'}).click()
    await manager.locator('summary').filter({hasText:'Тест браузера'}).click()
    await manager.locator('details[open] select[name=status]').selectOption('4')
    await manager.locator('details[open]').getByRole('button',{name:'Сохранить'}).click()
    await manager.locator('summary').filter({hasText:'Курьер в пути'}).waitFor()
    await page.reload()
    await page.getByRole('heading',{name:'Курьер в пути'}).waitFor()
    const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
    await mobile.goto(base)
    await mobile.getByRole('heading',{name:'Любимая еда. Уже в пути.'}).waitFor()
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    if (process.env.SCREENSHOTS) await mobile.screenshot({path:'docs/screenshots/home-mobile.png',fullPage:true})
    assert.deepEqual(errors,[])
  } finally { await browser.close() }
})
