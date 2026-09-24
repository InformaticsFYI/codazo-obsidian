import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { availablePath, containedFolder, parseSavedReview, reviewNoteContent, revisionNoteContent, sanitizeBasename, studyNoteContent } from '../src/artifacts';
import type { ReviewSession } from '../src/session';
import type { Review } from '../shared/lib/review/schema';

const review = JSON.parse(readFileSync(new URL('./fixtures/valid-codazo-v1.json', import.meta.url), 'utf8')) as Review;
const session: ReviewSession = {
  id: 'f3f6a7c0-1111-4222-8333-444455556666', kind: 'review', notePath: 'Diario/Lunes.md', source: review.source, sourceHash: 'ab'.repeat(32), offset: 12,
  reviewedAt: '2026-09-20T13:00:00.000Z', review, generatedBy: 'Live AI feedback — OpenAI · synthetic-model; AI may be wrong', provider: 'openai', model: 'synthetic-model',
};
const links = { source: '[[Lunes]]', review: '[[Lunes · Codazo]]' };

test('the saved review carries flat properties, the exact source, readable feedback, and a payload that revalidates', () => {
  const content = reviewNoteContent(session, links);
  expect(content.startsWith('---\ncodazo-kind: "review"\ncodazo-schema: "codazo.review/1"\n')).toBe(true);
  for (const key of ['codazo-session', 'codazo-source', 'codazo-source-hash', 'codazo-version', 'codazo-reviewed-at', 'codazo-provider', 'codazo-model']) expect(content).toContain(`\n${key}: `);
  expect(content).toContain('> ' + review.source.text);
  expect(content).toContain('caminé');
  expect(content).toContain('Una alternativa opcional');
  const parsed = parseSavedReview(content);
  expect(parsed.ok && parsed.value.review).toEqual(review);
  expect(parsed.ok && parsed.value.sourceHash).toBe('ab'.repeat(32));
  expect(parsed.ok && parsed.value.model).toBe('synthetic-model');
});

test('a tampered or missing payload is refused instead of rendered', () => {
  const content = reviewNoteContent(session, links);
  expect(parseSavedReview(content.replace('"quote":"camino"', '"quote":"camina"'))).toEqual({ ok: false, error: 'ANCHOR_NOT_FOUND' });
  expect(parseSavedReview(content.replace('```json codazo-review', '```json'))).toEqual({ ok: false, error: 'NO_PAYLOAD' });
  expect(parseSavedReview(content.replace('"codazo.review/1"', '"codazo.review/2"').replace('codazo.review/1","source"', 'codazo.review/2","source"'))).toEqual({ ok: false, error: 'INVALID_REVIEW' });
  expect(parseSavedReview(content.replace('{"schema_version"', '{"schema_version":"x","schema_version"'))).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
});

test('revision and study notes link back to source and review and copy the passage without touching the original', () => {
  const revision = revisionNoteContent(session, links, 2);
  expect(revision).toContain('codazo-kind: "revision"');
  expect(revision).toContain('codazo-version: 2');
  expect(revision).toContain('codazo-review: "[[Lunes · Codazo]]"');
  expect(revision).toContain(`## Mi revisión\n\n${review.source.text}\n`);
  const study = studyNoteContent(session, { source: '[[Lunes]]' });
  expect(study).toContain('codazo-kind: "study"');
  expect(study).not.toContain('codazo-review:');
  expect(study).toContain('### parque');
  expect(study).toContain('### caminar · to walk');
});

test('no artifact ever contains a provider key even when one leaks into a field', () => {
  const leaky = { ...session, generatedBy: 'Live AI feedback — OpenAI · synthetic-model; AI may be wrong' };
  for (const content of [reviewNoteContent(leaky, links), revisionNoteContent(leaky, links, 1), studyNoteContent(leaky, links)]) expect(content).not.toMatch(/sk-|Bearer|apiKey/);
});

test('artifact paths stay inside the configured folder and never overwrite', () => {
  expect(containedFolder(' Codazo/Reviews ')).toBe('Codazo/Reviews');
  for (const bad of ['../Escapes', '/abs', 'C:/x', 'a/../b', '', '.']) expect(() => containedFolder(bad)).toThrow('INVALID_FOLDER');
  expect(sanitizeBasename('Lunes: ¿qué/pasó? [[x]] #tag')).toBe('Lunes ¿qué pasó x tag');
  const existing = new Set(['Codazo/Reviews/Lunes.md', 'Codazo/Reviews/Lunes 2.md']);
  expect(availablePath(path => existing.has(path), 'Codazo/Reviews', 'Lunes')).toBe('Codazo/Reviews/Lunes 3.md');
  expect(availablePath(() => false, 'Codazo/Reviews', '../../etc/passwd')).toBe('Codazo/Reviews/.. .. etc passwd.md');
});

test('study sheets carry a payload and parse back with their kind, so they reload without a model call', () => {
  const study = studyNoteContent(session, { source: '[[Lunes]]' });
  const parsed = parseSavedReview(study);
  expect(parsed.ok && parsed.value.kind).toBe('study');
  expect(parsed.ok && parsed.value.review).toEqual(review);
  const saved = parseSavedReview(reviewNoteContent(session, links));
  expect(saved.ok && saved.value.kind).toBe('review');
});
