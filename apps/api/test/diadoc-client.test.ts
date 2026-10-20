import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {startDiadocSimulator} from './fixtures/diadoc-simulator.js';
import {DiadocClient} from '../src/organizations/diadoc-client.js';

const inn='9709128511',box='11111111-1111-4111-8111-111111111111';
let simulator:Awaited<ReturnType<typeof startDiadocSimulator>>,base:string,scenario='ok';const requests:string[]=[];
before(async()=>{simulator=await startDiadocSimulator();base=simulator.url});
after(async()=>{await simulator.close()});
const transport:typeof fetch=(input,options)=>{
 const url=new URL(String(input));assert.equal(url.origin,'https://diadoc-api-staging.kontur.ru');
 assert.equal(options?.method,'GET');assert.equal(options?.redirect,'manual');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer synthetic-token');requests.push(url.pathname+url.search);
 return fetch(base+url.pathname+url.search,options);
};
function client(){simulator.setScenario(scenario);return new DiadocClient('staging','synthetic-token',transport)}
test('real HTTP adapter checks existing employee using BoxIdGuid and never produces legal permission',async()=>{
 scenario='ok';requests.length=0;const result=await client().verify(inn);
 assert.equal(result.status,'access_confirmed');assert.equal(result.source,'diadoc_staging');
 assert.equal(result.evidence?.requisites?.name,'Тестовая компания');assert.equal(result.evidence?.requisites?.boxId,box);
 assert.deepEqual(result.evidence?.permissions,{isAdministrator:true,canSignDocuments:true,documentAccessLevel:'AllDocuments'});
 assert.deepEqual(requests,['/GetMyOrganizations?autoRegister=false','/GetMyEmployee?boxId='+box]);assert.ok(!JSON.stringify(result).includes('private@example.test'));
});
for(const mode of ['certificate_only','other_inn','multiple'])test('does not probe arbitrary boxes for '+mode,async()=>{
 scenario=mode;requests.length=0;const result=await client().verify(inn);
 assert.equal(result.status,mode==='multiple'?'selection_required':'access_denied');assert.equal(requests.length,1);
});
for(const mode of ['blocked','unknown_block','malformed'])test('never confirms uncertain or blocked response '+mode,async()=>{
 scenario=mode;const result=await client().verify(inn);assert.notEqual(result.status,'access_confirmed');
});
for(const [status,expected] of [[401,'connection_required'],[402,'unavailable'],[403,'access_denied'],[404,'access_denied'],[409,'unavailable'],[500,'unavailable']] as const)test('maps HTTP '+status+' without disclosing upstream bodies',async()=>{
 scenario='http'+status;const result=await client().verify(inn);assert.equal(result.status,expected);assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPOSE'));
});
test('refuses redirects and bounds network waits',async()=>{
 scenario='redirect';assert.equal((await client().verify(inn)).status,'unavailable');
 const never:typeof fetch=async(_input,options)=>new Promise((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(new Error('secret')),{once:true})});
 assert.equal((await new DiadocClient('staging','synthetic-token',never,25).verify(inn)).reason,'provider_unavailable');
});
test('an interrupted response body returns unavailable without an unhandled cleanup rejection',async()=>{
 const errors:unknown[]=[],listener=(error:unknown)=>{errors.push(error)};process.on('unhandledRejection',listener);
 try{
  const broken:typeof fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));queueMicrotask(()=>controller.error(new Error('upstream-body-failed')))}}));
  assert.equal((await new DiadocClient('staging','synthetic-token',broken).verify(inn)).status,'unavailable');
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(errors,[]);
 }finally{process.off('unhandledRejection',listener)}
});
