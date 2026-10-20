import {Controller,Get,Post,Inject,Req,Res} from '@nestjs/common';
import type {FastifyReply,FastifyRequest} from 'fastify';
import {AuthRuntime} from '../iam/auth.controller.js';
import {AuthError} from '../iam/auth-error.js';
import {validInn} from './inn.js';
import {VerificationStore,type VerificationProvider,type VerificationMethod} from './verification.js';

export class VerificationRuntime {
 readonly store?:VerificationStore;
 constructor(runtime:AuthRuntime,provider?:VerificationProvider){this.store=runtime.pool?new VerificationStore(runtime.pool,provider):undefined}
}
@Controller()
export class VerificationController {
 constructor(@Inject(AuthRuntime) private readonly runtime:AuthRuntime,@Inject(VerificationRuntime) private readonly verification:VerificationRuntime){}
 private async owner(req:FastifyRequest){
  const token=req.cookies[this.runtime.sessionCookie];
  if(!token||!/^[\w-]{43}$/.test(token)||!this.runtime.store||!this.verification.store)throw new AuthError('unauthenticated',401);
  return (await this.runtime.store.session(token)).user.id as string;
 }
 private enabled(){if(this.runtime.config.organizationVerificationEnabled!==true)throw new AuthError('not_found',404)}
 @Get('/api/me/organizations/verification/options')
 async options(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  try{const userId=await this.owner(req);if(new URL(req.url,'http://localhost').search)throw new AuthError('invalid_request');return reply.send({userId,enabled:this.runtime.config.organizationVerificationEnabled===true})}catch(e){return this.fail(reply,e)}
 }
 @Get('/api/me/organizations/verification')
 async result(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  try{
   const userId=await this.owner(req);this.enabled();const query=new URL(req.url,'http://localhost').searchParams;
   if([...query.keys()].length!==1||!validInn(query.get('inn')))throw new AuthError('invalid_request');
   return reply.send({userId,item:await this.verification.store!.latest(userId,query.get('inn')!)});
  }catch(e){return this.fail(reply,e)}
 }
 @Post('/api/me/organizations/verification')
 async start(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  try{
   if(req.headers.origin!==this.runtime.config.publicOrigin)throw new AuthError('invalid_origin',403);
   const userId=await this.owner(req);this.enabled();const body=req.body as Record<string,unknown>;
   if(new URL(req.url,'http://localhost').search||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='inn,method,requestId'
    ||!validInn(body.inn)||!['diadoc','kep'].includes(String(body.method))||typeof body.requestId!=='string'||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b$/i.test(body.requestId))throw new AuthError('invalid_request');
   const result=await this.verification.store!.start(userId,body.inn,body.method as VerificationMethod,body.requestId);
   return reply.code(result.created?201:200).send({userId,item:result.item});
  }catch(e){return this.fail(reply,e)}
 }
 private fail(reply:FastifyReply,error:unknown){return reply.code(error instanceof AuthError?error.status:503).send({code:error instanceof AuthError?error.code:'temporarily_unavailable'})}
}
