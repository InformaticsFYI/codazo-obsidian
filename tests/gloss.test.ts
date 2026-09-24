// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { installObsidianDom } from './obsidian-dom';
installObsidianDom();
import { findGlosses, makeGloss, stripGlosses } from '../src/gloss';
import { glossPostProcessor } from '../src/gloss-extension';

test('finds word and phrase glosses with exact ranges', () => {
  const text = 'Compré {botas|boots} nuevas. {sepa la bola|who knows} si llegan.';
  const found = findGlosses(text);
  expect(found.map(g => [g.term, g.gloss])).toEqual([['botas', 'boots'], ['sepa la bola', 'who knows']]);
  expect(text.slice(found[0]!.start, found[0]!.end)).toBe('{botas|boots}');
  expect(text.slice(found[1]!.termStart, found[1]!.termEnd)).toBe('sepa la bola');
});

test('stripping leaves only the Spanish; building escapes the delimiters', () => {
  expect(stripGlosses('Compré {botas|boots} nuevas. {sepa la bola|who knows}.')).toBe('Compré botas nuevas. sepa la bola.');
  expect(makeGloss('  botas ', 'boots (footwear)')).toBe('{botas|boots (footwear)}');
  expect(makeGloss('a|b', 'c}d')).toBe('{a b|c d}');
  expect(findGlosses('no gloss here {} or {only}')).toEqual([]);
});

test('reading view replaces glosses with underlined spans carrying the tooltip, and leaves code alone', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>Compré {botas|boots} nuevas.</p><code>{x|y}</code>';
  const tips: string[] = [];
  glossPostProcessor(root, (_el, text) => tips.push(text));
  const span = root.querySelector('p .codazo-gloss')!;
  expect(span.textContent).toBe('botas');
  expect(span.getAttribute('aria-label')).toBe('boots');
  expect(root.querySelector('p')!.textContent).toBe('Compré botas nuevas.');
  expect(root.querySelector('code')!.textContent).toBe('{x|y}');
  expect(tips).toEqual(['boots']);
});
