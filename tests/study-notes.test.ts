import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { PROGRESS_VALUES, planStudyNotes, verbBasename, wordBasename } from '../src/study-notes';
import type { ReviewSession } from '../src/session';
import type { Review } from '../shared/lib/review/schema';

const review = JSON.parse(readFileSync('tests/fixtures/valid-codazo-v1.json', 'utf8')) as Review;
const session: ReviewSession = { id: 'f3f6a7c0-1111-4222-8333-444455556666', kind: 'study', notePath: 'Diario/Lunes.md', source: review.source, sourceHash: 'ab'.repeat(32), offset: 0, reviewedAt: '2026-09-21T13:00:00.000Z', review, generatedBy: 'Live AI feedback — OpenAI · m; AI may be wrong', provider: 'openai', model: 'm' };

test('one note per word and per verb-and-tense, under Palabras and Verbos, with progress metadata', () => {
  const plans = planStudyNotes(review, session, 'Codazo', '[[Lunes]]');
  expect(plans.map(p => p.path)).toEqual(['Codazo/Palabras/parque.md', 'Codazo/Verbos/caminar · Pretérito (perfecto simple).md']);
  const word = plans[0]!.content;
  expect(word).toMatch(/^---\ncodazo-kind: "palabra"\n/);
  expect(word).toContain('codazo-progreso: "nuevo"');
  expect(word).toContain('codazo-expresion: "parque"');
  expect(word).toContain('# parque\n\n- Significado: park');
  expect(word).toContain('- El parque es grande.');
  const verb = plans[1]!.content;
  expect(verb).toContain('codazo-kind: "verbo"');
  expect(verb).toContain('codazo-infinitivo: "caminar"');
  expect(verb).toContain('codazo-tiempo: "Pretérito (perfecto simple)"');
  expect(verb).toContain('| yo | caminé |');
  expect(verb).toContain('Fuente: conjugate-esp');
  for (const plan of plans) { expect(plan.content).toContain('codazo-source: "[[Lunes]]"'); for (const value of PROGRESS_VALUES) expect(plan.content).toContain(`\`${value}\``); }
});

test('names are stable so a word or verb-tense seen again maps to the same file', () => {
  expect(wordBasename('  Morada ')).toBe('morada');
  expect(wordBasename('prisión y  límite')).toBe('prisión y límite');
  expect(verbBasename('Dar', 'Presente de indicativo')).toBe('dar · Presente de indicativo');
  expect(verbBasename('poder', 'Presente de subjuntivo')).not.toBe(verbBasename('poder', 'Pretérito perfecto simple'));
  expect(wordBasename('a/b:c')).toBe('a b c');
});

test('duplicate words inside one review plan a single note', () => {
  const doubled = { ...review, vocabulary: [review.vocabulary[0]!, { ...review.vocabulary[0]!, id: 'v-dup', expression: 'PARQUE' }] };
  expect(planStudyNotes(doubled, session, 'Codazo', '[[Lunes]]').filter(p => p.kind === 'palabra')).toHaveLength(1);
});
