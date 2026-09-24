/**
 * Inline glosses: `{botas|boots}` or `{sepa la bola|who knows}`. Plain text
 * that survives in any Markdown tool. Live Preview hides the braces and the
 * gloss and underlines the Spanish; hovering shows the gloss. Reading view
 * does the same through a post-processor. Text sent to the model has the
 * markup removed so English never enters the Spanish source.
 */
export type Gloss = { start: number; end: number; term: string; termStart: number; termEnd: number; gloss: string };

export const GLOSS_PATTERN = /\{([^{}|\n]+?)\|([^{}\n]+?)\}/g;

export function findGlosses(text: string): Gloss[] {
  const out: Gloss[] = [];
  for (const match of text.matchAll(GLOSS_PATTERN)) {
    const start = match.index;
    const term = match[1];
    out.push({ start, end: start + match[0].length, term, termStart: start + 1, termEnd: start + 1 + term.length, gloss: match[2].trim() });
  }
  return out;
}

export function makeGloss(term: string, gloss: string): string {
  const cleanTerm = term.replace(/[{}|\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanGloss = gloss.replace(/[{}\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return `{${cleanTerm}|${cleanGloss}}`;
}

/** The text with every gloss reduced to its Spanish term. */
export function stripGlosses(text: string): string {
  return text.replace(GLOSS_PATTERN, (_, term: string) => term);
}
