/**
 * Access checks over HTTP, against the built app and a real Postgres.
 *
 * These cover what the unit tests cannot: the status codes, redirects and
 * cookies a browser actually receives. Google is never contacted. Signed-in
 * people are set up by writing a session row, the same row a sign-in writes.
 *
 * Needs `next build` to have run, and HTTP_TEST_DATABASE_URL pointing at a
 * throwaway database whose name contains "test". Every table is emptied.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { encodePending } from '../../src/lib/oidc';
import { createSection } from '../../src/lib/sections';
import { createSession } from '../../src/lib/sessions';
import { PEPPER, dumpDatabase, rowCounts } from '../helpers';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_ID = 'http-test-client.apps.googleusercontent.com';

let client: postgres.Sql;
let db: Db;
let server: ChildProcess | undefined;
let origin: string;
let serverLog = '';
let studentCookie: string;
let instructorCookie: string;
let bootstrapCookie: string;
let expiredCookie: string;
let studentToken: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

/** Creates a person and a session for them, as a completed sign-in would. */
async function addUser(
  role: 'student' | 'instructor',
  studentCode: string | null,
  sectionId: string | null,
  signedInAt = new Date(),
): Promise<{ token: string; cookie: string }> {
  let rosterId: string | null = null;
  if (studentCode !== null && sectionId !== null) {
    const [entry] = await db
      .insert(schema.roster)
      .values({ sectionId, emailHmac: `test-email-hash-${studentCode}`, studentCode, role })
      .returning();
    rosterId = entry?.id ?? null;
  }
  const [user] = await db
    .insert(schema.users)
    .values({
      subHmac: `test-sub-hash-${studentCode ?? 'bootstrap'}`,
      admittedBy: rosterId === null ? 'bootstrap' : 'roster',
      rosterId,
      role,
      studentCode,
      sectionId,
    })
    .returning();
  if (user === undefined) throw new Error('user was not created');
  const { token } = await createSession(db, user.id, signedInAt);
  return { token, cookie: `session=${token}` };
}

/** A request as a browser would send it, without following redirects. */
function get(path: string, cookie?: string): Promise<Response> {
  return fetch(`${origin}${path}`, {
    redirect: 'manual',
    headers: cookie === undefined ? {} : { Cookie: cookie },
  });
}

function location(response: Response): string {
  return response.headers.get('location') ?? '';
}

/** The hidden fields of the form that contains the given button label, as React renders them for use without JavaScript. */
function formFields(html: string, buttonLabel: string): FormData {
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((candidate) => candidate.includes(`>${buttonLabel}<`));
  if (form === undefined) throw new Error(`no form with a "${buttonLabel}" button`);
  const data = new FormData();
  for (const input of form.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = /name="([^"]*)"/.exec(input)?.[1];
    const value = /value="([^"]*)"/.exec(input)?.[1] ?? '';
    if (name !== undefined) {
      data.append(name, value.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    }
  }
  return data;
}

function postForm(path: string, cookie: string, data: FormData): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: cookie, Origin: origin },
    body: data,
  });
}

beforeAll(async () => {
  const url = process.env.HTTP_TEST_DATABASE_URL ?? '';
  if (url === '') throw new Error('Set HTTP_TEST_DATABASE_URL to a throwaway Postgres database.');
  if (!new URL(url).pathname.includes('test')) {
    throw new Error(
      'HTTP_TEST_DATABASE_URL must name a database with "test" in its name. These tests empty every table.',
    );
  }

  client = postgres(url, { max: 2, onnotice: () => undefined });
  const real = drizzle(client, { schema });
  await migrate(real, { migrationsFolder: join(appDir, 'drizzle') });
  db = real;
  await db.execute(sql`truncate table audit_log, sessions, users, roster, sections`);

  const section = await createSection(db, 'Fall 2026', 'ELI 275-01');
  if (!section.ok) throw new Error(section.error);
  const student = await addUser('student', 'S-014', section.id);
  studentToken = student.token;
  studentCookie = student.cookie;
  instructorCookie = (await addUser('instructor', 'T-001', section.id)).cookie;
  bootstrapCookie = (await addUser('instructor', null, null)).cookie;
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  expiredCookie = (await addUser('student', 'S-015', section.id, eightDaysAgo)).cookie;

  const port = await freePort();
  origin = `http://localhost:${String(port)}`;
  server = spawn(
    process.execPath,
    [join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)],
    {
      cwd: appDir,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        APP_URL: origin,
        DATABASE_URL: url,
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: 'http-test-client-secret',
        IDENTITY_PEPPER: PEPPER,
        SESSION_SECRET: 'http-test-session-secret-http-test-session',
        ALLOWED_DOMAIN: 'college.example',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stdout?.on('data', (chunk: Buffer) => (serverLog += chunk.toString()));
  server.stderr?.on('data', (chunk: Buffer) => (serverLog += chunk.toString()));

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${origin}/login`, { redirect: 'manual' });
      if (response.status === 200) break;
    } catch {
      // Not listening yet.
    }
    if (server.exitCode !== null || Date.now() > deadline) {
      throw new Error(`The app did not start. Did you run the build?\n${serverLog}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

afterAll(async () => {
  server?.kill();
  await client.end();
});

describe('visitors who are not signed in', () => {
  it('are sent to the sign-in page from every protected page', async () => {
    for (const path of ['/', '/instructor']) {
      const response = await get(path);
      expect(response.status).toBe(307);
      expect(location(response)).toBe('/login');
    }
  });

  it('are sent to the sign-in page with a made-up, empty or expired session cookie', async () => {
    for (const cookie of [
      'session=made-up-token',
      'session=',
      '__Host-session=made-up',
      expiredCookie,
    ]) {
      const response = await get('/', cookie);
      expect(response.status).toBe(307);
      expect(location(response)).toBe('/login');
    }
  });

  it('can read the sign-in page, which credits the source project', async () => {
    const response = await get('/login');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Sign in with Google');
    expect(html).toContain('https://cupola.gettysburg.edu/oer/13');
    expect(html).toContain('CC BY 4.0');
    expect(html).toContain('This version changes');
  });

  it('can read the not-on-roster page, which says nothing was saved', async () => {
    const response = await get('/not-on-roster');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('You are not on the roster');
    expect(html).toContain('Nothing about your account was saved');
    expect(html).toContain('CC BY 4.0');
  });

  it('get protective headers and no server banner', async () => {
    const response = await get('/login');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});

describe('starting a sign-in', () => {
  it('sends the browser to Google with PKCE, state, nonce and the domain hint', async () => {
    const response = await get('/auth/start');
    expect(response.status).toBe(302);
    const target = new URL(location(response));
    expect(target.origin + target.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const params = target.searchParams;
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(`${origin}/auth/callback`);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('hd')).toBe('college.example');
    for (const name of ['state', 'nonce', 'code_challenge']) {
      expect(params.get(name)?.length).toBeGreaterThanOrEqual(43);
    }

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^signin=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=600/i);
    expect(cookie).not.toMatch(/Domain=/i);
    // The secret half of PKCE stays in the cookie and is not sent to Google.
    expect(location(response)).not.toContain('code_verifier');
  });

  it('uses fresh values every time', async () => {
    const first = new URL(location(await get('/auth/start'))).searchParams;
    const second = new URL(location(await get('/auth/start'))).searchParams;
    for (const name of ['state', 'nonce', 'code_challenge']) {
      expect(first.get(name)).not.toBe(second.get(name));
    }
  });
});

describe('the callback', () => {
  it('refuses a return that this browser did not start, sets no session and stores nothing', async () => {
    const before = await rowCounts(db);
    const response = await get('/auth/callback?code=stolen-code&state=made-up');
    expect(response.status).toBe(303);
    expect(location(response)).toBe(`${origin}/sign-in-refused?reason=failed`);
    expect(response.headers.get('set-cookie') ?? '').not.toMatch(/(^|,\s*)session=[^;]/);
    expect(await rowCounts(db)).toEqual(before);
  });

  it('refuses a return whose state does not match the pending cookie', async () => {
    const pending = encodePending({ state: 'expected-state', nonce: 'n', codeVerifier: 'v' });
    const response = await get('/auth/callback?code=some-code&state=forged', `signin=${pending}`);
    expect(response.status).toBe(303);
    expect(location(response)).toBe(`${origin}/sign-in-refused?reason=failed`);
    // The pending cookie is used up either way.
    expect(response.headers.get('set-cookie') ?? '').toMatch(/signin=;.*Max-Age=0/i);
  });

  it('explains a refused personal account in plain words', async () => {
    const html = await (await get('/sign-in-refused?reason=domain')).text();
    expect(html).toContain('A personal Gmail account will not work');
  });
});

describe('a signed-in student', () => {
  it('sees the home page with their code', async () => {
    const response = await get('/', studentCookie);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('S-014');
    expect(html).not.toContain('instructor console');
  });

  it('gets 403 from the instructor console, with none of its content', async () => {
    const response = await get('/instructor', studentCookie);
    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain('This page is for instructors');
    expect(html).not.toContain('Upload a roster');
    expect(html).not.toContain('ELI 275-01');
  });

  it('cannot run an instructor action by posting its form, as a browser without JavaScript would', async () => {
    const page = await (await get('/instructor', instructorCookie)).text();
    const before = await dumpDatabase(db);

    const create = formFields(page, 'Create section');
    create.set('term', 'Fall 2026');
    create.set('name', 'Made by a student');
    const upload = formFields(page, 'Upload roster');
    upload.set(
      'roster',
      new File(['email,student_code,section\nx@college.example,X-1,ELI 275-01\n'], 'r.csv'),
    );
    const close = formFields(page, 'Close');

    for (const form of [create, upload, close]) {
      const response = await postForm('/instructor', studentCookie, form);
      // Next.js answers a refused form post of this kind with its 404 page
      // rather than the 403 page. Either way the action did not run.
      expect([403, 404]).toContain(response.status);
      expect(await response.text()).not.toContain('Upload a roster');
    }
    expect(await dumpDatabase(db)).toBe(before);
  });

  it('gets 403 when calling an instructor action the way the page\u2019s own script does', async () => {
    const page = await (await get('/instructor', instructorCookie)).text();
    const actionId = /\$ACTION_\d+:0" value="\{&quot;id&quot;:&quot;([0-9a-f]+)&quot;/.exec(
      page,
    )?.[1];
    if (actionId === undefined) throw new Error('no action id found in the page');
    const before = await dumpDatabase(db);

    const call = (cookie: string): Promise<Response> => {
      const body = new FormData();
      body.set('1_term', 'Fall 2026');
      body.set('1_name', 'Made by a student');
      body.set('0', JSON.stringify([{ ok: '$undefined', message: '', problems: [] }, '$K1']));
      return fetch(`${origin}/instructor`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Cookie: cookie,
          Origin: origin,
          'Next-Action': actionId,
          Accept: 'text/x-component',
        },
        body,
      });
    };

    expect((await call(studentCookie)).status).toBe(403);
    expect(await dumpDatabase(db)).toBe(before);
    // The same call from an instructor reaches the action, so the 403 above is the role check.
    expect((await call(instructorCookie)).status).toBe(200);
  });

  it('is sent home from the sign-in page', async () => {
    const response = await get('/login', studentCookie);
    expect(response.status).toBe(307);
    expect(location(response)).toBe('/');
  });
});

describe('a signed-in instructor', () => {
  it('sees the instructor console', async () => {
    for (const cookie of [instructorCookie, bootstrapCookie]) {
      const response = await get('/instructor', cookie);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Instructor console');
      expect(html).toContain('ELI 275-01');
    }
  });

  it('can create a section and load a roster, which stores no email', async () => {
    const page = await (await get('/instructor', instructorCookie)).text();

    const create = formFields(page, 'Create section');
    create.set('term', 'Fall 2026');
    create.set('name', 'ELI 275-02');
    const created = await postForm('/instructor', instructorCookie, create);
    expect(created.status).toBeLessThan(400);
    const names = (await db.select().from(schema.sections)).map((section) => section.name);
    expect(names.sort()).toEqual(['ELI 275-01', 'ELI 275-02']);

    const upload = formFields(page, 'Upload roster');
    const csv = 'email,student_code,section\nwinifred.abernathy@college.example,S-101,ELI 275-02\n';
    upload.set('roster', new File([csv], 'roster.csv', { type: 'text/csv' }));
    const uploaded = await postForm('/instructor', instructorCookie, upload);
    expect(uploaded.status).toBeLessThan(400);
    const entries = await db.select().from(schema.roster);
    expect(entries.map((entry) => entry.studentCode)).toContain('S-101');

    const dump = (await dumpDatabase(db)).toLowerCase();
    for (const piece of ['@', 'college', 'winifred', 'abernathy']) {
      expect(dump).not.toContain(piece);
    }
    const actions = (await db.select().from(schema.auditLog)).map(
      (entry) => `${entry.actorCode} ${entry.action}`,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['T-001 section_created', 'T-001 roster_imported']),
    );
  });

  it('is refused when the form is posted from another site, or with no Origin at all', async () => {
    const page = await (await get('/instructor', instructorCookie)).text();
    const before = await dumpDatabase(db);
    for (const headers of [
      { Cookie: instructorCookie, Origin: 'https://evil.example' },
      { Cookie: instructorCookie, Origin: 'null' },
      { Cookie: instructorCookie },
    ]) {
      const create = formFields(page, 'Create section');
      create.set('term', 'Fall 2026');
      create.set('name', 'Cross-site');
      const response = await fetch(`${origin}/instructor`, {
        method: 'POST',
        redirect: 'manual',
        headers,
        body: create,
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(await dumpDatabase(db)).toBe(before);
  });

  it('loses the console at once when the roster says student', async () => {
    const [entry] = await db
      .select()
      .from(schema.roster)
      .where(eq(schema.roster.studentCode, 'T-001'));
    if (entry === undefined) throw new Error('no roster row for the instructor');
    await db.update(schema.roster).set({ role: 'student' }).where(eq(schema.roster.id, entry.id));
    expect((await get('/instructor', instructorCookie)).status).toBe(403);
    await db
      .update(schema.roster)
      .set({ role: 'instructor' })
      .where(eq(schema.roster.id, entry.id));
    expect((await get('/instructor', instructorCookie)).status).toBe(200);
  });
});

describe('signing out', () => {
  const signOut = (headers: Record<string, string>): Promise<Response> =>
    fetch(`${origin}/auth/signout`, { method: 'POST', redirect: 'manual', headers });

  it('is refused without the app’s own Origin, and the session stays', async () => {
    for (const extra of [{}, { Origin: 'https://evil.example' }, { Origin: 'null' }]) {
      const response = await signOut({ Cookie: studentCookie, ...extra });
      expect(response.status).toBe(403);
    }
    expect((await get('/', studentCookie)).status).toBe(200);
  });

  it('is not available as a link', async () => {
    const response = await get('/auth/signout', studentCookie);
    expect(response.status).toBe(405);
    expect((await get('/', studentCookie)).status).toBe(200);
  });

  it('ends the session on the server and clears the cookies', async () => {
    const response = await signOut({ Cookie: studentCookie, Origin: origin });
    expect(response.status).toBe(303);
    expect(location(response)).toBe(`${origin}/login`);
    expect(response.headers.get('set-cookie') ?? '').toMatch(/session=;.*Max-Age=0/i);

    // The old cookie is now worthless, even if someone kept a copy.
    const after = await get('/', `session=${studentToken}`);
    expect(after.status).toBe(307);
    expect(location(after)).toBe('/login');
    const actions = (await db.select().from(schema.auditLog)).map(
      (entry) => `${entry.actorCode} ${entry.action}`,
    );
    expect(actions).toContain('S-014 sign_out');
  });
});
