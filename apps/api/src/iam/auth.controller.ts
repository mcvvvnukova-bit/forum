import {Controller, Get, Post, Inject, Logger, Req, Res} from '@nestjs/common';
import type {FastifyRequest, FastifyReply} from 'fastify';
import type {Pool} from 'pg';
import type {ApiConfig} from '../config.js';
import {AuthStore} from './auth-store.js';
import {AuthError} from './auth-error.js';
import {SberClient} from './sber-client.js';
import {randomToken} from './crypto.js';

export class AuthRuntime {
  readonly store?: AuthStore;
  readonly sber?: SberClient;
  readonly sessionCookie: string;
  readonly attemptCookie: string;
  constructor(readonly config: ApiConfig, readonly pool?: Pool, private readonly ownsPool = false) {
    this.store = pool ? new AuthStore(pool) : undefined;
    this.sber = config.sber ? new SberClient(config.sber) : undefined;
    const prefix = config.secureCookies ? '__Host-' : '';
    this.sessionCookie = `${prefix}forum_session`;
    this.attemptCookie = `${prefix}sber_attempt`;
  }
  async onModuleDestroy() { this.sber?.close(); if (this.ownsPool) await this.pool?.end(); }
}

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(@Inject(AuthRuntime) private readonly runtime: AuthRuntime) {}

  @Get('/auth/sber-id/start')
  async start(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      if (req.method !== 'GET') throw new AuthError('method_not_allowed', 405);
      const query = parameters(req, ['intent', 'subject']);
      const intent = query.get('intent') ?? 'login';
      if (!['register', 'login'].includes(intent) || (query.has('subject') && query.get('subject') !== 'individual')) {
        throw new AuthError('invalid_request');
      }
      const {sber, store} = this.available();
      const state = randomToken(), browser = randomToken(), nonce = randomToken(), verifier = randomToken();
      await store.start(state, browser, nonce, verifier, intent as 'register' | 'login');
      this.setCookie(reply, this.runtime.attemptCookie, browser, 600);
      return reply.redirect(sber.authorizeUrl(state, nonce, verifier), 303);
    } catch (error) {
      if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
        return reply.redirect(`/?auth_error=${encodeURIComponent(this.errorCode(error))}`, 303);
      }
      return this.failure(reply, error);
    }
  }

  @Get(['/auth/sber-id/callback', '/authorization', '/'])
  async callback(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const url = new URL(req.url, this.runtime.config.publicOrigin);
    const callbackPath = this.runtime.config.sber
      ? new URL(this.runtime.config.sber.redirectUri).pathname : '/auth/sber-id/callback';
    if (url.pathname !== callbackPath || (url.pathname === '/'
      && !(url.searchParams.has('state') && (url.searchParams.has('code') || url.searchParams.has('error'))))) {
      return reply.code(404).send({code: 'not_found'});
    }
    if (req.method !== 'GET') return reply.code(405).send({code: 'method_not_allowed'});
    try {
      const {sber, store} = this.available();
      const query = parameters(req, ['code', 'state', 'error', 'error_description', 'error_uri']);
      const state = query.get('state');
      const browser = req.cookies[this.runtime.attemptCookie];
      if (!state || !browser || !/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(browser)) throw new AuthError('invalid_state');
      const attempt = await store.consume(state, browser);
      if (query.has('error')) throw new AuthError(query.get('error') === 'access_denied' ? 'access_denied' : 'provider_unavailable');
      const code = query.get('code');
      if (!code || code.length > 512 || /\s/.test(code)) throw new AuthError('invalid_request');
      const {identity, accessToken, rquid} = await sber.identify(code, attempt.nonce, attempt.code_verifier);
      const session = randomToken();
      await store.authenticate(identity, attempt.intent, session, this.runtime.config.sessionTtlSeconds,
        req.cookies[this.runtime.sessionCookie]);
      if (!await sber.complete(accessToken, rquid)) this.logger.warn({event: 'sber_completion_failed'});
      this.setCookie(reply, this.runtime.sessionCookie, session, this.runtime.config.sessionTtlSeconds);
      this.setCookie(reply, this.runtime.attemptCookie, '', 0);
      return reply.redirect('/cabinet/?auth=success', 303);
    } catch (error) {
      this.setCookie(reply, this.runtime.attemptCookie, '', 0);
      const code = this.errorCode(error);
      if (code === 'account_deactivated') {
        const oldToken = req.cookies[this.runtime.sessionCookie];
        if (oldToken && this.runtime.store) {
          try { await this.runtime.store.logout(oldToken); }
          catch { this.logger.error({event:'blocked_session_revocation_failed'}); }
        }
        this.setCookie(reply, this.runtime.sessionCookie, '', 0);
      }
      return reply.redirect(`/?auth_error=${encodeURIComponent(code)}`, 303);
    }
  }

  @Get('/api/auth/session')
  async session(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      const token = req.cookies[this.runtime.sessionCookie];
      if (!token || !/^[\w-]{43}$/.test(token) || !this.runtime.store) throw new AuthError('unauthenticated', 401);
      return reply.send(await this.runtime.store.session(token));
    } catch (error) { return this.failure(reply, error); }
  }

  @Post('/api/auth/logout')
  async logout(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      if (req.headers.origin !== this.runtime.config.publicOrigin) throw new AuthError('invalid_origin', 403);
      const token = req.cookies[this.runtime.sessionCookie];
      if (token && this.runtime.store) await this.runtime.store.logout(token);
      this.setCookie(reply, this.runtime.sessionCookie, '', 0);
      return reply.code(204).send();
    } catch (error) { return this.failure(reply, error); }
  }

  @Get('/api/profile')
  async profile(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      parameters(req, []);
      const token = req.cookies[this.runtime.sessionCookie];
      if (!token || !/^[\w-]{43}$/.test(token) || !this.runtime.store) throw new AuthError('unauthenticated', 401);
      return reply.send(await this.runtime.store.profile(token));
    } catch (error) { return this.failure(reply, error); }
  }

  private available() {
    const {sber, store} = this.runtime;
    if (!sber || !store) throw new AuthError('sber_unavailable', 503);
    return {sber, store};
  }

  private setCookie(reply: FastifyReply, name: string, value: string, maxAge: number) {
    reply.setCookie(name, value, {httpOnly: true, secure: this.runtime.config.secureCookies, sameSite: 'lax', path: '/', maxAge});
  }

  private errorCode(error: unknown): string {
    if (error instanceof AuthError) return error.code;
    // Provider payloads, auth codes, cookies and DB errors may contain secrets/PII.
    this.logger.error({event: 'authentication_failed', code: 'internal_error'});
    return 'temporarily_unavailable';
  }

  private failure(reply: FastifyReply, error: unknown) {
    return reply.code(error instanceof AuthError ? error.status : 503).send({code: this.errorCode(error)});
  }
}

function parameters(req: FastifyRequest, allowed: string[]): URLSearchParams {
  const query = new URL(req.url, 'http://localhost').searchParams;
  for (const key of query.keys()) {
    if (!allowed.includes(key) || query.getAll(key).length !== 1 || query.get(key)!.length > 2048) throw new AuthError('invalid_request');
  }
  return query;
}
