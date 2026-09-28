import { EditorState, EditorSelection } from '@codemirror/state';
import { expect, test } from 'vitest';
import { SelectionMemory, rememberSelection, recallSelection } from '../src/selection-memory';

const doc = 'Hola, yo soy estudiante de español.';
const state = (from: number, to: number) => EditorState.create({ doc, selection: EditorSelection.single(from, to) });

test('a non-empty selection is remembered; collapsing it later keeps the last one', () => {
  const memory = new SelectionMemory();
  rememberSelection(memory, state(6, 12));
  expect(memory.last).toEqual({ from: 6, to: 12, text: 'yo soy' });
  rememberSelection(memory, state(3, 3));
  expect(memory.last).toEqual({ from: 6, to: 12, text: 'yo soy' });
});

test('recall only returns the range while the document still holds the same text there', () => {
  const memory = new SelectionMemory();
  rememberSelection(memory, state(6, 12));
  expect(recallSelection(memory, (from, to) => doc.slice(from, to))).toEqual({ from: 6, to: 12 });
  expect(recallSelection(memory, (from, to) => 'Hola, tú eres estudiante.'.slice(from, to))).toBeNull();
  expect(recallSelection(new SelectionMemory(), () => '')).toBeNull();
});
