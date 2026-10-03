import { describe, expect, it } from 'vitest';
import {
  baseCookieOptions,
  cookieNames,
  decodeGreeting,
  encodeGreeting,
  expiredCookieOptions,
  pendingCookieOptions,
  sessionCookieOptions,
} from '../src/lib/cookies';
import { isSameOrigin } from '../src/lib/origin';

const SECRET = 'test-session-secret-test-session-secret';
const https = { secureCookies: true };
const localhost = { secureCookies: false };

describe('cookies', () => {
  it('uses __Host- names over https', () => {
    expect(cookieNames(https)).toEqual({
      session: '__Host-session',
      pending: '__Host-signin',
      greeting: '__Host-greeting',
    });
  });

  it('drops the prefix on localhost, where a browser would refuse it', () => {
    expect(cookieNames(localhost).session).toBe('session');
  });

  it('sets HttpOnly, Secure, SameSite=Lax and Path=/ over https, with no Domain', () => {
    expect(baseCookieOptions(https)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(baseCookieOptions(localhost).secure).toBe(false);
  });

  it('expires the session cookie when the session ends', () => {
    const expiresAt = new Date('2026-09-08T16:00:00Z');
    expect(sessionCookieOptions(https, expiresAt)).toMatchObject({
      expires: expiresAt,
      httpOnly: true,
    });
  });

  it('keeps the pending cookie for ten minutes and can remove any cookie', () => {
    expect(pendingCookieOptions(https).maxAge).toBe(600);
    expect(expiredCookieOptions(https)).toMatchObject({ maxAge: 0, secure: true, path: '/' });
  });
});

describe('the greeting cookie', () => {
  it('returns the first name to the user it was made for', () => {
    const value = encodeGreeting(SECRET, 'user-1', 'Patrice');
    expect(decodeGreeting(SECRET, 'user-1', value)).toBe('Patrice');
  });

  it('is not readable as plain text and is ignored for a different user', () => {
    const value = encodeGreeting(SECRET, 'user-1', 'Patrice');
    expect(value).not.toContain('Patrice');
    expect(decodeGreeting(SECRET, 'user-2', value)).toBeUndefined();
  });

  it('is ignored when altered, signed with another key, missing or malformed', () => {
    const value = encodeGreeting(SECRET, 'user-1', 'Patrice');
    expect(decodeGreeting(SECRET, 'user-1', `x${value}`)).toBeUndefined();
    expect(
      decodeGreeting('another-secret-another-secret-another', 'user-1', value),
    ).toBeUndefined();
    expect(decodeGreeting(SECRET, 'user-1', undefined)).toBeUndefined();
    expect(decodeGreeting(SECRET, 'user-1', 'a.b.c')).toBeUndefined();
  });

  it('cuts a very long name short', () => {
    const value = encodeGreeting(SECRET, 'user-1', 'x'.repeat(500));
    expect(decodeGreeting(SECRET, 'user-1', value)).toHaveLength(60);
  });
});

describe('the Origin check', () => {
  const config = { appOrigin: 'https://bigsim.example' };

  it('accepts the app’s own origin', () => {
    expect(isSameOrigin('https://bigsim.example', config)).toBe(true);
  });

  it('refuses a missing, different or lookalike origin', () => {
    for (const origin of [
      null,
      '',
      'null',
      'https://evil.example',
      'https://bigsim.example.evil.example',
      'http://bigsim.example',
    ]) {
      expect(isSameOrigin(origin, config)).toBe(false);
    }
  });
});
