import {createHash, randomBytes} from 'node:crypto';

export function randomToken(): string { return randomBytes(32).toString('base64url'); }
export function hashToken(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function pkceChallenge(value: string): string { return createHash('sha256').update(value).digest('base64url'); }
