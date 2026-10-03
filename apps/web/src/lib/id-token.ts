/**
 * The domain gate.
 *
 * A Google ID token is accepted only if its signature, issuer, audience and
 * expiry check out, its nonce is the one this app issued, its `hd` claim is
 * the allowed Workspace domain, and its email is verified.
 *
 * The `hd` claim is the control. The `hd` parameter sent with the sign-in
 * request only pre-selects an account, and an email's suffix does not prove
 * the account belongs to the domain. See Google's OpenID Connect guide.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

let googleKeys: JWTVerifyGetKey | undefined;

/** Google's published signing keys, fetched on first use and cached by jose. */
export function getGoogleKeys(): JWTVerifyGetKey {
  googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_KEYS_URL));
  return googleKeys;
}

/** What the app learns about a person from a verified token. Held in memory only. */
export interface VerifiedIdentity {
  /** Google account id. Stored only as a keyed hash. */
  readonly subject: string;
  /** Used once, to match the roster. Stored only as a keyed hash. */
  readonly email: string;
  /** For the greeting cookie. Never stored. */
  readonly givenName: string | undefined;
}

export type TokenRefusal =
  /** Bad signature, issuer, audience or expiry, or not a token at all. */
  | 'invalid_token'
  | 'nonce_mismatch'
  /** The account is not in the allowed Workspace domain: `hd` is missing or different. */
  | 'wrong_domain'
  | 'email_not_verified';

export type TokenCheck =
  | { readonly ok: true; readonly identity: VerifiedIdentity }
  | { readonly ok: false; readonly reason: TokenRefusal };

export interface TokenExpectations {
  readonly keys: JWTVerifyGetKey;
  /** This app's OAuth client id. */
  readonly clientId: string;
  /** The nonce this app put in the sign-in request. */
  readonly nonce: string;
  readonly allowedDomain: string;
  /** For tests. Defaults to now. */
  readonly now?: Date;
}

export async function verifyIdToken(
  idToken: string,
  expected: TokenExpectations,
): Promise<TokenCheck> {
  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(idToken, expected.keys, {
      issuer: GOOGLE_ISSUERS,
      audience: expected.clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
      ...(expected.now === undefined ? {} : { currentDate: expected.now }),
    });
    claims = verified.payload;
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }

  if (typeof claims.nonce !== 'string' || claims.nonce !== expected.nonce) {
    return { ok: false, reason: 'nonce_mismatch' };
  }
  if (claims.hd !== expected.allowedDomain) {
    return { ok: false, reason: 'wrong_domain' };
  }
  if (claims.email_verified !== true || typeof claims.email !== 'string' || claims.email === '') {
    return { ok: false, reason: 'email_not_verified' };
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    return { ok: false, reason: 'invalid_token' };
  }

  return {
    ok: true,
    identity: {
      subject: claims.sub,
      email: claims.email,
      givenName: typeof claims.given_name === 'string' ? claims.given_name : undefined,
    },
  };
}
