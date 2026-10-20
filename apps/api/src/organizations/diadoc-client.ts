import type {VerificationResult} from './verification.js';
import {validInn} from './inn.js';
type Json=Record<string,unknown>;
function object(value:unknown):Json{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid response');return value as Json}
function text(value:unknown,max=512):string{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('Invalid response');return value}
function guid(value:unknown){const s=text(value,36);if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s))throw new Error('Invalid GUID');return s}
class HttpFailure extends Error{constructor(readonly status:number){super('Provider request failed')}}
// The provider boundary is deliberately unconfigured until personal OIDC linking is available.
export class DiadocClient {
 constructor(private readonly environment:'staging'|'production',private readonly token:string,private readonly transport:typeof fetch=fetch,private readonly timeoutMs=8000){
  if(!['staging','production'].includes(environment)||!token||/[\r\n]/.test(token)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000)throw new Error('Invalid Diadoc configuration');
 }
 private async request(path:string,signal:AbortSignal):Promise<Json>{
  const base=this.environment==='staging'?'https://diadoc-api-staging.kontur.ru':'https://diadoc-api.kontur.ru';
  const response=await this.transport(base+path,{method:'GET',headers:{Authorization:'Bearer '+this.token,Accept:'application/json'},redirect:'manual',signal});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new HttpFailure(response.status)}
  if(!response.body)throw new Error('Empty response');
  const reader=response.body.getReader(),decoder=new TextDecoder();let content='',bytes=0;
  try{
   for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>2_000_000)throw new Error('Oversized response');content+=decoder.decode(chunk.value,{stream:true})}
   content+=decoder.decode();return object(JSON.parse(content));
  }finally{await reader.cancel().catch(()=>{})}
 }
 async verify(inn:string):Promise<VerificationResult>{
  if(!validInn(inn))throw new Error('Invalid INN');
  const source=this.environment==='staging'?'diadoc_staging':'diadoc_production';
  const result=(status:VerificationResult['status'],reason:string):VerificationResult=>({status,source,reason});
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),this.timeoutMs);
  try{
   // This can still register an organization by certificate; production use awaits vendor confirmation.
   const own=await this.request('/GetMyOrganizations?autoRegister=false',abort.signal);
   if(!Array.isArray(own.Organizations))throw new Error('Invalid organizations');
   const matches=own.Organizations.map(object).filter(org=>org.Inn===inn&&org.IsEmployee===true);
   if(!matches.length)return result('access_denied','not_employee');
   if(matches.length!==1)return result('selection_required','multiple_organizations');
   const org=matches[0];if(!Array.isArray(org.Boxes)||!org.Boxes.length)throw new Error('Invalid boxes');
   if(org.Boxes.length!==1)return result('selection_required','multiple_boxes');
   const boxId=guid(object(org.Boxes[0]).BoxIdGuid),orgId=guid(org.OrgId),name=text(org.FullName);
   const employee=await this.request('/GetMyEmployee?boxId='+encodeURIComponent(boxId),abort.signal);
   const user=object(employee.User),permissions=object(employee.Permissions);
   if(user.IsRegistered!==true)return result('access_denied','unregistered_employee');
   guid(user.UserId);
   const authorization=object(permissions.AuthorizationPermission);
   if(authorization.IsBlocked===true)return result('access_denied','blocked');
   if(authorization.IsBlocked!==false||typeof permissions.IsAdministrator!=='boolean'||!Array.isArray(permissions.Actions))throw new Error('Unknown permissions');
   const signing=permissions.Actions.map(object).filter(action=>action.Name==='SignDocuments');
   if(signing.length!==1||typeof signing[0].IsAllowed!=='boolean')throw new Error('Unknown signing permission');
   const kpp=org.Kpp===undefined||org.Kpp===''?undefined:text(org.Kpp,9),ogrn=org.Ogrn===undefined||org.Ogrn===''?undefined:text(org.Ogrn,15);
   if((kpp&&!/^\d{9}$/.test(kpp))||(ogrn&&!/^\d{13,15}$/.test(ogrn)))throw new Error('Invalid requisites');
   return {...result('access_confirmed','employee_access'),evidence:{requisites:{inn,name,orgId,boxId,...(kpp?{kpp}:{}),...(ogrn?{ogrn}:{})},permissions:{
    isAdministrator:permissions.IsAdministrator,canSignDocuments:signing[0].IsAllowed,documentAccessLevel:text(permissions.DocumentAccessLevel,64)}}};
  }catch(error){
   if(error instanceof HttpFailure){
    if(error.status===401)return result('connection_required','reauthentication_required');
    if(error.status===402)return result('unavailable','api_subscription_required');
    if(error.status===403||error.status===404)return result('access_denied',error.status===403?'forbidden':'not_employee');
    if(error.status===409||error.status===429)return result('unavailable','rate_limited');
   }
   return result('unavailable','provider_unavailable');
  }finally{clearTimeout(timer)}
 }
}
