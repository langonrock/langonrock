import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: {
      '@stylistic': stylistic
    },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'directive', next: '*' },
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        {
          blankLine: 'always',
          prev: ['const', 'let', 'var'],
          next: '*'
        },
        {
          blankLine: 'any',
          prev: ['const', 'let', 'var'],
          next: ['const', 'let', 'var']
        },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        {
          blankLine: 'always',
          prev: ['return', 'throw', 'break', 'continue'],
          next: '*'
        },
        { blankLine: 'always', prev: '*', next: 'return' }
      ],
      '@stylistic/lines-between-class-members': ['error', 'always'],
      '@stylistic/padded-blocks': ['error', 'never'],
      '@stylistic/no-multiple-empty-lines': [
        'error',
        { max: 1, maxBOF: 0, maxEOF: 0 }
      ],

      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-lonely-if': 'error',
      'no-useless-return': 'error',
      'no-unneeded-ternary': ['error', { defaultAssignment: false }],
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      'prefer-arrow-callback': ['error', { allowNamedFunctions: false }],
      'arrow-body-style': ['error', 'as-needed'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      complexity: ['error', 12],
      'max-depth': ['error', 3],
      'max-nested-callbacks': ['error', 3],
      'max-params': ['error', 4],
      'max-lines-per-function': [
        'error',
        { max: 70, skipBlankLines: true, skipComments: true }
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' }
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn'
    }
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-nested-callbacks': 'off'
    }
  },
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**'])
])

export default eslintConfig
