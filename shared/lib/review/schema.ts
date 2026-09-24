import { z } from 'zod';
import { codePointLength, LIMITS } from './limits';

export const SCHEMA_VERSION = 'codazo.review/1' as const;
export const CATEGORIES = ['spelling', 'grammar', 'verb', 'alternative'] as const;
// Bound UTF-16 length first, then count actual Unicode code points. Never trim
// or normalize returned text. Lone surrogates are not valid Unicode scalar text.
const text = (max: number) => z.string().min(1).max(max * 2).refine(
 value => value.trim().length > 0 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) && codePointLength(value) <= max,
);
const stage = text(LIMITS.stageCodePoints);
const example = text(LIMITS.exampleCodePoints);
const expression = text(LIMITS.expressionCodePoints);
const id = z.string().min(1).max(LIMITS.idCharacters).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const uniqueIds = <T extends {id:string}>(items: T[]) => new Set(items.map(item => item.id)).size === items.length;
export const AnchorSchema = z.strictObject({
 // Whitespace-only anchors are valid exact spans (including CRLF).
 quote: z.string().min(1).max(LIMITS.quoteCodePoints * 2).refine(value => codePointLength(value) <= LIMITS.quoteCodePoints),
 occurrence: z.number().int().min(1).max(LIMITS.sourceCodePoints),
});
const LexicalChangeSchema = z.discriminatedUnion('status', [
 z.strictObject({ status: z.literal('none') }),
 z.strictObject({ status: z.literal('introduced'), items: z.array(z.strictObject({ expression, meaning:stage, reason:stage })).min(1).max(LIMITS.lexicalItems) }),
]);
const stages = { id, anchor:AnchorSchema, notice:stage, question:stage, hint:stage, explanation:stage, retry_focus:stage };
export const AnnotationSchema = z.union([
 z.strictObject({ ...stages, category:z.enum(['spelling','grammar','verb']), suggestion:z.strictObject({ kind:z.literal('correction'), text:example, lexical_change:LexicalChangeSchema }) }),
 z.strictObject({ ...stages, category:z.literal('alternative'), suggestion:z.strictObject({ kind:z.literal('optional_alternative'), text:example, lexical_change:LexicalChangeSchema }) }),
]);
export const SourceSchema = z.discriminatedUnion('mode', [
 z.strictObject({ text:text(LIMITS.sourceCodePoints), mode:z.literal('spanish_only') }),
 z.strictObject({ text:text(LIMITS.sourceCodePoints), mode:z.literal('intent_comparison'), intent:text(LIMITS.intentCodePoints) }),
]);
const grounded = { id, anchor:AnchorSchema };
export const FocusSchema = z.strictObject({ ...grounded, text:stage });
export const VocabularySchema = z.strictObject({
 ...grounded, kind:z.literal('word_or_phrase'), expression, meaning:stage,
 reason:stage, is_new:z.boolean(), examples:z.array(example).max(LIMITS.examples),
});
export const VerbFocusSchema = z.strictObject({
 ...grounded, kind:z.literal('verb_focus'), infinitive:expression, meaning:stage, reason:stage,
 tenses:z.array(z.strictObject({ id, name:expression, use:stage,
  // Provider output never supplies trusted paradigms. A separate deterministic
  // lookup supplies display tables independently; unsupported forms remain unavailable.
  conjugation:z.strictObject({ status:z.literal('unavailable'), reason:stage }),
 })).min(1).max(LIMITS.tenses).refine(uniqueIds),
});
export const ExerciseSchema = z.strictObject({
 ...grounded, kind:z.enum(['fill_blank','short_answer','rewrite_fragment']),
 prompt:example, hint:stage, answer:example, explanation:stage,
});
/** Shape validation only. Always use validateReview at an untrusted boundary. */
export const ReviewSchema = z.strictObject({
 schema_version:z.literal(SCHEMA_VERSION), source:SourceSchema,
 annotations:z.array(AnnotationSchema).max(LIMITS.annotations),
 strengths:z.array(FocusSchema).max(LIMITS.focuses), next_focus:z.array(FocusSchema).max(LIMITS.focuses),
 vocabulary:z.array(VocabularySchema).max(LIMITS.vocabulary), verbs:z.array(VerbFocusSchema).max(LIMITS.verbs),
 exercises:z.array(ExerciseSchema).max(LIMITS.exercises),
 alignment:z.strictObject({ assessment:z.enum(['aligned','meaning_differs','uncertain']), explanation:stage }).optional(),
}).refine(review => review.source.mode === 'intent_comparison' || review.alignment === undefined);
export type ReviewSource = z.infer<typeof SourceSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type SourceAnchor = z.infer<typeof AnchorSchema>;
export type Category = typeof CATEGORIES[number];
export type VocabularyItem = z.infer<typeof VocabularySchema>;
export type VerbFocus = z.infer<typeof VerbFocusSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type Focus = z.infer<typeof FocusSchema>;
