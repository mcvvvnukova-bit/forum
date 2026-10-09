import {Controller,Get,Put,Inject,Logger,Req,Res} from '@nestjs/common';
import type {FastifyReply,FastifyRequest} from 'fastify';
import {AuthRuntime} from './auth.controller.js';
import {AuthError} from './auth-error.js';
import {SettingsStore} from './settings-store.js';

@Controller()
export class SettingsController {
  private readonly logger=new Logger(SettingsController.name);
  private readonly store?:SettingsStore;
  constructor(@Inject(AuthRuntime) private readonly runtime:AuthRuntime){
    this.store=runtime.pool?new SettingsStore(runtime.pool):undefined;
  }
  @Get('/api/settings')
  async read(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
    try{this.query(req);const token=this.token(req);return reply.send(await this.store!.read(token))}
    catch(error){return this.failure(reply,error)}
  }
  @Put('/api/settings')
  async update(@Req() req:FastifyRequest,@Res() reply:FastifyReply){
    try {
      this.query(req);
      if(req.headers.origin!==this.runtime.config.publicOrigin)throw new AuthError('invalid_origin',403);
      const token=this.token(req),body=req.body;
      if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1
        || !('workAsIndividual' in body) || typeof body.workAsIndividual!=='boolean')throw new AuthError('invalid_request',400);
      return reply.send(await this.store!.update(token,body.workAsIndividual));
    } catch(error){return this.failure(reply,error)}
  }
  private query(req:FastifyRequest){if(new URL(req.url,'http://localhost').search)throw new AuthError('invalid_request',400)}
  private token(req:FastifyRequest):string {
    const token=req.cookies[this.runtime.sessionCookie];
    if(!token || !/^[\w-]{43}$/.test(token) || !this.store)throw new AuthError('unauthenticated',401);
    return token;
  }
  private failure(reply:FastifyReply,error:unknown){
    if(error instanceof AuthError)return reply.code(error.status).send({code:error.code});
    this.logger.error({event:'settings_failed',code:'internal_error'});
    return reply.code(503).send({code:'temporarily_unavailable'});
  }
}
