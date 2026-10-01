import {Agent, request} from 'node:https';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {UnsecuredJWT, importSPKI, jwtVerify, type JWTPayload} from 'jose';
import type {SberConfig} from '../config.js';
import {AuthError} from './auth-error.js';
import {pkceChallenge} from './crypto.js';

export interface SberIdentity {
  subject: string;
  alternateSubjects: string[];
  displayName: string;
  email: string | null;
  emailConfirmed: boolean;
  claims: Record<string, unknown>;
}

export class SberClient {
  private readonly agent: Agent;

  constructor(private readonly config: SberConfig) {
    const origin = new URL(config.apiOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== config.apiOrigin) throw new Error('Invalid Sber API origin');
    this.agent = new Agent({family: config.addressFamily, cert: config.cert, key: config.key, ca: config.ca,
      passphrase: config.passphrase, rejectUnauthorized: true, minVersion: 'TLSv1.2', keepAlive: true});
  }

  close() { this.agent.destroy(); }

  authorizeUrl(state: string, nonce: string, verifier: string): string {
    const url = new URL(this.config.authorizeUrl);
    url.search = new URLSearchParams({response_type: 'code', client_type: 'PRIVATE',
      client_id: this.config.clientId, redirect_uri: this.config.redirectUri, scope: this.config.scope,
      state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256'}).toString();
    return url.href;
  }

  async identify(code: string, nonce: string, verifier: string): Promise<{identity: SberIdentity; accessToken: string; rquid: string}> {
    const rquid = requestId();
    const response = await this.call('/ru/prod/tokens/v2/oidc', 'POST', {
      rquid, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
    }, new URLSearchParams({grant_type: 'authorization_code', code, client_id: this.config.clientId,
      client_secret: this.config.clientSecret, redirect_uri: this.config.redirectUri, code_verifier: verifier}).toString());
    const token = jsonObject(response);
    if (typeof token.access_token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(token.access_token)
      || typeof token.id_token !== 'string' || token.id_token.length > 16384
      || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') invalid();

    // Tokens enter here only from the authenticated back-channel, never from a browser.
    // Sber's documented unsigned format uses OIDC Core 3.1.3.7(6) TLS issuer validation.
    let claims: JWTPayload;
    try {
      const options = {issuer: this.config.issuer, audience: this.config.clientId, maxTokenAge: '10m', clockTolerance: 5};
      if (this.config.signingAlgorithm === 'none') {
        claims = UnsecuredJWT.decode(token.id_token, options).payload;
      } else {
        const key = await importSPKI(this.config.signingPublicKey!, 'RS256');
        claims = (await jwtVerify(token.id_token, key, {...options, algorithms: ['RS256']})).payload;
      }
    } catch { invalid(); }
    const now = Math.floor(Date.now() / 1000);
    if (!isSubject(claims.sub) || typeof claims.nonce !== 'string' || !equal(claims.nonce, nonce)
      || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat)
      || claims.exp! <= now || claims.iat! > now + 5
      || (claims.azp !== undefined && claims.azp !== this.config.clientId)
      || (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== this.config.clientId)) invalid();

    const profile = jsonObject(await this.call('/ru/prod/sberbankid/v2.1/userinfo', 'GET', {
      Authorization: `Bearer ${token.access_token}`, 'x-introspect-rquid': rquid, Accept: 'application/json',
    }));
    if (profile.sub !== claims.sub) invalid();
    const aliases: string[] = [];
    for (const value of [claims.sub_alt, claims.alt_sub]) {
      if (value === undefined) continue;
      const list = Array.isArray(value) ? value : [value];
      if (list.length > 20 || !list.every(isSubject)) invalid();
      aliases.push(...list);
    }
    const names = ['family_name', 'given_name', 'middle_name'].map(k => textClaim(profile[k], 128)).filter(Boolean);
    const email = textClaim(profile.email, 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid();
    const displayName = names.join(' ') || textClaim(profile.name, 384) || 'Пользователь';
    return {
      accessToken: token.access_token,
      rquid,
      identity: {
        subject: claims.sub,
        alternateSubjects: [...new Set(aliases)].filter(sub => sub !== claims.sub),
        displayName, email, emailConfirmed: Boolean(email && profile.email_verified === true),
        claims: {schemaVersion: 1, sub: claims.sub, displayName, email,
          emailVerified: profile.email_verified === true, phoneNumber: textClaim(profile.phone_number, 64),
          acr: textClaim(claims.acr, 128)},
      },
    };
  }

  async complete(accessToken: string, rquid: string): Promise<boolean> {
    if (!this.config.reportCompletion) return true;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.call('/api/v2/auth/completed', 'GET', {Authorization: `Bearer ${accessToken}`, rquid}, undefined, 204);
        return true;
      } catch { /* A completion outage must not undo a committed account/session. */ }
    }
    return false;
  }

  private call(path: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: string, expectedStatus = 200): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request(new URL(path, this.config.apiOrigin), {method, headers, agent: this.agent}, res => {
        // Never follow redirects with client credentials or bearer tokens.
        if (res.statusCode !== expectedStatus) {
          res.resume();
          reject(new AuthError('provider_unavailable', 502));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536) { req.destroy(); reject(new AuthError('invalid_provider_response', 502)); }
          else chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', () => reject(new AuthError('provider_unavailable', 502)));
      });
      const timer = setTimeout(() => req.destroy(new Error('Provider timeout')), 10000);
      req.on('close', () => clearTimeout(timer));
      req.on('error', () => reject(new AuthError('provider_unavailable', 502)));
      req.end(body);
    });
  }
}

function requestId() { return randomUUID().replaceAll('-', ''); }
function invalid(): never { throw new AuthError('invalid_provider_response', 502); }
function isSubject(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 96 && !/\s/.test(value); }
function equal(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function textClaim(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) invalid();
  return value.trim() || null;
}
function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid();
    return parsed as Record<string, unknown>;
  } catch { invalid(); }
}
