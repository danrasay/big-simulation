import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleCallback } from '../../../lib/callback';
import type { CallbackRefusal } from '../../../lib/callback';
import {
  cookieNames,
  encodeGreeting,
  expiredCookieOptions,
  sessionCookieOptions,
} from '../../../lib/cookies';
import { getGoogleKeys } from '../../../lib/id-token';
import { getConfig, getDb } from '../../../server/context';

/** What the refused page is told. The page explains each of these in plain words. */
function refusalCode(reason: CallbackRefusal): string {
  if (reason === 'wrong_domain') return 'domain';
  if (reason === 'email_not_verified') return 'unverified';
  if (reason === 'cancelled') return 'cancelled';
  return 'failed';
}

/** Google sends the browser back here after sign-in. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  const names = cookieNames(config);
  const jar = await cookies();
  const pendingCookie = jar.get(names.pending)?.value;
  // The pending cookie is good for one attempt.
  jar.set(names.pending, '', expiredCookieOptions(config));

  const outcome = await handleCallback({
    db: getDb(),
    config,
    keys: getGoogleKeys(),
    pendingCookie,
    params: request.nextUrl.searchParams,
  });

  const to = (path: string): NextResponse =>
    NextResponse.redirect(new URL(path, config.appOrigin), {
      status: 303,
      headers: { 'Cache-Control': 'no-store' },
    });

  if (outcome.kind === 'refused') {
    // The reason is logged without anything that identifies the person.
    console.warn(`sign-in refused: ${outcome.reason}`);
    return to(`/sign-in-refused?reason=${refusalCode(outcome.reason)}`);
  }
  if (outcome.kind === 'not_on_roster') return to('/not-on-roster');

  jar.set(names.session, outcome.token, sessionCookieOptions(config, outcome.expiresAt));
  if (outcome.givenName !== undefined && outcome.givenName !== '') {
    jar.set(
      names.greeting,
      encodeGreeting(config.sessionSecret, outcome.user.id, outcome.givenName),
      sessionCookieOptions(config, outcome.expiresAt),
    );
  } else {
    jar.set(names.greeting, '', expiredCookieOptions(config));
  }
  return to('/');
}
