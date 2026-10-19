import 'reflect-metadata';
import {ConsoleLogger, Controller, Get, Inject, Module, Res} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {FastifyAdapter, type NestFastifyApplication} from '@nestjs/platform-fastify';
import {Pool} from 'pg';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type {FastifyReply} from 'fastify';
import {loadConfig, type ApiConfig} from './config.js';
import {OrganizationsController} from './organizations/organizations.controller.js';
import {AuthController, AuthRuntime} from './iam/auth.controller.js';
import {SettingsController} from './iam/settings.controller.js';
import {RolesController} from './iam/roles.controller.js';
import {OkpdDirectoryController} from './references/okpd-directory.controller.js';
import {OkvedDirectoryController} from './references/okved-directory.controller.js';

@Controller()
class HealthController {
  constructor(@Inject(AuthRuntime) private readonly runtime: AuthRuntime) {}
  @Get('/health/live')
  live() { return {status: 'ok'}; }
  @Get('/health/ready')
  async ready(@Res() reply: FastifyReply) {
    try {
      if (!this.runtime.pool) return reply.code(503).send({status: 'not_ready'});
      await this.runtime.pool.query(`SELECT 1 FROM public.users, public.external_identities,
        public.persons, public.participants, public.participant_memberships, public.role_assignments,
        public.sessions, public.authorization_attempts, public.outbox_events, public.audit_events,
        public.identity_providers, public.identity_profiles, public.organization_memberships,
        public.organization_authorities,public.iam_role_assignments,public.iam_idempotency LIMIT 0`);
      const readiness=await this.runtime.pool.query(`SELECT
        EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='006_person_memberships')
        AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='008_iam_roles')
        AND has_column_privilege(current_user,'public.users','access_version','UPDATE')
        AND has_column_privilege(current_user,'public.sessions','csrf_token','SELECT')
        AND has_table_privilege(current_user,'public.iam_role_assignments','SELECT')
        AND has_table_privilege(current_user,'public.iam_role_assignments','INSERT')
        AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['status','revoked_at','effective_from','effective_until','version','reason']) AS columns(name)
          WHERE NOT has_column_privilege(current_user,'public.iam_role_assignments',columns.name,'UPDATE'))
        AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['status','revoked_at','version']) AS columns(name)
          WHERE NOT has_column_privilege(current_user,'public.organization_memberships',columns.name,'UPDATE'))
        AND has_table_privilege(current_user,'public.iam_idempotency','SELECT')
        AND has_table_privilege(current_user,'public.iam_idempotency','INSERT')
        AND has_table_privilege(current_user,'public.audit_events','INSERT')
        AND has_function_privilege(current_user,'public.guard_iam_role_owner()','EXECUTE')
        AND has_function_privilege(current_user,'public.guard_organization_association()','EXECUTE')
        AND has_table_privilege(current_user,'public.identity_profiles','INSERT')
        AND has_table_privilege(current_user,'public.identity_profiles','UPDATE')
        AND has_column_privilege(current_user,'public.role_assignments','status','UPDATE')
        AND has_column_privilege(current_user,'public.role_assignments','revoked_at','UPDATE') AS ready`);
      if (readiness.rows[0]?.ready !== true) return reply.code(503).send({status: 'not_ready'});
      await this.runtime.pool.query("SELECT public.effective_business_access(NULL::uuid,NULL::uuid,'customer',true)");
      await this.runtime.pool.query('SELECT role_code FROM public.effective_iam_roles(NULL::uuid,NULL::uuid)');
      return reply.send({status: 'ok', sberConfigured: Boolean(this.runtime.sber)});
    } catch { return reply.code(503).send({status: 'not_ready'}); }
  }
}

export async function createApp(config: ApiConfig = loadConfig(), existingPool?: Pool): Promise<NestFastifyApplication> {
  const pool = existingPool ?? (config.databaseUrl ? new Pool({connectionString: config.databaseUrl,
    max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000}) : undefined);
  const runtime = new AuthRuntime(config, pool, !existingPool);
  @Module({controllers: [HealthController, AuthController, SettingsController, OrganizationsController,RolesController,OkvedDirectoryController,OkpdDirectoryController], providers: [{provide: AuthRuntime, useValue: runtime}]})
  class AppModule {}
  const adapter = new FastifyAdapter({bodyLimit: 4096, logger: false,
    trustProxy: config.trustedProxyCidrs?.length ? config.trustedProxyCidrs : false});
  const server = adapter.getInstance();
  await server.register(cookie);
  await server.register(rateLimit, {max: 120, timeWindow: '1 minute', allowList: req => req.url.startsWith('/health/')});
  server.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY');
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter,
    {logger: new ConsoleLogger({json: true, colors: false, logLevels: ['warn', 'error']})});
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
