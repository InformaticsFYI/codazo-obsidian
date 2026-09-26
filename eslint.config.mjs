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
    // any-typed-JSON strictness do not apply to them. They run under Node (real loopback servers, fixture files), so the mobile Node-module rule and
    // browser globals do not apply either; TypeScript still checks every identifier. Nothing under tests/ ships in the plugin.
    files: ['tests/**/*.ts'],
    rules: {
      'obsidianmd/ui/sentence-case': 'off', 'obsidianmd/prefer-create-el': 'off', 'no-restricted-globals': 'off', 'obsidianmd/no-global-this': 'off', 'obsidianmd/prefer-window-timers': 'off', 'obsidianmd/no-nodejs-modules': 'off', 'no-undef': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off', '@typescript-eslint/no-unsafe-assignment': 'off', '@typescript-eslint/no-unsafe-member-access': 'off', '@typescript-eslint/no-unsafe-argument': 'off', '@typescript-eslint/no-unsafe-return': 'off', '@microsoft/sdl/no-inner-html': 'off',
    },
  },
]);
