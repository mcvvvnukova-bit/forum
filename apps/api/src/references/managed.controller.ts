import {Controller,Get,Post,Patch,Delete,Inject,Req,Res,Param} from '@nestjs/common';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {AuthRuntime} from '../iam/auth.controller.js';
import {AuthError} from '../iam/auth-error.js';
import {hashToken} from '../iam/crypto.js';
import {headerValue,noQuery,versionValue} from '../iam/role-request.js';
import {managedKind,referenceCode,referenceInput,referenceQuery} from './managed-model.js';
import {ManagedReferenceStore} from './managed-store.js';

@Controller('/api/references/managed')
export class ManagedReferenceController{
 constructor(@Inject(AuthRuntime) private readonly runtime:AuthRuntime){}
 private token(req:FastifyRequest){
  const token=req.cookies[this.runtime.sessionCookie];if(!token||!/^[\w-]{43}$/.test(token))throw new AuthError('unauthenticated',401);
  if(!this.runtime.pool)throw new AuthError('temporarily_unavailable',503);return token;
 }
 private store(){if(!this.runtime.pool)throw new AuthError('temporarily_unavailable',503);return new ManagedReferenceStore(this.runtime.pool)}
 private async respond(reply:FastifyReply,operation:()=>Promise<{status:number;body:unknown}>){
  try{const r=await operation();return reply.code(r.status).send(r.body)}catch(e){return reply.code(e instanceof AuthError?e.status:503).send({code:e instanceof AuthError?e.code:'temporarily_unavailable'})}
 }
 @Get('/:dictionary')
 async list(@Param('dictionary') dictionary:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.respond(reply,async()=>({status:200,body:await this.store().list(this.token(req),managedKind(dictionary),referenceQuery(req.url))}));
 }
 @Get('/:dictionary/:code')
 async detail(@Param('dictionary') dictionary:string,@Param('code') code:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.respond(reply,async()=>{noQuery(req);const kind=managedKind(dictionary);return {status:200,body:await this.store().detail(this.token(req),kind,referenceCode(kind,code))}});
 }
 private mutate(req:FastifyRequest,dictionary:string,operation:'create'|'edit'|'delete',rawCode?:string){
  noQuery(req);const token=this.token(req),kind=managedKind(dictionary);
  if(headerValue(req,'origin')!==this.runtime.config.publicOrigin)throw new AuthError('invalid_origin',403);
  const csrfToken=headerValue(req,'x-forum-csrf');if(!csrfToken||!/^[\w-]{43}$/.test(csrfToken))throw new AuthError('invalid_csrf',403);
  const idempotencyKey=headerValue(req,'idempotency-key');if(!idempotencyKey||!/^[\w-]{8,128}$/.test(idempotencyKey))throw new AuthError('invalid_request');
  const version=operation==='create'?undefined:versionValue(headerValue(req,'if-match'));
  if(operation==='create'&&headerValue(req,'if-match')!==undefined)throw new AuthError('invalid_request');
  if(operation==='delete'&&req.body!==undefined)throw new AuthError('invalid_request');
  const input=operation==='delete'?undefined:referenceInput(kind,req.body,operation==='create');
  const code=operation==='create'?input!.code!:referenceCode(kind,rawCode);
  const requestHash=hashToken(JSON.stringify({operation,kind,code,version,input}));
  return this.store().change({token,contextKey:'platform',csrfToken,idempotencyKey,requestHash,version},kind,operation,code,input);
 }
 @Post('/:dictionary')
 async create(@Param('dictionary') dictionary:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){return this.respond(reply,()=>this.mutate(req,dictionary,'create'))}
 @Patch('/:dictionary/:code')
 async edit(@Param('dictionary') dictionary:string,@Param('code') code:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){return this.respond(reply,()=>this.mutate(req,dictionary,'edit',code))}
 @Delete('/:dictionary/:code')
 async remove(@Param('dictionary') dictionary:string,@Param('code') code:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){return this.respond(reply,()=>this.mutate(req,dictionary,'delete',code))}
}
