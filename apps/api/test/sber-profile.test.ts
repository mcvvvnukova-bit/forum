import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSberProfile} from '../src/iam/sber-profile.js';

test('projects requested Professional fields without private or unmapped attributes',()=>{
  assert.deepEqual(normalizeSberProfile({birthdate:'02.03.2001',is_self_employed:false,sub:'not-public',bank_balance:100},['openid','birthdate','is_self_employed']),{birthdate:'2001-03-02',is_self_employed:false});
  assert.deepEqual(normalizeSberProfile({identification:{series:' 1234 ',number:'567890',issued_date:'29.02.2000',secret:'hidden'},phone_number:' +79000000000 ',family_name:' Name ',address:{city:'Unmapped'}},['openid','maindoc','mobile','name','address']),{identification:{series:'1234',number:'567890',issued_date:'2000-02-29'},phone_number:'+79000000000',family_name:'Name'});
});
test('scope intersection restricts output, including explicit empty grants',()=>{
  const raw={email:'e@example.test',family_name:'Name',birthdate:'not-a-date',phone_number:'number'};
  assert.deepEqual(normalizeSberProfile(raw,['openid','name','email'],['openid','name','mobile']),{family_name:'Name'});
  assert.deepEqual(normalizeSberProfile(raw,['openid','name','email'],[]),{});
  assert.deepEqual(normalizeSberProfile(raw,['openid']),{});
});
test('normalizes valid calendar dates and reviewed object codes',()=>{
  assert.deepEqual(normalizeSberProfile({birthdate:'2024-02-29',education:{code:1,description:' Higher '},priority_doc:{type:' 21 ',issued_date:'01.01.2020'},international_passport:{planned_end_date:'2029-12-31'}},['birthdate','education','priority_doc','international_passport']),{birthdate:'2024-02-29',education:{code:'1',description:'Higher'},priority_doc:{type:'21',issued_date:'2020-01-01'},international_passport:{planned_end_date:'2029-12-31'}});
});
for(const value of ['31.02.2001','2001-02-29','2020-13-01','2020-00-01','2020-01-00','0000-01-01','2001-2-3']) test(`rejects invalid calendar date ${value}`,()=>{
  assert.throws(()=>normalizeSberProfile({birthdate:value},['birthdate']),/invalid_provider_response/);
});
test('preserves explicit null, empty text and false as supplied values',()=>{
  assert.deepEqual(normalizeSberProfile({family_name:' ',birthdate:'',identification:null,education:{description:'',code:null},is_self_employed:false},['name','birthdate','maindoc','education','is_self_employed']),{family_name:null,birthdate:null,identification:null,education:{description:null,code:null},is_self_employed:false});
});
for(const [field,value,scope] of [
  ['family_name',123,'name'],['email','broken','email'],['phone_number',{},'mobile'],['identification',[],'maindoc'],['identification',{number:12},'maindoc'],['identification',{issued_date:'31.04.2020'},'maindoc'],['is_self_employed','false','is_self_employed'],['gender',3,'gender'],['education',{code:{}},'education'],['priority_doc',{type:Infinity},'priority_doc'],
] as const) test(`rejects malformed ${field}: ${JSON.stringify(value)}`,()=>{
  assert.throws(()=>normalizeSberProfile({[field]:value},[scope]),/invalid_provider_response/);
});
test('filters unknown children and inherited/prototype keys',()=>{
  const raw=JSON.parse('{"identification":{"number":"123456","__proto__":{"polluted":true},"constructor":"bad"},"__proto__":{"email":"bad"}}');
  assert.deepEqual(normalizeSberProfile(raw,['maindoc']),{identification:{number:'123456'}});
  assert.deepEqual(normalizeSberProfile(Object.create({family_name:'Inherited'}),['name']),{});
});


test('trims date text before calendar validation',()=>{
  assert.deepEqual(normalizeSberProfile({birthdate:' 02.03.2001 ',identification:{issued_date:' 2020-02-29 '}},['birthdate','maindoc']),{birthdate:'2001-03-02',identification:{issued_date:'2020-02-29'}});
});


test('all-zero provider date placeholders normalize to null',()=>{
  assert.deepEqual(normalizeSberProfile({birthdate:'0000-00-00',identification:{issued_date:'00.00.0000'},international_passport:{planned_end_date:'0000-00-00'}},['birthdate','maindoc','international_passport']),{birthdate:null,identification:{issued_date:null},international_passport:{planned_end_date:null}});
  for(const value of ['0000-00-01','00.01.0000','2000-00-00']) assert.throws(()=>normalizeSberProfile({birthdate:value},['birthdate']),/invalid_provider_response/);
});
test('explicit empty scalar gender and self-employment normalize to null',()=>{
  assert.deepEqual(normalizeSberProfile({gender:' ',is_self_employed:''},['gender','is_self_employed']),{gender:null,is_self_employed:null});
  assert.deepEqual(normalizeSberProfile({gender:'',is_self_employed:'  '},['gender','is_self_employed']),{gender:null,is_self_employed:null});
});
