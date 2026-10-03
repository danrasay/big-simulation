/**
 * Database tables for access control.
 *
 * Nothing here can hold an email address, a name or a Google token. A person
 * is a student code plus keyed hashes. See docs/PLAN.md, "Access control".
 *
 * Row-level security is enabled on every table with no policies. The app
 * connects as the table owner, which is not subject to it. The effect is that
 * Supabase's web API roles can read nothing, even if that API is left on.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** One course section in one term. */
export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    term: text('term').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('sections_term_name_unique').on(table.term, table.name),
    check('sections_status_check', sql`${table.status} in ('open', 'closed')`),
  ],
).enableRLS();

/** Who may enter a section. The email is stored only as a keyed hash. */
export const roster = pgTable(
  'roster',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    emailHmac: text('email_hmac').notNull(),
    studentCode: text('student_code').notNull(),
    role: text('role', { enum: ['student', 'instructor'] })
      .notNull()
      .default('student'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('roster_section_email_unique').on(table.sectionId, table.emailHmac),
    unique('roster_section_code_unique').on(table.sectionId, table.studentCode),
    index('roster_email_idx').on(table.emailHmac),
    check('roster_role_check', sql`${table.role} in ('student', 'instructor')`),
  ],
).enableRLS();

/**
 * A person who has signed in. Keyed by a hash of the Google account id.
 *
 * For someone admitted through a roster, role, student_code and section_id
 * are a record of their last sign-in. What they may do right now is read
 * from their roster row on every request, so a roster change or a removal
 * takes effect at once.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subHmac: text('sub_hmac').notNull().unique('users_sub_unique'),
    /** How the person got in: a roster row, the bootstrap instructor setting, or the domain alone. */
    admittedBy: text('admitted_by', { enum: ['roster', 'bootstrap', 'domain'] }).notNull(),
    /** The roster row that admitted them. Empty once that row is removed, which ends their access. */
    rosterId: uuid('roster_id').references(() => roster.id, { onDelete: 'set null' }),
    role: text('role', { enum: ['student', 'instructor'] }).notNull(),
    /** Absent only for a bootstrap instructor who is on no roster. */
    studentCode: text('student_code'),
    sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('users_role_check', sql`${table.role} in ('student', 'instructor')`),
    check('users_admitted_by_check', sql`${table.admittedBy} in ('roster', 'bootstrap', 'domain')`),
  ],
).enableRLS();

/** A live sign-in. Only the SHA-256 of the session token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique('sessions_token_unique'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
).enableRLS();

/** Sign-ins, sign-outs and instructor actions, by student code. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** A student code, or "instructor" for the bootstrap instructor. */
    actorCode: text('actor_code').notNull(),
    action: text('action').notNull(),
    target: text('target'),
  },
  (table) => [index('audit_log_at_idx').on(table.at)],
).enableRLS();
