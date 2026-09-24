import { REVIEW_POLICY, type ReviewPolicy } from '../shared/lib/review/prompt';

/**
 * Excerpt mode: the learner picks a word, a phrase, or a paragraph from any
 * note and asks what it means and what to study in it. Same codazo.review/1
 * contract and validation as a review; only the instruction changes.
 *
 * Meaning notes ride in `strengths`: anchored, source-bound notes with a
 * short text, which is exactly what "literal meaning", "how it is used in
 * conversation", and "register" are. The excerpt note labels them Significado.
 */
export type ExcerptKind = 'word' | 'phrase' | 'paragraph';

/** A first guess from the shape of the selection; the modal lets the learner change it. */
export function detectExcerptKind(text: string): ExcerptKind {
  const trimmed = text.trim();
  if (!/\s/.test(trimmed) && !/[.!?…;:]$/.test(trimmed)) return 'word';
  const words = trimmed.split(/\s+/).length;
  const internalBreak = /[.!?…]["»)]?\s+\S/.test(trimmed);
  return words <= 14 && !internalBreak ? 'phrase' : 'paragraph';
}

const COMMON = 'EXCERPT MODE: the learner did not write this text; they selected it from something they are reading and want to understand it. Do not correct it: return annotations, next_focus, and exercises as empty arrays and omit alignment. Copy every anchor quote exactly from the source. Keep conjugation.status unavailable as instructed.';

const BY_KIND: Record<ExcerptKind, string> = {
  word: 'The source is a single word or fixed expression. vocabulary: exactly one item for it (its dictionary form as expression) with meaning, why it matters, is_new true, and two short Spanish examples. If it is a conjugated verb form, also return one verbs item: the infinitive, meaning, and the tense of the form as used, plus one contrasting tense when useful. strengths: up to 2 anchored notes: a literal or etymological note, and a usage or register note (formal, informal, regional, slang) when relevant.',
  phrase: 'The source is a short phrase or sentence. strengths: up to 3 anchored notes that explain the phrase: (1) its literal meaning word by word, (2) how it is actually used in conversation, including slang, idiom, or intended effect when that differs from the literal reading, (3) register or region when relevant. vocabulary: the significant words and expressions (up to 5) with meaning, reason, is_new true, and short examples. verbs: the verbs used (up to 3) with the tense as used.',
  paragraph: 'The source is a paragraph. Build study material for the requested learner level: vocabulary of up to 5 words or expressions, mostly above the level and including one or two that are a real stretch, to encourage growth; each with meaning, reason, is_new true, and examples. verbs: up to 3 verbs whose tense or form is worth studying at that level, with the tense as used and one contrasting tense when useful. strengths: up to 3 anchored notes on meaning that a learner at that level would miss: idiom, tone, or an implied reading.',
};

export function excerptPolicy(kind: ExcerptKind): ReviewPolicy {
  return Object.freeze({ ...REVIEW_POLICY, instruction: `${REVIEW_POLICY.instruction}\n${COMMON} ${BY_KIND[kind]}` });
}
