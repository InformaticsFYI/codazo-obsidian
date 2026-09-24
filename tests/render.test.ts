// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { installObsidianDom } from './obsidian-dom';
installObsidianDom();
import { renderAnnotatedSource, renderAnnotation, renderStudySource } from '../src/render';
import type { Review } from '../shared/lib/review/schema';

const review = JSON.parse(readFileSync('tests/fixtures/valid-codazo-v1.json', 'utf8')) as Review;

test('the annotated source keeps the text byte-for-byte, marks every anchor once, and selects by id', () => {
  const root = document.createElement('div');
  const selected: string[] = [];
  renderAnnotatedSource(root, review, id => selected.push(id));
  const source = root.querySelector('.codazo-source')!;
  expect(source.textContent).toBe(review.source.text);
  const marks = [...root.querySelectorAll<HTMLButtonElement>('.codazo-source-mark')];
  expect(marks.map(mark => mark.textContent)).toEqual(['camino', 'arbol', 'La casa son', 'Quiero tomar']);
  expect(marks.map(mark => mark.className)).toContain('codazo-mark codazo-mark-alternative codazo-source-mark');
  const peek = root.querySelector('.codazo-peek')!;
  expect(peek.textContent).toContain('Pasa el cursor');
  marks[1]!.dispatchEvent(new MouseEvent('mouseenter'));
  expect(peek.textContent).toContain('árbol');
  expect(peek.textContent).toContain('Ortografía / acento · «arbol»');
  marks[1]!.dispatchEvent(new MouseEvent('mouseleave'));
  expect(peek.textContent).toContain('Pasa el cursor');
  marks[1]!.click();
  expect(selected).toEqual(['a-spelling']);
  marks[3]!.dispatchEvent(new MouseEvent('mouseenter'));
  expect(peek.textContent).toContain('Una alternativa opcional');
  marks[3]!.dispatchEvent(new MouseEvent('mouseleave'));
  expect(peek.textContent).toContain('árbol');
});

test('model text is rendered as text, never as HTML', () => {
  const root = document.createElement('div');
  const hostile = { ...review.annotations[0]!, explanation: '<img src=x onerror="alert(1)"><b>bold</b>' };
  renderAnnotation(root, hostile);
  expect(root.querySelector('img')).toBeNull();
  expect(root.querySelector('.codazo-explanation')!.textContent).toBe(hostile.explanation);
  const source = document.createElement('div');
  renderAnnotatedSource(source, { ...review, source: { text: '<script>x</script> camino', mode: 'spanish_only' }, annotations: [], strengths: [], next_focus: [], vocabulary: [], verbs: [], exercises: [] }, () => {});
  expect(source.querySelector('script')).toBeNull();
  expect(source.querySelector('.codazo-source')!.textContent).toBe('<script>x</script> camino');
});

test('study mode marks vocabulary and verbs only and peeks their meaning', () => {
  const root = document.createElement('div');
  const selected: string[] = [];
  renderStudySource(root, review, id => selected.push(id));
  expect(root.querySelector('.codazo-title')!.textContent).toBe('Guía de estudio');
  expect(root.querySelector('.codazo-source')!.textContent).toBe(review.source.text);
  const marks = [...root.querySelectorAll<HTMLButtonElement>('.codazo-source-mark')];
  expect(marks.map(mark => `${mark.className.includes('vocab') ? 'vocab' : 'verb'}:${mark.textContent}`)).toEqual(['verb:camino', 'vocab:parque']);
  marks[1]!.dispatchEvent(new MouseEvent('mouseenter'));
  expect(root.querySelector('.codazo-peek')!.textContent).toContain('parque: park');
  marks[0]!.click();
  expect(selected).toEqual(['verb-caminar']);
});

test('the interface language switches plugin text only; Codazo output strings are untouched', async () => {
  const { setUiLanguage, t } = await import('../src/strings');
  const { describeError } = await import('../src/labels');
  const { reviewNoteContent } = await import('../src/artifacts');
  const session = { id: 'f3f6a7c0-1111-4222-8333-444455556666', kind: 'review' as const, notePath: 'Diario/Lunes.md', source: review.source, sourceHash: 'ab'.repeat(32), offset: 0, reviewedAt: '2026-09-21T13:00:00.000Z', review, generatedBy: 'Live AI feedback — OpenAI · m; AI may be wrong', provider: 'openai', model: 'm' };
  const spanishNote = reviewNoteContent(session, { source: '[[Lunes]]' });
  try {
    setUiLanguage('en');
    const root = document.createElement('div');
    renderAnnotatedSource(root, review, () => {});
    expect(root.querySelector('.codazo-title')!.textContent).toBe('Your text');
    expect(root.querySelector('.codazo-peek')!.textContent).toContain('Hover or choose');
    expect([...root.querySelectorAll('.codazo-legend span')].map(s => s.textContent)).toEqual(['Spelling / accent', 'Grammar', 'Verb / tense', 'Natural alternative']);
    expect(describeError(new Error('IN_FLIGHT'))).toBe(t().errors.IN_FLIGHT);
    // Saved notes are Codazo output and keep the studio's Spanish regardless of interface language.
    expect(reviewNoteContent(session, { source: '[[Lunes]]' })).toBe(spanishNote);
    expect(spanishNote).toContain('Ortografía / acento');
    // Every key exists in both languages with the same shape.
    setUiLanguage('es');
    const es = t(); setUiLanguage('en'); const en = t();
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    expect(Object.keys(en.errors).sort()).toEqual(Object.keys(es.errors).sort());
  } finally { setUiLanguage('es'); }
});
