import { inspectJSONValue, codePointLength, utf8ByteLength } from '../review/limits';
import { validateReview } from '../review/validate';
import { resolveAnnotations } from '../review/resolve-annotations';
import type { Review } from '../review/schema';
import { lookupConjugation } from '../language/conjugations';

export type ExportProvenance = { generatedBy: string; methodology?: string };
export const DEFAULT_METHODOLOGY = 'Codazo review methodology: source-preserving, learner-controlled feedback; alternatives are optional, not errors.';
export type ExportEnvelope = {
  format: 'codazo.review.export'; format_version: 1; review: Review;
  provenance: { generated_by: string; methodology: string; application_schema: 'codazo.review/1'; upstream_contract: 'review-contract-v2'; compatibility: 'semantic derivation only; not wire compatibility' };
  revision?: string;
};
type Printable = string | number | boolean | null | undefined;
const escapeHtml = (value: Printable): string => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;').replaceAll('\r', '&#13;');
const block = (label: string, value: Printable) => `<div class="field"><strong>${escapeHtml(label)}</strong><div>${escapeHtml(value)}</div></div>`;
const list = (items: string[]) => items.length ? `<ul>${items.map(item => item.startsWith('<li>') ? item : `<li>${item}</li>`).join('')}</ul>` : '<p>None recorded.</p>';

export function validateExportRevision(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input)) throw new Error('INVALID_REVISION');
  if (codePointLength(input) > 4000 || utf8ByteLength(input) > 16000) throw new Error('INVALID_REVISION');
  return input;
}

export function validatedExportReview(input: unknown, expectedSource?: unknown): Review {
  if (inspectJSONValue(input, 256 * 1024) !== 'ok') throw new Error('INVALID_REVIEW');
  const embeddedSource = input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as { source?: unknown }).source : undefined;
  const result = validateReview(input, expectedSource === undefined ? embeddedSource : expectedSource);
  if (!result.ok) throw new Error('INVALID_REVIEW');
  return result.value;
}

function validatedProvenance(input: ExportProvenance): { generatedBy: string; methodology: string } {
  if (!input || typeof input !== 'object' || typeof input.generatedBy !== 'string' || input.generatedBy.length === 0 || (input.methodology !== undefined && typeof input.methodology !== 'string')) throw new Error('INVALID_PROVENANCE');
  return { generatedBy: input.generatedBy, methodology: input.methodology ?? DEFAULT_METHODOLOGY };
}

function annotationHtml(annotation: Review['annotations'][number], prefix = ''): string {
  const suggestionLabel = annotation.suggestion.kind === 'optional_alternative' ? 'Optional alternative' : 'Correction';
  const lexical = annotation.suggestion.lexical_change.status === 'introduced' ? annotation.suggestion.lexical_change.items.map(item => `${item.expression} — ${item.meaning} — ${item.reason}`).join('; ') : 'No lexical change.';
  return `<article id="${prefix}note-${escapeHtml(annotation.id)}" class="annotation annotation-${escapeHtml(annotation.category)}" role="note" tabindex="-1"><h3>${escapeHtml(annotation.category)} · <span lang="es">${escapeHtml(annotation.anchor.quote)}</span></h3><p class="suggestion"><strong>${escapeHtml(suggestionLabel)}${annotation.category === 'alternative' ? ' · not an error' : ''}:</strong> <span lang="es">${escapeHtml(annotation.suggestion.text)}</span></p><p class="explanation">${escapeHtml(annotation.explanation)}</p><details><summary>More guidance</summary>${block('Notice', annotation.notice)}${block('Think', annotation.question)}${block('Hint', annotation.hint)}${block('Understand', annotation.explanation)}${block('See suggestion', annotation.suggestion.text)}${block('Lexical change', lexical)}${block('Try again', annotation.retry_focus)}</details><a href="#${prefix}original-writing">Back to your writing</a></article>`;
}

function sourceHtml(review: Review, prefix = ''): string {
  const resolved = resolveAnnotations(review.source.text, review.annotations);
  if (!resolved.ok) throw new Error('INVALID_REVIEW');
  let cursor = 0;
  let html = '';
  for (const span of resolved.value) {
    html += escapeHtml(review.source.text.slice(cursor, span.start));
    html += `<a class="mark mark-${escapeHtml(span.annotation.category)}" href="#${prefix}note-${escapeHtml(span.id)}" aria-label="${escapeHtml(span.annotation.category)}: ${escapeHtml(span.annotation.anchor.quote)} — read feedback">${escapeHtml(review.source.text.slice(span.start, span.end))}</a>`;
    cursor = span.end;
  }
  return html + escapeHtml(review.source.text.slice(cursor));
}

function conjugationHtml(verb: string, tense: string, externalLinks = true): string {
  const reference = lookupConjugation(verb, tense);
  if (reference.status === 'unavailable') return block('Reference status', `Unavailable: ${reference.reason}`);
  return `<table class="conjugation-table"><caption lang="es">${escapeHtml(verb)} · ${escapeHtml(reference.tense)}</caption><thead><tr><th scope="col">Person</th><th scope="col">Form</th></tr></thead><tbody lang="es">${reference.forms.map(row => `<tr><th scope="row">${escapeHtml(row.person)}</th><td>${escapeHtml(row.form)}</td></tr>`).join('')}</tbody></table><p class="conjugation-source">Source: ${externalLinks ? `<a href="${escapeHtml(reference.source.url)}" rel="noreferrer">${escapeHtml(reference.source.label)}</a>` : `${escapeHtml(reference.source.label)} (${escapeHtml(reference.source.url)})`} · License: ${escapeHtml(reference.source.license)}</p>${reference.source.licenseText ? `<details><summary>Reference license</summary><p>${escapeHtml(reference.source.licenseText)}</p></details>` : ''}`;
}

function studyHtml(review: Review, prefix = '', externalLinks = true): string {
  const vocabulary = review.vocabulary.map(item => `<article><h3>${escapeHtml(item.expression)}</h3>${block('Meaning', item.meaning)}${block('Why this was selected', item.reason)}${block('New in this review', item.is_new ? 'Yes' : 'No')}${item.examples.length ? `<div class="field"><strong>Examples</strong><ul>${item.examples.map(example => `<li>${escapeHtml(example)}</li>`).join('')}</ul></div>` : ''}</article>`).join('');
  const verbs = review.verbs.map(verb => `<article><h3>${escapeHtml(verb.infinitive)} · ${escapeHtml(verb.meaning)}</h3>${block('Why this was selected', verb.reason)}${verb.tenses.map(tense => `<div class="tense"><h4>${escapeHtml(tense.name)}</h4>${block('Use', tense.use)}${conjugationHtml(verb.infinitive, tense.name, externalLinks)}</div>`).join('')}</article>`).join('');
  const exercises = review.exercises.map((exercise, index) => `<article><h4>Practice ${index + 1}</h4>${block('Prompt', exercise.prompt)}<details><summary>Hint</summary><p>${escapeHtml(exercise.hint)}</p></details><details class="answer"><summary>Reveal answer</summary>${block('Answer', exercise.answer)}${block('Explanation', exercise.explanation)}</details></article>`).join('');
  return `<section id="${prefix}study"><h2>Study material</h2><p>Try a little practice from your writing. Reveal help whenever you want.</p><section id="${prefix}practice"><h3>Practice</h3>${exercises || '<p>No practice prompts in this review.</p>'}</section><section><h3>Words from your writing</h3>${vocabulary || '<p>No vocabulary selection in this review.</p>'}</section><section id="${prefix}verb-references"><h3>Verb references</h3>${verbs || '<p>Verb references are unavailable in this local build.</p>'}</section></section>`;
}

const css = `

/* Compact local-reference tables, on the same warm paper as study. */
.conjugation-table { width: 100%; max-width: 34rem; table-layout: fixed; border-collapse: collapse; margin: .8rem 0 .4rem; font-size: .9rem; }
.conjugation-table caption { text-align: left; font: 600 .9rem/1.5 system-ui, sans-serif; padding-bottom: .4rem; }
.conjugation-table th, .conjugation-table td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #e3dccf; overflow-wrap: anywhere; }
.conjugation-table thead { background: #f3ede1; color: #655d50; font-size: .8rem; }
.conjugation-table tbody th { font-weight: 400; }
.conjugation-table td { font-family: Georgia, serif; font-size: 1.05rem; }
.conjugation-source, .tense-reference .conjugation-source { max-width: 34rem; color: #6d655c; font-size: .75rem; overflow-wrap: anywhere; }
@media print { .conjugation-table { break-inside: avoid; } .conjugation-source { break-before: avoid; } }
*{box-sizing:border-box}body{margin:0;background:#eee9df;color:#211f1c;font:16px/1.65 system-ui,sans-serif}main{max-width:860px;margin:2.5rem auto;padding:3rem 3.5rem;background:#fffdf8;box-shadow:0 3px 24px #211f1c12;overflow-wrap:anywhere}h1,h2,h3,h4{line-height:1.3}h1{font:normal clamp(1.8rem,5vw,2.6rem)/1.2 Georgia,serif;margin:.5rem 0 1rem}h2{font:normal 1.7rem/1.3 Georgia,serif;margin:0 0 1rem}h3{font-size:1.05rem}h4{font-size:1rem}.eyebrow{color:#8f6614;text-transform:uppercase;letter-spacing:.12em;font-size:.8rem}a{color:#8f6614;text-underline-offset:.2em}nav{margin:1rem 0}section{margin:2rem 0;padding-top:1.5rem;border-top:1px solid #ded7ca}section section{border:0;padding:0}article{margin:1.3rem 0;padding:.25rem 0 1rem;border-bottom:1px solid #e6dfd2}.source{white-space:pre-wrap;font:1.4rem/2 Georgia,serif;margin:1.25rem 0}.mark{color:inherit;border-radius:2px;text-underline-offset:.23em;text-decoration-thickness:1.5px}.mark-spelling{text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:#b33535}.mark-grammar{background:#f8dfdc;text-decoration-color:#b33535}.mark-verb{background:#eee4f5;text-decoration-color:#79518e}.mark-alternative{background:#fff0ad;text-decoration-color:#9a7016}.legend{font-size:.8rem;line-height:2.1}.legend span{padding:.15rem .2rem}.annotation{scroll-margin-top:1rem;padding-left:1rem;border-left:3px solid #ded7ca}.annotation-alternative{border-left-color:#d4ae36}.annotation-verb{border-left-color:#79518e}.annotation-spelling,.annotation-grammar{border-left-color:#b33535}.annotation:target{background:#f5f0e5}.suggestion{margin:.5rem 0}.suggestion [lang=es]{font-family:Georgia,serif;font-size:1.15rem}.explanation{margin:.5rem 0 1rem}.field{margin:.55rem 0}.field strong{display:block;font-size:.85rem;color:#655d50}summary{cursor:pointer;color:#8f6614;padding:.4rem 0;font-weight:600}details{margin:.5rem 0}a:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid #9a7016;outline-offset:4px}footer{border-top:1px solid #ded7ca;margin-top:2rem;padding-top:1rem;font-size:.85rem;color:#655d50}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem}@media(max-width:600px){main{margin:0;padding:1.5rem 1.2rem;box-shadow:none}.source{font-size:1.25rem}}@media print{body{background:white}main{margin:0;max-width:none;padding:0;box-shadow:none}nav,.export-details{display:none}a{color:inherit}article{break-inside:avoid}.source{font-size:14pt}}
`;

export const feedbackStyles = css;

/** Reusable fragments, never full documents; scope all IDs at the boundary. */
export function renderFeedbackSections(input: unknown, scope: string): { feedback: string; study: string } {
  if (typeof scope !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(scope)) throw new Error('INVALID_EXPORT_SCOPE');
  const review = validatedExportReview(input);
  const prefix = `${scope}-`;
  const source = review.source;
  const intent = source.mode === 'intent_comparison' ? `<section><h2>English intent</h2><div class="source">${escapeHtml(source.intent)}</div></section>` : '';
  const alignment = review.alignment ? `<section><h2>Meaning alignment</h2>${block('Assessment', review.alignment.assessment)}${block('Explanation', review.alignment.explanation)}</section>` : '';
  const annotations = review.annotations.map(annotation => annotationHtml(annotation, prefix)).join('');
  return {
    feedback: `<section><h2>What I wrote</h2><div id="${prefix}original-writing" class="source" lang="es" tabindex="-1">${sourceHtml(review, prefix)}</div></section>${intent}${alignment}<section id="${prefix}feedback"><h2>Corrections and choices</h2>${annotations || '<p>No corrections in this review.</p>'}</section>`,
    study: `${studyHtml(review, prefix, false)}<section><h2>Strengths</h2>${list(review.strengths.map(item => escapeHtml(item.text)))}</section><section><h2>Next focus</h2>${list(review.next_focus.map(item => escapeHtml(item.text)))}</section>`,
  };
}

/** Render a runtime-validated, script-free, standalone document. */
export function renderFeedbackHtml(input: unknown, provenanceInput: ExportProvenance, revisionInput?: unknown): string {
  const review = validatedExportReview(input);
  const provenance = validatedProvenance(provenanceInput);
  const revision = validateExportRevision(revisionInput);
  const source = review.source;
  const annotations = review.annotations.map(annotation => annotationHtml(annotation)).join('');
  const diagnostics = review.annotations.map(annotation => `<li><strong>${escapeHtml(annotation.id)}</strong>: ${escapeHtml(annotation.category)}; ${escapeHtml(annotation.suggestion.kind)}; quote occurrence ${annotation.anchor.occurrence}</li>`);
  const intent = source.mode === 'intent_comparison' ? `<section><h2>English intent</h2><div class="source">${escapeHtml(source.intent)}</div></section>` : '';
  const revisionSection = revision === undefined ? '' : `<section><h2>Unverified learner revision</h2><p>This is separate from the original and has not been reviewed.</p><div class="source">${escapeHtml(revision)}</div></section>`;
  const summary = `${review.annotations.length} feedback item(s), ${review.vocabulary.length} vocabulary item(s), ${review.verbs.length} verb focus item(s), and ${review.exercises.length} practice exercise(s).`;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Codazo offline review</title><style>${css}</style></head><body><main>`;
  const header = `<header><p class="eyebrow">Codazo · offline review</p><h1>Your writing, with room to grow</h1><p>Follow a marked phrase for a suggestion and an English explanation. Your original words stay yours.</p><nav aria-label="Review sections"><a href="#original-writing">Your writing</a> · <a href="#study">Study material</a></nav><p class="legend"><span class="mark-spelling">Spelling</span> · <span class="mark-grammar">Grammar</span> · <span class="mark-verb">Verbs</span> · <span class="mark-alternative">Optional alternatives</span></p></header>`;
  const alignment = review.alignment ? `<section><h2>Meaning alignment</h2>${block('Assessment', review.alignment.assessment)}${block('Explanation', review.alignment.explanation)}</section>` : '';
  const body = `${header}<section><h2>What I wrote</h2><div id="original-writing" class="source" lang="es" tabindex="-1">${sourceHtml(review)}</div></section>${intent}${alignment}<section id="feedback"><h2>Corrections and choices</h2>${annotations || '<p>No corrections in this review.</p>'}</section>${studyHtml(review)}${revisionSection}<section><h2>Strengths</h2>${list(review.strengths.map(item => escapeHtml(item.text)))}</section><section><h2>Next focus</h2>${list(review.next_focus.map(item => escapeHtml(item.text)))}</section>`;
  const footer = `<footer><p>This export contains your writing. Share it only with people you trust.</p><details class="export-details"><summary>Review details and provenance</summary>${block('Generated by', provenance.generatedBy)}${block('Methodology', provenance.methodology)}<h2>Summary</h2><p>${summary}</p><h2>Diagnostics</h2>${list(diagnostics)}<p>Schema: ${escapeHtml(review.schema_version)} · Local application schema: codazo.review/1 · Pinned upstream reference: review-contract-v2 (semantic derivation only; not wire compatibility)</p><details><summary>Complete review data</summary><pre>${escapeHtml(JSON.stringify(review, null, 2))}</pre></details></details></footer>`;
  return `${head}${body}${footer}</main></body></html>`;
}
