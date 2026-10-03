/**
 * Everything that happens when Google sends the browser back: the checks on
 * the returned state, the code exchange, the domain gate and the roster gate.
 * The route handler only reads the request and writes cookies around this.
 */
import type { JWTVerifyGetKey } from 'jose';
import type { Db } from '../db/client';
import type { Config } from './config';
import { verifyIdToken } from './id-token';
import type { TokenRefusal } from './id-token';
import { decodePending, exchangeCode, stateMatches } from './oidc';
import type { FetchLike } from './oidc';
import type { SessionUser } from './sessions';
import { completeSignIn } from './sign-in';

export type CallbackRefusal =
  /** Google reported an error, usually because the person pressed Cancel. */
  | 'cancelled'
  /** No pending cookie: the sign-in did not start in this browser, or took too long. */
  | 'no_pending_sign_in'
  | 'state_mismatch'
  | 'missing_code'
  | 'exchange_failed'
  | TokenRefusal;

export type CallbackOutcome =
  | {
      readonly kind: 'signed_in';
      readonly token: string;
      readonly expiresAt: Date;
      readonly user: SessionUser;
      /** For the greeting cookie only. */
      readonly givenName: string | undefined;
    }
  | { readonly kind: 'not_on_roster' }
  | { readonly kind: 'refused'; readonly reason: CallbackRefusal };

export interface CallbackInput {
  readonly db: Db;
  readonly config: Config;
  /** Google's signing keys. */
  readonly keys: JWTVerifyGetKey;
  /** The value of the pending cookie, if the browser sent one. */
  readonly pendingCookie: string | undefined;
  /** The query string Google sent the browser back with. */
  readonly params: URLSearchParams;
  readonly fetchImpl?: FetchLike;
  readonly now?: Date;
}

export async function handleCallback(input: CallbackInput): Promise<CallbackOutcome> {
  const { db, config, keys, params } = input;
  const refused = (reason: CallbackRefusal): CallbackOutcome => ({ kind: 'refused', reason });

  const pending = decodePending(input.pendingCookie);
  if (pending === undefined) return refused('no_pending_sign_in');
  // State is checked before anything else in the query string is believed.
  if (!stateMatches(pending, params.get('state'))) return refused('state_mismatch');
  if (params.get('error') !== null) return refused('cancelled');
  const code = params.get('code');
  if (code === null || code === '') return refused('missing_code');

  const idToken = await exchangeCode(config, code, pending.codeVerifier, input.fetchImpl);
  if (idToken === undefined) return refused('exchange_failed');

  const check = await verifyIdToken(idToken, {
    keys,
    clientId: config.googleClientId,
    nonce: pending.nonce,
    allowedDomain: config.allowedDomain,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  if (!check.ok) return refused(check.reason);

  const result = await completeSignIn(db, check.identity, config, input.now);
  if (result.kind === 'not_on_roster') return { kind: 'not_on_roster' };
  return { ...result, givenName: check.identity.givenName };
}
