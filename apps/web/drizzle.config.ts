import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Local runs read apps/web/.env.local. In CI and on the host the variables
// are already in the environment.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

// Migrations need a session connection. On Supabase that is the direct or
// session pooler string, not the transaction pooler the app runs on.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
});
