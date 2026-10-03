import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client';
import { auditLog, roster, sessions, users } from '../src/db/schema';
import type { VerifiedIdentity } from '../src/lib/id-token';
import { hashEmail } from '../src/lib/identity';
import { importRoster, parseRoster } from '../src/lib/roster';
import { createSection, setSectionStatus } from '../src/lib/sections';
import { findSessionUser } from '../src/lib/sessions';
import { completeSignIn } from '../src/lib/sign-in';
import { PEPPER, clearTestDb, createTestDb, dumpDatabase, rowCounts } from './helpers';

const NOW = new Date('2026-09-01T16:00:00Z');

const pat: VerifiedIdentity = {
  subject: '108000000000000000001',
  email: 'patrice.quimby@college.example',
  givenName: 'Patrice',
};
const sam: VerifiedIdentity = {
  subject: '108000000000000000002',
  email: 'samira.oyelaran@college.example',
  givenName: 'Samira',
};
const dana: VerifiedIdentity = {
  subject: '108000000000000000003',
  email: 'danielle.whitlock@college.example',
  givenName: 'Danielle',
};

const config = {
  identityPepper: PEPPER,
  requireRoster: true,
  bootstrapInstructorEmail: undefined,
} as const;

let db: Db;
let sectionId: string;

async function addToRoster(csv: string): Promise<void> {
  const parsed = parseRoster(csv, 'college.example');
  expect(parsed.problems).toEqual([]);
  const result = await importRoster(db, parsed.rows, PEPPER);
  expect(result.ok).toBe(true);
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await clearTestDb(db);
  const created = await createSection(db, 'Fall 2026', 'ELI 275-01');
  if (!created.ok) throw new Error(created.error);
  sectionId = created.id;
  await addToRoster(
    'email,student_code,section\npatrice.quimby@college.example,S-014,ELI 275-01\n',
  );
});

describe('the roster gate', () => {
  it('admits a college account on the roster of an open section', async () => {
    const result = await completeSignIn(db, pat, config, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user).toMatchObject({ role: 'student', studentCode: 'S-014', sectionId });
    expect(await findSessionUser(db, result.token, NOW)).toEqual(result.user);
  });

  it('matches the roster whatever the case of the email', async () => {
    const result = await completeSignIn(
      db,
      { ...pat, email: 'Patrice.Quimby@College.Example' },
      config,
      NOW,
    );
    expect(result.kind).toBe('signed_in');
  });

  it('refuses a college account that is on no roster, and stores nothing about it', async () => {
    const before = await rowCounts(db);
    const dumpBefore = await dumpDatabase(db);
    const result = await completeSignIn(db, sam, config, NOW);
    expect(result).toEqual({ kind: 'not_on_roster' });
    expect(await rowCounts(db)).toEqual(before);
    expect(await dumpDatabase(db)).toBe(dumpBefore);
  });

  it('refuses someone whose only section is closed', async () => {
    await setSectionStatus(db, sectionId, 'closed');
    const before = await rowCounts(db);
    expect(await completeSignIn(db, pat, config, NOW)).toEqual({ kind: 'not_on_roster' });
    expect(await rowCounts(db)).toEqual(before);
  });

  it('signs a section\u2019s students out when it closes, and leaves instructors signed in', async () => {
    await addToRoster(
      'email,student_code,section,role\ndanielle.whitlock@college.example,T-001,ELI 275-01,instructor\n',
    );
    const student = await completeSignIn(db, pat, config, NOW);
    const instructor = await completeSignIn(db, dana, config, NOW);
    if (student.kind !== 'signed_in' || instructor.kind !== 'signed_in')
      throw new Error('expected sign-ins');
    await setSectionStatus(db, sectionId, 'closed');
    expect(await findSessionUser(db, student.token, NOW)).toBeUndefined();
    expect(await findSessionUser(db, instructor.token, NOW)).toBeDefined();
  });

  it('lets an instructor in even when their only section is closed, so they can reopen it', async () => {
    await addToRoster(
      'email,student_code,section,role\ndanielle.whitlock@college.example,T-001,ELI 275-01,instructor\n',
    );
    await setSectionStatus(db, sectionId, 'closed');
    const result = await completeSignIn(db, dana, config, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user.role).toBe('instructor');
    expect(await findSessionUser(db, result.token, NOW)).toEqual(result.user);
  });

  it('gives the instructor role to someone who teaches one section and is listed as a student in another', async () => {
    const second = await createSection(db, 'Fall 2026', 'ELI 275-02');
    if (!second.ok) throw new Error(second.error);
    // Both orders, and both rows in one upload, so the outcome cannot depend on which row is newer.
    await addToRoster(
      [
        'email,student_code,section,role',
        'danielle.whitlock@college.example,S-300,ELI 275-02,student',
        'danielle.whitlock@college.example,T-001,ELI 275-01,instructor',
        'samira.oyelaran@college.example,T-002,ELI 275-01,instructor',
        'samira.oyelaran@college.example,S-301,ELI 275-02,student',
      ].join('\n'),
    );
    for (const person of [dana, sam]) {
      const result = await completeSignIn(db, person, config, NOW);
      if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
      expect(result.user).toMatchObject({ role: 'instructor', sectionId });
    }
  });

  it('uses the open section when someone is on an open and a closed roster', async () => {
    const second = await createSection(db, 'Spring 2027', 'ELI 275-02');
    if (!second.ok) throw new Error(second.error);
    await addToRoster(
      'email,student_code,section\npatrice.quimby@college.example,S-201,ELI 275-02\n',
    );
    await setSectionStatus(db, sectionId, 'closed');
    const result = await completeSignIn(db, pat, config, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user).toMatchObject({ studentCode: 'S-201', sectionId: second.id });
  });

  it('gives the instructor role to someone the roster lists as instructor', async () => {
    await addToRoster(
      'email,student_code,section,role\ndanielle.whitlock@college.example,T-001,ELI 275-01,instructor\n',
    );
    const result = await completeSignIn(db, dana, config, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user.role).toBe('instructor');
  });

  it('never gives the instructor role to a student', async () => {
    const result = await completeSignIn(
      db,
      pat,
      { ...config, bootstrapInstructorEmail: 'danielle.whitlock@college.example' },
      NOW,
    );
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user.role).toBe('student');
  });
});

describe('returning visitors', () => {
  it('keeps one user row across sign-ins and gives each sign-in its own session', async () => {
    const first = await completeSignIn(db, pat, config, NOW);
    const second = await completeSignIn(db, pat, config, new Date(NOW.getTime() + 60_000));
    if (first.kind !== 'signed_in' || second.kind !== 'signed_in')
      throw new Error('expected sign-ins');
    expect(second.user.id).toBe(first.user.id);
    expect(second.token).not.toBe(first.token);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(2);
  });

  it('picks up a changed code or role from the roster at the next sign-in', async () => {
    await completeSignIn(db, pat, config, NOW);
    await addToRoster(
      'email,student_code,section,role\npatrice.quimby@college.example,S-099,ELI 275-01,instructor\n',
    );
    const result = await completeSignIn(db, pat, config, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user).toMatchObject({ role: 'instructor', studentCode: 'S-099' });
  });

  it('refuses a returning student once their roster row is gone', async () => {
    await completeSignIn(db, pat, config, NOW);
    await db.delete(roster).where(eq(roster.emailHmac, hashEmail(PEPPER, pat.email)));
    expect(await completeSignIn(db, pat, config, NOW)).toEqual({ kind: 'not_on_roster' });
  });
});

describe('a session that is already open', () => {
  it('ends as soon as the person\u2019s roster row is gone', async () => {
    const result = await completeSignIn(db, pat, config, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    await db.delete(roster).where(eq(roster.emailHmac, hashEmail(PEPPER, pat.email)));
    expect(await findSessionUser(db, result.token, NOW)).toBeUndefined();
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it('loses the instructor role as soon as the roster says student', async () => {
    await addToRoster(
      'email,student_code,section,role\ndanielle.whitlock@college.example,T-001,ELI 275-01,instructor\n',
    );
    const result = await completeSignIn(db, dana, config, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect((await findSessionUser(db, result.token, NOW))?.role).toBe('instructor');

    await addToRoster(
      'email,student_code,section,role\ndanielle.whitlock@college.example,S-077,ELI 275-01,student\n',
    );
    expect(await findSessionUser(db, result.token, NOW)).toMatchObject({
      role: 'student',
      studentCode: 'S-077',
    });
  });

  it('ends for a student when the section closes, and does not come back when it reopens', async () => {
    const result = await completeSignIn(db, pat, config, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    await setSectionStatus(db, sectionId, 'closed');
    expect(await findSessionUser(db, result.token, NOW)).toBeUndefined();
    await setSectionStatus(db, sectionId, 'open');
    expect(await findSessionUser(db, result.token, NOW)).toBeUndefined();
  });

  it('does not depend on the roster for the bootstrap instructor', async () => {
    const withBootstrap = { ...config, bootstrapInstructorEmail: dana.email };
    await addToRoster(
      'email,student_code,section,role\ndanielle.whitlock@college.example,S-078,ELI 275-01,student\n',
    );
    const result = await completeSignIn(db, dana, withBootstrap, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user.role).toBe('instructor');
    await setSectionStatus(db, sectionId, 'closed');
    expect((await findSessionUser(db, result.token, NOW))?.role).toBe('instructor');
  });

  it('is cleared out at a later sign-in once it has expired', async () => {
    await completeSignIn(db, pat, config, NOW);
    const eightDaysLater = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    await completeSignIn(db, pat, config, eightDaysLater);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });
});

describe('the bootstrap instructor', () => {
  const withBootstrap = {
    ...config,
    bootstrapInstructorEmail: 'Danielle.Whitlock@college.example',
  };

  it('is admitted as instructor without being on a roster', async () => {
    const result = await completeSignIn(db, dana, withBootstrap, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user).toMatchObject({ role: 'instructor', studentCode: null, sectionId: null });
  });

  it('is admitted before any section exists', async () => {
    await clearTestDb(db);
    const result = await completeSignIn(db, dana, withBootstrap, NOW);
    expect(result.kind).toBe('signed_in');
  });

  it('does not open the door for anyone else', async () => {
    expect(await completeSignIn(db, sam, withBootstrap, NOW)).toEqual({ kind: 'not_on_roster' });
  });
});

describe('with the roster requirement turned off', () => {
  const open = { ...config, requireRoster: false };

  it('admits any college account as a student with a generated code', async () => {
    const result = await completeSignIn(db, sam, open, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user.role).toBe('student');
    expect(result.user.studentCode).toMatch(/^U-[A-Z0-9]{8}$/);
    expect(result.user.sectionId).toBeNull();
  });

  it('keeps the same generated code on later visits', async () => {
    const first = await completeSignIn(db, sam, open, NOW);
    const second = await completeSignIn(db, sam, open, NOW);
    if (first.kind !== 'signed_in' || second.kind !== 'signed_in')
      throw new Error('expected sign-ins');
    expect(second.user.studentCode).toBe(first.user.studentCode);
  });

  it('still uses the roster code for someone who is on a roster', async () => {
    const result = await completeSignIn(db, pat, open, NOW);
    if (result.kind !== 'signed_in') throw new Error('expected a sign-in');
    expect(result.user.studentCode).toBe('S-014');
  });
});

describe('what the database holds after people sign in', () => {
  it('contains no email address, no name and no Google account id', async () => {
    await addToRoster(
      'email,student_code,section,role\ndanielle.whitlock@college.example,T-001,ELI 275-01,instructor\n',
    );
    const bootstrap = {
      ...config,
      bootstrapInstructorEmail: 'rosalind.achterberg@college.example',
    };
    const boss: VerifiedIdentity = {
      subject: '108000000000000000009',
      email: 'rosalind.achterberg@college.example',
      givenName: 'Rosalind',
    };
    for (const person of [pat, dana, boss]) {
      expect((await completeSignIn(db, person, bootstrap, NOW)).kind).toBe('signed_in');
    }
    await completeSignIn(db, sam, bootstrap, NOW);
    await completeSignIn(db, sam, { ...bootstrap, requireRoster: false }, NOW);

    const dump = (await dumpDatabase(db)).toLowerCase();
    expect(dump).not.toContain('@');
    expect(dump).not.toContain('college');
    for (const person of [pat, sam, dana, boss]) {
      const [localPart] = person.email.split('@');
      const pieces = [person.subject, person.givenName ?? '', ...(localPart ?? '').split('.')];
      for (const piece of pieces) {
        expect(piece.length).toBeGreaterThan(5);
        expect(dump).not.toContain(piece.toLowerCase());
      }
    }
  });

  it('records sign-ins in the audit log by code only', async () => {
    await completeSignIn(db, pat, config, NOW);
    const entries = await db.select().from(auditLog);
    expect(entries.map((entry) => [entry.actorCode, entry.action])).toEqual([['S-014', 'sign_in']]);
  });
});
