import type {FastifyRequest} from 'fastify';
import {AuthError} from './auth-error.js';

export function uuidValue(value:unknown):string{
 if(typeof value!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(value))throw new AuthError('invalid_request');
 return value;
}
export function contextValue(value:unknown):string{
 if(typeof value!=='string')throw new AuthError('invalid_request');
 if(value==='platform')return value;
 if(!/^(person|organization):/.test(value))throw new AuthError('invalid_request');
 uuidValue(value.split(':')[1]);if(value.split(':').length!==2)throw new AuthError('invalid_request');return value;
}
export function bodyValue(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||
  Object.keys(value).some(key=>!keys.includes(key)))throw new AuthError('invalid_request');
 return value as Record<string,unknown>;
}
export function reasonValue(value:unknown):string{
 if(typeof value!=='string'||value.length>1000||!value.trim()||value!==value.trim()||/[\u0000-\u001f]/.test(value))throw new AuthError('invalid_request');
 return value;
}
export function headerValue(req:FastifyRequest,key:string):string|undefined{
 const value=req.headers[key];if(value===undefined)return undefined;
 if(typeof value!=='string'||value.includes(','))throw new AuthError('invalid_request');return value;
}
export function versionValue(value:string|undefined):number{
 if(!value||!/^"[1-9][0-9]*"$/.test(value))throw new AuthError('invalid_request');
 const version=Number(value.slice(1,-1));if(!Number.isSafeInteger(version)||version>2147483647)throw new AuthError('invalid_request');return version;
}
export type PageRequest={limit:number;cursor?:string};
export function pageValue(req:FastifyRequest):PageRequest{
 const query=new URL(req.url,'http://localhost').searchParams;
 for(const key of query.keys())if(!['limit','cursor'].includes(key)||query.getAll(key).length!==1)throw new AuthError('invalid_request');
 const size=query.get('limit');if(size!==null&&!/^[1-9][0-9]{0,2}$/.test(size))throw new AuthError('invalid_request');
 const limit=size===null?25:Number(size);if(limit>100)throw new AuthError('invalid_request');
 const cursor=query.get('cursor')??undefined;
 if(cursor!==undefined&&(!cursor||cursor.length>2048||!/^[\w-]+$/.test(cursor)))throw new AuthError('invalid_request');
 return {limit,cursor};
}
export function noQuery(req:FastifyRequest):void{
 if(new URL(req.url,'http://localhost').search)throw new AuthError('invalid_request');
}
