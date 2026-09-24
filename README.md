# Codazo for Obsidian

A vault-native Obsidian community plugin. The vault is the library, Markdown is the durable format, and Obsidian stays the writing environment. Codazo adds an explicit, learner-controlled review and study layer over notes the learner already owns: select a Spanish passage, confirm exactly what will be sent, read source-bound feedback in a side pane, and choose whether to keep anything.

Status: released in Obsidian's community plugin directory as `codazo` (https://community.obsidian.md/plugins/codazo), desktop-only (`isDesktopOnly: true`). This repository is the plugin's home: development, issues, pull requests, and releases happen here. Mobile will follow once it has been verified on real devices.

## What it does

1. Select text in a Markdown note and run **Codazo: Review selection** (command palette or right-click menu), or **Codazo: Review current note** for the whole note.
2. A modal shows the exact text that will leave the vault, takes optional English intent (prefilled from a callout in the note titled `English Intent`, `Intent`, or `Intención`, for example `> [!spoiler]- English Intent`, which is removed from the text sent), names the configured provider and model, and requires **Revisar mi texto**. Nothing is sent by opening the modal, opening a note, opening the pane, editing, saving, or syncing.
3. Only the text shown in the modal and the optional intent are sent, to the profile you confirmed. Vault name, note path, and other notes are never sent; in whole-note mode the frontmatter is removed first. Links or tags inside the text you select travel as written.
4. The pane shows the validated review: overview, annotations with the reveal ladder (Sugerencia → Observa → Piensa → Pista → Inténtalo otra vez), vocabulary, verbs with the offline conjugation reference, and practice. Annotations are marked temporarily in the editor; choosing one selects the exact phrase.
5. **Codazo: Excerpt from selection** is for text you are reading, not text you wrote: a word, a phrase, or a paragraph. The modal guesses the kind (you can change it) and asks your level. The result is saved at once under `Extractos/`: the passage, where it came from, meaning notes (literal reading, conversational or slang use, register), and the words and verbs in it with conjugation tables. A word that is a verb form gets its infinitive and tense; a paragraph is built like a study guide for your level with a few stretch items. No corrections are made to the text.
6. The pane has two tabs. **Resultado** shows the current review, study guide, or excerpt. **Índice** lists everything Codazo has saved under its folder, grouped by kind (and by the open note first), read from Obsidian's metadata cache. Choosing a review, study sheet, or excerpt there re-validates its saved payload and loads it into the pane with no model call; words, verbs, and revisions open as notes.
7. **Inline translations.** Select a word or phrase and choose *Añadir traducción a la selección* (Tools menu or command), type the English, and the text becomes `{botas|boots}` or `{sepa la bola|who knows}`: plain text that survives anywhere. In Live Preview and Reading view you see only the Spanish with a dotted underline, and hovering shows the translation; putting the cursor inside a gloss shows the raw markup for editing. Glosses are removed from anything sent to the model.
8. Actions, each explicit: create a linked revision note, save the review, save a study sheet, export JSON or HTML. Reviews and study guides are written only on request unless you turn on automatic saving; excerpts are always saved, since a note is their purpose.

## Boundaries

- A review never modifies the note it reviewed. Suggestions are information, not edits; there is no apply-all, rewrite, or background correction. The two editing tools, insert English intent and add translation, change the note only at your cursor when you invoke them.
- A review is bound to the exact captured source and its SHA-256. If the note changes so the passage is no longer present exactly once, the review stays visible as history but editor marks and navigation switch off. No fuzzy matching, no whitespace or Unicode normalization.
- Provider profiles: several named profiles, one active. The confirmation dialog is bound to the exact profile it shows; dispatch resolves that profile again and refuses if it changed. OpenAI and Ollama Cloud use fixed endpoints; a custom profile takes any OpenAI-compatible base URL (OpenRouter, a local server). A redirecting endpoint is treated as a failure before anything is forwarded. Custom URLs must be HTTPS unless the host is loopback, a `.local` name, or a private-network address, and on plain HTTP the key crosses that network unencrypted; the settings say so when you save such a profile. Local servers such as LM Studio usually reject the `json_object` response format; choose `json_schema` and `max_tokens` for them. In a check against LM Studio, a small non-reasoning model (gemma-4-e4b) satisfied the contract in `json_schema` mode and failed in "Solo instrucciones"; a reasoning model (muse-glimmer-30b) spent minutes thinking and never answered inside the timeout, so prefer non-reasoning models locally. Requests go through Node's http client on Obsidian desktop, which never follows a redirect, so the key and text can only reach the confirmed destination; (so it works without webview CORS on every platform). The shared provider adapter still enforces its limits, strict JSON, schema validation, and anchor resolution; malformed output is discarded, never shown.
- One review in flight, no retry, no provider switch, no sample presented as AI output. Cancelling stops waiting and ignores a late result; it cannot recall a request already sent.
- Each profile's key is kept for the session or stored through Obsidian Secret Storage (Obsidian 1.11.5 or newer) under its own entry, bound to the profile's destination. Secret Storage is Obsidian's shared store: it protects the key at rest (encrypted by the operating system; Linux needs a supported keyring), not against other plugins you have installed. Before offering persistent storage, Codazo writes a random canary through Secret Storage and checks that its plaintext does not appear in Local Storage; if the operating system keychain is unavailable and Obsidian would store secrets as plain text, persistent mode is refused and previously persisted keys are not read until encryption is back. Without Secret Storage, persistent mode is refused and the key stays in memory. `data.json` holds only the profiles (name, destination, model, preferences), the active profile, level, and vault settings.
- Saved reviews, revisions, and study sheets are ordinary Markdown in the configured folder (default `Codazo/Reviews`, `Codazo/Revisions`, `Codazo/Study`, `Codazo/Exports`) with flat `codazo-*` Properties. They are unencrypted vault content and sync with the rest of the vault; the plugin says so before the first save. New files never overwrite existing ones.
- Optionally, one note per word under `Palabras/` and one per verb and tense under `Verbos/` (named `infinitivo · tiempo`, with the deterministic conjugation table), created after every review or study guide, or on demand from the pane. Each carries `codazo-progreso` (`nuevo`, `con-problemas`, `necesita-trabajo`, `casi-listo`, `dominado`) for the learner to edit; existing notes are never touched. These are the notes a future flash-card or conjugation drill would read.
- A saved review carries the validated payload in a fenced `json codazo-review` block. **Codazo: Load saved review from current note** re-validates it before showing it; a payload that fails validation is refused.
- The plugin's own text (commands, menu, settings, modal, pane, notices) can be shown in Spanish (default) or English from a setting. Codazo's output is unaffected: the review contract, prompts, saved notes, and exports stay as they are.
- No telemetry, no Codazo account, no whole-vault indexing, no background reading of notes. AI features use your own provider account and key (OpenAI, Ollama Cloud, or an OpenAI-compatible endpoint such as OpenRouter or a local server); provider charges and data policies apply to what you send. Saved notes written by the plugin are literal text: model-generated prose is escaped so it cannot embed images, links, or HTML when a note renders.

## Install

From Obsidian: **Settings › Community plugins › Browse**, search for **Codazo**, Install, then Enable. Or copy `main.js`, `manifest.json`, and `styles.css` from a [release](https://github.com/InformaticsFYI/codazo-obsidian/releases) into `<vault>/.obsidian/plugins/codazo/`. Each release is attested; verify with `gh attestation verify main.js -R InformaticsFYI/codazo-obsidian`.

## Develop

```sh
npm ci
npm run lint       # Obsidian's community-plugin validator rules
npm run typecheck
npm test
npm run build      # dist/main.js, manifest.json, styles.css, RELEASE.json; regenerates NOTICE.md
```

Branch from `dev` and open pull requests against `dev`; see [CONTRIBUTING.md](CONTRIBUTING.md). The build uses esbuild with `platform: browser`, leaves `obsidian` and `@codemirror/*` external, and embeds every bundled package's license text at the top of `main.js`.

## Disclosures

- **Accounts and access.** No Codazo account is required. To use AI-powered reviews, study guides, and excerpt explanations through a hosted service such as the OpenAI API or Ollama Cloud, you need that provider's account and an API key with access to your chosen model; provider charges may apply. A local OpenAI-compatible server can be used instead, and its authentication requirements depend on the server.
- **Network use.** Codazo sends the text and optional English intent shown in the confirmation dialog, together with Codazo's review instructions and your profile's settings, directly to the provider you selected, to generate feedback or explanations. Supported destinations are OpenAI, Ollama Cloud, and a custom OpenAI-compatible endpoint such as OpenRouter or a local server. Requests happen only after your confirmation. There is no Codazo intermediary server and no telemetry.
- **Keys.** Stored in Obsidian's Secret Storage (encrypted by the operating system; Linux needs a supported keyring) or kept in memory for the session. Codazo verifies that Secret Storage is actually encrypting before offering persistent storage and refuses it otherwise. Secret Storage is shared by all plugins in Obsidian; it protects storage, not the running process.
- **Custom endpoints.** Requests never follow redirects: a redirecting endpoint fails before the key or text is forwarded. Plain HTTP is allowed to local and private-network servers and carries the key unencrypted on that network.
- **Storage.** Saved notes are ordinary unencrypted Markdown in your vault and sync like the rest of it.
- **Platform.** Desktop only for now. Mobile support will follow once it has been verified on real devices.

## Layout

- `src/` — the plugin: the `requestUrl`-free Node transport, Secret Storage vault and encryption canary, plugin data, session and stale-source logic, vault artifact builders and validation, the CodeMirror decoration extension, the pane, modal, and settings tab.
- `shared/` — the review contract and validation, anchor resolution, the OpenAI-compatible provider adapter, the local review service, provider-settings rules, export serializers, and the conjugation reference. Shared with other Codazo applications and kept portable.
- `tests/` — Vitest suites with synthetic fixtures; never real learner writing or credentials.

## Not in this release

Cumulative mastery, notebook challenges, an offline dictionary, and mobile Obsidian.
