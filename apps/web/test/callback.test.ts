import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client';
import { handleCallback } from '../src/lib/callback';
import type { CallbackOutcome } from '../src/lib/callback';
import type { Config } from '../src/lib/config';
import { createAuthorizationRequest, encodePending } from '../src/lib/oidc';
import type { FetchLike, PendingSignIn } from '../src/lib/oidc';
import { importRoster, parseRoster } from '../src/lib/roster';
import { createSection } from '../src/lib/sections';
import { findSessionUser } from '../src/lib/sessions';
import {
  CLIENT_ID,
  PEPPER,
  clearTestDb,
  createTestDb,
  createTokenForge,
  dumpDatabase,
  rowCounts,
} from './helpers';
import type { TokenForge } from './helpers';

const config: Config = {
  appOrigin: 'https://bigsim.example',
  googleClientId: CLIENT_ID,
  googleClientSecret: 'test-client-secret',
  identityPepper: PEPPER,
  sessionSecret: 'test-session-secret-test-session-secret',
  allowedDomain: 'college.example',
  requireRoster: true,
  bootstrapInstructorEmail: undefined,
  secureCookies: true,
};

let db: Db;
let forge: TokenForge;
let pending: PendingSignIn;
let tokenRequests: URLSearchParams[];

/** Stands in for Google's token endpoint, answering with the given ID token. */
function tokenEndpoint(idToken: string | undefined, status = 200): FetchLike {
  return (_url, init) => {
    tokenRequests.push(new URLSearchParams(init.body as string));
    const body =
      idToken === undefined
        ? { error: 'invalid_grant' }
        : { id_token: idToken, access_token: 'ya29.unused' };
    return Promise.resolve(Response.json(body, { status }));
  };
}

const neverCalled: FetchLike = () => {
  throw new Error('the token endpoint must not be called');
};

function run(options: {
  idToken?: string | undefined;
  fetchImpl?: FetchLike;
  cookie?: string | undefined;
  params?: Record<string, string>;
}): Promise<CallbackOutcome> {
  return handleCallback({
    db,
    config,
    keys: forge.keys,
    pendingCookie: 'cookie' in options ? options.cookie : encodePending(pending),
    params: new URLSearchParams(options.params ?? { state: pending.state, code: 'auth-code' }),
    fetchImpl: options.fetchImpl ?? tokenEndpoint(options.idToken),
  });
}

beforeAll(async () => {
  db = await createTestDb();
  forge = await createTokenForge();
});

beforeEach(async () => {
  await clearTestDb(db);
  tokenRequests = [];
  pending = createAuthorizationRequest(config).pending;
  const section = await createSection(db, 'Fall 2026', 'ELI 275-01');
  if (!section.ok) throw new Error(section.error);
  const parsed = parseRoster(
    'email,student_code,section\npatrice.quimby@college.example,S-014,ELI 275-01\n',
    'college.example',
  );
  await importRoster(db, parsed.rows, PEPPER);
});

const onRoster = {
  email: 'patrice.quimby@college.example',
  given_name: 'Patrice',
  name: 'Patrice Quimby',
};

describe('the callback from Google', () => {
  it('signs in a college account that is on the roster', async () => {
    const idToken = await forge.forge({ ...onRoster, nonce: pending.nonce });
    const outcome = await run({ idToken });
    if (outcome.kind !== 'signed_in')
      throw new Error(`expected a sign-in, got ${JSON.stringify(outcome)}`);
    expect(outcome.user).toMatchObject({ role: 'student', studentCode: 'S-014' });
    expect(outcome.givenName).toBe('Patrice');
    expect(await findSessionUser(db, outcome.token)).toEqual(outcome.user);
  });

  it('sends the code, the PKCE verifier and the client secret to the token endpoint', async () => {
    const idToken = await forge.forge({ ...onRoster, nonce: pending.nonce });
    await run({ idToken });
    expect(tokenRequests).toHaveLength(1);
    expect(Object.fromEntries(tokenRequests[0] ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      code_verifier: pending.codeVerifier,
      client_id: CLIENT_ID,
      client_secret: 'test-client-secret',
      redirect_uri: 'https://bigsim.example/auth/callback',
    });
  });

  it('refuses a personal Gmail account, and stores nothing', async () => {
    const before = await rowCounts(db);
    const idToken = await forge.forge({
      nonce: pending.nonce,
      hd: undefined,
      email: 'fixture.only@gmail.com',
    });
    expect(await run({ idToken })).toEqual({ kind: 'refused', reason: 'wrong_domain' });
    expect(await rowCounts(db)).toEqual(before);
  });

  it('refuses an account from another Workspace domain', async () => {
    const idToken = await forge.forge({ nonce: pending.nonce, hd: 'example.edu', ...onRoster });
    expect(await run({ idToken })).toEqual({ kind: 'refused', reason: 'wrong_domain' });
  });

  it('refuses a token signed by someone other than Google', async () => {
    const idToken = await forge.forgeWithOtherKey({ ...onRoster, nonce: pending.nonce });
    expect(await run({ idToken })).toEqual({ kind: 'refused', reason: 'invalid_token' });
  });

  it('refuses a token minted for a different sign-in attempt', async () => {
    const idToken = await forge.forge({ ...onRoster, nonce: 'someone-elses-nonce' });
    expect(await run({ idToken })).toEqual({ kind: 'refused', reason: 'nonce_mismatch' });
  });

  it('shows a college account that is not on the roster the door, and leaves no row', async () => {
    const before = await dumpDatabase(db);
    const idToken = await forge.forge({
      nonce: pending.nonce,
      sub: '108000000000000000002',
      email: 'samira.oyelaran@college.example',
    });
    expect(await run({ idToken })).toEqual({ kind: 'not_on_roster' });
    expect(await dumpDatabase(db)).toBe(before);
  });

  it('does not contact Google when the pending cookie is missing or damaged', async () => {
    for (const cookie of [
      undefined,
      '',
      'not-base64-json',
      encodePending({ ...pending, nonce: '' }),
    ]) {
      expect(await run({ cookie, fetchImpl: neverCalled })).toEqual({
        kind: 'refused',
        reason: 'no_pending_sign_in',
      });
    }
  });

  it('does not contact Google when the state does not match', async () => {
    for (const params of [{ code: 'auth-code' }, { code: 'auth-code', state: 'forged' }]) {
      expect(await run({ params, fetchImpl: neverCalled })).toEqual({
        kind: 'refused',
        reason: 'state_mismatch',
      });
    }
  });

  it('treats an error from Google as a cancelled sign-in', async () => {
    const params = { state: pending.state, error: 'access_denied' };
    expect(await run({ params, fetchImpl: neverCalled })).toEqual({
      kind: 'refused',
      reason: 'cancelled',
    });
  });

  it('refuses a return with no code', async () => {
    const params = { state: pending.state };
    expect(await run({ params, fetchImpl: neverCalled })).toEqual({
      kind: 'refused',
      reason: 'missing_code',
    });
  });

  it('refuses when Google rejects the code', async () => {
    expect(await run({ fetchImpl: tokenEndpoint(undefined, 400) })).toEqual({
      kind: 'refused',
      reason: 'exchange_failed',
    });
    expect(await run({ fetchImpl: tokenEndpoint(undefined, 200) })).toEqual({
      kind: 'refused',
      reason: 'exchange_failed',
    });
  });
});
