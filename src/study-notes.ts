import { lookupConjugation } from '../shared/lib/language/conjugations';
import type { Review, VerbFocus, VocabularyItem } from '../shared/lib/review/schema';
import { md, REVIEW_SCHEMA, sanitizeBasename } from './artifacts';
import type { ReviewSession } from './session';

/**
 * One vault note per word and per verb-and-tense, created the first time
 * they appear in a review or study guide and never overwritten. Each note
 * carries a `codazo-progreso` property the learner edits to track mastery;
 * a future flash-card or conjugation drill reads these notes, nothing else.
 * Like every saved note, this is Codazo output and stays in Spanish.
 */
export const PROGRESS_VALUES = ['nuevo', 'con-problemas', 'necesita-trabajo', 'casi-listo', 'dominado'] as const;
export type Progress = (typeof PROGRESS_VALUES)[number];
export const WORDS_FOLDER = 'Palabras';
export const VERBS_FOLDER = 'Verbos';

const yaml = (value: string | number | boolean) => (typeof value === 'string' ? JSON.stringify(value) : String(value));
const front = (entries: [string, string | number | boolean][]) => `---\n${entries.map(([k, v]) => `${k}: ${yaml(v)}`).join('\n')}\n---\n`;
const progressHelp = `Progreso (\`codazo-progreso\`): ${PROGRESS_VALUES.map(v => `\`${v}\``).join(', ')}. Cámbialo en las propiedades cuando quieras.`;

/** Words are keyed by their expression, case-folded and whitespace-normalized, so «Morada» and «morada» share a note. */
export function wordKey(expression: string): string { return expression.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es'); }
export function wordBasename(expression: string): string { return sanitizeBasename(wordKey(expression)); }
export function verbBasename(infinitive: string, tenseName: string): string { return sanitizeBasename(`${wordKey(infinitive)} · ${tenseName.trim().replace(/\s+/g, ' ')}`); }

export function wordNoteContent(item: VocabularyItem, session: ReviewSession, sourceLink: string): string {
  return `${front([
    ['codazo-kind', 'palabra'], ['codazo-schema', REVIEW_SCHEMA], ['codazo-expresion', item.expression], ['codazo-progreso', 'nuevo'],
    ['codazo-source', sourceLink], ['codazo-session', session.id], ['codazo-created-at', session.reviewedAt], ['codazo-provider', session.provider], ['codazo-model', session.model],
  ])}
# ${md(item.expression)}

- Significado: ${md(item.meaning)}
- Por qué: ${md(item.reason)}
- De tu texto: «${md(item.anchor.quote)}» (${sourceLink})
${item.examples.length ? `\n## Ejemplos\n\n${item.examples.map(example => `- ${md(example)}`).join('\n')}\n` : ''}
${progressHelp}
`;
}

export function verbNoteContent(verb: VerbFocus, tense: VerbFocus['tenses'][number], session: ReviewSession, sourceLink: string): string {
  const reference = lookupConjugation(verb.infinitive, tense.name);
  const table = reference.status === 'available'
    ? `| Persona | Forma |\n|---|---|\n${reference.forms.map(row => `| ${row.person} | ${row.form} |`).join('\n')}\n\nFuente: ${reference.source.label} · Licencia: ${reference.source.license}`
    : `Referencia no disponible: ${reference.reason}`;
  return `${front([
    ['codazo-kind', 'verbo'], ['codazo-schema', REVIEW_SCHEMA], ['codazo-infinitivo', verb.infinitive], ['codazo-tiempo', tense.name], ['codazo-progreso', 'nuevo'],
    ['codazo-source', sourceLink], ['codazo-session', session.id], ['codazo-created-at', session.reviewedAt], ['codazo-provider', session.provider], ['codazo-model', session.model],
  ])}
# ${md(verb.infinitive)} · ${md(tense.name)}

- Significado: ${md(verb.meaning)}
- Uso de este tiempo: ${md(tense.use)}
- Por qué: ${md(verb.reason)}
- De tu texto: «${md(verb.anchor.quote)}» (${sourceLink})

## Conjugación

${table}

${progressHelp}
`;
}

export type StudyNotePlan = { path: string; content: string; kind: 'palabra' | 'verbo' };

/** Every word and verb-tense note a review or study guide would produce, with vault-relative paths under `folder`. */
export function planStudyNotes(review: Review, session: ReviewSession, folder: string, sourceLink: string): StudyNotePlan[] {
  const plans: StudyNotePlan[] = [];
  const seen = new Set<string>();
  for (const item of review.vocabulary) {
    const path = `${folder}/${WORDS_FOLDER}/${wordBasename(item.expression)}.md`;
    if (seen.has(path)) continue; seen.add(path);
    plans.push({ path, content: wordNoteContent(item, session, sourceLink), kind: 'palabra' });
  }
  for (const verb of review.verbs) for (const tense of verb.tenses) {
    const path = `${folder}/${VERBS_FOLDER}/${verbBasename(verb.infinitive, tense.name)}.md`;
    if (seen.has(path)) continue; seen.add(path);
    plans.push({ path, content: verbNoteContent(verb, tense, session, sourceLink), kind: 'verbo' });
  }
  return plans;
}

