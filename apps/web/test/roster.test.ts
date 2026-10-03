import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client';
import { roster } from '../src/db/schema';
import { hashEmail } from '../src/lib/identity';
import { importRoster, parseCsv, parseCsvRecords, parseRoster } from '../src/lib/roster';
import { createSection, listSections, setSectionStatus } from '../src/lib/sections';
import { PEPPER, clearTestDb, createTestDb, dumpDatabase } from './helpers';

const HEADER = 'email,student_code,section';
const parse = (text: string) => parseRoster(text, 'college.example');

describe('reading CSV', () => {
  it('splits plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quotes, doubled quotes, commas and line breaks inside quotes', () => {
    expect(parseCsv('"a,1","say ""hi""","two\nlines"\n')).toEqual([
      ['a,1', 'say "hi"', 'two\nlines'],
    ]);
  });

  it('handles Windows line endings, a byte-order mark and no final line break', () => {
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reports the line each record starts on, even after a line break inside quotes', () => {
    const records = parseCsvRecords('a,b\n"two\nlines",x\r\n"three\r\nmore\nlines",y\nlast,z\n');
    expect(records.map((record) => record.line)).toEqual([1, 2, 4, 7]);
    expect(records[2]?.fields).toEqual(['three\nmore\nlines', 'y']);
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,,c\n,,\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });
});

describe('checking a roster file', () => {
  it('reads a good file', () => {
    const parsed = parse(`${HEADER}\nPat.Student@college.example , S-014 , ELI 275-01\n`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        email: 'pat.student@college.example',
        studentCode: 'S-014',
        section: 'ELI 275-01',
        role: 'student',
      },
    ]);
  });

  it('accepts columns in any order, with any header case, and an optional role', () => {
    const parsed = parse(
      'Section,ROLE,Student_Code,Email\nELI 275-01,Instructor,T-1,dana@college.example\n',
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ role: 'instructor', studentCode: 'T-1' });
  });

  it('skips blank lines and still reports the right line numbers', () => {
    const parsed = parse(`${HEADER}\n\npat@college.example,S-1,A\n,,\nbad,S-2,A\n`);
    expect(parsed.rows.map((row) => row.line)).toEqual([3, 5]);
    expect(parsed.problems.map((problem) => problem.line)).toEqual([5]);
  });

  it('needs the three columns', () => {
    expect(parse('email,code\npat@college.example,S-1\n').problems).toHaveLength(1);
    expect(parse('').problems).toHaveLength(1);
  });

  it('reports a file with a header and no rows', () => {
    expect(parse(`${HEADER}\n`).problems).toEqual([
      { line: 1, message: 'The file has no roster rows.' },
    ]);
  });

  it.each([
    ['an address from another domain', 'pat@elsewhere.example,S-1,A'],
    ['a lookalike domain', 'pat@college.example.example.com,S-1,A'],
    ['something that is not an address', 'pat,S-1,A'],
    ['two at signs', 'pat@college.example@college.example,S-1,A'],
    ['a missing email', ',S-1,A'],
    ['an email with a space in it', 'pat quimby@college.example,S-1,A'],
    ['an email pasted with a display name', '"Pat Quimby <pat@college.example>",S-1,A'],
    ['an email with a trailing bracket', 'pat@college.example>,S-1,A'],
    ['the reserved code', 'pat@college.example,Instructor,A'],
    ['a missing code', 'pat@college.example,,A'],
    ['a code with a space', 'pat@college.example,S 1,A'],
    ['a code that is an email', 'pat@college.example,pat@college.example,A'],
    ['a code equal to the name part of the email', 'pat.student@college.example,Pat.Student,A'],
    ['a missing section', 'pat@college.example,S-1,'],
    ['an unknown role', 'email,student_code,section,role\npat@college.example,S-1,A,admin'],
  ])('refuses %s', (_label, body) => {
    const text = body.startsWith('email,') ? body : `${HEADER}\n${body}`;
    expect(parse(`${text}\n`).problems.length).toBeGreaterThan(0);
  });

  it('refuses the same email or the same code twice in one section', () => {
    const sameEmail = parse(`${HEADER}\npat@college.example,S-1,A\nPAT@college.example,S-2,A\n`);
    expect(sameEmail.problems).toEqual([
      { line: 3, message: 'The same email is already on line 2 for this section.' },
    ]);
    const sameCode = parse(`${HEADER}\npat@college.example,S-1,A\nsam@college.example,s-1,A\n`);
    expect(sameCode.problems).toEqual([
      { line: 3, message: 'The same student code is already on line 2 for this section.' },
    ]);
  });

  it('points at the right line when an earlier cell contains a line break', () => {
    const parsed = parse(`${HEADER}\npat@college.example,S-1,"A\nB"\nnot-an-email,S-2,A\n`);
    expect(parsed.problems.map((problem) => problem.line)).toEqual([4]);
  });

  it('allows the same person in two sections', () => {
    expect(
      parse(`${HEADER}\npat@college.example,S-1,A\npat@college.example,S-1,B\n`).problems,
    ).toEqual([]);
  });

  it('refuses a file that is too long', () => {
    const lines = Array.from(
      { length: 2001 },
      (_, i) => `p${String(i)}@college.example,S-${String(i)},A`,
    );
    const parsed = parse(`${HEADER}\n${lines.join('\n')}\n`);
    expect(parsed.problems.some((problem) => problem.message.includes('more than 2000'))).toBe(
      true,
    );
  });

  it('never repeats an email address or a name in a message', () => {
    const parsed = parse(
      [
        'email,student_code,section,role',
        'jordan.rivers@elsewhere.example,S-1,A,',
        'jordan.rivers,S-2,A,',
        'jordan.rivers@college.example,jordan.rivers,A,',
        'jordan.rivers@college.example,S-4,A,boss',
        'jordan.rivers@college.example,S-5,A,',
        'casey.lake@college.example,S-5,,',
      ].join('\n'),
    );
    expect(parsed.problems.length).toBeGreaterThanOrEqual(6);
    const messages = JSON.stringify(parsed.problems).toLowerCase();
    for (const piece of ['jordan', 'rivers', 'casey', 'lake', 'elsewhere', '@']) {
      expect(messages).not.toContain(piece);
    }
  });
});

describe('importing a roster', () => {
  let db: Db;
  let sectionA: string;

  const load = async (body: string, header = HEADER) => {
    const parsed = parse(`${header}\n${body}\n`);
    expect(parsed.problems).toEqual([]);
    return importRoster(db, parsed.rows, PEPPER);
  };

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    await clearTestDb(db);
    const a = await createSection(db, 'Fall 2026', 'A');
    const b = await createSection(db, 'Fall 2026', 'B');
    if (!a.ok || !b.ok) throw new Error('sections were not created');
    sectionA = a.id;
  });

  it('stores a keyed hash and the code, and no email', async () => {
    const result = await load(
      'patrice.quimby@college.example,S-1,A\nsamira.oyelaran@college.example,S-2,b',
    );
    expect(result).toEqual({ ok: true, added: 2, updated: 0, unchanged: 0 });
    const rows = await db.select().from(roster);
    expect(rows.map((row) => row.studentCode).sort()).toEqual(['S-1', 'S-2']);
    expect(rows.find((row) => row.studentCode === 'S-1')?.emailHmac).toBe(
      hashEmail(PEPPER, 'patrice.quimby@college.example'),
    );
    const dump = (await dumpDatabase(db)).toLowerCase();
    for (const piece of ['@', 'college', 'patrice', 'quimby', 'samira', 'oyelaran']) {
      expect(dump).not.toContain(piece);
    }
    const counts = await listSections(db);
    expect(counts.map((section) => [section.name, section.rosterCount])).toEqual([
      ['A', 1],
      ['B', 1],
    ]);
  });

  it('can be loaded again without changing anything', async () => {
    await load('pat@college.example,S-1,A\nsam@college.example,S-2,A');
    expect(await load('pat@college.example,S-1,A\nsam@college.example,S-2,A')).toEqual({
      ok: true,
      added: 0,
      updated: 0,
      unchanged: 2,
    });
    expect(await db.select().from(roster)).toHaveLength(2);
  });

  it('updates the code or role of someone already on the roster, and adds new people', async () => {
    await load('pat@college.example,S-1,A');
    const result = await load(
      'pat@college.example,S-9,A,instructor\nsam@college.example,S-2,A,',
      'email,student_code,section,role',
    );
    expect(result).toEqual({ ok: true, added: 1, updated: 1, unchanged: 0 });
    const rows = await db.select().from(roster);
    expect(
      rows.find((row) => row.emailHmac === hashEmail(PEPPER, 'pat@college.example')),
    ).toMatchObject({
      studentCode: 'S-9',
      role: 'instructor',
    });
  });

  it('writes nothing when one row names a section that does not exist', async () => {
    const result = await load('pat@college.example,S-1,A\nsam@college.example,S-2,Nowhere');
    expect(result).toEqual({
      ok: false,
      problems: [{ line: 3, message: 'No open section has the name on this line.' }],
    });
    expect(await db.select().from(roster)).toHaveLength(0);
  });

  it('never repeats a cell in a message, even when a name is typed in the section column', async () => {
    const result = await load(
      'pat@college.example,S-1,Jordan Rivers jordan.rivers@college.example',
    );
    if (result.ok) throw new Error('expected problems');
    const messages = JSON.stringify(result.problems).toLowerCase();
    for (const piece of ['jordan', 'rivers', '@']) {
      expect(messages).not.toContain(piece);
    }
  });

  it('does not load into a closed section', async () => {
    await setSectionStatus(db, sectionA, 'closed');
    const result = await load('pat@college.example,S-1,A');
    expect(result.ok).toBe(false);
    expect(await db.select().from(roster)).toHaveLength(0);
  });

  it('refuses to guess between two open sections with the same name', async () => {
    await createSection(db, 'Spring 2027', 'A');
    const result = await load('pat@college.example,S-1,A');
    expect(result.ok).toBe(false);
    expect(await db.select().from(roster)).toHaveLength(0);
  });

  it('will not hand one person’s code to another person, and writes nothing', async () => {
    await load('pat@college.example,S-1,A');
    const result = await load('sam@college.example,S-1,A\ncasey@college.example,S-3,A');
    expect(result).toEqual({
      ok: false,
      problems: [
        { line: 2, message: 'That student code already belongs to someone else in this section.' },
      ],
    });
    expect(await db.select().from(roster)).toHaveLength(1);
  });
});
