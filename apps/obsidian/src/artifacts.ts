import { validateReview } from '../../../packages/shared/lib/review/validate';
import { parseStrictJson } from '../../../packages/shared/lib/security/strict-json';
import type { Review } from '../../../packages/shared/lib/review/schema';
import { CATEGORY_LABELS } from './labels';
import type { ReviewSession } from './session';

/**
 * Vault artifacts are ordinary Markdown the learner owns. They must stay
 * useful without the plugin, carry flat namespaced Properties, and never hold
 * a secret. The saved review also carries a lossless payload that is
 * re-validated before the plugin trusts it again.
 */
export const REVIEW_SCHEMA = 'codazo.review/1';
export const PAYLOAD_FENCE = '```json codazo-review';
export type ArtifactKind = 'review' | 'revision' | 'study' | 'excerpt';
export type ArtifactLinks = { source: string; review?: string };

const FORBIDDEN_NAME = /[\\/:*?"<>|#^[\]]/g;

/**
 * Model-generated prose is written into notes as literal text. Escaping the
 * Markdown and HTML control characters keeps a hostile string (a remote image,
 * a link, raw HTML, an embed) inert when Obsidian renders the note. Learner
 * source text is not escaped; it is quoted as the learner wrote it.
 */
export function md(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+!|<>~^=]/g, '\\$&').replace(/\r?\n/g, ' ');
}

/** A vault-safe basename: no path separators, link syntax, or characters Obsidian rejects. */
export function sanitizeBasename(name: string): string {
  const clean = name.replace(FORBIDDEN_NAME, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean.length ? clean : 'Sin título';
}

/** Vault-relative folder path with no traversal, absolute prefix, or empty segments. */
export function containedFolder(folder: string): string {
  const normalized = folder.replace(/\\/g, '/').trim();
  const segments = normalized.split('/').map(part => part.trim()).filter(Boolean);
  if (normalized.startsWith('/') || segments.length === 0 || segments.some(part => part === '.' || part === '..' || part.includes(':'))) throw new Error('INVALID_FOLDER');
  return segments.join('/');
}

/** First free path in `folder`: `name.md`, then `name 2.md`, `name 3.md`, … Never overwrites. */
export function availablePath(exists: (path: string) => boolean, folder: string, basename: string): string {
  const base = `${containedFolder(folder)}/${sanitizeBasename(basename)}`;
  if (!exists(`${base}.md`)) return `${base}.md`;
  for (let n = 2; n < 10_000; n++) if (!exists(`${base} ${n}.md`)) return `${base} ${n}.md`;
  throw new Error('NO_AVAILABLE_PATH');
}

function yamlScalar(value: string | number): string { return typeof value === 'number' ? String(value) : JSON.stringify(value); }

export function frontmatter(kind: ArtifactKind, session: ReviewSession, links: ArtifactLinks, version: number): string {
  const properties: [string, string | number][] = [
    ['codazo-kind', kind], ['codazo-schema', REVIEW_SCHEMA], ['codazo-session', session.id], ['codazo-source', links.source],
    ...(kind === 'excerpt' && session.excerptKind ? [['codazo-excerpt-kind', session.excerptKind] as [string, string]] : []),
    ...(links.review ? [['codazo-review', links.review] as [string, string]] : []),
    ['codazo-source-hash', session.sourceHash], ['codazo-version', version], ['codazo-reviewed-at', session.reviewedAt],
    ['codazo-provider', session.provider], ['codazo-model', session.model],
  ];
  return `---\n${properties.map(([key, value]) => `${key}: ${yamlScalar(value)}`).join('\n')}\n---\n`;
}

const quote = (text: string) => text.split(/\r?\n/).map(line => `> ${line}`).join('\n');
const bullet = (items: { text: string; anchor: { quote: string } }[]) => items.map(item => `- ${md(item.text)} («${md(item.anchor.quote)}»)`).join('\n');

function annotationsMarkdown(review: Review): string {
  if (review.annotations.length === 0) return '_Sin observaciones en esta versión._';
  return review.annotations.map(a => {
    const optional = a.category === 'alternative';
    const lexical = a.suggestion.lexical_change.status === 'introduced' ? `\n- Palabras nuevas: ${a.suggestion.lexical_change.items.map(item => `**${md(item.expression)}** · ${md(item.meaning)} · ${md(item.reason)}`).join('; ')}` : '';
    return `### ${optional ? 'Una alternativa opcional' : CATEGORY_LABELS[a.category]} · «${md(a.anchor.quote)}»\n\n- ${optional ? 'Sugerencia opcional' : 'Sugerencia'}: ${md(a.suggestion.text)}\n- Explicación: ${md(a.explanation)}\n- Observa: ${md(a.notice)}\n- Piensa: ${md(a.question)}\n- Pista: ${md(a.hint)}\n- Inténtalo otra vez: ${md(a.retry_focus)}${lexical}`;
  }).join('\n\n');
}

export function studyMarkdown(review: Review): string {
  const vocabulary = review.vocabulary.length ? review.vocabulary.map(item => `### ${md(item.expression)}${item.is_new ? ' · nueva' : ''}\n\n- Significado: ${md(item.meaning)}\n- Por qué: ${md(item.reason)}\n- De tu texto: «${md(item.anchor.quote)}»${item.examples.length ? `\n- Ejemplos: ${item.examples.map(md).join(' / ')}` : ''}`).join('\n\n') : '_No hay palabras nuevas en esta versión._';
  const verbs = review.verbs.length ? review.verbs.map(verb => `### ${md(verb.infinitive)} · ${md(verb.meaning)}\n\n- Por qué: ${md(verb.reason)}\n${verb.tenses.map(tense => `- ${md(tense.name)}: ${md(tense.use)}`).join('\n')}`).join('\n\n') : '_Las referencias de verbos aparecen cuando la revisión las incluye._';
  const exercises = review.exercises.length ? review.exercises.map((exercise, index) => `### Práctica ${index + 1}\n\n- ${md(exercise.prompt)}\n- Pista: ${md(exercise.hint)}\n- Respuesta: ${md(exercise.answer)}\n- Explicación: ${md(exercise.explanation)}`).join('\n\n') : '_Sin ejercicios en esta revisión._';
  return `## Reflexión\n\n${review.strengths.length ? `**Lo que ya funciona**\n\n${bullet(review.strengths)}\n\n` : ''}${review.next_focus.length ? `**Próximos pasos**\n\n${bullet(review.next_focus)}` : ''}\n\n## Palabras para estudiar\n\n${vocabulary}\n\n## Verbos para estudiar\n\n${verbs}\n\n## Práctica\n\n${exercises}`;
}

const intentSection = (session: ReviewSession) => session.source.mode === 'intent_comparison' ? `\n\n## Intención en inglés\n\n${quote(session.source.intent)}` : '';
const alignmentSection = (review: Review) => review.alignment ? `\n\n## Alineación con la intención\n\n- ${review.alignment.assessment}: ${md(review.alignment.explanation)}` : '';

/** Saved review: readable feedback plus the lossless validated payload. */
export function reviewNoteContent(session: ReviewSession, links: ArtifactLinks, version = 1): string {
  const review = session.review;
  return `${frontmatter('review', session, links, version)}
# Revisión de Codazo · ${links.source}

${session.generatedBy}. Tu texto original sigue siendo tuyo; las sugerencias son información, no cambios.

## Texto original (copia exacta al momento de la revisión)

${quote(session.source.text)}${intentSection(session)}${alignmentSection(review)}

## Observaciones

${annotationsMarkdown(review)}

${studyMarkdown(review)}

## Datos de la revisión

Copia exacta de la respuesta validada (${REVIEW_SCHEMA}). Codazo la vuelve a validar antes de mostrarla.

${PAYLOAD_FENCE}
${JSON.stringify(review)}
\`\`\`
`;
}

/** Linked revision: a copy the learner edits; the source note is untouched. */
export function revisionNoteContent(session: ReviewSession, links: ArtifactLinks, version: number): string {
  return `${frontmatter('revision', session, links, version)}
# Mi revisión · ${links.source}

Original: ${links.source}${links.review ? ` · Revisión de Codazo: ${links.review}` : ''}

## Mi revisión

${session.source.text}
`;
}

/** Study sheet for one reviewed version. Mastery tracking is deliberately absent. */
export function studyNoteContent(session: ReviewSession, links: ArtifactLinks, version = 1): string {
  return `${frontmatter('study', session, links, version)}
# Hoja de estudio · ${links.source}

${session.generatedBy}. Fuente: ${links.source}${links.review ? ` · Revisión: ${links.review}` : ''}

${studyMarkdown(session.review)}

## Datos de la revisión

Copia exacta de la respuesta validada (${REVIEW_SCHEMA}). Codazo la vuelve a validar antes de mostrarla.

${PAYLOAD_FENCE}
${JSON.stringify(session.review)}
\`\`\`
`;
}

const EXCERPT_KIND_LABEL = { word: 'palabra', phrase: 'frase', paragraph: 'párrafo' } as const;

/** Excerpt of text the learner is reading: the passage, where it came from, its meaning, and the words and verbs in it. */
export function excerptNoteContent(session: ReviewSession, links: ArtifactLinks, version = 1): string {
  const review = session.review;
  // Folded callout: hidden in reading view until the learner opens it, so they can work out the meaning first.
  const meaning = review.strengths.length ? review.strengths.map(item => `> - ${md(item.text)} («${md(item.anchor.quote)}»)`).join('\n') : '> _Sin notas de significado en esta respuesta._';
  return `${frontmatter('excerpt', session, links, version)}
# Extracto · ${links.source}

${session.generatedBy}. Texto de lectura (${session.excerptKind ? EXCERPT_KIND_LABEL[session.excerptKind] : 'extracto'}), no corregido.

## Extracto

${quote(session.source.text)}

De: ${links.source}

## Significado

> [!question]- Intenta primero, luego abre
${meaning}

${studyMarkdown(review).replace(/^## Reflexión[\s\S]*?(?=## Palabras para estudiar)/, '').replace(/\n\n## Práctica[\s\S]*$/, '')}

## Datos de la revisión

Copia exacta de la respuesta validada (${REVIEW_SCHEMA}). Codazo la vuelve a validar antes de mostrarla.

${PAYLOAD_FENCE}
${JSON.stringify(review)}
\`\`\`
`;
}

export type SavedReview = { review: Review; kind: 'review' | 'study' | 'excerpt'; excerptKind: string | null; sourceHash: string | null; sessionId: string | null; provider: string | null; model: string | null; reviewedAt: string | null };

/** Re-validate a saved review note before trusting it. Any doubt is a refusal. */
export function parseSavedReview(content: string): { ok: true; value: SavedReview } | { ok: false; error: string } {
  const start = content.indexOf(`\n${PAYLOAD_FENCE}\n`);
  if (start < 0) return { ok: false, error: 'NO_PAYLOAD' };
  const bodyStart = start + PAYLOAD_FENCE.length + 2;
  const end = content.indexOf('\n```', bodyStart);
  if (end < 0) return { ok: false, error: 'NO_PAYLOAD' };
  const raw = content.slice(bodyStart, end);
  if (raw.length > 256 * 1024) return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
  let parsed: unknown;
  try { parsed = parseStrictJson(raw); } catch { return { ok: false, error: 'INVALID_PAYLOAD' }; }
  const source = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { source?: unknown }).source : undefined;
  const review = validateReview(parsed, source);
  if (!review.ok) return { ok: false, error: review.error.code };
  const property = (key: string) => { const match = content.match(new RegExp(`^${key}: (.*)$`, 'm')); if (!match) return null; try { const value = JSON.parse(match[1]!); return typeof value === 'string' ? value : null; } catch { return null; } };
  const kindValue = property('codazo-kind');
  const kind = kindValue === 'study' || kindValue === 'excerpt' ? kindValue : 'review';
  return { ok: true, value: { review: review.value, kind, excerptKind: property('codazo-excerpt-kind'), sourceHash: property('codazo-source-hash'), sessionId: property('codazo-session'), provider: property('codazo-provider'), model: property('codazo-model'), reviewedAt: property('codazo-reviewed-at') } };
}
