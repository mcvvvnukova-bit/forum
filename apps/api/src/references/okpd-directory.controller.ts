import {Controller,Get,Inject,Req,Res} from '@nestjs/common';
import type {FastifyReply,FastifyRequest} from 'fastify';
import {AuthRuntime} from '../iam/auth.controller.js';
import {AuthError} from '../iam/auth-error.js';
import {effectiveRoles,RoleStore} from '../iam/role-store.js';

function filters(url:string){
 const params=new URL(url,'http://localhost').searchParams;
 for(const key of params.keys())if(!['code','name','page'].includes(key)||params.getAll(key).length!==1)throw new AuthError('invalid_request');
 const code=(params.get('code')??'').trim(),name=(params.get('name')??'').trim().normalize('NFC'),page=params.get('page')??'1';
 if(!/^[0-9.]{0,12}$/.test(code)||name.length>250||/[\u0000-\u001f\u007f]/.test(name)||!/^[1-9][0-9]{0,4}$/.test(page)||Number(page)>10000)throw new AuthError('invalid_request');
 return {code,name,page:Number(page)};
}
const literal=(value:string)=>value.replace(/[\\%_]/g,'\\$&');

@Controller('/api/references')
export class OkpdDirectoryController {
 constructor(@Inject(AuthRuntime) private readonly runtime:AuthRuntime){}
 @Get('/okpd')
 async list(@Req() request:FastifyRequest,@Res() reply:FastifyReply){
  try{
   const token=request.cookies[this.runtime.sessionCookie];
   if(!token||!/^[\w-]{43}$/.test(token))throw new AuthError('unauthenticated',401);
   if(!this.runtime.pool)throw new AuthError('temporarily_unavailable',503);
   const result=await new RoleStore(this.runtime.pool).read(token,async(client,actor)=>{
    if(!(await effectiveRoles(client,actor.id)).includes('platform_admin'))throw new AuthError('forbidden',403);
    const query=filters(request.url),values=[literal(query.code)+'%','%'+literal(query.name)+'%'];
    const condition="is_active AND okpd LIKE $1 ESCAPE '\\' AND name ILIKE $2 ESCAPE '\\'";
    const total=Number((await client.query(`SELECT count(*) AS total FROM public.okpds WHERE ${condition}`,values)).rows[0].total);
    const items=(await client.query(`SELECT okpd AS code,name FROM public.okpds WHERE ${condition} ORDER BY okpd COLLATE "C" LIMIT 50 OFFSET $3`,[...values,(query.page-1)*50])).rows;
    const state=(await client.query("SELECT revision,source_metadata,last_checked_at FROM public.okpd_reference_state WHERE id='okpd2'")).rows[0];
    if(!state||state.revision==='0'||!state.source_metadata||!state.last_checked_at)throw new AuthError('temporarily_unavailable',503);
    const {edition,publishedDate,url}=state.source_metadata;
    return {items,total,page:query.page,pageSize:50,source:{edition,publishedDate,url,checkedAt:state.last_checked_at.toISOString()}};
   });
   return reply.code(200).send(result);
  }catch(error){return reply.code(error instanceof AuthError?error.status:503).send({code:error instanceof AuthError?error.code:'temporarily_unavailable'})}
 }
}
