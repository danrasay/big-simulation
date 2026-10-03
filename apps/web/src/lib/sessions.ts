/**
 * Sessions.
 *
 * A session is a random 256-bit token in the browser's cookie and the
 * SHA-256 of that token in the database. Someone who reads the database
 * cannot use what they find there to sign in.
 */
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { roster, sections, sessions, users } from '../db/schema';
import { hashToken, randomToken } from './identity';

/** A session ends after this long without a request. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
/** A session ends this long after sign-in, however active it is. */
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** The last-seen time is written at most this often, to keep reads from becoming writes. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type Role = 'student' | 'instructor';

/** The signed-in person as the app knows them: a code and a role, never a name. */
export interface SessionUser {
  readonly id: string;
  readonly role: Role;
  /** Absent only for the bootstrap instructor. */
  readonly studentCode: string | null;
  readonly sectionId: string | null;
}

export async function createSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * The user a session token belongs to, or undefined if the session is
 * unknown, idle too long or expired, or the person's access has ended.
 *
 * Someone admitted through a roster is checked against their roster row on
 * every request. Their role and code come from that row as it is now. If the
 * row is gone, or its section is closed and they are a student, the session
 * ends.
 */
export async function findSessionUser(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<SessionUser | undefined> {
  if (token === '') return undefined;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      id: users.id,
      admittedBy: users.admittedBy,
      role: users.role,
      studentCode: users.studentCode,
      sectionId: users.sectionId,
      rosterRole: roster.role,
      rosterCode: roster.studentCode,
      rosterSectionId: roster.sectionId,
      sectionStatus: sections.status,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(roster, eq(users.rosterId, roster.id))
    .leftJoin(sections, eq(roster.sectionId, sections.id))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (row === undefined) return undefined;

  const end = async (): Promise<undefined> => {
    await db.delete(sessions).where(eq(sessions.id, row.sessionId));
    return undefined;
  };

  const idleFor = now.getTime() - row.lastSeenAt.getTime();
  if (now.getTime() >= row.expiresAt.getTime() || idleFor > SESSION_IDLE_MS) return end();

  let user: SessionUser;
  if (row.admittedBy === 'roster') {
    if (row.rosterRole === null || row.rosterCode === null) return end();
    if (row.rosterRole === 'student' && row.sectionStatus !== 'open') return end();
    user = {
      id: row.id,
      role: row.rosterRole,
      studentCode: row.rosterCode,
      sectionId: row.rosterSectionId,
    };
  } else {
    user = { id: row.id, role: row.role, studentCode: row.studentCode, sectionId: row.sectionId };
  }

  if (idleFor > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return user;
}

/** Ends a session. Safe to call with a token that no longer exists. */
export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Removes sessions past their absolute expiry. Returns how many were removed. */
export async function deleteExpiredSessions(db: Db, now: Date = new Date()): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return removed.length;
}
