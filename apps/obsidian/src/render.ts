import { lookupConjugation } from '../../../packages/shared/lib/language/conjugations';
import { resolveAnnotations } from '../../../packages/shared/lib/review/resolve-annotations';
import { resolveAnchor } from '../../../packages/shared/lib/review/resolve-annotations';
import type { Annotation, Review } from '../../../packages/shared/lib/review/schema';
import { t } from './strings';

/**
 * Plain-DOM rendering for the review pane. Every learner or model string goes
 * through textContent; nothing is injected as HTML.
 */
export function el<K extends keyof HTMLElementTagNameMap>(parent: Node, tag: K, options: { text?: string; cls?: string; lang?: string; attrs?: Record<string, string> } = {}): HTMLElementTagNameMap[K] {
  const node = parent.ownerDocument!.createElement(tag);
  if (options.text !== undefined) node.textContent = options.text;
  if (options.cls) node.className = options.cls;
  if (options.lang) node.lang = options.lang;
  for (const [key, value] of Object.entries(options.attrs ?? {})) node.setAttribute(key, value);
  parent.appendChild(node);
  return node;
}

function labeled(parent: Node, label: string, text: string, lang?: string): HTMLParagraphElement {
  const paragraph = el(parent, 'p', { cls: 'codazo-line' });
  el(paragraph, 'strong', { text: `${label} ` });
  el(paragraph, 'span', { text, lang });
  return paragraph;
}

/** A collapsible pane section: heading as the summary, content inside. `open` comes from the learner's setting. */
export function accordion(parent: Node, title: string, open: boolean): HTMLElement {
  const details = el(parent, 'details', { cls: 'codazo-section codazo-accordion' });
  if (open) details.open = true;
  el(details, 'summary', { cls: 'codazo-accordion-title', text: title });
  return el(details, 'div', { cls: 'codazo-accordion-body' });
}

function disclosure(parent: Node, summary: string): HTMLDetailsElement {
  const details = el(parent, 'details', { cls: 'codazo-disclosure' });
  el(details, 'summary', { text: summary });
  return details;
}

export type SourceMark = { id: string; start: number; end: number; category: string; label: string; peek: (container: HTMLElement) => void };

/**
 * The learner's text with inline marks, as in the app: solid underline for
 * corrections, dotted for optional alternatives, a wash for study words. A
 * mark shows its peek under the legend; choosing it pins the peek and selects.
 */
export function renderMarkedSource(parent: Node, options: { title: string; text: string; marks: SourceMark[]; legend: [string, string][]; idle: string }, onSelect: (id: string) => void): HTMLElement {
  const { text } = options;
  const section = el(parent, 'section', { cls: 'codazo-section codazo-text' });
  el(section, 'h2', { cls: 'codazo-title', text: options.title });
  const paragraph = el(section, 'p', { cls: 'codazo-source', lang: 'es', attrs: { 'aria-label': t().sourceAria } });
  const legend = el(section, 'p', { cls: 'codazo-legend codazo-muted' });
  for (const [category, label] of options.legend) el(legend, 'span', { cls: `codazo-mark codazo-mark-${category}`, text: label });
  const peek = el(section, 'div', { cls: 'codazo-peek', attrs: { 'aria-live': 'polite' } });
  let pinned: SourceMark | null = null;
  const show = (mark: SourceMark | null) => { peek.replaceChildren(); if (mark) mark.peek(peek); else el(peek, 'p', { cls: 'codazo-muted', text: options.idle }); };
  show(null);
  const marks = [...options.marks].sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const item of marks) {
    if (item.start < cursor) continue; // overlapping study anchors: keep the first
    if (item.start > cursor) paragraph.appendChild(paragraph.ownerDocument!.createTextNode(text.slice(cursor, item.start)));
    const mark = el(paragraph, 'button', { cls: `codazo-mark codazo-mark-${item.category} codazo-source-mark`, text: text.slice(item.start, item.end), attrs: { type: 'button', 'data-annotation': item.id, 'aria-label': `${text.slice(item.start, item.end)}, ${item.label}` } });
    mark.addEventListener('mouseenter', () => show(item));
    mark.addEventListener('focus', () => show(item));
    mark.addEventListener('mouseleave', () => show(pinned));
    mark.addEventListener('blur', () => show(pinned));
    mark.addEventListener('click', () => { pinned = item; show(pinned); onSelect(item.id); });
    cursor = item.end;
  }
  paragraph.appendChild(paragraph.ownerDocument!.createTextNode(text.slice(cursor)));
  return section;
}

/** Review mode: marks are the annotations; the peek is the observation. */
export function renderAnnotatedSource(parent: Node, review: Review, onSelect: (id: string) => void): HTMLElement {
  const text = review.source.text;
  const resolved = resolveAnnotations(text, review.annotations);
  const marks: SourceMark[] = resolved.ok ? resolved.value.map(item => ({
    id: item.id, start: item.start, end: item.end, category: item.annotation.category, label: t().category[item.annotation.category],
    peek: container => {
      const annotation = item.annotation;
      const optional = annotation.category === 'alternative';
      el(container, 'p', { cls: 'codazo-category', text: `${optional ? t().optionalAlternative : t().category[annotation.category]} · «${annotation.anchor.quote}»` });
      labeled(container, optional ? t().suggestionOptional : t().suggestion, annotation.suggestion.text, 'es');
      el(container, 'p', { text: annotation.explanation });
    },
  })) : [];
  const idle = marks.length ? t().idleReview : t().noObservations;
  return renderMarkedSource(parent, { title: t().yourText, text, marks, legend: Object.entries(t().category), idle }, onSelect);
}

/** Study mode: marks are the vocabulary and verbs; the peek is the meaning. */
export function renderStudySource(parent: Node, review: Review, onSelect: (id: string) => void, title = t().studyGuide): HTMLElement {
  const text = review.source.text;
  const marks: SourceMark[] = [];
  for (const item of review.vocabulary) {
    const span = resolveAnchor(text, item.anchor);
    if (span.ok) marks.push({ id: item.id, start: span.value.start, end: span.value.end, category: 'vocab', label: t().wordToStudy, peek: container => {
      el(container, 'p', { cls: 'codazo-category', text: `${t().wordToStudy} · «${item.anchor.quote}»` });
      labeled(container, `${item.expression}:`, item.meaning, 'es');
      el(container, 'p', { cls: 'codazo-muted', text: item.reason });
    } });
  }
  for (const verb of review.verbs) {
    const span = resolveAnchor(text, verb.anchor);
    if (span.ok) marks.push({ id: verb.id, start: span.value.start, end: span.value.end, category: 'verb', label: t().verbToStudy, peek: container => {
      el(container, 'p', { cls: 'codazo-category', text: `${t().verbToStudy} · «${verb.anchor.quote}»` });
      labeled(container, `${verb.infinitive}:`, verb.meaning, 'es');
      el(container, 'p', { cls: 'codazo-muted', text: `${verb.reason} ${verb.tenses.map(tense => tense.name).join(' · ')}` });
    } });
  }
  const idle = marks.length ? t().idleStudy : t().idleStudyEmpty;
  return renderMarkedSource(parent, { title, text, marks, legend: [['vocab', t().legendWords], ['verb', t().legendVerbs]], idle }, onSelect);
}

/** Suggestion and explanation first; the reveal ladder (Observa → Piensa → Pista → Inténtalo) on request. */
export function renderAnnotation(parent: Node, annotation: Annotation, onReveal?: () => void): HTMLElement {
  const optional = annotation.category === 'alternative';
  const card = el(parent, 'article', { cls: `codazo-card codazo-annotation codazo-annotation-${annotation.category}`, attrs: { tabindex: '0', 'data-annotation': annotation.id, 'aria-label': `${t().category[annotation.category]}: ${annotation.anchor.quote}` } });
  const head = el(card, 'div', { cls: 'codazo-card-head' });
  el(head, 'span', { cls: 'codazo-category', text: optional ? t().optionalAlternative : t().category[annotation.category] });
  if (onReveal) {
    const button = el(head, 'button', { cls: 'codazo-reveal', text: t().seeInNote, attrs: { type: 'button', 'aria-label': t().goTo(annotation.anchor.quote) } });
    button.addEventListener('click', onReveal);
  }
  el(card, 'p', { cls: 'codazo-quote', text: `«${annotation.anchor.quote}»`, lang: 'es' });
  labeled(card, optional ? t().suggestionOptional : t().suggestion, annotation.suggestion.text, 'es');
  el(card, 'p', { cls: 'codazo-explanation', text: annotation.explanation });
  const practice = disclosure(card, t().morePractice);
  labeled(practice, t().notice, annotation.notice);
  el(practice, 'p', { text: annotation.question });
  const hint = disclosure(practice, t().hint);
  el(hint, 'p', { text: annotation.hint });
  labeled(practice, t().tryAgain, annotation.retry_focus);
  if (annotation.suggestion.lexical_change.status === 'introduced') {
    const lexical = disclosure(card, t().newWords);
    for (const item of annotation.suggestion.lexical_change.items) {
      const line = el(lexical, 'p');
      el(line, 'strong', { text: item.expression, lang: 'es' });
      el(line, 'span', { text: ` · ${item.meaning}` });
      el(lexical, 'p', { cls: 'codazo-muted', text: item.reason });
    }
  }
  return card;
}

export function renderOverview(parent: Node, review: Review, open = true): void {
  const section = accordion(parent, t().summary, open);
  const corrections = review.annotations.filter(a => a.category !== 'alternative').length;
  const alternatives = review.annotations.length - corrections;
  el(section, 'p', { text: t().summaryLine(corrections, alternatives, review.vocabulary.length, review.verbs.length) });
  if (review.alignment) labeled(section, t().intentLabel(review.alignment.assessment), review.alignment.explanation);
  if (review.strengths.length) {
    el(section, 'h4', { text: t().strengths });
    const list = el(section, 'ul');
    for (const item of review.strengths) { const li = el(list, 'li', { text: `${item.text} ` }); el(li, 'span', { cls: 'codazo-muted', text: `«${item.anchor.quote}»`, lang: 'es' }); }
  }
  if (review.next_focus.length) {
    el(section, 'h4', { text: t().nextSteps });
    const list = el(section, 'ul');
    for (const item of review.next_focus) { const li = el(list, 'li', { text: `${item.text} ` }); el(li, 'span', { cls: 'codazo-muted', text: `«${item.anchor.quote}»`, lang: 'es' }); }
  }
}

export function renderStudy(parent: Node, review: Review, open = true): void {
  let section = accordion(parent, `${t().wordsToStudy} (${review.vocabulary.length})`, open);
  if (!review.vocabulary.length) el(section, 'p', { cls: 'codazo-muted', text: t().noNewWords });
  for (const item of review.vocabulary) {
    const card = el(section, 'article', { cls: 'codazo-card' });
    const head = el(card, 'div', { cls: 'codazo-card-head' });
    el(head, 'span', { cls: 'codazo-term', text: item.expression, lang: 'es' });
    el(head, 'span', { cls: 'codazo-badge', text: item.is_new ? t().badgeNew : t().badgePractice });
    el(card, 'p', { text: item.meaning });
    el(card, 'p', { cls: 'codazo-muted', text: item.reason });
    const more = disclosure(card, t().originalAndExamples);
    el(more, 'p', { cls: 'codazo-muted', text: t().fromYourText(item.anchor.quote), lang: 'es' });
    for (const example of item.examples) el(more, 'p', { text: example, lang: 'es' });
  }
  section = accordion(parent, `${t().verbsToStudy} (${review.verbs.length})`, open);
  if (!review.verbs.length) el(section, 'p', { cls: 'codazo-muted', text: t().noVerbs });
  for (const verb of review.verbs) {
    const card = el(section, 'article', { cls: 'codazo-card' });
    const head = el(card, 'div', { cls: 'codazo-card-head' });
    el(head, 'span', { cls: 'codazo-term', text: verb.infinitive, lang: 'es' });
    el(head, 'span', { cls: 'codazo-muted', text: verb.meaning });
    el(card, 'p', { cls: 'codazo-muted', text: verb.reason });
    for (const tense of verb.tenses) {
      const block = el(card, 'div', { cls: 'codazo-tense' });
      el(block, 'h4', { text: tense.name, lang: 'es' });
      el(block, 'p', { text: tense.use });
      const reference = lookupConjugation(verb.infinitive, tense.name);
      if (reference.status === 'unavailable') { el(block, 'p', { cls: 'codazo-muted', text: t().referenceUnavailable(reference.reason) }); continue; }
      const table = el(block, 'table', { cls: 'codazo-table', attrs: { 'aria-label': `${verb.infinitive}, ${reference.tense}` } });
      const body = el(table, 'tbody');
      for (const row of reference.forms) { const tr = el(body, 'tr'); el(tr, 'th', { text: row.person, attrs: { scope: 'row' } }); el(tr, 'td', { text: row.form, lang: 'es' }); }
      el(block, 'p', { cls: 'codazo-source-line', text: t().sourceLine(reference.source.label, reference.source.license) });
    }
  }
}
