import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Tests under test/http need a running app and a real database. They run with `pnpm test:http`.
    exclude: ['**/node_modules/**', 'apps/*/test/http/**'],
  },
});
