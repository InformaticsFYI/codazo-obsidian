# Local conjugation reference

## What supplies the forms

`lookupConjugation` uses **`@jirimracek/conjugate-esp` 2.3.6**, a deterministic Spanish conjugator with an explicit known-verb lexicon and hand-maintained conjugation models/rules. This is a **rule-based reference, not an independently human-verified table corpus**. The AI provider selects relevant verbs and tenses; it never supplies trusted table forms.

- Package: https://www.npmjs.com/package/@jirimracek/conjugate-esp/v/2.3.6
- Source: https://github.com/jirimracek/conjugate-esp
- Public API / person-order / regional settings: https://github.com/jirimracek/conjugate-esp/blob/main/docs/USAGE.md
- Exact npm artifact: `https://registry.npmjs.org/@jirimracek/conjugate-esp/-/conjugate-esp-2.3.6.tgz`
- Lockfile integrity: `sha512-zMljc/hNojyvDShjhYOBV607WKiU0BRN6/FLwG+BwY3eSqI+Ta3xXDT9dNyFExO+D8KhyMlU5ehry3U3uScNCA==`
- License: MIT, copyright Jiri Mracek and Automation Controls & Engineering, Colorado LLC.
- Transitive dependency: `fast-diff` 1.3.0, Apache-2.0; separately pinned by `package-lock.json`.
- Both unmodified license texts are retained in `conjugation-licenses.json` and included in the app and offline HTML's optional **Reference license** disclosure. No license is imposed on the learner's writing by this notice.

Installation is reproducible with `npm ci`. No runtime reference download, model query, ML prediction, credential, telemetry, or remote conjugation API is involved. The npm artifact's code/data are not modified.

## Selection and display boundary

- Only exact lowercase Spanish infinitives present in the package's lexicon can reach the conjugator. No suffix-based fallback for invented/unknown verbs; no accent repair or automatic reflexive stripping.
- Explicit 2010 orthography; highlighting disabled so no markup is embedded in forms.
- The library's `canarias` setting supplies **tú + ustedes**; that setting is used only for its person pattern, not as a claim that Mexican Spanish is Canarian Spanish. The display is yo / tú / él-ella-usted / nosotros-nosotras / ellos-ellas-ustedes. Both library plural slots must agree before being combined. Other valid regional forms are not errors.
- Supported simple finite tenses: present indicative, preterite, imperfect indicative, future indicative, conditional, present subjunctive, imperfect subjunctive -ra, imperfect subjunctive -se.
- Tense-name aliases are explicit English/Spanish entries. No arbitrary substring match, ambiguous `past` inference, or fallback from a conflicting label to an arbitrary provider ID.
- Known reflexive infinitives such as `sentirse` retain their person-specific pronouns.
- Defective variants are excluded. Missing/incomplete paradigms, invalid form strings, conflicting complete variants, unsupported names, and unknown verbs return an explicit unavailable result. The broad library lexicon is not a claim of complete table coverage in Codazo.
- Compound tenses, imperatives, progressives, and additional regional forms are not exposed in this bounded fix.
- Model payloads and exported raw JSON remain `codazo.review/1`, including their unavailable provider-conjugation field. Tables and their source attribution are a separately resolved display layer, not a claim that the provider's JSON supplied them.

## Verification and authority

On 2026-09-07, a separate agent retrieved SpanishDictionary.com person/tense tables for caminar, sentir, ser, ir, tener, hacer, poder, and hablar. The parent compared the final rule-reference adapter's **11 selected paradigms / 55 person forms** with those independently retrieved expected values: all matched. This is bounded source comparison, not professional linguistic certification, and the external pages are verification sources rather than a redistributed corpus. See [the verification record](../../docs/verification/conjugation-tables.md).

The earlier unavailable-only publication gate is replaced by a source-labeled, tested rule-based reference; no human review was invented. A UniMorph/Wiktionary-derived corpus was evaluated and rejected because its inspected snapshot omitted frequent verbs including tener/poner/venir. No UniMorph or scraped Wiktionary dataset is shipped. Fred Jehle's CC BY-NC-SA dataset was also not imported. These rejected candidates do not supply the shipped tables or determine their license.
