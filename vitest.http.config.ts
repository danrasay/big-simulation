import { defineConfig } from 'vitest/config';

// Tests that drive the built app over HTTP against a real Postgres.
// Run with `pnpm test:http`. See apps/web/test/http/access.test.ts.
export default defineConfig({
  test: {
    include: ['apps/*/test/http/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
