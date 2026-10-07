import {createHash} from 'node:crypto'
import {readFileSync, readdirSync} from 'node:fs'
import {resolve, relative} from 'node:path'
import type {Plugin} from 'vite'

// Give even delayed public images a content-addressed namespace before Vite
// hashes the chunks that reference them. No post-build rewriting of hashed JS.
export function immutableMedia(root: string): Plugin {
  const files: {name:string; bytes:Buffer}[] = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const path=resolve(directory,entry.name)
      if (entry.isSymbolicLink()) throw new Error('Symlink in web media')
      if (entry.isDirectory()) walk(path)
      else if (!path.endsWith('/resume.js')) files.push({name:relative(root,path).replaceAll('\\','/'), bytes:readFileSync(path)})
    }
  }
  walk(root)
  const hash=createHash('sha256')
  for (const file of files) hash.update(file.name+'\0').update(file.bytes).update('\0')
  const prefix='/web-media/'+hash.digest('hex')+'/'
  const rewrite=(code:string) => code.replaceAll('/assets/',prefix+'assets/').replaceAll('/audience-assets/',prefix+'audience-assets/')
  return {name:'forum-immutable-media', apply:'build',
    transform(code,id) {if (id.includes('/src/') && /\.[jt]sx?$/.test(id)) return {code:rewrite(code), map:null}},
    transformIndexHtml: {order:'pre', handler:rewrite},
    generateBundle() {for (const file of files) this.emitFile({type:'asset',fileName:prefix.slice(1)+file.name,source:file.bytes})},
  }
}
