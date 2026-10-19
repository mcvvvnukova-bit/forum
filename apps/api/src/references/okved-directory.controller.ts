import {Controller,Get,Inject,Req,Res} from '@nestjs/common';
import type {FastifyReply,FastifyRequest} from 'fastify';
import {AuthRuntime} from '../iam/auth.controller.js';
import {AuthError} from '../iam/auth-error.js';
import {effectiveRoles,RoleStore} from '../iam/role-store.js';

function filters(url:string){
 const params=new URL(url,'http://localhost').searchParams;
 for(const key of params.keys())if(!['code','name','page'].includes(key)||params.getAll(key).length!==1)throw new AuthError('invalid_request');
 const code=(params.get('code')??'').trim(),name=(params.get('name')??'').trim().normalize('NFC'),page=params.get('page')??'1';
 if(!/^[0-9.]{0,8}$/.test(code)||name.length>250||/[\u0000-\u001f\u007f]/.test(name)||!/^[1-9][0-9]{0,4}$/.test(page)||Number(page)>10000)throw new AuthError('invalid_request');
 return {code,name,page:Number(page)};
}
const literal=(value:string)=>value.replace(/[\\%_]/g,'\\$&');

@Controller('/api/references')
export class OkvedDirectoryController {
 constructor(@Inject(AuthRuntime) private readonly runtime:AuthRuntime){}
 @Get('/okved')
 async list(@Req() request:FastifyRequest,@Res() reply:FastifyReply){
  try{
   const token=request.cookies[this.runtime.sessionCookie];
   if(!token||!/^[\w-]{43}$/.test(token))throw new AuthError('unauthenticated',401);
   if(!this.runtime.pool)throw new AuthError('temporarily_unavailable',503);
   const result=await new RoleStore(this.runtime.pool).read(token,async(client,actor)=>{
    if(!(await effectiveRoles(client,actor.id)).includes('platform_admin'))throw new AuthError('forbidden',403);
    const query=filters(request.url),values=[literal(query.code)+'%','%'+literal(query.name)+'%'];
    const condition="is_active AND okved LIKE $1 ESCAPE '\\' AND name ILIKE $2 ESCAPE '\\'";
    const total=Number((await client.query(`SELECT count(*) AS total FROM public.okveds WHERE ${condition}`,values)).rows[0].total);
    const items=(await client.query(`SELECT okved AS code,name FROM public.okveds WHERE ${condition} ORDER BY okved COLLATE "C" LIMIT 50 OFFSET $3`,[...values,(query.page-1)*50])).rows;
    return {items,total,page:query.page,pageSize:50};
   });
   return reply.code(200).send(result);
  }catch(error){return reply.code(error instanceof AuthError?error.status:503).send({code:error instanceof AuthError?error.code:'temporarily_unavailable'})}
 }
}
