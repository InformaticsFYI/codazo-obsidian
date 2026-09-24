/**
 * English intent written in the note itself, as an Obsidian callout the
 * learner can keep folded:
 *
 *   > [!spoiler]- English Intent
 *   > What I meant to say.
 *
 * Any callout type is accepted; the title decides: "English Intent",
 * "Intent", "Intención", or "Intención en inglés", case-insensitive. The
 * callout's body becomes the modal's prefilled intent, and the callout is
 * removed from the text sent for review so English never enters the source.
 */
export type IntentCallout = { intent: string; start: number; end: number };

/** YAML frontmatter at the very start of a note, with the offset where the body begins; null when absent. */
export function frontmatterEnd(text: string): number | null {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  return match ? match[0].length : null;
}

export const INTENT_PLACEHOLDER = 'What I meant to say, in English.';
/** The callout the plugin inserts: folded spoiler, placeholder body, then two blank lines for the Spanish to follow. */
export const INTENT_TEMPLATE = `> [!spoiler]- English Intent\n> ${INTENT_PLACEHOLDER}\n\n\n`;
/** Offset of the placeholder inside the template, so the editor can select it for typing over. */
export const INTENT_PLACEHOLDER_OFFSET = INTENT_TEMPLATE.indexOf(INTENT_PLACEHOLDER);

const TITLE = /^(?:english intent|intent|intenci[oó]n(?: en ingl[eé]s)?)$/i;
const HEADER = /^[ \t]{0,3}>[ \t]?\[!([A-Za-z][\w-]*)\]([-+]?)[ \t]*(.*?)[ \t]*$/;
const BODY = /^[ \t]{0,3}>(?:[ \t]?(.*))?$/;

/**
 * The first intent callout in the note body, with absolute UTF-16 offsets into
 * `text`. YAML frontmatter is skipped first: a property whose value happens to
 * look like a callout is metadata, never intent.
 */
export function findIntentCallout(text: string): IntentCallout | null {
  const offset = frontmatterEnd(text) ?? 0;
  const body = text.slice(offset);
  return findCalloutIn(body, offset);
}

function findCalloutIn(text: string, base: number): IntentCallout | null {
  let offset = base;
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const head = HEADER.exec(line.replace(/\r?\n$/, ''));
    if (head && TITLE.test(head[3] ?? '')) {
      const body: string[] = [];
      let end = offset + line.length;
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].replace(/\r?\n$/, '');
        const match = BODY.exec(next);
        if (!match || HEADER.test(next)) break;
        body.push(match[1] ?? '');
        end += lines[j].length;
      }
      const intent = body.join('\n').trim();
      // A placeholder left untouched is not an intent; the modal then shows an empty field.
      return intent && intent !== INTENT_PLACEHOLDER ? { intent, start: offset, end } : null;
    }
    offset += line.length;
  }
  return null;
}

/**
 * Remove the callout from a selection that overlaps it. Returns the text to
 * send and where that text starts in the note. When the callout sits at the
 * start or end of the selection the result stays contiguous in the note, so
 * marks and navigation keep working; a callout in the middle leaves the sent
 * text non-contiguous, which the pane reports as stale.
 */
export function stripCallout(selection: string, selectionOffset: number, callout: IntentCallout): { text: string; offset: number } {
  const start = Math.max(callout.start - selectionOffset, 0);
  const end = Math.min(callout.end - selectionOffset, selection.length);
  if (end <= 0 || start >= selection.length) return { text: selection, offset: selectionOffset };
  const before = selection.slice(0, start).replace(/\s+$/, '');
  const after = selection.slice(end).replace(/^\s+/, '');
  if (!before) return { text: after, offset: selectionOffset + (selection.length - selection.slice(end).replace(/^\s+/, '').length) };
  return { text: after ? `${before}\n\n${after}` : before, offset: selectionOffset };
}
