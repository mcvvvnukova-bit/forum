import {test} from 'node:test';
import assert from 'node:assert/strict';
const path='../src/references/okpd2-model.js';
async function model(){const m=await import(path).catch(()=>({}));assert.equal(typeof m.normalizeSnapshot,'function','OKPD2 normalization is missing');return m;}
import {fixture} from './okpd2-fixture.js';

test('normalization preserves code zeroes, computes required parents, canonicalizes order and rejects malformed hierarchy',async()=>{
 const m=await model(),x=m.normalizeSnapshot(fixture());assert.equal(x.items[1].parentCode,'01');assert.equal(x.items[1].level,2);
 assert.equal(m.snapshotHash(x),m.snapshotHash(m.normalizeSnapshot({...fixture(),items:[...fixture().items].reverse()})));
 assert.throws(()=>m.normalizeSnapshot({...fixture(),items:[{code:'01.11',section:'A',name:'Missing parent'}]}),/parent/i);
 assert.throws(()=>m.normalizeSnapshot({...fixture(),items:[{code:'01.11.111',section:'A',name:'Bad code'}]}),/code/i);
 assert.throws(()=>m.normalizeSnapshot({...fixture(),items:[...fixture().items,fixture().items[0]]}),/Duplicate/i);
});
test('review identifies removals, reactivation, hierarchy changes, large changes and downgraded editions',async()=>{
 const m=await model(),before=m.normalizeSnapshot(fixture()),after=m.normalizeSnapshot(fixture('Root',false));
 assert.ok(m.reviewReasons(m.snapshotDiff(before,after),before,new Set()).includes('removed_codes_or_sections'));
 assert.ok(m.reviewReasons(m.snapshotDiff(after,before),after,new Set(['01.1'])).includes('reactivated_codes'));
 const moved=m.normalizeSnapshot({...fixture(),sections:[{code:'B',name:'Mining'}],items:fixture().items.map(x=>({...x,section:'B'}))});assert.ok(m.reviewReasons(m.snapshotDiff(before,moved),before,new Set()).includes('changed_hierarchy'));
 assert.ok(m.reviewReasons(m.snapshotDiff(before,after),before,new Set()).includes('large_change'));
 const older=m.normalizeSnapshot({...fixture(),edition:'147/2026'});assert.ok(m.reviewReasons(m.snapshotDiff(before,older),before,new Set()).includes('older_edition'));
});
