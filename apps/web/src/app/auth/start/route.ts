import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { cookieNames, pendingCookieOptions } from '../../../lib/cookies';
import { createAuthorizationRequest, encodePending } from '../../../lib/oidc';
import { getConfig } from '../../../server/context';

/** Sends the browser to Google to sign in, remembering what to expect back. */
export async function GET(): Promise<NextResponse> {
  const config = getConfig();
  const { url, pending } = createAuthorizationRequest(config);
  const jar = await cookies();
  jar.set(cookieNames(config).pending, encodePending(pending), pendingCookieOptions(config));
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
