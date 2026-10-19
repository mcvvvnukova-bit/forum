import {AuthError} from '../iam/auth-error.js';

// Identifiers are owned by code. Request values never become SQL identifiers.
export const managedReferences={
 'regions':{table:'regions',description:false,symbol:false,numeric:true},
 'offer-types':{table:'offer_types',description:true,symbol:false,numeric:false},
 'business-segments':{table:'business_segments',description:true,symbol:false,numeric:false},
 'commercial-roles':{table:'commercial_roles',description:true,symbol:false,numeric:false},
 'units':{table:'units',description:true,symbol:true,numeric:false},
 'rejection-reasons':{table:'moderation_reasons',description:true,symbol:false,numeric:false},
 'company-statuses':{table:'company_statuses',description:false,symbol:false,numeric:false},
} as const;
export type ManagedKind=keyof typeof managedReferences;
export type ReferenceValue={code:string;name:string;description:string|null;symbol:string|null;version:number};
export type ReferenceInput={code?:string;name:string;description?:string|null;symbol?:string|null};
export type ReferenceQuery={code:string;name:string;page:number};
export function managedKind(value:string):ManagedKind{
 if(!Object.hasOwn(managedReferences,value))throw new AuthError('not_found',404);return value as ManagedKind;
}
export function textValue(value:unknown,max:number,required=false,multiline=false):string{
 if(typeof value!=='string'||value.length>max||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value))throw new AuthError('invalid_request');
 const result=value.normalize('NFC').trim();if(required&&!result)throw new AuthError('invalid_request');return result;
}
export function referenceCode(kind:ManagedKind,value:unknown):string{
 if(typeof value!=='string'||!(managedReferences[kind].numeric?/^(0[1-9]|[1-9][0-9])$/:/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/).test(value))throw new AuthError('invalid_request');
 return value;
}
export function referenceInput(kind:ManagedKind,value:unknown,create:boolean):ReferenceInput{
 const schema=managedReferences[kind],allowed=['name',...(create?['code']:[]),...(schema.description?['description']:[]),...(schema.symbol?['symbol']:[])];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new AuthError('invalid_request');
 const body=value as Record<string,unknown>,result:ReferenceInput={name:textValue(body.name,250,true)};
 if(create)result.code=referenceCode(kind,body.code);
 for(const key of ['description','symbol'] as const)if(schema[key])result[key]=body[key]===undefined||body[key]===null?null:textValue(body[key],key==='symbol'?32:1000,false,key==='description')||null;
 return result;
}
export function referenceQuery(url:string):ReferenceQuery{
 const params=new URL(url,'http://localhost').searchParams;
 for(const key of params.keys())if(!['code','name','page'].includes(key)||params.getAll(key).length!==1)throw new AuthError('invalid_request');
 const page=params.get('page')??'1';if(!/^[1-9][0-9]{0,4}$/.test(page)||Number(page)>10000)throw new AuthError('invalid_request');
 return {code:textValue(params.get('code')??'',64),name:textValue(params.get('name')??'',250),page:Number(page)};
}
