import {Controller,Get,Post,Inject,Req,Res} from '@nestjs/common';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {AuthRuntime} from '../iam/auth.controller.js';
import {AuthError} from '../iam/auth-error.js';
import {OrganizationStore} from './organization-store.js';
import {validInn} from './inn.js';
@Controller()
export class OrganizationsController {
 constructor(@Inject(AuthRuntime) private readonly runtime:AuthRuntime){}
 private async owner(req:FastifyRequest){
  const token=req.cookies[this.runtime.sessionCookie];
  if(!token||!/^[\w-]{43}$/.test(token)||!this.runtime.store||!this.runtime.pool)throw new AuthError('unauthenticated',401);
  return (await this.runtime.store.session(token)).user.id as string;
 }
 @Get('/api/me/organizations')
 async list(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  try{
   const userId=await this.owner(req),query=new URL(req.url,'http://localhost').searchParams;
   for(const key of query.keys())if(key!=='cursor'||query.getAll(key).length!==1||!query.get(key)||query.get(key)!.length>512)throw new AuthError('invalid_request');
   return reply.send(await new OrganizationStore(this.runtime.pool!).list(userId,query.get('cursor')??undefined));
  }catch(error){return this.failure(reply,error)}
 }
 @Post('/api/me/organizations')
 async add(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  try{
   if(req.headers.origin!==this.runtime.config.publicOrigin)throw new AuthError('invalid_origin',403);
   const userId=await this.owner(req),body=req.body;
   if(new URL(req.url,'http://localhost').search||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('inn' in body)||!validInn(body.inn))throw new AuthError('invalid_request');
   const result=await new OrganizationStore(this.runtime.pool!).add(userId,body.inn);
   return reply.code(result.created?201:200).send({userId,item:result.item});
  }catch(error){return this.failure(reply,error)}
 }
 private failure(reply:FastifyReply,error:unknown){return reply.code(error instanceof AuthError?error.status:503).send({code:error instanceof AuthError?error.code:'temporarily_unavailable'})}
}
