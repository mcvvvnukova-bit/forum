import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:https';
import {createServer as createHttpServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {UnsecuredJWT} from 'jose';
import type {SberConfig} from '../src/config.js';

export async function providerFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'forum-sber-test-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], {stdio: 'ignore'});
  const cert = readFileSync(join(dir, 'cert.pem'));
  const key = readFileSync(join(dir, 'key.pem'));
  const pending = new Map<string, {nonce: string; claims: Record<string, unknown>; profile: Record<string, unknown>}>();
  const profiles = new Map<string, Record<string, unknown>>();
  const calls: {path: string; headers: Record<string, unknown>; form: URLSearchParams}[] = [];
  const faults = {tokenStatus: 200, profileStatus: 200, completionStatus: 204};
  const server = createServer({cert, key, ca: cert, requestCert: true, rejectUnauthorized: true}, async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const form = new URLSearchParams(Buffer.concat(chunks).toString());
    calls.push({path: req.url!, headers: req.headers, form});
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.endsWith('/tokens/v2/oidc')) {
      if (faults.tokenStatus !== 200) { res.writeHead(faults.tokenStatus); res.end('{"error":"invalid_grant"}'); return; }
      const code = form.get('code')!;
      const attempt = pending.get(code);
      if (!attempt) { res.writeHead(400); res.end('{"error":"invalid_grant"}'); return; }
      pending.delete(code);
      const now = Math.floor(Date.now() / 1000);
      const claims = {iss: 'id.sber.ru', sub: 'sber-person-1', aud: 'test-client', nonce: attempt.nonce,
        iat: now, exp: now + 60, auth_time: now, ...attempt.claims};
      const accessToken = `test-access-${code}`;
      profiles.set(accessToken, {sub: claims.sub, given_name: 'Анна', family_name: 'Иванова',
        email: 'anna@example.test', email_verified: true, ...attempt.profile});
      res.end(JSON.stringify({access_token: accessToken, token_type: 'Bearer', expires_in: 60,
        id_token: new UnsecuredJWT(claims).encode()}));
    } else if (req.url?.endsWith('/userinfo')) {
      res.writeHead(faults.profileStatus);
      res.end(JSON.stringify(profiles.get(req.headers.authorization?.replace('Bearer ', '') ?? '') ?? {}));
    } else if (req.url === '/api/v2/auth/completed') {
      res.writeHead(faults.completionStatus); res.end();
    } else { res.writeHead(404); res.end('{}'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test provider port');
  const authorizeServer = createHttpServer((req, res) => {
    const query = new URL(req.url!, 'http://localhost').searchParams;
    const code = randomUUID();
    pending.set(code, {nonce: query.get('nonce')!, claims: {}, profile: {}});
    const redirect = new URL(query.get('redirect_uri')!);
    if (redirect.hostname !== '127.0.0.1') { res.writeHead(400); res.end(); return; }
    redirect.search = new URLSearchParams({code, state: query.get('state')!}).toString();
    res.writeHead(303, {Location: redirect.href}); res.end();
  });
  authorizeServer.listen(0, '127.0.0.1');
  await once(authorizeServer, 'listening');
  const authorizeAddress = authorizeServer.address();
  if (!authorizeAddress || typeof authorizeAddress === 'string') throw new Error('No test authorization port');
  const sber: SberConfig = {
    clientId: 'test-client', clientSecret: 'synthetic-secret', issuer: 'id.sber.ru',
    redirectUri: 'https://forum.example/auth/sber-id/callback', authorizeUrl: `http://127.0.0.1:${authorizeAddress.port}/authorize`,
    apiOrigin: `https://127.0.0.1:${address.port}`, scope: 'openid name email mobile',
    cert, key, ca: cert, signingAlgorithm: 'none', reportCompletion: true,
  };
  return {
    sber, calls, faults,
    authorize(code: string, nonce: string, claims: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) {
      pending.set(code, {nonce, claims, profile});
    },
    async close() {
      authorizeServer.closeAllConnections(); authorizeServer.close(); await once(authorizeServer, 'close');
      server.closeAllConnections(); server.close(); await once(server, 'close'); rmSync(dir, {recursive: true});
    },
  };
}
