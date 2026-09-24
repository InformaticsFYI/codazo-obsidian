/// <reference types="obsidian" />
import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { findGlosses } from './gloss';

/**
 * Live Preview rendering of `{term|gloss}`: the markup is hidden and the term
 * underlined with the gloss as its tooltip, except where the cursor sits
 * inside the gloss, which shows the raw text for editing. Derived state; the
 * note is never modified.
 */
function build(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = state.doc.toString();
  const selections = state.selection.ranges;
  for (const gloss of findGlosses(text)) {
    const editing = selections.some(range => range.from <= gloss.end && range.to >= gloss.start);
    if (editing) { builder.add(gloss.start, gloss.end, Decoration.mark({ class: 'codazo-gloss-raw' })); continue; }
    builder.add(gloss.start, gloss.termStart, Decoration.replace({}));
    builder.add(gloss.termStart, gloss.termEnd, Decoration.mark({ class: 'codazo-gloss', attributes: { title: gloss.gloss, 'aria-label': gloss.gloss } }));
    builder.add(gloss.termEnd, gloss.end, Decoration.replace({}));
  }
  return builder.finish();
}

export function glossExtension(): Extension {
  const field = StateField.define<DecorationSet>({
    create: build,
    update: (value, transaction) => (transaction.docChanged || transaction.selection ? build(transaction.state) : value),
    provide: field => EditorView.decorations.from(field),
  });
  return [field];
}

/** Reading view: replace `{term|gloss}` inside text nodes with an underlined span carrying the tooltip. */
export function glossPostProcessor(element: HTMLElement, setTooltip: (el: HTMLElement, text: string) => void): void {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if ((node as Text).data.includes('{') && (node as Text).data.includes('|')) nodes.push(node as Text);
  for (const node of nodes) {
    const glosses = findGlosses(node.data);
    if (!glosses.length || node.parentElement?.closest('code, pre')) continue;
    // Replacement parts: plain strings plus spans from Obsidian's createSpan (created in this window, text via textContent, never HTML), swapped into place at once.
    const parts: (string | HTMLElement)[] = [];
    let cursor = 0;
    for (const gloss of glosses) {
      if (gloss.start > cursor) parts.push(node.data.slice(cursor, gloss.start));
      const span = element.createSpan({ cls: 'codazo-gloss', text: gloss.term, attr: { 'aria-label': gloss.gloss } });
      setTooltip(span, gloss.gloss);
      parts.push(span);
      cursor = gloss.end;
    }
    parts.push(node.data.slice(cursor));
    node.replaceWith(...parts);
  }
}
