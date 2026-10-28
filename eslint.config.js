import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // QA journey bodies are injected into an async callback by scripts/mac-qa/qa.py.
  globalIgnores([
    'dist',
    'src-tauri/target',
    '.remember',
    'web',
    'data/build-bible-db.ts',
    'scripts/mac-qa/prepare-mixed-journey.js',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    { rules: { 'react-refresh/only-export-components': ['error', { allowConstantExport: true }] } },
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui files export their variant helpers next to the component by design.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Window entry points render into the DOM and export nothing by design.
    files: ['src/main.tsx', 'src/broadcast-output.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
