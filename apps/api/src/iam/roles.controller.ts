import {Controller,Get,Post,Patch,Inject,Req,Res,Param} from '@nestjs/common';
import type {FastifyRequest,FastifyReply} from 'fastify';
import {AuthRuntime} from './auth.controller.js';
import {AuthError} from './auth-error.js';
import {hashToken} from './crypto.js';
import {roleCatalogue,type RoleCode} from './role-catalog.js';
import {RoleStore} from './role-store.js';
import {RoleMutations,type MutationRequest,type MutationResult} from './role-mutations.js';
import {bodyValue,contextValue,headerValue,noQuery,pageValue,reasonValue,uuidValue,versionValue} from './role-request.js';

@Controller('/api/iam')
export class RolesController {
 constructor(@Inject(AuthRuntime) private readonly runtime:AuthRuntime){}
 private token(req:FastifyRequest):string{
  const token=req.cookies[this.runtime.sessionCookie];
  if(!token||!/^[\w-]{43}$/.test(token))throw new AuthError('unauthenticated',401);
  if(!this.runtime.pool)throw new AuthError('temporarily_unavailable',503);return token;
 }
 private key(req:FastifyRequest):string{
  const value=headerValue(req,'x-forum-context');if(!value)throw new AuthError('context_required');return contextValue(value);
 }
 private store(){if(!this.runtime.pool)throw new AuthError('temporarily_unavailable',503);return new RoleStore(this.runtime.pool)}
 private async respond(reply:FastifyReply,operation:()=>Promise<unknown>){
  try{return reply.code(200).send(await operation())}catch(error){return this.failure(reply,error)}
 }
 private failure(reply:FastifyReply,error:unknown){return reply.code(error instanceof AuthError?error.status:503)
  .send({code:error instanceof AuthError?error.code:'temporarily_unavailable'})}
 @Get('/roles')
 async roles(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.respond(reply,async()=>{noQuery(req);return this.store().read(this.token(req),async()=>({items:roleCatalogue}))});
 }
 @Get('/contexts')
 async contexts(@Req() req:FastifyRequest,@Res() reply:FastifyReply){return this.respond(reply,()=>this.store().contexts(this.token(req),pageValue(req)))}
 @Post('/context/resolve')
 async resolve(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.respond(reply,()=>{noQuery(req);const input=bodyValue(req.body,['contextKey']);return this.store().resolve(this.token(req),contextValue(input.contextKey))});
 }
 @Get('/platform-users')
 async users(@Req() req:FastifyRequest,@Res() reply:FastifyReply){return this.respond(reply,()=>this.store().platformUsers(this.token(req),this.key(req),pageValue(req)))}
 @Get('/platform-user-access')
 async userAccess(@Req() req:FastifyRequest,@Res() reply:FastifyReply){return this.respond(reply,()=>this.store().userAccess(this.token(req),this.key(req),pageValue(req)))}
 @Get('/organizations/:id/members')
 async members(@Param('id') id:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.respond(reply,()=>this.store().members(this.token(req),this.key(req),uuidValue(id),pageValue(req)));
 }
 @Get('/audit-events')
 async audit(@Req() req:FastifyRequest,@Res() reply:FastifyReply){return this.respond(reply,()=>this.store().audit(this.token(req),this.key(req),pageValue(req)))}
 private request(req:FastifyRequest,update=false,maximumVersion=2147483647):MutationRequest{
  noQuery(req);const token=this.token(req);
  if(headerValue(req,'origin')!==this.runtime.config.publicOrigin)throw new AuthError('invalid_origin',403);
  const contextKey=this.key(req),csrfToken=headerValue(req,'x-forum-csrf');
  if(!csrfToken||!/^[\w-]{43}$/.test(csrfToken))throw new AuthError('invalid_csrf',403);
  const idempotencyKey=headerValue(req,'idempotency-key');if(!idempotencyKey||!/^[\w-]{8,128}$/.test(idempotencyKey))throw new AuthError('invalid_request');
  const match=headerValue(req,'if-match');
  const version=update||match!==undefined?versionValue(match,maximumVersion):undefined;
  // Canonicalize recursively so a JSON property-order change is the same body.
  const requestHash=hashToken(JSON.stringify({method:req.method,path:req.url,contextKey,version,body:canonical(req.body)}));
  return {token,contextKey,csrfToken,idempotencyKey,requestHash,version};
 }
 private async change(reply:FastifyReply,operation:()=>Promise<MutationResult>){
  try{const result=await operation();return reply.code(result.status).send(result.body)}catch(error){return this.failure(reply,error)}
 }
 @Post('/platform-role-assignments')
 async grant(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.change(reply,()=>{
   const request=this.request(req),body=bodyValue(req.body,['targetUserId','roleCode','reason']);
   if(!['platform_admin','platform_moderator'].includes(body.roleCode as string))throw new AuthError('invalid_request');
   return new RoleMutations(this.runtime.pool!).grant(request,{targetUserId:uuidValue(body.targetUserId),roleCode:body.roleCode as RoleCode,reason:reasonValue(body.reason)});
  });
 }
 @Patch('/platform-role-assignments/:id')
 async updatePlatform(@Param('id') id:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.change(reply,()=>{
   const request=this.request(req,true),body=bodyValue(req.body,['status','reason']);
   if(!['active','revoked'].includes(body.status as string))throw new AuthError('invalid_request');
   return new RoleMutations(this.runtime.pool!).updatePlatform(request,uuidValue(id),{status:body.status as 'active'|'revoked',reason:reasonValue(body.reason)});
  });
 }
 @Patch('/platform-user-access/:id')
 async updateUserAccess(@Param('id') id:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.change(reply,()=>{
   const request=this.request(req,true,Number.MAX_SAFE_INTEGER),body=bodyValue(req.body,['status']);
   if(!['active','deactivated'].includes(body.status as string))throw new AuthError('invalid_request');
   return new RoleMutations(this.runtime.pool!).updateUserAccess(request,uuidValue(id),body.status as 'active'|'deactivated');
  });
 }
 @Patch('/organizations/:id/members/:membershipId')
 async updateMember(@Param('id') id:string,@Param('membershipId') membershipId:string,@Req() req:FastifyRequest,@Res() reply:FastifyReply){
  return this.change(reply,()=>{
   const request=this.request(req,true),body=bodyValue(req.body,['roles','status','reason']);
   if(!['active','revoked'].includes(body.status as string)||!Array.isArray(body.roles)||body.roles.length>3||
    body.roles.some(role=>!['organization_employee','organization_admin','organization_signer'].includes(role))||
    new Set(body.roles).size!==body.roles.length||(body.status==='active'&&body.roles.length===0))throw new AuthError('invalid_request');
   return new RoleMutations(this.runtime.pool!).updateMember(request,uuidValue(id),uuidValue(membershipId),{
    roles:body.roles as RoleCode[],status:body.status as 'active'|'revoked',reason:reasonValue(body.reason)});
  });
 }
}
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
 return value;
}
