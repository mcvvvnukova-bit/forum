import {createHash} from 'node:crypto';

export interface OkvedGroup {code:string; name:string; size:number}
export interface OkvedCode {
  code:string; group:string; name:string; description:string; selectable:boolean;
  parentCode:string|null; level:number;
}
export interface OkvedSnapshot {groups:OkvedGroup[]; okveds:OkvedCode[]}
export interface SnapshotDiff {
  added:OkvedCode[]; removed:OkvedCode[]; changed:{before:OkvedCode; after:OkvedCode}[];
  groups:{added:OkvedGroup[]; removed:OkvedGroup[]; changed:{before:OkvedGroup;after:OkvedGroup}[]};
}

function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('FNS object expected');
  return value as Record<string,unknown>;
}
function text(value:unknown,max:number):string {
  if (typeof value!=='string' || !value.trim() || value.length>max || value.includes('\0')) throw new Error('Invalid FNS text');
  return value.trim();
}
function list(value:unknown):unknown[] {
  if (!Array.isArray(value) || !value.length || value.length>20_000) throw new Error('Invalid FNS list');
  return value;
}
const order=(a:{code:string},b:{code:string})=>a.code<b.code?-1:a.code>b.code?1:0;

export function normalizeSnapshot(codesPayload:unknown,groupsPayload:unknown):OkvedSnapshot {
  const groups=list(object(groupsPayload).groups).map(value=>{
    const g=object(value),code=text(g.code,1),name=text(g.name,2000);
    if (!/^[A-U]$/.test(code) || !Number.isSafeInteger(g.size) || (g.size as number)<0) throw new Error('Invalid FNS group');
    return {code,name,size:g.size as number};
  }).sort(order);
  const sections=new Map(groups.map(g=>[g.code,g]));
  if (sections.size!==groups.length) throw new Error('Duplicate FNS group');
  const okveds=list(object(codesPayload).okveds).map(value=>{
    const r=object(value),code=text(r.code,8),group=text(r.group,1),name=text(r.name,4000);
    if (!/^\d{2}(?:\.\d{1,2}|\.\d{2}\.\d{1,2})?$/.test(code) || !sections.has(group)) throw new Error('Invalid OKVED code or group');
    if (r.selectable!==undefined && typeof r.selectable!=='boolean') throw new Error('Invalid selectable flag');
    if (r.description!==undefined && (typeof r.description!=='string' || r.description.length>100_000 || r.description.includes('\0'))) throw new Error('Invalid description');
    const parentCode=code.length===2?null:([5,8].includes(code.length)?code.slice(0,-1):code.slice(0,code.lastIndexOf('.')));
    const level=({2:1,4:2,5:3,7:4,8:5} as Record<number,number>)[code.length];
    if (!level) throw new Error('Invalid OKVED depth');
    return {code,group,name,description:(r.description as string|undefined)?.trim()??'',selectable:r.selectable===true,parentCode,level};
  }).sort(order);
  const byCode=new Map(okveds.map(r=>[r.code,r]));
  if (byCode.size!==okveds.length) throw new Error('Duplicate OKVED code');
  for (const r of okveds) {
    if (r.parentCode && byCode.get(r.parentCode)?.group!==r.group) throw new Error('Missing or inconsistent OKVED parent');
  }
  for (const g of groups) {
    if (okveds.filter(r=>r.group===g.code && r.selectable).length!==g.size) throw new Error('Incomplete FNS group');
  }
  return {groups,okveds};
}

export function snapshotHash(snapshot:OkvedSnapshot):string {
  return createHash('sha256').update(JSON.stringify({
    groups:[...snapshot.groups].sort(order).map(g=>[g.code,g.name,g.size]),
    okveds:[...snapshot.okveds].sort(order).map(r=>[r.code,r.group,r.name,r.description,r.selectable,r.parentCode,r.level]),
  })).digest('hex');
}

function diffRows<T extends {code:string}>(before:T[],after:T[]) {
  const old=new Map(before.map(x=>[x.code,x])),next=new Map(after.map(x=>[x.code,x]));
  return {added:after.filter(x=>!old.has(x.code)),removed:before.filter(x=>!next.has(x.code)),
    changed:after.filter(x=>old.has(x.code) && JSON.stringify(old.get(x.code))!==JSON.stringify(x)).map(x=>({before:old.get(x.code)!,after:x}))};
}
export function snapshotDiff(before:OkvedSnapshot,after:OkvedSnapshot):SnapshotDiff {
  return {...diffRows(before.okveds,after.okveds),groups:diffRows(before.groups,after.groups)};
}

export function reviewReasons(diff:SnapshotDiff,current:OkvedSnapshot,inactive:Set<string>):string[] {
  const reasons:string[]=[];
  if (diff.removed.length || diff.groups.removed.length) reasons.push('removed_codes_or_groups');
  if (diff.changed.some(x=>x.before.group!==x.after.group || x.before.parentCode!==x.after.parentCode)) reasons.push('changed_hierarchy');
  if (diff.added.some(x=>inactive.has(x.code))) reasons.push('reactivated_codes');
  if (current.okveds.length && (diff.added.length+diff.removed.length+diff.changed.length)/current.okveds.length>0.1) reasons.push('large_change');
  return reasons;
}
