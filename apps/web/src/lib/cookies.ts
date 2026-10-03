/**
 * The app's cookies.
 *
 * Over https every cookie carries the __Host- prefix, which the browser only
 * accepts with Secure, Path=/ and no Domain. That pins the cookie to this
 * exact host. Over http on localhost the prefix and Secure are dropped, since
 * a browser would refuse them.
 */
import type { Config } from './config';
import { sign, unsign } from './identity';

type CookieConfig = Pick<Config, 'secureCookies'>;

export interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly expires?: Date;
  readonly maxAge?: number;
}

export interface CookieNames {
  /** The session token. */
  readonly session: string;
  /** State, nonce and PKCE verifier, between leaving for Google and coming back. */
  readonly pending: string;
  /** The person's first name, signed. It lives in their browser and nowhere else. */
  readonly greeting: string;
}

/** How long someone has to finish signing in at Google. */
export const PENDING_MAX_AGE_SECONDS = 10 * 60;

export function cookieNames(config: CookieConfig): CookieNames {
  const prefix = config.secureCookies ? '__Host-' : '';
  return {
    session: `${prefix}session`,
    pending: `${prefix}signin`,
    greeting: `${prefix}greeting`,
  };
}

/**
 * Options shared by every cookie. SameSite=Lax, not Strict, because the
 * return from Google is a cross-site navigation and must carry the pending
 * cookie.
 */
export function baseCookieOptions(config: CookieConfig): CookieOptions {
  return { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/' };
}

export function sessionCookieOptions(config: CookieConfig, expiresAt: Date): CookieOptions {
  return { ...baseCookieOptions(config), expires: expiresAt };
}

export function pendingCookieOptions(config: CookieConfig): CookieOptions {
  return { ...baseCookieOptions(config), maxAge: PENDING_MAX_AGE_SECONDS };
}

/** Options that make the browser drop a cookie. A __Host- cookie can only be removed with the same attributes it was set with. */
export function expiredCookieOptions(config: CookieConfig): CookieOptions {
  return { ...baseCookieOptions(config), maxAge: 0 };
}

const MAX_NAME_LENGTH = 60;

/** The greeting cookie's value: the first name, tied to one user and signed so it cannot be edited. */
export function encodeGreeting(secret: string, userId: string, givenName: string): string {
  return sign(secret, JSON.stringify({ u: userId, n: givenName.slice(0, MAX_NAME_LENGTH) }));
}

/** The first name from a greeting cookie, if it is intact and belongs to this user. */
export function decodeGreeting(
  secret: string,
  userId: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  const json = unsign(secret, value);
  if (json === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { u, n } = parsed as Record<string, unknown>;
    return u === userId && typeof n === 'string' && n !== '' ? n : undefined;
  } catch {
    return undefined;
  }
}
