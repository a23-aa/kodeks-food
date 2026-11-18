const parse = JSON.parse
const json = JSON.stringify
export const categories = ['Бургеры','Пицца','Суши','Шаурма','Завтраки','Десерты','Напитки','Комбо']
export const icons = ['🍔','🍕','🍣','🌯','🥞','🧁','🥤','🍟']
const initialSettings = { name:'Кодекс', logo:'♔', contacts:'hello@example.com', cities:['Казань','Самара','Москва'], delivery:0, minimum:0 }

export async function seedCatalog(db) {
  const statement=(sql,...args)=>db.prepare(sql).bind(...args)
  if (await db.prepare('SELECT id FROM settings WHERE id=1').first()) return
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
  const restaurants=[]
  const menu=[]
  for (const city of initialSettings.cities) {
    names.forEach((name,index)=>{
      const id=restaurants.length+1
      restaurants.push([id,name,dishes[index][0][1],categories[index],city,4.9-index%3/10,25+index*3,index%2?79:0,299,'/food-'+index+'.jpg'])
      for (const [title,description,price] of dishes[index]) {
        menu.push([menu.length+1,id,title,description,categories[index],price,0,index===6?'330 мл':'250 г','/food-'+index+'.jpg',1,json(index===0?[{name:'Дополнительный сыр',price:49},{name:'Соус',price:29}]:[])])
      }
    })
  }
  const unseeded=' WHERE NOT EXISTS(SELECT 1 FROM settings WHERE id=1)'
  function seedRows(table,rows) {
    const chunkSize=Math.floor(100/rows[0].length)
    const inserts=[]
    for (let i=0;i<rows.length;i+=chunkSize) {
      const chunk=rows.slice(i,i+chunkSize)
      const values=chunk.map(row=>'('+row.map(()=>'?').join(',')+')').join(',')
      inserts.push(statement('INSERT INTO '+table+' SELECT * FROM (VALUES '+values+')'+unseeded,...chunk.flat()))
    }
    return inserts
  }
  await db.batch([
    ...seedRows('restaurants',restaurants),
    ...seedRows('dishes',menu),
    ...seedRows('promos',[['KODEKS10','percent',10,'2099-12-31',1000]]),
    statement('INSERT OR IGNORE INTO settings VALUES(1,?)',json(initialSettings))
  ])
}
