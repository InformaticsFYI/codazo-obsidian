# Contributing to Codazo for Obsidian

Thank you for helping. This repository is the plugin's home: issues, pull requests, and releases all live here.

## Workflow

- Branch from `dev` and open your pull request against `dev`. CI runs Obsidian's validator rules, the typecheck, the tests, and a build on every pull request; the built plugin is attached to the run so reviewers can install the exact candidate in a test vault.
- `main` holds released code. Maintainers merge `dev` into `main` and push a tag equal to `manifest.json`'s version; the Release workflow builds, publishes the three install files, and attests them.
- Keep one concern per pull request and describe the problem, the change, and what you ran.

## Local setup

```sh
npm ci
npm run lint       # Obsidian's community-plugin validator rules
npm run typecheck
npm test
npm run build      # dist/main.js, manifest.json, styles.css; also regenerates NOTICE.md
```

Copy the three files from `dist/` into `<vault>/.obsidian/plugins/codazo/` of a test vault and enable the plugin. Use synthetic text and dummy keys while developing; never commit a key, a real learner's writing, or a vault.

## Things that will not be merged

These are the promises the plugin makes to learners, and pull requests that weaken them will be declined even if they simplify the code:

- A provider request only after the learner confirms exactly what will be sent; no automatic or background calls, no retry, no provider switching.
- The learner's note is never modified by a review. Suggestions are information; the two editing tools act only at the cursor on request.
- Keys live in Obsidian Secret Storage only when it is actually encrypting, or in session memory; never in plain text.
- Requests never follow redirects: the key and text go only to the confirmed destination.
- Model output is validated against the contract and rendered as text; it never becomes HTML or active Markdown.
- Diagnostics never echo model or learner text.

## Layout

- `src/` — the plugin: settings, profiles, transport, review pane, artifacts.
- `shared/` — the review contract, validation, provider adapter, exports, and conjugation reference. This code is shared with other Codazo applications and kept portable: it does not import Obsidian or browser-only globals, which is why the validator reports a few warnings there on purpose.
- `tests/` — Vitest, with synthetic fixtures under `tests/fixtures/`.
