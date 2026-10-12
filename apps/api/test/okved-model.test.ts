import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSnapshot, snapshotHash, snapshotDiff} from '../src/references/okved-model.js';
import {loadFnsSnapshot} from '../src/references/fns-source.js';

const groups = {groups:[{code:'A',name:'Agriculture',size:2}]};
const rows = {okveds:[
  {code:'01',group:'A',name:'Root',selectable:false},
  {code:'01.1',group:'A',name:'Parent',selectable:false},
  {code:'01.11',group:'A',name:'Child',selectable:true},
  {code:'01.11.1',group:'A',name:'Leaf',selectable:true},
]};

test('size counts selectable codes; hierarchy keeps leading zeros and unselectable parents', () => {
  const s=normalizeSnapshot(rows,groups);
  assert.deepEqual(s.okveds.map(x=>[x.code,x.parentCode,x.level,x.selectable]),[
    ['01',null,1,false],['01.1','01',2,false],['01.11','01.1',3,true],['01.11.1','01.11',4,true],
  ]);
});

test('canonical hash ignores row order and extra source metadata, but observes descriptions', () => {
  const a=normalizeSnapshot(rows,groups);
  const b=normalizeSnapshot({okveds:[...rows.okveds].reverse().map(x=>({...x,license:'ignored'}))},groups);
  assert.equal(snapshotHash(a),snapshotHash(b));
  const c=structuredClone(rows); Object.assign(c.okveds[2],{description:'New explanation'});
  assert.notEqual(snapshotHash(a),snapshotHash(normalizeSnapshot(c,groups)));
});

type MalformedRows={okveds:Record<string,unknown>[]};
type MalformedGroups={groups:Record<string,unknown>[]};
const invalidCases:[string,(r:MalformedRows,g:MalformedGroups)=>unknown][]=[
  ['duplicate codes',(r,g)=>r.okveds.push(r.okveds[0])],
  ['missing parent',(r,g)=>r.okveds.splice(1,1)],
  ['numeric code',(r,g)=>r.okveds[0].code=1],
  ['empty name',(r,g)=>r.okveds[0].name='  '],
  ['unknown section',(r,g)=>r.okveds[0].group='Z'],
  ['inconsistent parent section',(r,g)=>{g.groups.push({code:'B',name:'B',size:0});r.okveds[0].group='B';}],
  ['wrong selectable type',(r,g)=>r.okveds[2].selectable='true'],
  ['incomplete selectable count',(r,g)=>g.groups[0].size=3],
  ['empty snapshot',(r,g)=>r.okveds=[]],
];
for (const [name,mutate] of invalidCases) {
  test(`rejects ${name} before producing a publishable snapshot`,()=>{
    const r=structuredClone(rows),g=structuredClone(groups);mutate(r,g);
    assert.throws(()=>normalizeSnapshot(r,g));
  });
}

test('diff exposes before and after values for review and records removed codes',()=>{
  const a=normalizeSnapshot(rows,groups);
  const r=structuredClone(rows);r.okveds.pop();r.okveds[2].name='Changed';
  const b=normalizeSnapshot(r,{groups:[{code:'A',name:'Agriculture',size:1}]});
  const d=snapshotDiff(a,b);
  assert.deepEqual(d.removed.map(x=>x.code),['01.11.1']);
  assert.equal(d.changed[0].before.name,'Child');assert.equal(d.changed[0].after.name,'Changed');
});

test('FNS transport rejects redirects, oversized bodies and non-JSON HTTP responses',async()=>{
  for (const response of [
    ()=>new Response('redirect',{status:302}),
    ()=>new Response('<html>failure</html>',{headers:{'content-type':'text/html'}}),
    ()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'99999999'}}),
  ]) {
    await assert.rejects(loadFnsSnapshot(async()=>response()));
  }
});

test('FNS source uses fixed official URLs and returns the validated complete tree',async()=>{
  const calls:string[]=[];
  const s=await loadFnsSnapshot(async(url,options)=>{
    calls.push(String(url));assert.equal(options?.redirect,'error');assert.ok(options?.signal);
    return new Response(JSON.stringify(String(url).endsWith('/groups')?groups:rows),{headers:{'content-type':'application/json'}});
  });
  assert.deepEqual(calls.sort(),[
    'https://service.nalog.ru/okved/api/v1/reference/groups',
    'https://service.nalog.ru/okved/api/v1/reference/okveds',
  ]);
  assert.equal(s.okveds.length,4);
});
