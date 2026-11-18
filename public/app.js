const $ = selector => document.querySelector(selector)
const main = $('#main')
const modal = $('#modal')
const statuses = ['Заказ оформлен','Ресторан принял заказ','Готовится','Передан курьеру','Курьер в пути','Доставлен']
const rub = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽'
const date = value => new Date(value).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'})
const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char])
const persist = (key,value) => localStorage.setItem('kodeks:'+key,JSON.stringify(value))
const stored = (key,fallback) => {
  try {return JSON.parse(localStorage.getItem('kodeks:'+key)) ?? fallback} catch {return fallback}
}
const state = {catalog:null,user:null,authOptions:{},cart:stored('cart',[]),favorites:stored('favorites',[]),promo:'',quote:null,quoteError:'',renderID:0,checkoutDraft:null}
let saveQueue = Promise.resolve()
let toastTimer
let trackTimer
let orderPending = false
let orderAttempt
const href = (page,params={}) => '#'+page+(Object.keys(params).length?'?'+new URLSearchParams(params):'')
const navigate = (page,params) => { location.hash=href(page,params) }
const readRoute = () => {
  const [path,query] = (location.hash.slice(1)||'home').split('?')
  return {path,params:new URLSearchParams(query)}
}
async function api(path,method='GET',body) {
  const response = await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined})
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса')
  return data
}
function toast(text) {
  $('#toast').textContent=text
  clearTimeout(toastTimer)
  toastTimer=setTimeout(()=>$('#toast').textContent='',4000)
}
const img = (url,alt='',extra='') => `<img src="${esc(url)}" alt="${esc(alt)}" ${extra}>`
const btn = (text,action,style='',extra='') => `<button type="button" class="button ${style}" data-act="${action}" ${extra}>${text}</button>`
const link = (text,page,style='button',params) => `<a class="${style}" href="${esc(href(page,params))}">${text}</a>`
const empty = (title,description,action='') => `<div class="panel empty"><span class="empty-icon" aria-hidden="true">♔</span><h2>${title}</h2><p>${description}</p>${action}</div>`
const title = (name,sub='') => `<div class="page-title"><h1>${name}</h1>${sub?`<p>${sub}</p>`:''}</div>`
const section = (name,content,action='') => `<section class="section"><div class="section-head"><h2>${name}</h2>${action}</div>${content}</section>`
const opts = (options,selected) => options.map(option=>{
  const [value,label] = Array.isArray(option)?option:[option,option]
  return `<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`
}).join('')
const input = (name,label,value='',type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`
const field = (name,label,options,value) => `<label>${label}<select name="${name}">${opts(options,value)}</select></label>`
const submit = label => `<button class="button primary" type="submit">${label}</button>`
const matches = (query,...values) => values.some(value=>value.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
const dishBy = id => state.catalog.dishes.find(dish=>dish.id===id)
const restBy = id => state.catalog.restaurants.find(rest=>rest.id===id)
const cityRestaurants = () => state.catalog.restaurants
const cityDishes = () => state.catalog.dishes
const featuredDishes = () => cityRestaurants().map(rest=>cityDishes().find(dish=>dish.restaurant_id===rest.id)).filter(Boolean).slice(0,3)
const brand = () => {
  const {name,logo} = state.catalog.settings
  return `<a class="brand" href="#home"><span class="brandmark">${/^(\/|https:|data:)/.test(logo)?img(logo):esc(logo)}</span><span>${esc(name)}<small>Доставка еды</small></span></a>`
}
function shell(route) {
  const nav = [['home','⌂','Главная'],['catalog','♨','Рестораны'],['offers','✧','Акции'],['favorites','♡','Избранное'],['orders','▤','Заказы']]
  $('#sidebar').innerHTML=brand()+`<nav class="side-nav" aria-label="Навигация">${nav.map(([path,icon,label])=>`<a class="navlink ${route.path===path?'active':''}" href="#${path}"><span class="navicon" aria-hidden="true">${icon}</span>${label}</a>`).join('')}</nav>`+
    (state.catalog.promos[0]?`<a href="#offers" class="side-promo"><strong>✦ Промокоды</strong><small>Скидки на заказ</small></a>`:'')
  const count=state.cart.reduce((sum,item)=>sum+item.qty,0)
  $('#header').innerHTML=`<a class="mobile-brand" href="#home">♔ ${esc(state.catalog.settings.name)}</a>
    <form class="search" data-form="search"><input type="search" name="q" aria-label="Поиск блюд и ресторанов" placeholder="Поиск блюд и ресторанов…" value="${esc(route.path==='catalog'?route.params.get('q'):'')}"><button class="button compact" aria-label="Найти">⌕</button></form>
    ${state.user?link('◉ '+esc(state.user.name.split(' ')[0]),'profile','button compact'):btn('◉ Войти','auth','compact')}
    ${link('Корзина'+(count?' · '+count:''),'cart','button primary compact')}`
  $('#footer').innerHTML=`<span>© ${new Date().getFullYear()} ${esc(state.catalog.settings.name)}</span><span>${esc(state.catalog.settings.contacts)}</span><span>${link('Рестораны','catalog','text-link')} · ${link('Акции','offers','text-link')}</span>`
}
const restaurantCard = rest => `<article class="card"><a class="card-media" href="#restaurant?id=${rest.id}" aria-label="Меню ${esc(rest.name)}">${img(rest.image,rest.name,'loading="lazy"')}</a>
<button class="favorite ${state.favorites.includes(rest.id)?'active':''}" type="button" data-act="favorite" data-id="${rest.id}" aria-label="Избранное" aria-pressed="${state.favorites.includes(rest.id)}">${state.favorites.includes(rest.id)?'♥':'♡'}</button>
<div class="card-body"><h3><a href="#restaurant?id=${rest.id}">${esc(rest.name)}</a></h3><div class="meta"><span class="rating">★ ${rest.rating.toFixed(1)}</span><span>${rest.minutes} мин</span><span>${esc(rest.category)}</span></div><div class="meta"><span>${rest.delivery?'Доставка '+rub(rest.delivery):'Бесплатная доставка'}</span><span>от ${rub(rest.minimum)}</span></div></div></article>`
const dishCard = dish => `<article class="card"><div class="card-media">${img(dish.image,dish.name,'loading="lazy"')}</div><div class="card-body"><h3>${esc(dish.name)}</h3><p>${esc(dish.description)}</p><div class="meta">${esc(dish.weight)}</div><div class="spread"><strong>${dish.discount?`<del class="muted">${rub(dish.price)}</del> `:''}${rub(dish.price-dish.discount)}</strong>${btn('＋','dish','primary compact',`data-id="${dish.id}" aria-label="Добавить ${esc(dish.name)}"`)}</div></div></article>`
const grid = (values,card) => '<div class="grid">'+values.map(card).join('')+'</div>'
const categoryLinks = selected => `<div class="categories">${state.catalog.categories.map((category,index)=>`<a href="${esc(href('catalog',selected===category?{}:{category}))}" class="category ${selected===category?'active':''}">${img('/food-'+index+'.jpg')}${category}</a>`).join('')}</div>`
const giftOffer = () => `<article class="panel promo-card gift-offer">${img('/food-2.jpg')}<div><h3>Роллы в подарок</h3><p>Добавим автоматически при заказе блюд от 1 000 ₽.</p></div></article>`
const promoCards = () => giftOffer()+(state.catalog.promos.length?grid(state.catalog.promos,promo=>`<article class="panel promo-card"><span class="pill">Промокод</span><h3>Скидка ${promo.kind==='percent'?promo.value+'%':rub(promo.value)}</h3><p>Действует до ${promo.expires.split('-').reverse().join('.')}</p>${btn(esc(promo.code),'promo','',`data-code="${esc(promo.code)}"`)}</article>`):'')
function home() {
  return `<section class="hero"><div class="hero-copy"><span class="pill">Доставка по городу ${esc(state.catalog.settings.city)}</span><h1>Любимая еда.<br><em>Уже в пути.</em></h1><p>Бургеры, пицца, суши и другие блюда из ресторанов рядом.</p>${link('Выбрать ресторан →','catalog','button primary')}</div></section>`
    +section('Что закажем?',categoryLinks())
    +section('Популярные рестораны',grid(cityRestaurants().sort((a,b)=>(b.rating-b.minutes/100)-(a.rating-a.minutes/100)).slice(0,3),restaurantCard),link('Все рестораны →','catalog','text-link'))
    +section('Популярные блюда',grid(featuredDishes(),dishCard))
    +section('Специальные предложения',promoCards())
    +section('Доставка с Кодексом',grid([['Разные кухни','Бургеры, роллы и десерты в одном каталоге.'],['Заказ ко времени','Выберите время доставки при оформлении.'],['Отслеживание заказа','Статус заказа и ориентир по времени всегда в личном кабинете.']],([heading,copy])=>`<article class="panel"><h3>${heading}</h3><p>${copy}</p></article>`))
}
function catalog(params) {
  const q=params.get('q')||''
  const category=params.get('category')||''
  const sort=params.get('sort')||'rating'
  const time=Number(params.get('time'))||0
  const dishes=cityDishes().filter(dish=>matches(q,dish.name,dish.description,dish.category)&&(!category||dish.category===category)&&(!time||restBy(dish.restaurant_id).minutes<=time))
  const restaurants=cityRestaurants().filter(rest=>(matches(q,rest.name,rest.description,rest.category)||dishes.some(dish=>dish.restaurant_id===rest.id))&&(!category||rest.category===category)&&(!time||rest.minutes<=time))
  restaurants.sort((a,b)=>sort==='delivery'?a.delivery-b.delivery:sort==='time'?a.minutes-b.minutes:b.rating-a.rating)
  return title('Рестораны')+categoryLinks(category)+`<form data-form="filters" class="row filters">
    <input type="hidden" name="q" value="${esc(q)}"><select name="category" aria-label="Категория">${opts([['','Все категории'],...state.catalog.categories],category)}</select>
    <select name="sort" aria-label="Сортировка">${opts([['rating','По рейтингу'],['delivery','По цене доставки'],['time','По времени']],sort)}</select>
    <select name="time" aria-label="Время доставки">${opts([[0,'Любое время'],[30,'До 30 мин'],[45,'До 45 мин'],[60,'До 60 мин']],time)}</select>${submit('Применить')}</form>`
    +(restaurants.length?grid(restaurants,restaurantCard):empty('Рестораны не найдены','Измените запрос или фильтры.',link('Сбросить фильтры','catalog')))
    +(q&&dishes.length?section('Найденные блюда',grid(dishes,dishCard)):'')
}
function restaurant(params) {
  const rest=restBy(Number(params.get('id')))
  if (!rest) return empty('Ресторан недоступен','Выберите другой ресторан.',link('В каталог','catalog'))
  const dishes=state.catalog.dishes.filter(dish=>dish.restaurant_id===rest.id)
  const categories=[...new Set(dishes.map(dish=>dish.category))]
  const q=params.get('q')||''
  const category=params.get('category')||''
  return `<div class="card hero-small"><div class="panel stack"><h1>${esc(rest.name)}</h1><p>${esc(rest.description)}</p><div class="meta"><span class="rating">★ ${rest.rating.toFixed(1)}</span><span>${rest.minutes} мин · Доставка ${rub(rest.delivery)} · Заказ от ${rub(rest.minimum)}</span></div></div>${img(rest.image,rest.name)}</div>
    <form class="row filters" data-form="menu"><input type="hidden" name="id" value="${rest.id}"><input type="search" name="q" value="${esc(q)}" placeholder="Поиск по меню" aria-label="Поиск по меню"><select name="category" aria-label="Категория меню">${opts([['','Всё меню'],...categories],category)}</select>${submit('Найти')}</form>`
    + (dishes.some(dish=>(!category||dish.category===category)&&matches(q,dish.name,dish.description))?grid(dishes.filter(dish=>(!category||dish.category===category)&&matches(q,dish.name,dish.description)),dishCard):empty('Блюда не найдены','Измените поиск или категорию.'))
}
function sync(fields) {
  const userID=state.user?.id
  if (!userID) return
  const update=structuredClone(fields)
  saveQueue=saveQueue.catch(()=>{}).then(()=>{
    if (state.user?.id===userID) return api('/me','PATCH',update)
  })
  saveQueue.catch(error=>toast(error.message))
}
function setCart(cart) {
  state.cart=cart
  if (!state.user) persist('cart',cart)
  sync({cart})
}
function setFavorites(favorites) {
  state.favorites=favorites
  if (!state.user) persist('favorites',favorites)
  sync({favorites})
}
const itemEquals = (a,b) => a.id===b.id&&a.addons.join('|')===b.addons.join('|')
const giftLine = gift => gift?`<article class="panel line-item gift-line">${img(gift.image,gift.name)}<div><span class="pill">Подарок</span><h3>${esc(gift.name)}</h3></div><strong>0 ₽</strong></article>`:''
const summarized = q => q?`<div class="spread"><span>Блюда</span><strong>${rub(q.subtotal)}</strong></div><div class="spread"><span>Доставка</span><strong>${rub(q.delivery)}</strong></div>${q.discount?`<div class="spread"><span>Скидка</span><strong>−${rub(q.discount)}</strong></div>`:''}<div class="spread"><h3>Итого</h3><h3>${rub(q.total)}</h3></div>${q.warnings.map(warning=>`<p class="error">${esc(warning)}</p>`).join('')}`:`<p class="error">${esc(state.quoteError)}</p>`
const promoForm = () => `<form class="stack" data-form="promo"><label>Промокод<input name="promo" maxlength="40" placeholder="Введите код" value="${esc(state.promo)}"></label>${submit('Применить')}</form>${state.promo?btn('Убрать промокод','removePromo'):''}`
function cartPage() {
  if (!state.cart.length) return title('Корзина')+empty('Корзина пуста','Выберите что-нибудь вкусное в меню.',link('К ресторанам','catalog','button primary'))
  const contents=state.cart.map((item,index)=>{
    const dish=dishBy(item.id)
    return `<article class="panel line-item">${img(dish?.image||'/mascot.jpg')}<div><h3>${esc(dish?.name||'Блюдо недоступно')}</h3><p>${item.addons.map(esc).join(', ')}</p>${dish?.addons.length?btn('Добавки','editDish','compact',`data-index="${index}"`):''}</div><div class="row">${btn('−','qty','compact',`data-index="${index}" data-step="-1" aria-label="Уменьшить количество"`)}<strong>${item.qty}</strong>${btn('+','qty','compact',`data-index="${index}" data-step="1" aria-label="Увеличить количество"`)}${btn('×','remove','compact danger',`data-index="${index}" aria-label="Удалить"`)}</div></article>`
  }).join('')
  return title('Корзина')+`<div class="split"><div class="stack">${contents}${giftLine(state.quote?.items.find(item=>item.gift))}${state.quote&&state.quote.subtotal<1000?`<p class="muted">До роллов в подарок ещё ${rub(1000-state.quote.subtotal)}.</p>`:""}</div><aside class="panel stack summary">${summarized(state.quote)}${promoForm()}${state.quote&&!state.quote.warnings.length?link('Оформить заказ','checkout','button primary full'):''}</aside></div>`
}
const addressFields = [['street','Улица'],['house','Дом'],['flat','Квартира'],['entry','Подъезд'],['floor','Этаж'],['intercom','Домофон']]
const addressInputs = (values={}) => addressFields.map(([key,label],index)=>input(key,label,values[key],'text',index<2?'required maxlength="120"':'maxlength="120"')).join('')
const addressLabel = a => [a.city,a.street,a.house,a.flat?'кв. '+a.flat:''].filter(Boolean).join(', ')
function checkout() {
  if (!state.cart.length) return title('Оформление')+empty('Корзина пуста','Добавьте блюда перед оформлением.',link('В каталог','catalog'))
  if (!state.user) return title('Оформление')+empty('Войдите для оформления','В личном кабинете будет доступно отслеживание заказа.',btn('Войти или зарегистрироваться','auth','primary'))
  const draft=state.checkoutDraft||{}
  const addresses=state.user.addresses.map((a,i)=>[i,addressLabel(a)]).filter(([index])=>!state.user.addresses[index].city||state.user.addresses[index].city===state.catalog.settings.city)
  return title('Оформление заказа')+`<div class="split"><form class="panel form-grid" data-form="checkout">
    ${input('name','Имя',draft.name??state.user.name,'text','required maxlength="120"')}${input('phone','Телефон',draft.phone??state.user.phone,'tel','required minlength="10" maxlength="22"')}
    ${addresses.length?field('saved','Сохранённый адрес',[['','Новый адрес'],...addresses],draft.saved):''}
    ${addressInputs(draft)}<label class="span">Комментарий курьеру<textarea name="comment" maxlength="500">${esc(draft.comment)}</textarea></label>
    ${field('schedule','Время доставки',[['asap','Как можно скорее'],['later','Ко времени']],draft.schedule||'asap')}
    <label id="delivery-time" ${draft.schedule!=='later'?'hidden':''}>Дата и время<input type="datetime-local" name="time" value="${esc(draft.time)}"></label>
    ${field('payment','Способ оплаты',[['demo','Демо-оплата'],['cash','Наличными курьеру']],draft.payment||'demo')}
    <label class="check"><input name="saveAddress" type="checkbox" ${draft.saveAddress?'checked':''}> Сохранить адрес</label>
    <p class="muted span">В режиме демо деньги не списываются.</p><div class="span">${state.quote&&!state.quote.warnings.length?submit('Подтвердить заказ'):link('Вернуться в корзину','cart')}</div>
    </form><aside class="panel stack summary"><h2>Ваш заказ</h2>${(state.quote?.items||[]).map(item=>`<div class="spread"><span>${esc(item.name)} × ${item.qty} ${item.gift?'<span class="pill">Подарок</span>':''}</span><strong>${rub(item.total)}</strong></div>`).join('')}${summarized(state.quote)}${promoForm()}</aside></div>`
}
const orderList = orders => orders.length?`<div class="panel stack">${orders.map(order=>`<a class="spread list-row" href="#order?id=${order.id}"><span><strong>Заказ №${order.id}</strong><br><small>${date(order.created)}</small></span><span class="pill">${statuses[order.status]}</span><strong>${rub(order.total)} →</strong></a>`).join('')}</div>`:empty('Заказов пока нет','Ваши заказы появятся здесь после оформления.',link('К ресторанам','catalog'))
const needsAuth = () => empty('Войдите в аккаунт','Здесь хранятся ваши заказы и настройки.',btn('Войти','auth','primary'))
function tracking(order) {
  return title('Заказ №'+order.id,'Оформлен '+date(order.created))+`<div class="split">
    <div class="panel stack"><h2>${statuses[order.status]}</h2><p>Ориентир по доставке · ${date(order.eta)}</p><ol class="timeline">${statuses.map((status,i)=>`<li class="${i<=order.status?'done':''} ${i===order.status?'current':''}" ${i===order.status?'aria-current="step"':''}>${status}</li>`).join('')}</ol></div>
    <aside class="panel stack"><h2>Состав заказа</h2>${order.items.map(item=>`<div class="spread"><span>${esc(item.name)} × ${item.qty} ${item.gift?'<span class="pill">Подарок</span>':''}<br><small>${item.addons.map(addon=>esc(addon.name)).join(', ')}</small></span><strong>${rub(item.total)}</strong></div>`).join('')}<p>${esc(addressLabel(order.details.address))}</p><p>${order.details.payment==='demo'?'Демонстрационная оплата':'Наличными при получении'}</p><div class="spread"><strong>Итого с доставкой</strong><strong>${rub(order.total)}</strong></div></aside></div>`
}
function profile(params) {
  if (!state.user) return title('Личный кабинет')+needsAuth()
  const tab=params.get('tab')||'profile'
  const {user}=state
  const tabs=[['profile','Профиль'],['addresses','Адреса'],['settings','Настройки']]
  let body=`<form class="panel form-grid" data-form="profile">${input('name','Имя',user.name,'text','required maxlength="120"')}${input('email','Электронная почта',user.email,'email','readonly')}${input('phone','Телефон',user.phone,'tel','maxlength="22"')}<div class="span">${submit('Сохранить')}</div></form>`
  if (tab==='addresses') body=`<div class="stack">${user.addresses.map((a,index)=>`<div class="panel spread">${esc(addressLabel(a))}${btn('Удалить','removeAddress','danger',`data-index="${index}"`)}</div>`).join('')}<form class="panel form-grid" data-form="address"><h2 class="span">Добавить адрес</h2>${addressInputs()}<div class="span">${submit('Добавить адрес')}</div></form></div>`
  if (tab==='settings') body=`<div class="panel stack"><h2>Аккаунт</h2>${btn('Выйти из аккаунта','logout','danger')}</div>`
  return title('Личный кабинет','Привет, '+esc(user.name))+`<div class="row filters">${tabs.map(([key,label])=>link(label,'profile','button '+(key===tab?'primary':''),{tab:key})).join('')}${link('Мои заказы','orders')}${link('Избранное','favorites')}${user.role==='admin'?link('Админ-панель','admin'):''}</div>`+body
}
function adminOrders(orders,params) {
  const filter=params.get('status')||'active'
  const query=params.get('q')||''
  const filtered=orders.filter(order=>(filter==='all'||(filter==='active'?order.status<5:order.status===Number(filter)))&&
    matches(query,String(order.id),order.details.name,order.details.phone,order.details.address.street))
  const labels=[['active','В работе'],['0','Новые'],['1','Принятые'],['2','Готовятся'],['3','Переданы'],['4','В пути'],['5','Доставлены'],['all','Все заказы']]
  const advance=['Принять заказ','Начать готовить','Передать курьеру','Отправить курьера','Отметить доставленным']
  return `<div class="ops-layout"><div class="panel ops-toolbar">
    <form class="row" data-form="adminOrders"><input type="search" name="q" value="${esc(query)}" placeholder="Номер, имя, телефон или улица" aria-label="Поиск заказов"><input type="hidden" name="status" value="${esc(filter)}">${submit('Найти')}${btn('↻ Обновить','refreshOrders')}</form>
    <div class="row">${labels.map(([key,label])=>link(label,'admin','button compact '+(key===filter?'primary':''),{tab:'orders',status:key,q:query})).join('')}</div>
  </div><div class="stack">${filtered.map(order=>{
    const {details}=order
    const addressDetails=[details.address.entry&&'подъезд '+details.address.entry,details.address.floor&&'этаж '+details.address.floor,details.address.intercom&&'домофон '+details.address.intercom].filter(Boolean).join(' · ')
    return `<article class="panel ops-order ${order.status===0?'ops-new':''}">
      <div class="spread"><div><small>${date(order.created)} · ${details.payment==='demo'?'Демо-оплата':'Наличными'}</small><h3>Заказ №${order.id}</h3></div><span class="pill">${statuses[order.status]}</span></div>
      <div class="spread"><div><strong>${esc(details.name)}</strong><p>${esc(details.phone)} · ${esc(addressLabel(details.address))}</p></div><strong class="ops-total">${rub(order.total)}</strong></div>
      <details><summary>Состав и управление</summary><div class="stack">
        <p>Доставка к ${date(order.eta)} ${addressDetails?' · '+esc(addressDetails):''}</p>
        ${details.comment?`<p>Комментарий — ${esc(details.comment)}</p>`:''}
        ${order.items.map(item=>`<div class="spread list-row"><span>${esc(item.name)} × ${item.qty} ${item.gift?'<span class="pill">Подарок</span>':''}<br><small>${esc(item.restaurant)} ${esc(item.addons.map(addon=>addon.name).join(', '))}</small></span><strong>${rub(item.total)}</strong></div>`).join('')}
        <form class="row" data-form="adminStatus" data-id="${order.id}" data-expected="${order.status}">${field('status','Изменить статус',statuses.map((status,i)=>[i,status]),order.status)}${submit('Сохранить')}</form>
      </div></details>
      ${order.status<5?`<div>${btn(advance[order.status],'advanceOrder','primary',`data-id="${order.id}" data-expected="${order.status}"`)}</div>`:''}
    </article>`
  }).join('')||empty('Заказы не найдены','Как только заказ поступит в эту очередь, он появится здесь.')}</div></div>`
}

const adminTabs = [['dashboard','Статистика'],['restaurants','Рестораны'],['dishes','Блюда'],['orders','Заказы'],['users','Пользователи'],['promos','Промокоды'],['settings','Настройки']]
function adminPage(data,params) {
  const tab=params.get('tab')||'dashboard'
  const controls=`<nav class="row filters ops-nav" aria-label="Разделы админ-панели">${adminTabs.map(([key,label])=>link(label,'admin','button '+(key===tab?'primary':''),{tab:key})).join('')}</nav>`
  let content
  if (tab==='dashboard') {
    const revenue=data.orders.filter(order=>order.status===5&&order.details.payment==='cash').reduce((sum,order)=>sum+order.total,0)
    const popularity=new Map()
    for (const order of data.orders) for (const item of order.items) popularity.set(item.name,(popularity.get(item.name)||0)+item.qty)
    const popular=[...popularity].sort((a,b)=>b[1]-a[1]).slice(0,6)
    const distribution=statuses.map((status,i)=>[status,data.orders.filter(order=>order.status===i).length])
    const bars=(values,max)=>`<div class="bars">${values.map(([name,value])=>`<div><div class="spread"><span>${esc(name)}</span><strong>${value}</strong></div><progress value="${value}" max="${max}" aria-label="${esc(name)}"></progress></div>`).join('')}</div>`
    content=grid([['Заказы',data.orders.length],['Доставлено наличными',rub(revenue)],['Пользователи',data.users.length]],([label,value])=>`<div class="panel"><p>${label}</p><h2>${value}</h2></div>`)+
      section('Заказы по статусам',`<div class="panel">${bars(distribution,Math.max(1,...distribution.map(item=>item[1])))}</div>`)+
      section('Популярные блюда',`<div class="panel">${popular.length?bars(popular,popular[0][1]):'<p>Появятся после первого заказа.</p>'}</div>`)+
      section('Последние заказы',`<div class="panel">${data.orders.slice(0,6).map(order=>`<div class="spread list-row"><span>№${order.id} · ${date(order.created)}</span><span>${statuses[order.status]}</span><strong>${rub(order.total)}</strong></div>`).join('')||'<p>Заказов пока нет.</p>'}</div>`)
  }
  if (tab==='orders') content=adminOrders(data.orders,params)
  if (tab==='users') content=`<div class="stack">${data.users.map(user=>`<details class="panel"><summary>${esc(user.name)} · ${esc(user.email)} · ${user.role==='admin'?'Администратор':'Покупатель'}</summary><p>${esc(user.phone)}</p>${data.orders.filter(order=>order.user_id===user.id).map(order=>`<p>Заказ №${order.id} · ${date(order.created)} · ${rub(order.total)} · ${statuses[order.status]}</p>`).join('')||'<p>Заказов пока нет.</p>'}${user.id!==state.user.id?`<form data-form="adminRole" data-id="${user.id}" class="row">${field('role','Роль',[['customer','Покупатель'],['admin','Администратор']],user.role)}${submit('Сохранить')}</form>`:''}</details>`).join('')}</div>`
  if (tab==='settings') {
    const {settings}=data
    content=`<form data-form="adminSettings" class="panel form-grid">${input('name','Название',settings.name,'text','required')}${input('contacts','Контакты',settings.contacts,'text','required')}${input('logo','Логотип',settings.logo,'text','required')}${input('upload','Загрузить логотип','','file','accept="image/png,image/jpeg,image/webp"')}${input('city','Город доставки',settings.city,'text','required')}${input('delivery','Доплата за доставку',settings.delivery,'number','required min="0"')}${input('minimum','Минимальная сумма',settings.minimum,'number','required min="0"')}<div class="span">${submit('Сохранить')}</div></form>`
  }
  if (['restaurants','dishes','promos'].includes(tab)) {
    content=`<div class="panel stack"><div>${btn('Добавить','adminEdit','primary',`data-table="${tab}" data-key="new"`)}</div>${data[tab].map(value=>{
      const key=esc(value.id??value.code)
      return `<div class="spread list-row ops-editor-row"><span class="row">${value.image?img(value.image,value.name):""}<span><strong>${esc(value.name||value.code)}</strong><br><small>${esc(value.category||(value.kind==='percent'?value.value+'%':rub(value.value)))}</small></span></span><div class="row">${btn('Редактировать','adminEdit','compact',`data-table="${tab}" data-key="${key}"`)}${btn('Удалить','adminDelete','compact danger',`data-table="${tab}" data-key="${key}"`)}</div></div>`
    }).join('')}</div>`
  }
  return `<div class="ops"><div class="ops-heading"><div><h1>Админ-панель</h1><p>Заказы, меню и настройки доставки</p></div>${link('Новые заказы · '+data.orders.filter(order=>order.status===0).length,'admin','button primary',{tab:'orders',status:'0'})}</div>${controls}${content||empty('Раздел не найден','Выберите раздел в меню.')}</div>`
}
let adminData
function adminEdit(table,key) {
  const record=adminData[table].find(item=>String(item.id??item.code)===key)||{}
  const text=(name,label,value=record[name])=>input(name,label,value,'text','required')
  const number=(name,label,value=record[name]??0,step=1)=>input(name,label,value,'number',`required min="0" step="${step}"`)
  const image=(index)=>input('image','Изображение',record.image||'/food-'+index+'.jpg','text','required')+input('upload','Загрузить файл','','file','accept="image/png,image/jpeg,image/webp"')
  const common=()=>text('name','Название')+field('category','Категория',state.catalog.categories,record.category)+`<label class="span">Описание<textarea name="description" maxlength="1000">${esc(record.description)}</textarea></label>`
  let fields
  if (table==='restaurants') fields=common()+number('rating','Рейтинг',record.rating??4.5,.1)+number('minutes','Время, мин',record.minutes??30)+number('delivery','Доставка, ₽')+number('minimum','Минимум заказа, ₽')+image(0)
  if (table==='dishes') fields=common()+field('restaurant_id','Ресторан',adminData.restaurants.map(rest=>[rest.id,rest.name]),record.restaurant_id)+number('price','Цена, ₽')+number('discount','Скидка, ₽')+text('weight','Вес или объём')+field('available','Доступность',[[1,'В меню'],[0,'Скрыто']],record.available??1)+image(0)+`<label class="span">Добавки в формате «Название | Цена», одна на строку<textarea name="addons">${esc((record.addons||[]).map(addon=>addon.name+' | '+addon.price).join('\n'))}</textarea></label>`
  if (table==='promos') fields=text('code','Код')+field('kind','Тип скидки',[['percent','Процент'],['fixed','Рубли']],record.kind)+number('value','Размер скидки')+input('expires','Действует до',record.expires,'date','required')+number('max_uses','Лимит применений (0 — без лимита)')
  openModal(key==='new'?'Добавить запись':'Редактировать запись',`<form class="form-grid" data-form="adminEntity" data-table="${table}" data-key="${esc(key)}">${fields}<div class="span">${submit('Сохранить')}</div></form>`)
}
function openModal(heading,content) {
  modal.innerHTML=`<div class="stack"><div class="spread"><h2 id="modal-title">${heading}</h2>${btn('×','close','compact','aria-label="Закрыть"')}</div>${content}<p class="error" id="modal-error" role="alert"></p></div>`
  modal.setAttribute('aria-labelledby','modal-title')
  if (!modal.open) modal.showModal()
}
function authModal(register=false) {
  openModal(register?'Регистрация':'Вход',`<form class="stack" data-form="auth" data-mode="${register?'register':'login'}">
    ${register?input('name','Имя','','text','required maxlength="120" autocomplete="name"'):''}
    ${input('email','Электронная почта','','email','required autocomplete="email"')}
    ${input('password','Пароль','','password',`required maxlength="128" ${register?'minlength="10" autocomplete="new-password"':'autocomplete="current-password"'}`)}
    ${submit(register?'Создать аккаунт':'Войти')}${btn(register?'Уже есть аккаунт':'Создать аккаунт',register?'auth':'register')}</form>
    ${state.authOptions.google?'<a class="button light full" href="/api/auth/google" target="_top">Продолжить с Google</a>':''}
`)
}
function dishModal(id,index) {
  const dish=dishBy(id)
  if (!dish) return
  const line=state.cart[index]
  openModal(esc(dish.name),`<form class="stack" data-form="dish" data-id="${id}" data-index="${index??''}"><p>${esc(dish.description)} · ${esc(dish.weight)} · ${rub(dish.price-dish.discount)}</p>
    ${dish.addons.map(addon=>`<label class="check"><input type="checkbox" name="addon" value="${esc(addon.name)}" ${line?.addons.includes(addon.name)?'checked':''}>${esc(addon.name)} · +${rub(addon.price)}</label>`).join('')}
    ${input('qty','Количество',line?.qty||1,'number','min="1" max="50" required')}${submit(line?'Сохранить':'Добавить в корзину')}</form>`)
}
async function loadQuote() {
  if (!state.cart.length) return {quote:null,error:''}
  try {return {quote:await api('/quote','POST',{cart:state.cart,promo:state.promo}),error:''}}
  catch (error) {return {quote:null,error:error.message}}
}
async function render() {
  if (!state.catalog) return
  const renderID=++state.renderID
  const route=readRoute()
  const {path,params}=route
  clearTimeout(trackTimer)
  shell(route)
  try {
    let html
    switch(path) {
      case 'home':html=home();break
      case 'catalog':html=catalog(params);break
      case 'restaurant':html=restaurant(params);break
      case 'offers':html=title('Акции')+promoCards();break
      case 'favorites': {
        const saved=cityRestaurants().filter(rest=>state.favorites.includes(rest.id))
        html=title('Избранное')+(saved.length?grid(saved,restaurantCard):empty('Избранное пусто','Нажмите на сердечко на карточке ресторана.',link('К ресторанам','catalog')))
        break
      }
      case 'cart':case 'checkout': {
        const result=await loadQuote()
        if (renderID!==state.renderID) return
        state.quote=result.quote
        state.quoteError=result.error
        html=path==='cart'?cartPage():checkout()
        break
      }
      case 'admin-setup':
        html=state.authOptions.adminSetup&&/^[a-f0-9]{64}$/.test(params.get('token')||'')
          ? title('Настройка администратора')+`<form class="panel stack" data-form="adminSetup">${input('password','Новый пароль','','password','required minlength="10" maxlength="128" autocomplete="new-password"')}${input('confirmation','Повторите пароль','','password','required minlength="10" maxlength="128" autocomplete="new-password"')}${submit('Создать аккаунт администратора')}</form>`
          : empty('Настройка недоступна','Откройте ссылку настройки, выданную при развёртывании.',link('На главную','home'))
        break
      case 'profile':html=profile(params);break
      case 'orders': {
        const list=state.user?await api('/orders'):null
        const history=params.get('tab')==='history'
        html=title(history?'История заказов':'Мои заказы')+(list?`<div class="row filters">${link('Все заказы','orders','button '+(!history?'primary':''))}${link('История','orders','button '+(history?'primary':''),{tab:'history'})}</div>`+orderList(history?list.filter(order=>order.status===5):list):needsAuth())
        break
      }
      case 'order': {
        const order=state.user?await api('/orders/'+encodeURIComponent(params.get('id')||'')):null
        html=order?tracking(order):needsAuth()
        if (order&&order.status<5&&renderID===state.renderID) trackTimer=setTimeout(render,15000)
        break
      }
      case 'admin':
        if (state.user?.role!=='admin') html=empty('Доступ ограничен','Войдите с учётной записью администратора.')
        else {adminData=await api('/admin/data');html=adminPage(adminData,params)}
        break
      default:html=empty('Страница не найдена','Вернитесь на главную.',link('На главную','home'))
    }
    if (renderID===state.renderID) main.innerHTML=html
  } catch (error) {
    if (renderID===state.renderID) main.innerHTML=empty('Не удалось загрузить страницу',esc(error.message),btn('Повторить','retry'))
  } finally {
    if (renderID===state.renderID) main.setAttribute('aria-busy','false')
  }
}
const values = form => Object.fromEntries(new FormData(form))
const getAddress = fields => ({city:state.catalog.settings.city,...Object.fromEntries(addressFields.map(([key])=>[key,fields[key]||'']))})
const numeric = (fields,keys) => {for (const key of keys) fields[key]=Number(fields[key])}
const attach = async (fields,key) => {
  const file=fields.upload
  delete fields.upload
  if (!file?.size) return
  if (file.size>550000||!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Загрузите PNG, JPEG или WebP до 550 КБ')
  fields[key]=await new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onload=()=>resolve(reader.result)
    reader.onerror=reject
    reader.readAsDataURL(file)
  })
}
async function refreshCatalog() {
  state.catalog=await api('/catalog')

}
async function submitForm(form) {
  const fields=values(form)
  switch(form.dataset.form) {
    case 'search':case 'filters':navigate('catalog',fields);return
    case 'menu':navigate('restaurant',fields);return
    case 'adminOrders':navigate('admin',{tab:'orders',...fields});return
    case 'promo':
      state.checkoutDraft=$('[data-form=checkout]')?values($('[data-form=checkout]')):state.checkoutDraft
      state.promo=fields.promo.toUpperCase().trim()
      break
    case 'auth':{
      const guest=state.cart
      const favorites=state.favorites
      state.user=await api('/'+form.dataset.mode,'POST',fields)
      const merged=state.user.cart.filter(item=>dishBy(item.id))
      for (const item of guest) {
        const found=merged.find(value=>itemEquals(value,item))
        if (found) found.qty=Math.min(50,found.qty+item.qty)
        else if (merged.length<80) merged.push(item)
      }
      setCart(merged)
      setFavorites([...new Set([...state.user.favorites,...favorites])].slice(0,500))
      persist('cart',[])
      persist('favorites',[])
      modal.close()
      toast('Вы вошли в аккаунт')
      break
    }
    case 'dish': {
      const next={id:Number(form.dataset.id),qty:Number(fields.qty),addons:new FormData(form).getAll('addon').sort()}
      const cart=state.cart.slice()
      const index=form.dataset.index===''?-1:Number(form.dataset.index)
      if (index!==-1) cart.splice(index,1)
      const existing=cart.findIndex(item=>itemEquals(item,next))
      if (existing>=0) cart[existing]={...next,qty:Math.min(50,cart[existing].qty+next.qty)}
      else {
        if (cart.length>=80) throw new Error('В корзине уже 80 позиций')
        cart.push(next)
      }
      setCart(cart)
      modal.close()
      toast(index===-1?'Добавлено в корзину':'Добавки обновлены')
      break
    }
    case 'checkout':{
      if (orderPending) return
      orderPending=true
      try {
        await saveQueue.catch(()=>{})
        const time=fields.schedule==='later'?new Date(fields.time):null
        if (time&&!Number.isFinite(time.getTime())) throw new Error('Укажите дату и время доставки')
        const payload={cart:state.cart,promo:state.promo,name:fields.name,phone:fields.phone,address:getAddress(fields),comment:fields.comment,time:time?time.toISOString():'',payment:fields.payment,saveAddress:!!fields.saveAddress}
        const fingerprint=JSON.stringify(payload)
        if (orderAttempt?.fingerprint!==fingerprint) orderAttempt={fingerprint,key:crypto.randomUUID()}
        const result=await api('/orders','POST',{...payload,requestKey:orderAttempt.key})
        orderAttempt=null
        state.cart=[]
        state.promo=''
        state.checkoutDraft=null
        try {state.user=await api('/me')} catch {}
        navigate('order',{id:result.id})
        toast('Заказ оформлен')
        return
      } finally {orderPending=false}
    }
    case 'adminSetup':
      if (fields.password!==fields.confirmation) throw new Error('Пароли должны совпадать')
      state.user=await api('/auth/admin/setup','POST',{token:readRoute().params.get('token'),password:fields.password})
      state.cart=state.user.cart
      state.favorites=state.user.favorites
      history.replaceState(null,'','#admin')
      break
    case 'profile':
      await saveQueue.catch(()=>{})
      state.user=await api('/me','PATCH',{name:fields.name,phone:fields.phone})
      toast('Профиль обновлён')
      break
    case 'address':
      await saveQueue.catch(()=>{})
      state.user=await api('/me','PATCH',{addresses:[...state.user.addresses,getAddress(fields)]})
      toast('Адрес добавлен')
      break
    case 'adminStatus':await api('/admin/orders/'+form.dataset.id,'PATCH',{status:Number(fields.status),expected:Number(form.dataset.expected)});toast('Статус сохранён');break
    case 'adminRole':await api('/admin/users/'+form.dataset.id,'PATCH',{role:fields.role});toast('Роль сохранена');break
    case 'adminEntity': {
      const {table,key}=form.dataset
      await attach(fields,'image')
      numeric(fields,{restaurants:['rating','minutes','delivery','minimum'],dishes:['restaurant_id','price','discount','available'],promos:['value','max_uses']}[table])
      if (table==='promos') fields.code=fields.code.trim().toUpperCase()
      if (table==='dishes') fields.addons=fields.addons.split('\n').filter(value=>value.trim()).map(value=>{
        const [name,price]=value.split('|')
        if (!price?.trim()) throw new Error('Укажите цену каждой добавки после символа |')
        return {name:name.trim(),price:Number(price)}
      })
      await api('/admin/'+table+'/'+encodeURIComponent(key),'PUT',fields)
      modal.close()
      await refreshCatalog()
      toast('Запись сохранена')
      break
    }
    case 'adminSettings':
      await attach(fields,'logo')
      numeric(fields,['delivery','minimum'])
      await api('/admin/settings','PUT',fields)
      await refreshCatalog()
      toast('Настройки сохранены')
      break
  }
  await render()
}
document.addEventListener('submit',async event=>{
  const form=event.target
  if (!form.matches('[data-form]')) return
  event.preventDefault()
  const button=event.submitter
  if (button) button.disabled=true
  if (modal.open) $('#modal-error').textContent=''
  try {await submitForm(form)}
  catch (error) {if (modal.open) $('#modal-error').textContent=error.message;else toast(error.message)}
  finally {if (button) button.disabled=false}
})
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-act]')
  if (!button) return
  const {act,id,index,step,code,table,key}=button.dataset
  try {
    switch(act) {
      case 'retry':if (!state.catalog) {await start();return}break
      case 'auth':authModal();return
      case 'register':authModal(true);return
      case 'close':modal.close();return
      case 'dish':dishModal(Number(id));return
      case 'editDish':dishModal(state.cart[index].id,Number(index));return
      case 'favorite':{
        const target=Number(id)
        setFavorites(state.favorites.includes(target)?state.favorites.filter(value=>value!==target):[...state.favorites,target])
        break
      }
      case 'qty': {
        const cart=state.cart.map((item,i)=>i===Number(index)?{...item,qty:Math.min(50,item.qty+Number(step))}:item).filter(item=>item.qty>0)
        setCart(cart);break
      }
      case 'remove':setCart(state.cart.filter((_,i)=>i!==Number(index)));break
      case 'promo':state.promo=code;toast('Промокод выбран');navigate('cart');return
      case 'removePromo':
        state.checkoutDraft=$('[data-form=checkout]')?values($('[data-form=checkout]')):state.checkoutDraft
        state.promo='';break
      case 'logout':
        await saveQueue.catch(()=>{})
        await api('/logout','POST')
        orderAttempt=null;state.user=null;state.cart=stored('cart',[]);state.favorites=stored('favorites',[]);state.promo='';state.checkoutDraft=null
        navigate('home');toast('Вы вышли из аккаунта');return
      case 'removeAddress':
        await saveQueue.catch(()=>{})
        state.user=await api('/me','PATCH',{addresses:state.user.addresses.filter((_,i)=>i!==Number(index))})
        toast('Адрес удалён');break
      case 'refreshOrders':break
      case 'advanceOrder':{
        button.disabled=true
        try {
          const expected=Number(button.dataset.expected)
          await api('/admin/orders/'+id,'PATCH',{status:expected+1,expected})
          toast(expected===0?'Заказ принят':'Статус обновлён')
        } finally {button.disabled=false}
        break
      }
      case 'adminEdit':adminEdit(table,key);return
      case 'adminDelete':
        if (!window.confirm('Удалить запись? При удалении ресторана его блюда тоже будут удалены.')) return
        await api('/admin/'+table+'/'+encodeURIComponent(key),'DELETE')
        await refreshCatalog()
        toast('Запись удалена');break
    }
    await render()
  } catch (error) {toast(error.message)}
})
document.addEventListener('change',event=>{
  const field=event.target
  const form=field.closest('[data-form=checkout]')
  if (!form) return
  if (field.name==='schedule') $('#delivery-time').hidden=field.value!=='later'
  if (field.name==='saved'&&field.value!=='') for (const [key] of addressFields) form.elements[key].value=state.user.addresses[Number(field.value)][key]||''
  state.checkoutDraft=values(form)
})
document.addEventListener('error',event=>{
  const image=event.target
  if (!(image instanceof HTMLImageElement)||image.dataset.fallback) return
  image.dataset.fallback='true'
  image.src='/mascot.jpg'
},true)
window.addEventListener('hashchange',()=>{
  window.scrollTo(0,0)
  render()
})
async function start() {
  try {
    const [,user,options]=await Promise.all([refreshCatalog(),api('/me'),api('/auth/options')])
    state.authOptions=options
    state.user=user
    if (user) {state.cart=user.cart;state.favorites=user.favorites}
    await render()
    const google=new URL(location.href).searchParams.get('google')
    if (google) {
      history.replaceState(null,'',location.pathname+location.hash)
      if (google==='existing') toast('Для этого email уже есть аккаунт. Войдите по паролю.')
      if (google==='error') toast('Вход через Google не завершился.')
    }
  } catch(error) {
    main.innerHTML=empty('Не удалось загрузить каталог',esc(error.message),btn('Повторить','retry'))
    main.setAttribute('aria-busy','false')
  }
}
start()
