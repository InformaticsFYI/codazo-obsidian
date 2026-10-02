# Codazo for Obsidian

Codazo helps you improve your written Spanish inside your own notes. Select a passage you wrote, ask for a review, and read source-based feedback in a side pane. You decide when the AI runs, exactly what it sees, and what you keep.

Codazo never edits the note you asked it to review. Your writing stays yours.

> [!NOTE]
> **You bring your own AI provider.** Codazo has no account and no server of its own. To get feedback, you connect an account and API key from OpenAI, Ollama Cloud, Google Gemini, or any OpenAI-compatible service, including a local model running on your computer. On desktop you can instead **use your ChatGPT plan**: sign in with your ChatGPT account and reviews count against your plan, with no API key. The provider's charges and privacy terms apply to the text you send. See [Disclosures](#disclosures) below.

## What you can do

- **Review your writing** — select text, then perform **Codazo: Review selection** from the right-click menu, the command palette, or the buttons at the top of the Codazo pane. Or review the whole active note. A dialog shows the exact text that will be sent and which provider will receive it. Nothing leaves your vault until you select **Revisar mi texto**.
- **Use your ChatGPT plan** — on desktop, choose **Continue with ChatGPT** in a profile, sign in in your browser, and Codazo's reviews use your ChatGPT plan's allowance instead of an API key. The pane shows **Using ChatGPT plan** with a **Manage usage** link to your ChatGPT settings. [Learn more](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) about which plans include it.
- **Read feedback that points at your words** — the pane shows an overview, observations tied to exact phrases, vocabulary, and verbs with conjugation tables. Observations reveal in steps (suggestion, observe, think, hint, try again) so you can work it out before seeing the answer. The phrases are marked in the editor while the review is open, and selecting an observation jumps to the phrase.
- **Build a study guide** — from a selection, get only the vocabulary and verbs above your level, without corrections.
- **Explain something you are reading** — **Codazo: Excerpt from selection** takes a word, phrase, or paragraph someone else wrote and saves a note under `Extractos/` with its meaning, register, and the words and verbs in it.
- **Add inline translations** — select a word, perform *Añadir traducción a la selección*, and type the English. The note stores `{botas|boots}` as plain text. In Reading view and Live Preview you see only the Spanish with an underline. Hover over it, or tap it on a touch screen, to see the translation.
- **Keep what helps** — save a review, create a linked revision note, save a study sheet, or export JSON or HTML. Reviews are saved only when you ask, unless you turn on automatic saving in settings. Everything is ordinary Markdown in your vault.
- **Find it again** — the **Índice** tab lists every review, study sheet, excerpt, word, and verb note Codazo has saved, with the active note's items first. Opening a saved review from there does not call the AI.
- **Optional word and verb notes** — one note per word under `Palabras/` and one per verb tense under `Verbos/`, each with a `codazo-progreso` property (`nuevo`, `con-problemas`, `necesita-trabajo`, `casi-listo`, `dominado`) you can update as you learn. Existing notes are never changed.

The plugin's own interface can be shown in Spanish (default) or English. The feedback itself is always about Spanish.

## Install

1. Open **Settings → Community plugins → Browse**.
2. Search for **Codazo**, then select **Install** and **Enable**.
3. Open **Settings → Codazo**, add a provider profile, and choose your level. Either paste an API key, or on desktop pick the ChatGPT service and select **Continue with ChatGPT** to use your plan.

To install by hand, copy `main.js`, `manifest.json`, and `styles.css` from a [release](https://github.com/InformaticsFYI/codazo-obsidian/releases) into `<vault>/.obsidian/plugins/codazo/`. Releases are signed with GitHub build attestations.

Codazo needs Obsidian 1.11.5 or newer.

| Platform | Status |
|----------|--------|
| Windows, macOS, Linux | Tested |
| iPad and iPhone | Being tested |
| Android | Should work, not yet tested |

### Mobile

On a touch screen, long-pressing selected text shows the system's copy and paste bar rather than Obsidian's menu, so the right-click route is not available. Instead, select the text, open the Codazo pane from the ribbon, and tap **Revisar la selección** at the top of the pane. On an iPad the pane can stay open beside your note. The same actions are in the command palette and can be added to the mobile toolbar in Obsidian's settings. On a phone, choosing an observation closes the sidebar so you can see the phrase in your note.

Requests on mobile come from the Obsidian app, so the AI service has to accept requests from it. OpenAI and OpenRouter do. Ollama Cloud, and local servers such as LM Studio or Ollama, may refuse them unless they are set to allow cross-origin requests. When that happens, Codazo shows an error explaining it, and nothing is retried or sent anywhere else.

## Disclosures

**Payment.** Codazo is free and has no paid tier. AI features run on a provider account that you supply. Hosted providers such as OpenAI and Ollama Cloud charge for use according to their own pricing. A local model on your own computer costs nothing to run. If you sign in with ChatGPT, eligible reviews use your ChatGPT plan's allowance; OpenAI decides which plans include it and how much, and you can cap Codazo's share in your ChatGPT settings.

**Accounts.** No Codazo account exists. To use AI features you need an account and API key with the provider you choose, or a local OpenAI-compatible server, whose sign-in requirements depend on that server. To use your ChatGPT plan instead, you sign in to your existing ChatGPT account in your browser through OpenAI's own sign-in page; Codazo never sees your password. Codazo keeps the permission OpenAI grants, which you can revoke in your ChatGPT settings.

**Network use.** Codazo connects to the internet only when you confirm a review, study guide, or excerpt. It sends the text shown in the confirmation dialog, your optional English intent, Codazo's review instructions, and your chosen model and level directly to the provider you selected. Supported destinations are the OpenAI API, Ollama Cloud, and any OpenAI-compatible URL you enter, such as OpenRouter, Google's Gemini API at its OpenAI-compatible address, or a local server. This is needed because the provider's model generates the feedback. Your vault name, note names, other notes, frontmatter, links you did not select, and inline translations are not sent. Nothing is sent when you open Obsidian, open a note, open the pane, type, save, or sync. Requests never follow redirects on any platform, so your key and text can reach only the address you confirmed. Custom URLs must use HTTPS unless they point to your own computer or local network; on plain HTTP the key travels unencrypted across that network, and the settings say so when you save such a profile. With ChatGPT sign-in, Codazo also contacts `auth.openai.com` when you sign in or when the permission needs renewing, and sends reviews to `api.openai.com` with `store: false`, which asks OpenAI not to keep them. Signing in opens a short-lived listener on your own computer only (`127.0.0.1`) to receive OpenAI's reply.

**Files outside your vault.** Codazo does not read or write files outside your vault. Your API key, or your ChatGPT sign-in permission, is the one exception: with your permission it is stored in Obsidian's Secret Storage, which Obsidian keeps encrypted by your operating system outside the vault so that it never syncs with your notes. Codazo first checks that Secret Storage is really encrypting on your system; if it is not, Codazo refuses to store the key and keeps it in memory for the session only. Secret Storage is shared by all Obsidian plugins you have installed.

**Ads.** Codazo shows no ads, banners, promotions, or pop-ups.

**Telemetry.** Codazo collects no usage data, analytics, or crash reports, and has no server to send them to. Error messages stay on your screen. What your AI provider retains is governed by that provider's privacy policy.

**Source code.** Codazo is fully open source under the Apache 2.0 license in this repository. Each release includes a `NOTICE.md` listing bundled third-party packages and their licenses.

**What is stored in your vault.** Saved reviews, revisions, study sheets, excerpts, and word and verb notes are ordinary unencrypted Markdown in the folders you choose (default `Codazo/…`). They sync like the rest of your vault, and the plugin tells you so before the first save. New files never overwrite existing ones. The plugin's `data.json` holds your profiles (name, destination, model), level, and folder settings, but never a key.

## How Codazo treats your writing

- A review is a set of observations, not edits. There is no apply-all, rewrite, or background correction. The only two tools that change a note, insert English intent and add translation, act at your cursor when you perform them.
- A review is bound to the exact text it reviewed. If you change the passage so it no longer appears exactly once, the review stays readable as history but the editor marks turn off.
- One request at a time. If the provider fails or returns something that does not fit Codazo's review format, you see an error. Codazo never retries silently, switches providers, or shows sample text as if it were feedback.
- Model-written text saved into notes is escaped, so it cannot embed images, links, or HTML when a note renders.

> [!TIP]
> **Using a local model.** Local servers such as LM Studio often reject the `json_object` response format. Choose `json_schema` and set a maximum token count in the profile. Small non-reasoning models have worked well; reasoning models may think for minutes and time out.

## Develop

```sh
npm ci
npm run lint       # Obsidian's community-plugin validator rules
npm run typecheck
npm test
npm run build      # dist/main.js, manifest.json, styles.css; regenerates NOTICE.md
```

Branch from `dev` and open pull requests against `dev`; see [CONTRIBUTING.md](CONTRIBUTING.md). Releases are cut by pushing a tag equal to the manifest version.

- `src/` — the plugin: the desktop (Node http) and mobile (webview fetch) transports, both refusing redirects; Secret Storage vault and encryption check, plugin data, sessions, vault note builders, the editor decoration extension, pane, dialogs, and settings.
- `shared/` — the review contract and validation, anchor resolution, the OpenAI-compatible provider adapter, provider-settings rules, export serializers, and the conjugation reference, shared with other Codazo applications.
- `tests/` — Vitest suites with synthetic fixtures; never real learner writing or credentials.

## Not yet included

Cumulative mastery tracking, notebook challenges, and an offline dictionary.
