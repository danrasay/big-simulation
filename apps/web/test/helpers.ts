import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { exportJWK, exportSPKI, generateKeyPair, createLocalJWKSet, SignJWT } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { Db } from '../src/db/client';
import * as schema from '../src/db/schema';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/**
 * A fresh in-process Postgres with the app's real migrations applied, so the
 * tests also prove the migrations run.
 */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

/** Empties every table. Starting PGlite takes seconds, so each test file starts it once and clears it between tests. */
export async function clearTestDb(db: Db): Promise<void> {
  await db.execute(sql`truncate table audit_log, sessions, users, roster, sections`);
}

/** Runs raw SQL and returns its rows, whichever driver is underneath. */
export async function queryRows<Row>(db: Db, query: SQL): Promise<Row[]> {
  const result: unknown = await db.execute(query);
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows: Row[] }).rows;
}

/** Every row of every table as one string, for checks on what the database holds. */
export async function dumpDatabase(db: Db): Promise<string> {
  const tables = {
    sections: await db.select().from(schema.sections),
    roster: await db.select().from(schema.roster),
    users: await db.select().from(schema.users),
    sessions: await db.select().from(schema.sessions),
    auditLog: await db.select().from(schema.auditLog),
  };
  return JSON.stringify(tables);
}

export async function rowCounts(db: Db): Promise<Record<string, number>> {
  return {
    sections: (await db.select().from(schema.sections)).length,
    roster: (await db.select().from(schema.roster)).length,
    users: (await db.select().from(schema.users)).length,
    sessions: (await db.select().from(schema.sessions)).length,
    auditLog: (await db.select().from(schema.auditLog)).length,
  };
}

export const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
export const NONCE = 'test-nonce';
export const PEPPER = 'test-pepper-test-pepper-test-pepper-0123';

export interface TokenForge {
  /** The keys the app would trust, standing in for Google's. */
  readonly keys: JWTVerifyGetKey;
  /** Signs a token with the trusted key. Claims given here replace the defaults; undefined removes one. */
  readonly forge: (claims?: Record<string, unknown>) => Promise<string>;
  /** Signs the same token with a key the app does not trust. */
  readonly forgeWithOtherKey: (claims?: Record<string, unknown>) => Promise<string>;
  /**
   * The algorithm-confusion attack: an HS256 token whose secret is the
   * trusted public key, which anyone can download.
   */
  readonly forgeWithPublicKeyAsSecret: (claims?: Record<string, unknown>) => Promise<string>;
}

/** Sets up a signing key that plays the part of Google, and a second key that plays an attacker. */
export async function createTokenForge(): Promise<TokenForge> {
  const trusted = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(trusted.publicKey)), kid: 'trusted', alg: 'RS256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [jwk] });

  const publicKeyAsSecret = new TextEncoder().encode(await exportSPKI(trusted.publicKey));

  const build = (claims: Record<string, unknown>, alg = 'RS256'): SignJWT => {
    const now = Math.floor(Date.now() / 1000);
    const merged: Record<string, unknown> = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '108000000000000000001',
      iat: now,
      exp: now + 3600,
      nonce: NONCE,
      hd: 'college.example',
      email: 'pat.student@college.example',
      email_verified: true,
      given_name: 'Pat',
      name: 'Pat Student',
      ...claims,
    };
    const payload = Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined),
    );
    return new SignJWT(payload).setProtectedHeader({ alg, kid: 'trusted' });
  };

  return {
    keys,
    forge: (claims = {}) => build(claims).sign(trusted.privateKey),
    forgeWithOtherKey: (claims = {}) => build(claims).sign(other.privateKey),
    forgeWithPublicKeyAsSecret: (claims = {}) => build(claims, 'HS256').sign(publicKeyAsSecret),
  };
}
