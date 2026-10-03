import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client';
import { createSection, listSections, setSectionStatus } from '../src/lib/sections';
import { clearTestDb, createTestDb } from './helpers';

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await clearTestDb(db);
});

describe('sections', () => {
  it('creates a section, open by default, with an empty roster', async () => {
    const created = await createSection(db, ' Fall 2026 ', ' ELI 275-01 ');
    expect(created.ok).toBe(true);
    expect(await listSections(db)).toMatchObject([
      { term: 'Fall 2026', name: 'ELI 275-01', status: 'open', rosterCount: 0 },
    ]);
  });

  it('needs a term and a name of reasonable length', async () => {
    expect((await createSection(db, '', 'A')).ok).toBe(false);
    expect((await createSection(db, 'Fall 2026', '   ')).ok).toBe(false);
    expect((await createSection(db, 'Fall 2026', 'x'.repeat(61))).ok).toBe(false);
    expect(await listSections(db)).toEqual([]);
  });

  it('refuses a second section with the same term and name', async () => {
    await createSection(db, 'Fall 2026', 'A');
    expect(await createSection(db, 'Fall 2026', 'A')).toEqual({
      ok: false,
      error: 'A section with that term and name already exists.',
    });
    expect((await createSection(db, 'Spring 2027', 'A')).ok).toBe(true);
  });

  it('closes and reopens a section', async () => {
    const created = await createSection(db, 'Fall 2026', 'A');
    if (!created.ok) throw new Error(created.error);
    expect(await setSectionStatus(db, created.id, 'closed')).toBe(true);
    expect((await listSections(db))[0]?.status).toBe('closed');
    expect(await setSectionStatus(db, created.id, 'open')).toBe(true);
    expect((await listSections(db))[0]?.status).toBe('open');
  });

  it('reports when the section does not exist', async () => {
    expect(await setSectionStatus(db, '00000000-0000-4000-8000-000000000000', 'closed')).toBe(
      false,
    );
  });
});
