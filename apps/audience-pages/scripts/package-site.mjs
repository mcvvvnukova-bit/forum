import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
const output = new URL('../dist/site/', import.meta.url)
const dist = new URL('../dist/', import.meta.url)
await rm(output, {recursive:true,force:true})
await mkdir(output,{recursive:true})
await cp(new URL('audience-assets/', dist),new URL('audience-assets/', output),{recursive:true})
const html = await readFile(new URL('index.html', dist),'utf8')
for (const [route,title] of Object.entries({customers:'Для заказчиков',suppliers:'Для поставщиков и подрядчиков',work:'Работа и подработка',participate:'Вход и регистрация'})) {
  await mkdir(new URL(`${route}/`,output),{recursive:true})
  await writeFile(new URL(`${route}/index.html`,output),html.replace(/<title>.*?<\/title>/,`<title>${title} — АСТ Форум</title>`))
}
console.log('Packaged four routes and isolated audience-assets; no homepage/auth gateway in package')
