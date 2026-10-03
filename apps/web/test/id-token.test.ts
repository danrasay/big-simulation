import { describe, expect, it } from 'vitest';
import { verifyIdToken } from '../src/lib/id-token';
import { CLIENT_ID, createTokenForge, NONCE } from './helpers';

const forge = await createTokenForge();
const expected = {
  keys: forge.keys,
  clientId: CLIENT_ID,
  nonce: NONCE,
  allowedDomain: 'college.example',
};
const check = async (claims?: Record<string, unknown>) =>
  verifyIdToken(await forge.forge(claims), expected);

describe('verifyIdToken: the domain gate', () => {
  it('accepts a verified college.example account', async () => {
    expect(await check()).toEqual({
      ok: true,
      identity: {
        subject: '108000000000000000001',
        email: 'pat.student@college.example',
        givenName: 'Pat',
      },
    });
  });

  it('refuses a personal Gmail account, which has no hd claim', async () => {
    const result = await check({ hd: undefined, email: 'fixture.only@gmail.com' });
    expect(result).toEqual({ ok: false, reason: 'wrong_domain' });
  });

  it('refuses an account from another Workspace domain', async () => {
    const result = await check({ hd: 'example.edu', email: 'someone@example.edu' });
    expect(result).toEqual({ ok: false, reason: 'wrong_domain' });
  });

  it('does not trust the email suffix: a college.example email with no hd claim is refused', async () => {
    expect(await check({ hd: undefined })).toEqual({ ok: false, reason: 'wrong_domain' });
  });

  it('refuses a domain that only looks similar', async () => {
    for (const hd of ['COLLEGE.EXAMPLE', 'college.example.evil.example', 'xcollege.example', '']) {
      expect(await check({ hd })).toEqual({ ok: false, reason: 'wrong_domain' });
    }
  });

  it('refuses an account whose email is not verified', async () => {
    expect(await check({ email_verified: false })).toEqual({
      ok: false,
      reason: 'email_not_verified',
    });
    expect(await check({ email_verified: 'true' })).toEqual({
      ok: false,
      reason: 'email_not_verified',
    });
    expect(await check({ email: undefined })).toEqual({ ok: false, reason: 'email_not_verified' });
  });
});

describe('verifyIdToken: the token itself', () => {
  it("refuses a token signed with a key that is not Google's", async () => {
    const token = await forge.forgeWithOtherKey();
    expect(await verifyIdToken(token, expected)).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('refuses a token issued to a different app', async () => {
    expect(await check({ aud: 'another-client-id' })).toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });

  it('refuses a token from a different issuer', async () => {
    expect(await check({ iss: 'https://accounts.example.com' })).toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });

  it('accepts both issuer spellings Google uses', async () => {
    expect((await check({ iss: 'accounts.google.com' })).ok).toBe(true);
  });

  it('refuses an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    expect(await check({ iat: past, exp: past + 3600 })).toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });

  it('refuses a token with no signature', async () => {
    const encode = (value: object): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '1',
      iat: now,
      exp: now + 3600,
      nonce: NONCE,
      hd: 'college.example',
      email: 'pat.student@college.example',
      email_verified: true,
    })}.`;
    expect(await verifyIdToken(unsigned, expected)).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('refuses a token signed with the public key used as a shared secret', async () => {
    const confused = await forge.forgeWithPublicKeyAsSecret();
    expect(await verifyIdToken(confused, expected)).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('refuses something that is not a token', async () => {
    expect(await verifyIdToken('not-a-token', expected)).toEqual({
      ok: false,
      reason: 'invalid_token',
    });
    expect(await verifyIdToken('', expected)).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('refuses a token whose nonce is not the one this app issued', async () => {
    expect(await check({ nonce: 'someone-elses-nonce' })).toEqual({
      ok: false,
      reason: 'nonce_mismatch',
    });
    expect(await check({ nonce: undefined })).toEqual({ ok: false, reason: 'nonce_mismatch' });
  });

  it('refuses a token with no subject', async () => {
    expect(await check({ sub: undefined })).toEqual({ ok: false, reason: 'invalid_token' });
  });
});
