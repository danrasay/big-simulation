import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Plain JavaScript config files are not part of the TypeScript project.
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // The engine is pure: no file system, network, database or UI imports.
    // Tests may read scenario files; the engine source may not.
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'path',
                'http',
                'https',
                'react',
                'react-dom',
                'next',
                'next/*',
              ],
              message: 'packages/engine must stay pure TypeScript with no platform or UI imports.',
            },
          ],
        },
      ],
    },
  },
);
