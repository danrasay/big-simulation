import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/** The database handle the app's logic takes. The same type serves the real driver and the in-process test database. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Db | undefined;

/** Connection settings for a database URL. Exported for tests. */
export function connectionOptions(url: string): {
  prepare: false;
  max: number;
  idle_timeout: number;
  ssl: 'require' | false;
} {
  const { hostname } = new URL(url);
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return {
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    // A small pool that lets go of idle connections suits short-lived serverless functions.
    max: 5,
    idle_timeout: 20,
    // Anything that is not this machine is reached over TLS, whatever the URL says.
    ssl: local ? false : 'require',
  };
}

/** The app's database connection, created on first use. */
export function getDb(): Db {
  if (cached === undefined) {
    const url = process.env.DATABASE_URL;
    if (url === undefined || url === '') throw new Error('DATABASE_URL is not set');
    cached = drizzle(postgres(url, connectionOptions(url)), { schema });
  }
  return cached;
}
