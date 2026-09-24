import type { Review, ReviewSource } from '../../../packages/shared/lib/review/schema';

/**
 * One validated review bound to the exact source it was produced for. The
 * session lives in memory until the learner saves or exports it; it never
 * carries the provider key.
 */
export type SessionKind = 'review' | 'study' | 'excerpt';
export type { ExcerptKind } from './excerpt';

export type ReviewSession = {
  id: string;
  /** review: full feedback; study: vocabulary and verbs only; excerpt: meaning and study for text the learner is reading. */
  kind: SessionKind;
  excerptKind?: import('./excerpt').ExcerptKind;
  notePath: string;
  source: ReviewSource;
  sourceHash: string;
  /** UTF-16 offset of the reviewed passage in the note when captured, if known. */
  offset: number | null;
  reviewedAt: string;
  review: Review;
  generatedBy: string;
  /** openai, ollama, or the custom endpoint's host. */
  provider: string;
  model: string;
  /** Path of the saved review note for this session, once the learner saved it. */
  savedReviewPath?: string;
};

export type SourceLocation =
  | { status: 'fresh' | 'relocated'; offset: number }
  | { status: 'stale'; reason: 'missing' | 'ambiguous' };

export async function sha256Hex(text: string, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Where the exact reviewed passage sits in the note now. Exact string
 * comparison only: no normalization, no fuzzy matching. If the passage moved
 * and appears exactly once, navigation may follow it; if it appears more than
 * once or not at all, the review is stale for navigation.
 */
export function locateSource(noteText: string, sourceText: string, offset: number | null): SourceLocation {
  if (offset !== null && noteText.slice(offset, offset + sourceText.length) === sourceText) return { status: 'fresh', offset };
  const first = noteText.indexOf(sourceText);
  if (first < 0) return { status: 'stale', reason: 'missing' };
  if (noteText.indexOf(sourceText, first + 1) >= 0) return { status: 'stale', reason: 'ambiguous' };
  return { status: 'relocated', offset: first };
}
