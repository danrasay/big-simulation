/**
 * The OpenID Connect authorization code flow with PKCE, against Google.
 *
 * This is the whole OAuth client: one URL to send the browser to, and one
 * POST to trade the returned code for an ID token. The token's signature and
 * claims are checked separately, in id-token.ts.
 */
import { createHash } from 'node:crypto';
import type { Config } from './config';
import { randomToken, safeEqual } from './identity';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const CALLBACK_PATH = '/auth/callback';

/** What the app must remember between sending the browser to Google and getting it back. */
export interface PendingSignIn {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export function redirectUri(config: Config): string {
  return `${config.appOrigin}${CALLBACK_PATH}`;
}

/** Builds the Google sign-in URL and the values to keep for the callback. */
export function createAuthorizationRequest(config: Config): {
  url: string;
  pending: PendingSignIn;
} {
  const pending: PendingSignIn = {
    state: randomToken(),
    nonce: randomToken(),
    codeVerifier: randomToken(),
  };
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', config.googleClientId);
  url.searchParams.set('redirect_uri', redirectUri(config));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', pending.state);
  url.searchParams.set('nonce', pending.nonce);
  url.searchParams.set(
    'code_challenge',
    createHash('sha256').update(pending.codeVerifier).digest('base64url'),
  );
  url.searchParams.set('code_challenge_method', 'S256');
  // A hint that pre-selects the college account. It is not the control: the
  // server checks the hd claim of the signed token.
  url.searchParams.set('hd', config.allowedDomain);
  url.searchParams.set('prompt', 'select_account');
  return { url: url.toString(), pending };
}

/** Packs the pending values into a cookie value. */
export function encodePending(pending: PendingSignIn): string {
  return Buffer.from(JSON.stringify(pending)).toString('base64url');
}

/** Unpacks a pending cookie. Returns undefined for anything malformed. */
export function decodePending(value: string | undefined): PendingSignIn | undefined {
  if (value === undefined || value === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { state, nonce, codeVerifier } = parsed as Record<string, unknown>;
    if (
      typeof state !== 'string' ||
      typeof nonce !== 'string' ||
      typeof codeVerifier !== 'string'
    ) {
      return undefined;
    }
    if (state === '' || nonce === '' || codeVerifier === '') return undefined;
    return { state, nonce, codeVerifier };
  } catch {
    return undefined;
  }
}

/** True when the state Google returned is the one this browser was sent with. */
export function stateMatches(pending: PendingSignIn, returned: string | null): boolean {
  return returned !== null && safeEqual(pending.state, returned);
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Trades the authorization code for an ID token. Returns undefined if Google
 * refuses the code or cannot be reached. Access and refresh tokens in the response are dropped
 * here: the app calls no Google APIs.
 */
export async function exchangeCode(
  config: Config,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | undefined> {
  let body: unknown;
  try {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: redirectUri(config),
      }).toString(),
    });
    if (!response.ok) return undefined;
    body = await response.json();
  } catch {
    // Google could not be reached, or did not answer with JSON.
    return undefined;
  }
  if (typeof body !== 'object' || body === null) return undefined;
  const idToken = (body as Record<string, unknown>).id_token;
  return typeof idToken === 'string' && idToken !== '' ? idToken : undefined;
}
