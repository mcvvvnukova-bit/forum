import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {expect,it} from 'vitest'
const script = readFileSync('public/audience-assets/resume.js','utf8')
function resume(value: unknown, search: string) {
  let redirect: string | null = null
  runInNewContext(script, {URL,URLSearchParams,sessionStorage:{getItem:()=>JSON.stringify(value)},window:{location:{pathname:'/',origin:'https://dev.astforum.ru',search,replace:(s:string)=>{redirect=s}}}})
  return redirect
}
it('resumes personal work after the actual Sber callback',()=>{expect(resume({audience:'individual',action:'find-orders',direction:'orders',returnTo:'/work/'},'?auth=success')).toBe('/participate/?resume=1')})
it.each([
  {action:'find-jobs',direction:'jobs'},
  {action:'find-work'},
])('resumes $action without losing the selected route',route=>{expect(resume({audience:'individual',returnTo:'/work/',...route},'?auth=success')).toBe('/participate/?resume=1')})
it('does not resume a mismatched vacancy route',()=>{expect(resume({audience:'individual',action:'find-orders',direction:'jobs',returnTo:'/work/'},'?auth=success')).toBeNull()})
it('keeps a cancellation visible without discarding the intent',()=>{expect(resume({audience:'individual',action:'find-orders',direction:'orders',returnTo:'/work/'},'?auth_error=access_denied')).toBe('/participate/?auth_error=access_denied&resume=1')})
it('never navigates to a tampered return target',()=>{expect(resume({audience:'individual',action:'find-orders',direction:'orders',returnTo:'//external.example'},'?auth=success')).toBeNull()})
it('does not interrupt an ordinary homepage visit',()=>{expect(resume({audience:'individual',action:'find-orders',direction:'orders',returnTo:'/work/'},'')).toBeNull()})
