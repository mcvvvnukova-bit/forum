import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Agent, request} from 'node:https';
import {UnsecuredJWT, importSPKI, jwtVerify} from 'jose';
import {SberClient} from '../dist/iam/sber-client.js';
import {loadConfig} from '../dist/config.js';

const fail = code => { throw new Error(code); };
const randomToken = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function beginProbe(config, directory) {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const attemptDirectory = mkdtempSync(join(directory, 'attempt-'));
  const attempt = {state: randomToken(), nonce: randomToken(), verifier: randomToken(),
    expiresAt: Date.now() + 600000, clientId: config.sber.clientId,
    redirectUri: config.sber.redirectUri, publicOrigin: config.publicOrigin};
  writeFileSync(join(attemptDirectory, 'pending.json'), JSON.stringify(attempt), {mode: 0o600, flag: 'wx'});
  const client = new SberClient({...config.sber, scope: 'openid'});
  try {
    return {authorizationUrl: client.authorizeUrl(attempt.state, attempt.nonce, attempt.verifier),
      attemptDirectory, expiresAt: new Date(attempt.expiresAt).toISOString()};
  } finally { client.close(); }
}

export async function completeProbe(config, directory, callbackUrl) {
  const pendingPath = join(directory, 'pending.json');
  let attempt;
  try { attempt = JSON.parse(readFileSync(pendingPath, 'utf8')); }
  catch { fail('attempt_unavailable'); }
  if (!Number.isFinite(attempt.expiresAt) || Date.now() >= attempt.expiresAt) {
    unlinkSync(pendingPath);
    fail('attempt_expired');
  }
  let callback;
  try { callback = new URL(callbackUrl); } catch { fail('invalid_callback'); }
  const query = callback.searchParams;
  if (attempt.clientId !== config.sber.clientId || attempt.redirectUri !== config.sber.redirectUri
    || attempt.publicOrigin !== config.publicOrigin || callback.origin !== config.publicOrigin
    || callback.pathname !== new URL(config.sber.redirectUri).pathname || callback.hash
    || callback.username || callback.password || !equal(query.get('state'), attempt.state)) fail('invalid_callback');
  for (const key of query.keys()) {
    if (!['code', 'state', 'error', 'error_description', 'error_uri'].includes(key)
      || query.getAll(key).length !== 1 || query.get(key).length > 2048) fail('invalid_callback');
  }
  const code = query.get('code');
  if (!query.has('error') && (!code || code.length > 512 || /\s/.test(code))) fail('invalid_callback');
  // Claim the attempt before any external request; even failed exchanges are not retried.
  try { writeFileSync(join(directory, 'consumed'), '', {flag: 'wx', mode: 0o600}); }
  catch { fail('attempt_unavailable'); }
  unlinkSync(pendingPath);
  if (query.has('error')) fail('authorization_declined');
  const token = await exchangeCode(config.sber, code, attempt.verifier);
  try {
    if (typeof token.id_token !== 'string' || token.id_token.length > 16384) fail('invalid_token');
    // No issuer equality check here: this command observes it, never authenticates a user.
    const options = {audience: config.sber.clientId, maxTokenAge: '10m', clockTolerance: 5};
    const claims = config.sber.signingAlgorithm === 'none'
      ? UnsecuredJWT.decode(token.id_token, options).payload
      : (await jwtVerify(token.id_token, await importSPKI(config.sber.signingPublicKey, 'RS256'),
        {...options, algorithms: ['RS256']})).payload;
    const now = Math.floor(Date.now() / 1000);
    if (!equal(claims.nonce, attempt.nonce) || !Number.isFinite(claims.exp) || claims.exp <= now
      || !Number.isFinite(claims.iat) || claims.iat > now + 5
      || (claims.azp !== undefined && claims.azp !== config.sber.clientId)
      || (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== config.sber.clientId)
      || typeof claims.iss !== 'string' || !/^[A-Za-z0-9.:/_~-]{1,512}$/.test(claims.iss)) fail('invalid_token');
    return {issuer: claims.iss, purpose: 'diagnostic_only', sessionCreated: false};
  } catch { fail('invalid_token'); }
}

async function exchangeCode(config, code, verifier) {
  const url = new URL('/ru/prod/tokens/v2/oidc', config.apiOrigin);
  if (url.protocol !== 'https:') fail('https_required');
  const agent = new Agent({family: config.addressFamily, cert: config.cert, key: config.key, ca: config.ca, passphrase: config.passphrase,
    rejectUnauthorized: true, minVersion: 'TLSv1.2'});
  try {
    return await new Promise((resolveToken, reject) => {
      const req = request(url, {method: 'POST', agent, headers: {
        'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
        rquid: randomUUID().replaceAll('-', ''),
      }}, response => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`token_endpoint_http_${response.statusCode}`));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 65536) { req.destroy(); reject(new Error('oversized_response')); }
          else chunks.push(chunk);
        });
        response.once('error', () => reject(new Error('tls_or_network_error')));
        response.once('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
            resolveToken(value);
          } catch { reject(new Error('invalid_token')); }
        });
      });
      const timeout = setTimeout(() => req.destroy(), 10000);
      req.once('close', () => clearTimeout(timeout));
      req.once('error', () => reject(new Error('tls_or_network_error')));
      req.end(new URLSearchParams({grant_type: 'authorization_code', code, client_id: config.clientId,
        client_secret: config.clientSecret, redirect_uri: config.redirectUri, code_verifier: verifier}).toString());
    });
  } finally { agent.destroy(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const directory = process.argv[3];
    if (!['begin', 'complete'].includes(command) || !directory) fail('usage_begin_or_complete_and_private_directory');
    if (process.env.SBER_ID_ENVIRONMENT !== 'test' || process.env.SBER_ID_ENABLED !== 'false') fail('requires_disabled_sandbox');
    // This marker only loads existing credentials; it is not a trusted issuer or a runtime setting.
    const config = loadConfig({...process.env, SBER_ID_ENABLED: 'true', SBER_ID_ISSUER: 'diagnostic-only-not-trusted'});
    const result = command === 'begin' ? beginProbe(config, directory)
      : await completeProbe(config, directory, readFileSync(0, 'utf8').trim());
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = /^[a-z_0-9]+$/.test(error.message) ? error.message : 'diagnostic_failed';
    console.error(JSON.stringify({error: code}));
    process.exitCode = 1;
  }
}
