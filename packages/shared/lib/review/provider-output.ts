import { z } from 'zod';
import { parseStrictJson } from '../security/strict-json';
import { LIMITS, utf8ByteLength } from './limits';
import { ReviewSchema, SCHEMA_VERSION, type Review, type ReviewSource } from './schema';
import { validateReview } from './validate';

export const FEEDBACK_SCHEMA_VERSION = 'codazo.feedback/1' as const;
// Zod 4 exposes the inner object's shape. Reuse every field schema, but defer
// the source-dependent root refinement to validateReview after server assembly.
export const FeedbackSchema = z.strictObject(ReviewSchema.shape)
  .omit({ source: true })
  .extend({ schema_version: z.literal(FEEDBACK_SCHEMA_VERSION) });

/** Source must be the server's already-validated snapshot, never model output. */
export function parseProviderOutput(text: unknown, source: ReviewSource): Review {
  try {
    if (typeof text !== 'string' || text.length > LIMITS.responseBytes || utf8ByteLength(text) > LIMITS.responseBytes) throw new Error();
    // Unwrap only one whole-response fence, allowing ASCII transport whitespace
    // outside it and LF/CRLF delimiters. Never alter the captured JSON body,
    // extract it from prose, or repair its content.
    let json = text;
    const fenced = /^[ \t\r\n\v\f]*```(?:json)?\r?\n([\s\S]*?)\r?\n```[ \t\r\n\v\f]*$/.exec(text);
    if (fenced) {
      if (fenced[0] !== text || fenced[1]!.includes('```')) throw new Error();
      json = fenced[1]!;
    }
    let parsed: unknown;
    try { parsed = parseStrictJson(json); } catch { throw new ProviderOutputError('not_json'); }
    const feedback = FeedbackSchema.safeParse(parsed);
    if (!feedback.success) throw new ProviderOutputError(`schema:${issuePath(feedback.error.issues[0])}`);
    const review = validateReview({ ...feedback.data, schema_version: SCHEMA_VERSION, source }, source);
    if (!review.ok) throw new ProviderOutputError(`contract:${review.error.code}`);
    return review.value;
  } catch (error) {
    // Never expose model strings or learner data at this boundary; the detail is a fixed category plus a field path.
    throw error instanceof ProviderOutputError ? error : new ProviderOutputError('too_large');
  }
}

/** Property names the contract defines; anything else in a path is model-controlled and is never echoed. */
const KNOWN_KEYS = new Set(['schema_version', 'annotations', 'strengths', 'next_focus', 'vocabulary', 'verbs', 'exercises', 'alignment', 'id', 'anchor', 'quote', 'occurrence', 'category', 'notice', 'question', 'hint', 'explanation', 'suggestion', 'kind', 'text', 'lexical_change', 'status', 'items', 'expression', 'meaning', 'reason', 'is_new', 'examples', 'infinitive', 'tenses', 'name', 'use', 'conjugation', 'prompt', 'answer', 'assessment', 'source', 'mode', 'intent', 'retry_focus']);
const MAX_DETAIL = 80;

/**
 * Field path of a zod issue, restricted to contract-defined keys and array
 * indices. Unknown keys become the fixed word `unknown-key`; a union reports
 * its deepest branch so the offending field is named. Bounded length.
 */
function issuePath(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return 'root';
  const safe = (segments: readonly PropertyKey[]) => segments.map(s => (typeof s === 'number' ? String(s) : KNOWN_KEYS.has(String(s)) ? String(s) : 'unknown-key')).join('.');
  if (issue.code === 'unrecognized_keys') return `${safe(issue.path)}${issue.path.length ? '.' : ''}unknown-key`.slice(0, MAX_DETAIL);
  if (issue.code === 'invalid_union') {
    const nested = issue.errors.flat().sort((a, b) => b.path.length - a.path.length)[0];
    if (nested) return issuePath({ ...nested, path: [...issue.path, ...nested.path] } as z.core.$ZodIssue);
  }
  return (safe(issue.path) || 'root').slice(0, MAX_DETAIL);
}

/** INVALID_OUTPUT with a short diagnostic category. Contains no model text and no learner text. */
export class ProviderOutputError extends Error {
  constructor(public readonly detail: string) { super('INVALID_OUTPUT'); this.name = 'ProviderOutputError'; }
}
