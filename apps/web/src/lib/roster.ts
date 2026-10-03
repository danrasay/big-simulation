/**
 * Roster import.
 *
 * The instructor uploads a CSV with columns email, student_code and section
 * (and optionally role). Each email is hashed in memory; the hash and the
 * code are stored; the file is not kept. Messages about the file refer to
 * line numbers and never repeat what a cell contained, so a name or an
 * address typed into the wrong column is not echoed back.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { roster, sections } from '../db/schema';
import { hashEmail, normalizeEmail } from './identity';
import type { Role } from './sessions';

export interface RosterRow {
  /** Line in the file, counting the header as line 1. */
  readonly line: number;
  readonly email: string;
  readonly studentCode: string;
  readonly section: string;
  readonly role: Role;
}

export interface RosterProblem {
  readonly line: number;
  readonly message: string;
}

export interface ParsedRoster {
  readonly rows: readonly RosterRow[];
  readonly problems: readonly RosterProblem[];
}

const MAX_ROWS = 2000;
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
/** Deliberately narrow: an address with a space, a bracket or a display name is a typing mistake. */
const EMAIL_PATTERN = /^[a-z0-9._%+'-]+@[a-z0-9.-]+$/;
/** The audit log's label for the bootstrap instructor. A student code may not look like it. */
const RESERVED_CODES = new Set(['instructor']);

export interface CsvRecord {
  /** The line of the file the record starts on, counting from 1. */
  readonly line: number;
  readonly fields: string[];
}

/**
 * Splits CSV text into records, each with the line it starts on. Handles
 * quotes, doubled quotes, line breaks inside quotes, CRLF and a byte-order mark.
 */
export function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;

  const endRecord = (): void => {
    fields.push(field);
    records.push({ line: startLine, fields });
    fields = [];
    field = '';
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input.charAt(i);
    const lineBreak = char === '\n' || char === '\r';
    if (char === '\r' && input.charAt(i + 1) === '\n') i += 1;
    if (lineBreak) line += 1;

    if (quoted) {
      if (char === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += lineBreak ? '\n' : char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (lineBreak) {
      endRecord();
      startLine = line;
    } else {
      field += char;
    }
  }
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}

/** The fields of each record, without line numbers. */
export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((record) => record.fields);
}

/**
 * Reads a roster file and checks every row. If there are any problems, the
 * caller must not import anything: a roster goes in whole or not at all.
 */
export function parseRoster(text: string, allowedDomain: string): ParsedRoster {
  const records = parseCsvRecords(text);
  const header = records[0]?.fields.map((cell) => cell.trim().toLowerCase()) ?? [];
  const column = (name: string): number => header.indexOf(name);
  const emailAt = column('email');
  const codeAt = column('student_code');
  const sectionAt = column('section');
  const roleAt = column('role');

  if (emailAt === -1 || codeAt === -1 || sectionAt === -1) {
    return {
      rows: [],
      problems: [
        {
          line: 1,
          message: 'The first line must name the columns email, student_code and section.',
        },
      ],
    };
  }

  const rows: RosterRow[] = [];
  const problems: RosterProblem[] = [];
  const seenEmails = new Map<string, number>();
  const seenCodes = new Map<string, number>();

  for (const { line, fields: record } of records.slice(1)) {
    if (record.every((cell) => cell.trim() === '')) continue;
    const problem = (message: string): void => {
      problems.push({ line, message });
    };

    const email = normalizeEmail(record[emailAt] ?? '');
    const studentCode = (record[codeAt] ?? '').trim();
    const section = (record[sectionAt] ?? '').trim();
    const roleText = roleAt === -1 ? '' : (record[roleAt] ?? '').trim().toLowerCase();

    const [localPart, domain] = email.split('@');
    if (!EMAIL_PATTERN.test(email) || localPart === undefined || domain === undefined) {
      problem('The email is missing or is not a plain email address.');
    } else if (domain !== allowedDomain.toLowerCase()) {
      problem(`The email is not an ${allowedDomain} address.`);
    }

    if (!CODE_PATTERN.test(studentCode)) {
      problem(
        'The student code must be 1 to 32 letters, digits, hyphens or underscores, starting with a letter or digit.',
      );
    } else if (RESERVED_CODES.has(studentCode.toLowerCase())) {
      problem('That student code is reserved. Use a different one.');
    } else if (localPart !== undefined && studentCode.toLowerCase() === localPart) {
      problem(
        'The student code must not be the name part of the email. Use a code that does not identify the student.',
      );
    }

    if (section === '') problem('The section is missing.');

    let role: Role = 'student';
    if (roleText === 'instructor') role = 'instructor';
    else if (roleText !== '' && roleText !== 'student')
      problem('The role must be student or instructor.');

    const emailKey = `${section.toLowerCase()}|${email}`;
    const earlierEmail = seenEmails.get(emailKey);
    if (earlierEmail !== undefined) {
      problem(`The same email is already on line ${String(earlierEmail)} for this section.`);
    } else {
      seenEmails.set(emailKey, line);
    }
    const codeKey = `${section.toLowerCase()}|${studentCode.toLowerCase()}`;
    const earlierCode = seenCodes.get(codeKey);
    if (earlierCode !== undefined) {
      problem(`The same student code is already on line ${String(earlierCode)} for this section.`);
    } else {
      seenCodes.set(codeKey, line);
    }

    rows.push({ line, email, studentCode, section, role });
  }

  if (rows.length === 0 && problems.length === 0) {
    problems.push({ line: 1, message: 'The file has no roster rows.' });
  }
  if (rows.length > MAX_ROWS) {
    problems.push({ line: 1, message: `The file has more than ${String(MAX_ROWS)} rows.` });
  }
  return { rows, problems };
}

export type ImportResult =
  | {
      readonly ok: true;
      readonly added: number;
      readonly updated: number;
      readonly unchanged: number;
    }
  | { readonly ok: false; readonly problems: readonly RosterProblem[] };

/**
 * Stores a parsed roster. Rows are matched to open sections by name. A row
 * for someone already on the section's roster updates their code and role.
 * Nothing is written if any row has a problem.
 */
export async function importRoster(
  db: Db,
  rows: readonly RosterRow[],
  pepper: string,
): Promise<ImportResult> {
  const open = await db
    .select({ id: sections.id, name: sections.name })
    .from(sections)
    .where(eq(sections.status, 'open'));
  const byName = new Map<string, string[]>();
  for (const section of open) {
    const key = section.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), section.id]);
  }

  const problems: RosterProblem[] = [];
  const prepared = rows.flatMap((row) => {
    const matches = byName.get(row.section.toLowerCase()) ?? [];
    const [sectionId, ...others] = matches;
    if (sectionId === undefined) {
      problems.push({ line: row.line, message: 'No open section has the name on this line.' });
      return [];
    }
    if (others.length > 0) {
      problems.push({
        line: row.line,
        message: 'More than one open section has the name on this line. Close or rename one.',
      });
      return [];
    }
    return [{ ...row, sectionId, emailHmac: hashEmail(pepper, row.email) }];
  });
  if (problems.length > 0) return { ok: false, problems };

  return db.transaction(async (tx): Promise<ImportResult> => {
    const sectionIds = [...new Set(prepared.map((row) => row.sectionId))];
    const existing =
      sectionIds.length === 0
        ? []
        : await tx.select().from(roster).where(inArray(roster.sectionId, sectionIds));
    const byEmail = new Map(
      existing.map((entry) => [`${entry.sectionId}|${entry.emailHmac}`, entry]),
    );
    const codeOwner = new Map(
      existing.map((entry) => [
        `${entry.sectionId}|${entry.studentCode.toLowerCase()}`,
        entry.emailHmac,
      ]),
    );

    // A code may not move to a different person, or two people would share a history.
    for (const row of prepared) {
      const owner = codeOwner.get(`${row.sectionId}|${row.studentCode.toLowerCase()}`);
      if (owner !== undefined && owner !== row.emailHmac) {
        problems.push({
          line: row.line,
          message: 'That student code already belongs to someone else in this section.',
        });
      }
    }
    if (problems.length > 0) return { ok: false, problems };

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    for (const row of prepared) {
      const current = byEmail.get(`${row.sectionId}|${row.emailHmac}`);
      if (current === undefined) {
        await tx.insert(roster).values({
          sectionId: row.sectionId,
          emailHmac: row.emailHmac,
          studentCode: row.studentCode,
          role: row.role,
        });
        added += 1;
      } else if (current.studentCode !== row.studentCode || current.role !== row.role) {
        await tx
          .update(roster)
          .set({ studentCode: row.studentCode, role: row.role })
          .where(and(eq(roster.sectionId, row.sectionId), eq(roster.emailHmac, row.emailHmac)));
        updated += 1;
      } else {
        unchanged += 1;
      }
    }
    return { ok: true, added, updated, unchanged };
  });
}
