import { expect, test } from 'vitest';
import { locateSource, sha256Hex } from '../src/session';

test('sha256 of the exact source is stable and hex encoded', async () => {
  expect(await sha256Hex('Ayer yo camino al parque.')).toMatch(/^[0-9a-f]{64}$/);
  expect(await sha256Hex('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});

test('unchanged source at the captured offset is fresh', () => {
  const note = '# Diario\n\nAyer yo camino al parque.\n';
  expect(locateSource(note, 'Ayer yo camino al parque.', 10)).toEqual({ status: 'fresh', offset: 10 });
});

test('a passage that moved but is still unique is relocated; edits inside it make the review stale', () => {
  const source = 'El arbol es bonito.';
  expect(locateSource(`Nuevo párrafo.\n\n${source}`, source, 0)).toEqual({ status: 'relocated', offset: 16 });
  expect(locateSource('El árbol es bonito.', source, 0)).toEqual({ status: 'stale', reason: 'missing' });
});

test('duplicate passages are ambiguous, never attached to a similar occurrence', () => {
  const source = 'Quiero tomar un café.';
  expect(locateSource(`${source}\n\n${source}`, source, 40)).toEqual({ status: 'stale', reason: 'ambiguous' });
});

test('no normalization: CRLF, combining marks, and zero-width characters must match exactly', () => {
  expect(locateSource('Hola\nmundo', 'Hola\r\nmundo', null)).toEqual({ status: 'stale', reason: 'missing' });
  expect(locateSource('caf\u00e9', 'cafe\u0301', null)).toEqual({ status: 'stale', reason: 'missing' });
  expect(locateSource('ho\u200Bla', 'hola', null)).toEqual({ status: 'stale', reason: 'missing' });
});
