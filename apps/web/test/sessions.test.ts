import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client';
import { sessions, users } from '../src/db/schema';
import { hashToken } from '../src/lib/identity';
import {
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  createSession,
  deleteExpiredSessions,
  destroySession,
  findSessionUser,
} from '../src/lib/sessions';
import { clearTestDb, createTestDb, dumpDatabase } from './helpers';

const START = new Date('2026-09-01T16:00:00Z');
const after = (ms: number): Date => new Date(START.getTime() + ms);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let db: Db;
let userId: string;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await clearTestDb(db);
  const [user] = await db
    .insert(users)
    .values({ subHmac: 'hash-of-sub', admittedBy: 'domain', role: 'student', studentCode: 'S-001' })
    .returning();
  if (user === undefined) throw new Error('no user');
  userId = user.id;
});

describe('sessions', () => {
  it('finds the user for a fresh session', async () => {
    const { token, expiresAt } = await createSession(db, userId, START);
    expect(expiresAt.getTime()).toBe(START.getTime() + SESSION_MAX_MS);
    const user = await findSessionUser(db, token, after(MINUTE));
    expect(user).toEqual({ id: userId, role: 'student', studentCode: 'S-001', sectionId: null });
  });

  it('stores only the hash of the token', async () => {
    const { token } = await createSession(db, userId, START);
    const dump = await dumpDatabase(db);
    expect(dump).not.toContain(token);
    expect(dump).toContain(hashToken(token));
  });

  it('gives each session a different token', async () => {
    const first = await createSession(db, userId, START);
    const second = await createSession(db, userId, START);
    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThanOrEqual(43);
  });

  it('does not accept an unknown token, or the stored hash used as a token', async () => {
    const { token } = await createSession(db, userId, START);
    expect(await findSessionUser(db, 'not-a-token', START)).toBeUndefined();
    expect(await findSessionUser(db, hashToken(token), START)).toBeUndefined();
    expect(await findSessionUser(db, '', START)).toBeUndefined();
  });

  it('ends a session left idle for more than eight hours, and removes its row', async () => {
    const { token } = await createSession(db, userId, START);
    expect(await findSessionUser(db, token, after(SESSION_IDLE_MS + MINUTE))).toBeUndefined();
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('keeps a session alive while it is used', async () => {
    const { token } = await createSession(db, userId, START);
    for (let hours = 7; hours <= 49; hours += 7) {
      expect(await findSessionUser(db, token, after(hours * HOUR))).toBeDefined();
    }
  });

  it('ends a session seven days after sign-in however active it is', async () => {
    const { token } = await createSession(db, userId, START);
    for (let hours = 6; hours < 168; hours += 6) {
      expect(await findSessionUser(db, token, after(hours * HOUR))).toBeDefined();
    }
    expect(await findSessionUser(db, token, after(SESSION_MAX_MS))).toBeUndefined();
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('does not write on every request', async () => {
    const { token } = await createSession(db, userId, START);
    await findSessionUser(db, token, after(2 * MINUTE));
    const [row] = await db.select().from(sessions);
    expect(row?.lastSeenAt.getTime()).toBe(START.getTime());
    await findSessionUser(db, token, after(10 * MINUTE));
    const [touched] = await db.select().from(sessions);
    expect(touched?.lastSeenAt.getTime()).toBe(after(10 * MINUTE).getTime());
  });

  it('ends a session on sign-out and leaves other sessions alone', async () => {
    const first = await createSession(db, userId, START);
    const second = await createSession(db, userId, START);
    await destroySession(db, first.token);
    await destroySession(db, 'never-existed');
    expect(await findSessionUser(db, first.token, START)).toBeUndefined();
    expect(await findSessionUser(db, second.token, START)).toBeDefined();
  });

  it('removes expired sessions in bulk', async () => {
    await createSession(db, userId, START);
    await createSession(db, userId, after(3 * 24 * HOUR));
    expect(await deleteExpiredSessions(db, after(SESSION_MAX_MS + HOUR))).toBe(1);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('ends every session when the user row is removed', async () => {
    const { token } = await createSession(db, userId, START);
    await db.delete(users).where(eq(users.id, userId));
    expect(await findSessionUser(db, token, START)).toBeUndefined();
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
