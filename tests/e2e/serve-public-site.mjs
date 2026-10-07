import {createServer} from 'node:http'
import {readFileSync,statSync} from 'node:fs'
import {resolve,extname} from 'node:path'
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
}).listen(5297,'127.0.0.1')
