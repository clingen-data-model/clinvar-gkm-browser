import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Import boundaries, as in gencc. ESLint applies the last matching block for a rule, so each list
// below runs from the most general file pattern to the most specific.

const http = {
  group: ['fastify', 'fastify/*', '@fastify/*', 'fastify-*'],
  message: 'Only routes.ts, http/ and the composition root import Fastify.',
};
const databaseGroup = ['@duckdb/*'];
// Server code may import database types to pass the handle along; only queries run queries.
const database = {
  group: [...databaseGroup, '**/data/database.ts'],
  message: 'Only queries.ts files and data/ use the database.',
  allowTypeImports: true,
};
const databaseInBrowser = {
  group: databaseGroup,
  message: 'This code runs in the browser; the database is server-only.',
};
const nodeBuiltins = {
  group: ['node:*'],
  message: 'This code runs in the browser; Node built-ins are not available.',
};

interface Pattern {
  group: string[];
  message: string;
  allowTypeImports?: boolean;
}

function restrict(...patterns: Pattern[]): ['error', { patterns: Pattern[] }] {
  return ['error', { patterns }];
}

const boundaries = defineConfig(
  // Browser-safe code.
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': restrict(nodeBuiltins, http, databaseInBrowser),
    },
  },
  // Server layers.
  {
    files: ['apps/server/src/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': restrict(http, database) },
  },
  {
    files: ['apps/server/src/**/routes.ts', 'apps/server/src/http/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': restrict(database) },
  },
  {
    files: ['apps/server/src/**/queries.ts', 'apps/server/src/data/**/*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': restrict(http) },
  },
  {
    files: ['apps/server/src/{main,server}.ts', 'apps/server/test/**/*.ts', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
);

export default defineConfig(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', 'data/', 'docs/'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      // Values from outside the program are parsed with Zod, not asserted. `as const` is allowed.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, destructuredArrayIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Fastify plugins are idiomatically `async (app) => { app.get(...) }` with no await.
      '@typescript-eslint/require-await': 'off',
    },
  },
  boundaries,
);
