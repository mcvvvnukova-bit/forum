import {readFileSync} from 'node:fs';

export interface SberConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  apiOrigin: string;
  addressFamily?: 4;
  issuer: string;
  scope: string;
  cert: Buffer;
  key: Buffer;
  ca?: Buffer;
  passphrase?: string;
  signingAlgorithm: 'none' | 'RS256';
  signingPublicKey?: string;
  reportCompletion: boolean;
}

export interface ApiConfig {
  publicOrigin: string;
  databaseUrl: string;
  secureCookies: boolean;
  sessionTtlSeconds: number;
  trustedProxyCidrs?: string[];
  sber?: SberConfig;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing configuration: ${key}`);
  return value;
}

function secret(env: NodeJS.ProcessEnv, key: string): string {
  return env[`${key}_FILE`]
    ? readFileSync(env[`${key}_FILE`]!, 'utf8').trim()
    : required(env, key);
}

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Provider URLs must use HTTPS without credentials or fragments');
  }
  return url;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const origin = new URL(env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:4173');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local && env.NODE_ENV !== 'production'))) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (HTTP is allowed only on local development)');
  }
  const ttl = Number(env.SESSION_TTL_SECONDS ?? '86400');
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 604800) throw new Error('Invalid SESSION_TTL_SECONDS');
  const config: ApiConfig = {
    publicOrigin: origin.origin,
    databaseUrl: env.DATABASE_URL_FILE ? secret(env, 'DATABASE_URL') : env.DATABASE_URL ?? '',
    secureCookies: origin.protocol === 'https:',
    sessionTtlSeconds: ttl,
    trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS?.split(',').map(value => value.trim()).filter(Boolean),
  };
  if (env.SBER_ID_ENABLED !== 'true') return config;

  const redirectUri = required(env, 'SBER_ID_REDIRECT_URI');
  const redirect = new URL(redirectUri);
  const relay = env.SBER_ID_CALLBACK_RELAY_ORIGIN ? httpsUrl(env.SBER_ID_CALLBACK_RELAY_ORIGIN) : undefined;
  if (relay && (relay.pathname !== '/' || relay.search || relay.origin === origin.origin || origin.protocol !== 'https:')) {
    throw new Error('SBER_ID_CALLBACK_RELAY_ORIGIN must be a distinct HTTPS origin, with an HTTPS PUBLIC_ORIGIN');
  }
  const allowedCallback = relay
    ? redirect.origin === relay.origin && redirect.pathname === '/authorization'
    : redirect.origin === origin.origin && ['/', '/authorization', '/auth/sber-id/callback'].includes(redirect.pathname);
  if (!allowedCallback
    || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new Error('SBER_ID_REDIRECT_URI must be a supported same-origin callback or /authorization on the configured relay origin');
  }
  const environment = required(env, 'SBER_ID_ENVIRONMENT');
  if (!['test', 'production'].includes(environment)) throw new Error('Invalid SBER_ID_ENVIRONMENT');
  const authorize = httpsUrl(required(env, 'SBER_ID_AUTHORIZE_URL'));
  if (authorize.search) throw new Error('SBER_ID_AUTHORIZE_URL must not contain query parameters');
  const scope = (env.SBER_ID_SCOPE ?? 'openid').trim().split(/\s+/);
  if (scope[0] !== 'openid' || scope.includes('offline_access') || scope.some(s => !/^[a-z_]+$/.test(s))) {
    throw new Error('SBER_ID_SCOPE must start with openid and must not request offline_access');
  }
  const signingAlgorithm = required(env, 'SBER_ID_TOKEN_SIGNING_ALG');
  if (signingAlgorithm !== 'none' && signingAlgorithm !== 'RS256') throw new Error('Unsupported ID token algorithm');
  const signingPublicKey = signingAlgorithm === 'RS256'
    ? readFileSync(required(env, 'SBER_ID_SIGNING_PUBLIC_KEY_FILE'), 'utf8') : undefined;
  config.sber = {
    clientId: required(env, 'SBER_ID_CLIENT_ID'),
    clientSecret: secret(env, 'SBER_ID_CLIENT_SECRET'),
    redirectUri,
    authorizeUrl: authorize.href,
    apiOrigin: environment === 'production' ? 'https://oauth.sber.ru' : 'https://oauth-sb.sber.ru:6443',
    // The Sandbox's AAAA DNS query can time out even when its A record resolves.
    addressFamily: environment === 'test' ? 4 : undefined,
    issuer: required(env, 'SBER_ID_ISSUER'),
    scope: scope.join(' '),
    cert: readFileSync(required(env, 'SBER_ID_CERT_FILE')),
    key: readFileSync(required(env, 'SBER_ID_KEY_FILE')),
    ca: env.SBER_ID_CA_FILE ? readFileSync(env.SBER_ID_CA_FILE) : undefined,
    passphrase: env.SBER_ID_KEY_PASSPHRASE_FILE || env.SBER_ID_KEY_PASSPHRASE ? secret(env, 'SBER_ID_KEY_PASSPHRASE') : undefined,
    signingAlgorithm,
    signingPublicKey,
    reportCompletion: environment === 'production',
  };
  if (!config.databaseUrl || !config.sber.clientSecret) throw new Error('Database and partner secret are required');
  return config;
}
