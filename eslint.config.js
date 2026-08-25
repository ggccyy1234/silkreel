import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

const NODE_BUILTIN_RESTRICTION = {
  patterns: [
    {
      group: [
        'assert',
        'buffer',
        'child_process',
        'cluster',
        'constants',
        'crypto',
        'dgram',
        'dns',
        'domain',
        'events',
        'fs',
        'http',
        'http2',
        'https',
        'module',
        'net',
        'os',
        'path',
        'perf_hooks',
        'process',
        'punycode',
        'querystring',
        'readline',
        'repl',
        'stream',
        'string_decoder',
        'timers',
        'tls',
        'tty',
        'url',
        'util',
        'v8',
        'vm',
        'worker_threads',
        'zlib',
        'node:*'
      ],
      message: 'node builtins are banned in browser-safe package sources'
    }
  ]
}

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.vite/**', '**/coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'warn'
    }
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: [
      'packages/ingest/src/**/*.ts',
      'packages/choreo/src/**/*.ts',
      'packages/render/src/**/*.ts',
      'packages/studio/src/**/*.{ts,tsx}'
    ],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', NODE_BUILTIN_RESTRICTION]
    }
  },
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: {
          defaultProject: 'tsconfig.json'
        },
        tsconfigRootDir: import.meta.dirname
      }
    }
  }
)
