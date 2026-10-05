import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * The rules that keep a two-institution build honest.
 * Every one of these has been a real bug on a project like this.
 */
export default tseslint.config(
  { ignores: ['dist', 'dist-e2e', 'exports', 'test-results', 'playwright-report', 'dev-dist', 'src/styles/**', 'src/lib/database.types.ts', 'supabase/functions/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.serviceworker },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      'no-restricted-syntax': [
        'error',
        {
          // 1. No colour literal outside styles/. Colours come from tokens.
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: 'Use a design token. Colour literals belong in src/styles/tokens.css only.',
        },
        {
          // 2. The client never computes status; the server owns it.
          selector: "AssignmentExpression > MemberExpression[property.name='status']",
          message: 'equipment.status is computed by the database trigger. Render it, never set it.',
        },
        {
          // 3. Emoji are not iconography.
          selector: 'Literal[value=/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/u]',
          message: 'Use <Icon name="..." />. This product has no emoji.',
        },
      ],
    },
  },
  {
    // Build and release tooling runs in Node, not the browser.
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-syntax': 'off' },
  },
);
