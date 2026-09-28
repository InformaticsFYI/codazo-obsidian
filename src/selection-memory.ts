import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * The last non-empty editor selection. On a touch screen, tapping a button
 * outside the editor collapses the selection before the button's handler
 * runs, so the pane's actions would see nothing selected. The memory is
 * consulted only when the live selection is empty, and only if the document
 * still holds the same text at the same place. Nothing here is written to the
 * note.
 */
export type RememberedSelection = { from: number; to: number; text: string };
export class SelectionMemory { last: RememberedSelection | null = null; }

export function rememberSelection(memory: SelectionMemory, state: EditorState): void {
  const range = state.selection.main;
  if (range.empty) return;
  memory.last = { from: range.from, to: range.to, text: state.doc.sliceString(range.from, range.to) };
}

export function recallSelection(memory: SelectionMemory, textAt: (from: number, to: number) => string): { from: number; to: number } | null {
  const last = memory.last;
  if (!last || textAt(last.from, last.to) !== last.text) return null;
  return { from: last.from, to: last.to };
}

export function selectionMemoryExtension(memory: SelectionMemory): Extension {
  return EditorView.updateListener.of(update => { if (update.selectionSet || update.docChanged) rememberSelection(memory, update.state); });
}
