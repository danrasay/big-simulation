/**
 * Pseudonymous identity.
 *
 * The database never holds an email address or a Google account id. It holds
 * keyed hashes of them. Without the pepper, a hash cannot be matched back to
 * a person; with it, anyone holding a list of college emails could. So the
 * pepper lives only in the host's secret store.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Emails are compared case-insensitively and without surrounding space. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function keyedHash(pepper: string, purpose: string, value: string): string {
  // The purpose prefix keeps an email hash and an account-id hash of the same
  // text from ever being equal.
  return createHmac('sha256', pepper).update(`${purpose}:${value}`).digest('hex');
}

/** The stored stand-in for an email address. */
export function hashEmail(pepper: string, email: string): string {
  return keyedHash(pepper, 'email', normalizeEmail(email));
}

/** The stored stand-in for a Google account id (the `sub` claim). */
export function hashSubject(pepper: string, subject: string): string {
  return keyedHash(pepper, 'sub', subject);
}

/** A random token for cookies and OAuth parameters: 256 bits, URL-safe. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of a token, hex. Session tokens are stored only in this form. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Compares two strings without leaking, through timing, where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Signs a short value with the session secret, for cookies the app sets and reads back. */
export function sign(secret: string, value: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('base64url');
  return `${Buffer.from(value).toString('base64url')}.${signature}`;
}

/** Returns the value from `sign`, or undefined if it was altered or is malformed. */
export function unsign(secret: string, signed: string): string | undefined {
  const [encoded, signature, ...rest] = signed.split('.');
  if (encoded === undefined || signature === undefined || rest.length > 0) return undefined;
  const value = Buffer.from(encoded, 'base64url').toString();
  const expected = createHmac('sha256', secret).update(value).digest('base64url');
  return safeEqual(signature, expected) ? value : undefined;
}
