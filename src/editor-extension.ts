import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/**
 * Temporary annotation marks. Decorations are derived state: they are built
 * only when the exact reviewed passage sits at the expected offset, cleared on
 * any document change, and rebuilt when the plugin re-locates the passage
 * through `workspace.updateOptions()`. Nothing here is written to the note.
 */
export type HighlightSpan = { from: number; to: number; category: string };
export type HighlightTarget = { sourceText: string; offset: number; spans: HighlightSpan[] } | null;
export class HighlightStore { current: HighlightTarget = null; }

function build(state: EditorState, target: HighlightTarget): DecorationSet {
  if (!target) return Decoration.none;
  const end = target.offset + target.sourceText.length;
  if (end > state.doc.length || state.doc.sliceString(target.offset, end) !== target.sourceText) return Decoration.none;
  return Decoration.set(target.spans.map(span => Decoration.mark({ class: `codazo-mark codazo-mark-${span.category}` }).range(target.offset + span.from, target.offset + span.to)), true);
}

export function highlightExtension(store: HighlightStore): Extension {
  const field = StateField.define<DecorationSet>({
    create: state => build(state, store.current),
    update: (value, transaction) => transaction.docChanged ? Decoration.none : value,
    provide: field => EditorView.decorations.from(field),
  });
  return [field];
}
