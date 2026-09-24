// Obsidian's community-plugin validator rules (eslint-plugin-obsidianmd), run
// from the repository root where manifest.json lives. `npm run lint`.
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['dist/**', 'node_modules/**', 'scripts/**'] },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { parserOptions: { projectService: { allowDefaultProject: ['eslint.config.*', 'vitest.config.ts'] }, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // Product names and wire-level identifiers (API field names, URLs, model ids) are shown verbatim; everything else follows sentence case.
      'obsidianmd/ui/sentence-case': ['warn', { brands: ['Codazo', 'Obsidian', 'OpenAI', 'Ollama Cloud', 'OpenRouter', 'LM Studio'], ignoreRegex: ['^[a-z][a-z0-9_-]*$', '^https?://'] }],
    },
  },
  {
    // Tests drive the shared service with scripted transports, synthetic JSON fixtures, dummy keys, and deliberately hostile HTML; Obsidian UI rules and the
    // any-typed-JSON strictness do not apply to them. Nothing under tests/ ships in the plugin.
    files: ['tests/**/*.ts'],
    rules: {
      'obsidianmd/ui/sentence-case': 'off', 'obsidianmd/prefer-create-el': 'off', 'no-restricted-globals': 'off', 'obsidianmd/no-global-this': 'off', 'obsidianmd/prefer-window-timers': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off', '@typescript-eslint/no-unsafe-assignment': 'off', '@typescript-eslint/no-unsafe-member-access': 'off', '@typescript-eslint/no-unsafe-argument': 'off', '@typescript-eslint/no-unsafe-return': 'off', '@microsoft/sdl/no-inner-html': 'off',
    },
  },
]);
