/**
 * Who is making this request.
 *
 * Every page and every server action that needs a signed-in person calls
 * requireUser or requireInstructor itself. Nothing relies on a layout or a
 * proxy having checked first.
 */
import { cookies, headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { cookieNames, decodeGreeting } from '../lib/cookies';
import { isSameOrigin } from '../lib/origin';
import { findSessionUser } from '../lib/sessions';
import type { SessionUser } from '../lib/sessions';
import { getConfig, getDb } from './context';

/** The signed-in person, or undefined. Looked up once per request. */
export const currentUser = cache(async (): Promise<SessionUser | undefined> => {
  const config = getConfig();
  const jar = await cookies();
  const token = jar.get(cookieNames(config).session)?.value;
  if (token === undefined || token === '') return undefined;
  return findSessionUser(getDb(), token);
});

/** The signed-in person. Sends anyone else to the sign-in page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (user === undefined) redirect('/login');
  return user;
}

/** The signed-in instructor. Sends visitors to sign in, and answers 403 to students. */
export async function requireInstructor(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'instructor') forbidden();
  return user;
}

/**
 * The guard for an instructor's server action. As well as the role, it checks
 * that the request came from the app's own pages. Next.js makes a similar
 * check itself, but lets a request with no Origin header through.
 */
export async function requireInstructorForAction(): Promise<SessionUser> {
  const origin = (await headers()).get('origin');
  if (!isSameOrigin(origin, getConfig())) forbidden();
  return requireInstructor();
}

/** The person's first name from their own greeting cookie, if they have one. */
export async function greetingName(user: SessionUser): Promise<string | undefined> {
  const config = getConfig();
  const jar = await cookies();
  return decodeGreeting(
    config.sessionSecret,
    user.id,
    jar.get(cookieNames(config).greeting)?.value,
  );
}
