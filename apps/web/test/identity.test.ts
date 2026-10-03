import { describe, expect, it } from 'vitest';
import {
  hashEmail,
  hashSubject,
  hashToken,
  normalizeEmail,
  randomToken,
  safeEqual,
  sign,
  unsign,
} from '../src/lib/identity';

const PEPPER = 'pepper-pepper-pepper-pepper-pepper-1';

describe('keyed hashes', () => {
  it('hash an email the same way whatever its case or padding', () => {
    expect(hashEmail(PEPPER, ' Pat.Student@College.Example ')).toBe(
      hashEmail(PEPPER, 'pat.student@college.example'),
    );
    expect(normalizeEmail(' Pat.Student@College.Example ')).toBe('pat.student@college.example');
  });

  it('do not contain the email', () => {
    const hash = hashEmail(PEPPER, 'pat.student@college.example');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('pat');
  });

  it('change completely with the pepper', () => {
    const other = 'another-pepper-another-pepper-another';
    expect(hashEmail(PEPPER, 'pat.student@college.example')).not.toBe(
      hashEmail(other, 'pat.student@college.example'),
    );
  });

  it('keep email hashes and account-id hashes apart, even for the same text', () => {
    expect(hashEmail(PEPPER, 'same-text')).not.toBe(hashSubject(PEPPER, 'same-text'));
  });
});

describe('tokens', () => {
  it('are 256 bits, URL-safe and different every time', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('are stored as a SHA-256 that does not reveal them', () => {
    const token = randomToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});

describe('safeEqual', () => {
  it('compares strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('signed cookie values', () => {
  const SECRET = 'secret-secret-secret-secret-secret-1';

  it('round-trip', () => {
    expect(unsign(SECRET, sign(SECRET, 'Pat'))).toBe('Pat');
    expect(unsign(SECRET, sign(SECRET, 'Zoë O’Neil'))).toBe('Zoë O’Neil');
  });

  it('are rejected when altered, re-signed with another secret, or malformed', () => {
    const signed = sign(SECRET, 'Pat');
    const [value, signature] = signed.split('.');
    const forged = `${Buffer.from('Sam').toString('base64url')}.${signature ?? ''}`;
    expect(unsign(SECRET, forged)).toBeUndefined();
    expect(unsign(SECRET, sign('another-secret-another-secret-another', 'Pat'))).toBeUndefined();
    expect(unsign(SECRET, value ?? '')).toBeUndefined();
    expect(unsign(SECRET, `${signed}.extra`)).toBeUndefined();
    expect(unsign(SECRET, '')).toBeUndefined();
  });
});
