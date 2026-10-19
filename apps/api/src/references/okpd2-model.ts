import {createHash} from 'node:crypto';
export interface OkpdSection {code:string;name:string}
export interface OkpdCode {code:string;section:string;name:string;parentCode:string|null;level:number}
export interface OkpdSnapshot {edition:string;publishedDate:string;url:string;archiveHash:string;sections:OkpdSection[];items:OkpdCode[]}
export const ROSSTAT_ARCHIVE='https://rosstat.gov.ru/storage/mediabank/OKPD2.rar';
const order=(a:{code:string},b:{code:string})=>a.code<b.code?-1:a.code>b.code?1:0;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid source object');return value as Record<string,unknown>}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Invalid source text');return value.trim().replace(/\s+/g,' ').normalize('NFC')}
function rows(value:unknown,max:number):unknown[]{if(!Array.isArray(value)||!value.length||value.length>max)throw new Error('Invalid source list');return value}
export function normalizeSnapshot(value:unknown):OkpdSnapshot {
 const source=object(value),edition=text(source.edition,10),publishedDate=text(source.publishedDate,10),url=text(source.url,200),archiveHash=text(source.archiveHash,64);
 if(!/^[1-9]\d{0,3}\/20\d{2}$/.test(edition)||!/^20\d{2}-\d{2}-\d{2}$/.test(publishedDate)||!Number.isFinite(Date.parse(publishedDate))||new Date(publishedDate).toISOString().slice(0,10)!==publishedDate||url!==ROSSTAT_ARCHIVE||!/^[a-f0-9]{64}$/.test(archiveHash))throw new Error('Invalid source metadata');
 const sections=rows(source.sections,21).map(value=>{const r=object(value),code=text(r.code,1),name=text(r.name,2000);if(!/^[A-U]$/.test(code))throw new Error('Invalid section');return {code,name}}).sort(order);
 const bySection=new Set(sections.map(s=>s.code));if(bySection.size!==sections.length)throw new Error('Duplicate section');
 const items=rows(source.items,100000).map(value=>{
  const r=object(value),code=text(r.code,12),section=text(r.section,1),name=text(r.name,2000);
  if(!/^\d{2}(?:\.\d(?:\d(?:\.\d(?:\d(?:\.\d{3})?)?)?)?)?$/.test(code)||!bySection.has(section))throw new Error('Invalid OKPD code/section');
  const level=({2:1,4:2,5:3,7:4,8:5,12:6} as Record<number,number>)[code.length];
  const parentCode=({4:code.slice(0,2),5:code.slice(0,4),7:code.slice(0,5),8:code.slice(0,7),12:code.slice(0,8)} as Record<number,string>)[code.length]??null;
  if(!level)throw new Error('Invalid OKPD code depth');return {code,section,name,parentCode,level};
 }).sort(order);
 const byCode=new Map(items.map(x=>[x.code,x]));if(byCode.size!==items.length)throw new Error('Duplicate OKPD code');
 for(const row of items)if(row.parentCode&&byCode.get(row.parentCode)?.section!==row.section)throw new Error('Missing or inconsistent OKPD parent');
 for(const section of sections)if(!items.some(r=>r.section===section.code))throw new Error('Empty source section');
 return {edition,publishedDate,url,archiveHash,sections,items};
}
/** Edition/date are bound to decisions; archive layout bytes are recorded separately. */
export function snapshotHash(snapshot:OkpdSnapshot):string {
 return createHash('sha256').update(JSON.stringify({edition:snapshot.edition,publishedDate:snapshot.publishedDate,
  sections:[...snapshot.sections].sort(order).map(x=>[x.code,x.name]),items:[...snapshot.items].sort(order).map(x=>[x.code,x.section,x.name,x.parentCode,x.level])})).digest('hex');
}
function diffRows<T extends {code:string}>(before:T[],after:T[]){
 const old=new Map(before.map(x=>[x.code,x])),next=new Set(after.map(x=>x.code));
 return {added:after.filter(x=>!old.has(x.code)),removed:before.filter(x=>!next.has(x.code)),changed:after.filter(x=>old.has(x.code)&&JSON.stringify(old.get(x.code))!==JSON.stringify(x)).map(x=>({before:old.get(x.code)!,after:x}))};
}
export function snapshotDiff(before:OkpdSnapshot,after:OkpdSnapshot){return {...diffRows(before.items,after.items),sections:diffRows(before.sections,after.sections),editionBefore:before.edition,editionAfter:after.edition}}
const editionRank=(value:string)=>{const [number,year]=value.split('/').map(Number);return (year||0)*10000+(number||0)};
export function reviewReasons(diff:ReturnType<typeof snapshotDiff>,current:OkpdSnapshot,inactive:Set<string>){
 const reasons:string[]=[];
 if(diff.removed.length||diff.sections.removed.length)reasons.push('removed_codes_or_sections');
 if(diff.changed.some(x=>x.before.section!==x.after.section||x.before.parentCode!==x.after.parentCode))reasons.push('changed_hierarchy');
 if(diff.added.some(x=>inactive.has(x.code)))reasons.push('reactivated_codes');
 if(current.items.length&&(diff.added.length+diff.removed.length+diff.changed.length)/current.items.length>0.1)reasons.push('large_change');
 if(editionRank(diff.editionAfter)<editionRank(diff.editionBefore))reasons.push('older_edition');
 return reasons;
}
