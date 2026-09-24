import { expect, test } from 'vitest';
import { findIntentCallout, stripCallout } from '../src/intent';

const note = `# Lunes\n\n> [!spoiler]- English Intent\n> I wanted to say that yesterday I walked to the park.\n> And that the tree was pretty.\n\nAyer yo camino al parque. El arbol es bonito.\n`;

test('reads the folded spoiler callout as English intent with its exact range', () => {
  const found = findIntentCallout(note)!;
  expect(found.intent).toBe('I wanted to say that yesterday I walked to the park.\nAnd that the tree was pretty.');
  expect(note.slice(found.start, found.end)).toBe('> [!spoiler]- English Intent\n> I wanted to say that yesterday I walked to the park.\n> And that the tree was pretty.\n');
});

test('accepts other callout types and Spanish titles; ignores unrelated callouts and empty ones', () => {
  expect(findIntentCallout('> [!note] Intención en inglés\n> Hello\n')?.intent).toBe('Hello');
  expect(findIntentCallout('> [!intent]+ intent\n> Hi\n')?.intent).toBe('Hi');
  expect(findIntentCallout('> [!warning] Cuidado\n> Not intent\n')).toBeNull();
  expect(findIntentCallout('> [!spoiler]- English Intent\n\nNo body\n')).toBeNull();
  expect(findIntentCallout('Plain text only')).toBeNull();
});

test('a whole-note review drops the callout and keeps the Spanish contiguous in the note', () => {
  const callout = findIntentCallout(note)!;
  const stripped = stripCallout(note, 0, callout);
  expect(stripped.text).toBe('# Lunes\n\nAyer yo camino al parque. El arbol es bonito.\n');
  expect(stripped.text).not.toMatch(/English|walked/);
});

test('a selection beginning with the callout is trimmed and its offset moves to the Spanish', () => {
  const callout = findIntentCallout(note)!;
  const selectionOffset = callout.start;
  const selection = note.slice(selectionOffset);
  const stripped = stripCallout(selection, selectionOffset, callout);
  expect(stripped.text).toBe('Ayer yo camino al parque. El arbol es bonito.\n');
  expect(note.slice(stripped.offset, stripped.offset + stripped.text.length)).toBe(stripped.text);
});

test('a selection that does not touch the callout is unchanged', () => {
  const callout = findIntentCallout(note)!;
  const start = note.indexOf('Ayer');
  expect(stripCallout('Ayer yo camino al parque.', start, callout)).toEqual({ text: 'Ayer yo camino al parque.', offset: start });
});

test('the inserted template is a folded callout with a selectable placeholder and two blank lines after it', async () => {
  const { INTENT_TEMPLATE, INTENT_PLACEHOLDER, INTENT_PLACEHOLDER_OFFSET } = await import('../src/intent');
  expect(INTENT_TEMPLATE).toBe('> [!spoiler]- English Intent\n> What I meant to say, in English.\n\n\n');
  expect(INTENT_TEMPLATE.slice(INTENT_PLACEHOLDER_OFFSET, INTENT_PLACEHOLDER_OFFSET + INTENT_PLACEHOLDER.length)).toBe(INTENT_PLACEHOLDER);
  // An untouched placeholder is not treated as intent; a filled-in one is.
  expect(findIntentCallout(INTENT_TEMPLATE + 'Hola.')).toBeNull();
  expect(findIntentCallout(INTENT_TEMPLATE.replace(INTENT_PLACEHOLDER, 'I said hello.') + 'Hola.')?.intent).toBe('I said hello.');
});

test('F1: a callout-shaped YAML property is metadata, not intent; a body callout after frontmatter still works with absolute offsets', () => {
  const yamlOnly = '---\nprivate: |\n  > [!note] English Intent\n  > SYNTHETIC-PRIVATE-META\n---\nHola.\n';
  expect(findIntentCallout(yamlOnly)).toBeNull();
  const withBody = '---\ntitle: x\n---\n> [!spoiler]- English Intent\n> Real intent.\n\nHola.\n';
  const found = findIntentCallout(withBody)!;
  expect(found.intent).toBe('Real intent.');
  expect(withBody.slice(found.start, found.end)).toBe('> [!spoiler]- English Intent\n> Real intent.\n');
  const crlf = '---\r\ntitle: x\r\n---\r\n> [!note] Intent\r\n> Windows.\r\n\r\nHola.\r\n';
  const foundCrlf = findIntentCallout(crlf)!;
  expect(foundCrlf.intent).toBe('Windows.');
  expect(crlf.slice(foundCrlf.start, foundCrlf.end)).toBe('> [!note] Intent\r\n> Windows.\r\n');
});
