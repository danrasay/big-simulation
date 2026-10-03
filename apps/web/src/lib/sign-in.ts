/**
 * The roster gate, and what happens after it.
 *
 * By the time this runs, Google has vouched for the person and the domain
 * gate has passed. This decides whether they may enter, and if so creates
 * their user row (on first visit) and a session.
 */
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { roster, sections, users } from '../db/schema';
import { recordAudit } from './audit';
import type { Config } from './config';
import type { VerifiedIdentity } from './id-token';
import { hashEmail, hashSubject, normalizeEmail, randomToken } from './identity';
import { createSession, deleteExpiredSessions } from './sessions';
import type { Role, SessionUser } from './sessions';

export type SignInResult =
  | {
      readonly kind: 'signed_in';
      readonly token: string;
      readonly expiresAt: Date;
      readonly user: SessionUser;
    }
  /** A college account that is on no roster of an open section. Nothing was stored. */
  | { readonly kind: 'not_on_roster' };

type SignInConfig = Pick<Config, 'identityPepper' | 'requireRoster' | 'bootstrapInstructorEmail'>;

/** A code for someone admitted without a roster, when REQUIRE_ROSTER is false. */
function generatedCode(): string {
  return `U-${randomToken()
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase()}`;
}

export async function completeSignIn(
  db: Db,
  identity: VerifiedIdentity,
  config: SignInConfig,
  now: Date = new Date(),
): Promise<SignInResult> {
  const emailHash = hashEmail(config.identityPepper, identity.email);
  const subjectHash = hashSubject(config.identityPepper, identity.subject);

  // A student needs a row in an open section. An instructor's row counts
  // whatever the section's state, or closing a section could lock its
  // instructor out. If someone has several rows, an instructor row wins,
  // then the newest; the id breaks ties so the choice never varies.
  const [entry] = await db
    .select({
      id: roster.id,
      sectionId: roster.sectionId,
      studentCode: roster.studentCode,
      role: roster.role,
    })
    .from(roster)
    .innerJoin(sections, eq(roster.sectionId, sections.id))
    .where(
      and(
        eq(roster.emailHmac, emailHash),
        or(eq(sections.status, 'open'), eq(roster.role, 'instructor')),
      ),
    )
    .orderBy(sql`(${roster.role} = 'instructor') desc`, desc(roster.createdAt), asc(roster.id))
    .limit(1);

  const isBootstrapInstructor =
    config.bootstrapInstructorEmail !== undefined &&
    normalizeEmail(config.bootstrapInstructorEmail) === normalizeEmail(identity.email);

  if (entry === undefined && !isBootstrapInstructor && config.requireRoster) {
    return { kind: 'not_on_roster' };
  }

  const [existing] = await db.select().from(users).where(eq(users.subHmac, subjectHash)).limit(1);

  // The bootstrap setting outranks a roster row, so it is not tied to one.
  const admittedBy = isBootstrapInstructor
    ? 'bootstrap'
    : entry !== undefined
      ? 'roster'
      : 'domain';
  const rosterId = admittedBy === 'roster' ? (entry?.id ?? null) : null;
  const role: Role = isBootstrapInstructor ? 'instructor' : (entry?.role ?? 'student');
  let studentCode: string | null;
  if (entry !== undefined) {
    studentCode = entry.studentCode;
  } else if (isBootstrapInstructor) {
    studentCode = null;
  } else {
    // Admitted on the domain alone. Keep the code from an earlier visit.
    studentCode = existing?.studentCode ?? generatedCode();
  }
  const sectionId = entry?.sectionId ?? null;

  const values = { admittedBy, rosterId, role, studentCode, sectionId, lastSignInAt: now } as const;
  const [saved] = await db
    .insert(users)
    .values({ subHmac: subjectHash, createdAt: now, ...values })
    .onConflictDoUpdate({ target: users.subHmac, set: values })
    .returning();
  if (saved === undefined) throw new Error('user row was not saved');

  const user: SessionUser = {
    id: saved.id,
    role: saved.role,
    studentCode: saved.studentCode,
    sectionId: saved.sectionId,
  };
  await deleteExpiredSessions(db, now);
  const session = await createSession(db, user.id, now);
  await recordAudit(db, user.studentCode ?? 'instructor', 'sign_in');
  return { kind: 'signed_in', token: session.token, expiresAt: session.expiresAt, user };
}
