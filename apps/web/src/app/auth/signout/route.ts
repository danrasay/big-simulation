import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { actorCode, recordAudit } from '../../../lib/audit';
import { cookieNames, expiredCookieOptions } from '../../../lib/cookies';
import { isSameOrigin } from '../../../lib/origin';
import { destroySession, findSessionUser } from '../../../lib/sessions';
import { getConfig, getDb } from '../../../server/context';

/** Ends the session. A POST from the app's own pages only, so another site cannot sign someone out. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  if (!isSameOrigin(request.headers.get('origin'), config)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const names = cookieNames(config);
  const jar = await cookies();
  const token = jar.get(names.session)?.value;
  if (token !== undefined && token !== '') {
    const db = getDb();
    const user = await findSessionUser(db, token);
    await destroySession(db, token);
    if (user !== undefined) await recordAudit(db, actorCode(user), 'sign_out');
  }
  for (const name of [names.session, names.greeting, names.pending]) {
    jar.set(name, '', expiredCookieOptions(config));
  }
  return NextResponse.redirect(new URL('/login', config.appOrigin), {
    status: 303,
    headers: { 'Cache-Control': 'no-store' },
  });
}
