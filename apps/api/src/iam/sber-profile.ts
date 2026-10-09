import {AuthError} from './auth-error.js';
import {canonicalProfileFields, type PersonProfile} from './person-profile.js';

// Only documented Sber scopes map to canonical fields. Generic address has no
// approved mapping; a response or an invented scope cannot make it public.
const scopeForField:Partial<Record<typeof canonicalProfileFields[number],string>> = {
  email:'email',phone_number:'mobile',birthdate:'birthdate',family_name:'name',given_name:'name',middle_name:'name',gender:'gender',
  identification:'maindoc',inn:'inn',snils:'snils',driving_license:'driving_license',international_passport:'international_passport',priority_doc:'priority_doc',
  citizenship:'citizenship',place_of_birth:'place_of_birth',address_reg:'address_reg',work_address:'work_address',address_of_actual_residence:'address_of_actual_residence',delivery_address:'delivery_address',
  sts:'sts',previous_identification:'previous_identification',previous_family_name:'previous_name',previous_given_name:'previous_name',previous_middle_name:'previous_name',
  education:'education',place_of_work:'place_of_work',job_title:'job_title',marital_status:'marital_status',is_self_employed:'is_self_employed',
};
const documentChildren=['series','number','issued_by','issued_date','code'];
const addressChildren=['full_address','fias_code','post_index','country','region','district','city','settlement','street','house','building','bulk','apartment'];
const objectChildren:Record<string,readonly string[]> = {
  identification:documentChildren,previous_identification:documentChildren,
  international_passport:['series','number','issued_by','issued_date','planned_end_date','name','surname'],
  priority_doc:['type',...documentChildren],inn:['number'],snils:['number'],driving_license:['number'],sts:['number'],
  citizenship:['country_code','country_name'],education:['code','description'],marital_status:['code','description'],
  address_reg:addressChildren,work_address:addressChildren,address_of_actual_residence:addressChildren,delivery_address:addressChildren,
};
function invalid():never {throw new AuthError('invalid_provider_response',502);}
function text(value:unknown,max=4096):string|null {
  if(value===null) return null;
  if(typeof value!=='string' || value.length>max) invalid();
  return value.trim() || null;
}
function date(value:unknown):string|null {
  const normalized=text(value);
  if(normalized===null || normalized==='0000-00-00' || normalized==='00.00.0000') return null;
  const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const local=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(normalized);
  if(!iso && !local) invalid();
  const [year,month,day]=iso ? [Number(iso[1]),Number(iso[2]),Number(iso[3])] : [Number(local![3]),Number(local![2]),Number(local![1])];
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1 || month<1 || month>12 || day<1 || day>days[month-1]) invalid();
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function object(value:unknown,field:string):Record<string,unknown>|null {
  if(value===null) return null;
  if(typeof value!=='object' || Array.isArray(value)) invalid();
  const raw=value as Record<string,unknown>, normalized:Record<string,unknown>={};
  for(const child of objectChildren[field]) {
    if(!Object.hasOwn(raw,child)) continue;
    const v=raw[child];
    if(child==='issued_date' || child==='planned_end_date') normalized[child]=date(v);
    else if((child==='code' && ['education','marital_status'].includes(field)) || (child==='type' && field==='priority_doc')) {
      if(typeof v==='number') {if(!Number.isSafeInteger(v)) invalid();normalized[child]=String(v);}
      else normalized[child]=text(v,128);
    } else normalized[child]=text(v);
  }
  return normalized;
}

export function normalizeSberProfile(profile:Record<string,unknown>,requestedScopes:readonly string[],grantedScopes?:readonly string[]):PersonProfile {
  const granted=grantedScopes===undefined ? undefined : new Set(grantedScopes);
  const allowed=new Set(requestedScopes.filter(scope=>granted===undefined || granted.has(scope)));
  const normalized:PersonProfile={};
  for(const field of canonicalProfileFields) {
    const scope=scopeForField[field];
    if(!scope || !allowed.has(scope) || !Object.hasOwn(profile,field)) continue;
    const value=profile[field];
    if(Object.hasOwn(objectChildren,field)) normalized[field]=object(value,field);
    else if(field==='birthdate') normalized[field]=date(value);
    else if(field==='is_self_employed') {if(value===null || (typeof value==='string' && !value.trim())) normalized[field]=null;
      else {if(typeof value!=='boolean') invalid();normalized[field]=value;}}
    else if(field==='gender') {
      if(value===null || (typeof value==='string' && !value.trim())) normalized[field]=null;
      else if(value===1 || value===2 || value==='1' || value==='2') normalized[field]=Number(value);
      else invalid();
    } else {
      const limit=field==='email'?254:field==='phone_number'?64:field.endsWith('name')?128:4096;
      normalized[field]=text(value,limit);
      if(field==='email' && normalized[field]!==null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized[field] as string)) invalid();
    }
  }
  return normalized;
}
