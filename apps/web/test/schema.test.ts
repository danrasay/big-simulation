import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client';
import { createTestDb, queryRows } from './helpers';

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

describe('the database schema', () => {
  it('turns on row-level security for every table, so a web API role can read nothing', async () => {
    const rows = await queryRows<{ relname: string; relrowsecurity: boolean }>(
      db,
      sql`
      select relname, relrowsecurity from pg_class
      where relkind = 'r' and relnamespace = 'public'::regnamespace
      order by relname
    `,
    );
    const tables = rows.map((row) => [row.relname, row.relrowsecurity]);
    expect(tables).toEqual([
      ['audit_log', true],
      ['roster', true],
      ['sections', true],
      ['sessions', true],
      ['users', true],
    ]);
    const policies = await queryRows(
      db,
      sql`select 1 from pg_policies where schemaname = 'public'`,
    );
    expect(policies).toHaveLength(0);
  });

  it('has no column that could hold an email address or a name', async () => {
    const rows = await queryRows<{ column_name: string }>(
      db,
      sql`
      select column_name from information_schema.columns where table_schema = 'public'
    `,
    );
    const columns = rows.map((row) => row.column_name);
    expect(columns.length).toBeGreaterThan(20);
    for (const column of columns) {
      if (column === 'email_hmac') continue;
      expect(column).not.toMatch(
        /mail|first_name|last_name|given|family|full_name|photo|picture|token$/,
      );
    }
    // "name" appears only as the name of a section.
    expect(columns.filter((column) => column.includes('name'))).toEqual(['name']);
  });

  it('accepts only the two roles and the two section states', async () => {
    await expect(
      db.execute(sql`insert into users (sub_hmac, role) values ('x', 'admin')`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`insert into sections (term, name, status) values ('t', 'n', 'archived')`),
    ).rejects.toThrow();
  });
});
