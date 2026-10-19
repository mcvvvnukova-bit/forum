import {readFileSync} from 'node:fs';

/** The background integration needs database access independently of public-site authentication. */
export function referenceDatabaseUrl(env:NodeJS.ProcessEnv=process.env):string {
  const value=env.DATABASE_URL_FILE?readFileSync(env.DATABASE_URL_FILE,'utf8').trim():env.DATABASE_URL?.trim();
  if(!value)throw new Error('DATABASE_URL or DATABASE_URL_FILE is required');
  return value;
}
