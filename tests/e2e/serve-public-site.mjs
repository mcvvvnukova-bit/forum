import {createServer} from 'node:http'
import {readFileSync,statSync} from 'node:fs'
import {resolve,extname} from 'node:path'
const portText=process.env.FORUM_WEB_E2E_PORT ?? '5297'
if(!/^[0-9]+$/.test(portText) || Number(portText)<1024 || Number(portText)>65535) throw new Error('Invalid FORUM_WEB_E2E_PORT')
const port=Number(portText)
const root=resolve(process.env.FORUM_WEB_SITE || 'apps/web/dist')
createServer((req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
  if(name.includes('..') || name.includes('\\')) throw new Error('Path')
  let file=resolve(root,'.'+name)
  if(!file.startsWith(root+'/') && file!==root) throw new Error('Path')
  try{if(statSync(file).isDirectory())file=resolve(file,'index.html')}catch{file=resolve(root,'index.html')}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream')
  res.setHeader('Cache-Control','no-store');res.end(readFileSync(file))
 }catch{res.statusCode=404;res.end('Not found')}
}).listen(port,'127.0.0.1')
