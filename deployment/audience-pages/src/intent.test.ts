import {beforeEach, expect, it} from 'vitest'
import {readIntent, saveIntent, sessionContext} from './intent'
beforeEach(()=>sessionStorage.clear())
it.each(['goods','design','construction','leasing','services'] as const)('keeps the supplier direction %s when the page is reopened',direction=>{saveIntent({audience:'supplier',action:'find-orders',direction,returnTo:'/suppliers/'});expect(readIntent()).toEqual({audience:'supplier',action:'find-orders',direction,returnTo:'/suppliers/'})})
it('rejects an unknown supplier direction',()=>{sessionStorage.setItem('forum.public.intent',JSON.stringify({audience:'supplier',action:'find-orders',direction:'arbitrary',returnTo:'/suppliers/'}));expect(readIntent()).toBeNull()})
it('rejects a stored external redirect',()=>{sessionStorage.setItem('forum.public.intent',JSON.stringify({audience:'individual',action:'find-orders',direction:'orders',returnTo:'https://example.org/'}));expect(readIntent()).toBeNull()})
it('rejects a company intent disguised as the individual path',()=>{sessionStorage.setItem('forum.public.intent',JSON.stringify({audience:'customer',action:'find-orders',direction:'orders',returnTo:'/work/'}));expect(readIntent()).toBeNull()})
it('rejects malformed storage without breaking the landing',()=>{sessionStorage.setItem('forum.public.intent','{');expect(readIntent()).toBeNull()})
it('does not mistake a company executor for the personal work context',()=>{expect(sessionContext({user:{id:'u',displayName:'Name'},participant:{id:'p',role:'executor',status:'active',kind:'company'}})).toBe('other')})
it('accepts only the documented individual participant context',()=>{expect(sessionContext({user:{id:'u',displayName:'Name'},participant:{id:'p',role:'provider',status:'active',legalStatus:'individual_person'}})).toBe('individual')})
