import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { detectExcerptKind, excerptPolicy } from '../src/excerpt';
import { excerptNoteContent, parseSavedReview } from '../src/artifacts';
import type { ReviewSession } from '../src/session';
import type { Review } from '../shared/lib/review/schema';

const review = JSON.parse(readFileSync('tests/fixtures/valid-codazo-v1.json', 'utf8')) as Review;

test('excerpt kind is guessed from the shape of the selection', () => {
  expect(detectExcerptKind('ensimismado')).toBe('word');
  expect(detectExcerptKind('  hilvanar ')).toBe('word');
  expect(detectExcerptKind('no me atropelles')).toBe('phrase');
  expect(detectExcerptKind('Quiero tomar un café.')).toBe('phrase');
  expect(detectExcerptKind('Ayer yo camino al parque. El arbol es bonito. La casa son grande.')).toBe('paragraph');
  expect(detectExcerptKind('palabra.')).toBe('phrase');
});

test('each kind keeps the review contract and adds its own instruction', () => {
  for (const kind of ['word', 'phrase', 'paragraph'] as const) {
    const policy = excerptPolicy(kind);
    expect(policy.schema).toBe('codazo.review/1');
    expect(policy.instruction).toContain('EXCERPT MODE');
    expect(policy.instruction).toContain('return annotations, next_focus, and exercises as empty arrays');
  }
  expect(excerptPolicy('phrase').instruction).toContain('slang, idiom');
  expect(excerptPolicy('paragraph').instruction).toContain('real stretch');
  expect(excerptPolicy('word').instruction).toContain('conjugated verb form');
});

test('the excerpt note carries the passage, its source, meaning notes, words, verbs, and a revalidating payload', () => {
  const session: ReviewSession = { id: 'f3f6a7c0-1111-4222-8333-444455556666', kind: 'excerpt', excerptKind: 'phrase', notePath: 'Lecturas/Cuento.md', source: review.source, sourceHash: 'ab'.repeat(32), offset: 3, reviewedAt: '2026-09-23T13:00:00.000Z', review, generatedBy: 'Live AI feedback — OpenAI · m; AI may be wrong', provider: 'openai', model: 'm' };
  const note = excerptNoteContent(session, { source: '[[Cuento]]' });
  expect(note).toContain('codazo-kind: "excerpt"');
  expect(note).toContain('codazo-excerpt-kind: "phrase"');
  expect(note).toContain('## Extracto\n\n> ' + review.source.text);
  expect(note).toContain('De: [[Cuento]]');
  expect(note).toContain('## Significado\n\n> [!question]- Intenta primero, luego abre\n> - Ayer makes the time of your story clear. («Ayer»)');
  expect(note).toContain('## Palabras para estudiar');
  expect(note).toContain('## Verbos para estudiar');
  expect(note).not.toContain('## Reflexión');
  expect(note).not.toContain('## Práctica');
  expect(note).not.toContain('## Observaciones');
  const parsed = parseSavedReview(note);
  expect(parsed.ok && parsed.value.review).toEqual(review);
});
