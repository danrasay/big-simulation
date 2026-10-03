import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/lib/config';
import {
  createAuthorizationRequest,
  decodePending,
  encodePending,
  exchangeCode,
  redirectUri,
  stateMatches,
} from '../src/lib/oidc';

const config = loadConfig({
  APP_URL: 'https://bigsim.example',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  IDENTITY_PEPPER: 'pepper-pepper-pepper-pepper-pepper-1',
  SESSION_SECRET: 'secret-secret-secret-secret-secret-1',
});

describe('createAuthorizationRequest', () => {
  const { url, pending } = createAuthorizationRequest(config);
  const parsed = new URL(url);
  const param = (name: string): string | null => parsed.searchParams.get(name);

  it('sends the browser to Google with the code flow and the sign-in scopes only', () => {
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(param('response_type')).toBe('code');
    expect(param('scope')).toBe('openid email profile');
    expect(param('client_id')).toBe('client-id');
    expect(param('redirect_uri')).toBe('https://bigsim.example/auth/callback');
    expect(redirectUri(config)).toBe('https://bigsim.example/auth/callback');
  });

  it('carries state, nonce and a PKCE challenge derived from the verifier', () => {
    expect(param('state')).toBe(pending.state);
    expect(param('nonce')).toBe(pending.nonce);
    expect(param('code_challenge_method')).toBe('S256');
    expect(param('code_challenge')).toBe(
      createHash('sha256').update(pending.codeVerifier).digest('base64url'),
    );
    // The verifier itself never goes in the URL.
    expect(url).not.toContain(pending.codeVerifier);
  });

  it('hints at the college domain and asks which account to use', () => {
    expect(param('hd')).toBe('lclark.edu');
    expect(param('prompt')).toBe('select_account');
  });

  it('uses fresh random values every time', () => {
    const again = createAuthorizationRequest(config).pending;
    expect(again.state).not.toBe(pending.state);
    expect(again.nonce).not.toBe(pending.nonce);
    expect(again.codeVerifier).not.toBe(pending.codeVerifier);
  });
});

describe('the pending sign-in cookie', () => {
  const pending = { state: 's', nonce: 'n', codeVerifier: 'v' };

  it('round-trips', () => {
    expect(decodePending(encodePending(pending))).toEqual(pending);
  });

  it('is rejected when missing or malformed', () => {
    expect(decodePending(undefined)).toBeUndefined();
    expect(decodePending('')).toBeUndefined();
    expect(decodePending('not base64 json')).toBeUndefined();
    expect(decodePending(Buffer.from('"text"').toString('base64url'))).toBeUndefined();
    expect(decodePending(Buffer.from('{"state":"s"}').toString('base64url'))).toBeUndefined();
    expect(
      decodePending(
        Buffer.from('{"state":"","nonce":"n","codeVerifier":"v"}').toString('base64url'),
      ),
    ).toBeUndefined();
  });

  it('matches only the state it was issued with', () => {
    expect(stateMatches(pending, 's')).toBe(true);
    expect(stateMatches(pending, 'x')).toBe(false);
    expect(stateMatches(pending, null)).toBe(false);
  });
});

describe('exchangeCode', () => {
  it('posts the code and the PKCE verifier to Google and returns only the ID token', async () => {
    let sent: { url: string; body: URLSearchParams; method: string | undefined } | undefined;
    const fakeFetch = (url: string, init: RequestInit): Promise<Response> => {
      sent = { url, body: new URLSearchParams(init.body as string), method: init.method };
      return Promise.resolve(
        Response.json({
          id_token: 'the-id-token',
          access_token: 'unused',
          refresh_token: 'unused',
        }),
      );
    };
    const idToken = await exchangeCode(config, 'the-code', 'the-verifier', fakeFetch);
    expect(idToken).toBe('the-id-token');
    expect(sent?.url).toBe('https://oauth2.googleapis.com/token');
    expect(sent?.method).toBe('POST');
    expect(Object.fromEntries(sent?.body ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      client_id: 'client-id',
      client_secret: 'client-secret',
      redirect_uri: 'https://bigsim.example/auth/callback',
    });
  });

  it('returns nothing when Google refuses the code', async () => {
    const refused = (): Promise<Response> =>
      Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect(await exchangeCode(config, 'bad', 'v', refused)).toBeUndefined();
  });

  it('returns nothing when the response has no ID token', async () => {
    const empty = (): Promise<Response> => Promise.resolve(Response.json({ access_token: 'x' }));
    expect(await exchangeCode(config, 'code', 'v', empty)).toBeUndefined();
  });

  it('returns nothing, rather than failing, when Google cannot be reached or answers with something else', async () => {
    const unreachable = (): Promise<Response> => Promise.reject(new Error('network down'));
    const notJson = (): Promise<Response> => Promise.resolve(new Response('<html>busy</html>'));
    expect(await exchangeCode(config, 'code', 'verifier', unreachable)).toBeUndefined();
    expect(await exchangeCode(config, 'code', 'verifier', notJson)).toBeUndefined();
  });
});
