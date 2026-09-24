import { inspectJSONValue, LIMITS, utf8ByteLength } from './limits';
import { resolveAnchor, resolveAnnotations } from './resolve-annotations';
import { ReviewSchema, SourceSchema, type Review, type ReviewSource } from './schema';

export type ReviewErrorCode = 'INVALID_REVIEW' | 'INVALID_SOURCE' | 'INVALID_JSON' |
 'REQUEST_TOO_LARGE' | 'RESPONSE_TOO_LARGE' | 'SOURCE_MISMATCH' |
 'INVALID_ANCHOR' | 'ANCHOR_NOT_FOUND' | 'OVERLAPPING_ANNOTATIONS' | 'DUPLICATE_ID';
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: { code: ReviewErrorCode } };
const failure = (code:ReviewErrorCode): {ok:false;error:{code:ReviewErrorCode}} => ({ok:false,error:{code}});

/** Body readers must also stop reading at responseBytes; this handles decoded JSON. */
export function parseReviewJSON(body: unknown, expectedSource: unknown): ValidationResult<Review> {
 if (typeof body !== 'string') return failure('INVALID_JSON');
 if (body.length > LIMITS.responseBytes || utf8ByteLength(body) > LIMITS.responseBytes) return failure('RESPONSE_TOO_LARGE');
 let input:unknown;
 try { input = JSON.parse(body); } catch { return failure('INVALID_JSON'); }
 return validateReview(input,expectedSource);
}
export function validateSource(input: unknown): ValidationResult<ReviewSource> {
 const inspection = inspectJSONValue(input,LIMITS.requestBytes);
 if (inspection !== 'ok') return failure(inspection === 'too_large' ? 'REQUEST_TOO_LARGE' : 'INVALID_SOURCE');
 const parsed = SourceSchema.safeParse(input);
 return parsed.success ? {ok:true,value:parsed.data} : failure('INVALID_SOURCE');
}
/** Complete atomic boundary. Shape alone does not prove source/anchor integrity. */
export function validateReview(input: unknown, expectedSource: unknown): ValidationResult<Review> {
 const inspection = inspectJSONValue(input,LIMITS.responseBytes);
 if (inspection !== 'ok') return failure(inspection === 'too_large' ? 'RESPONSE_TOO_LARGE' : 'INVALID_REVIEW');
 const parsed = ReviewSchema.safeParse(input);
 if (!parsed.success) return failure('INVALID_REVIEW');
 const expected = validateSource(expectedSource);
 if (!expected.ok) return failure('SOURCE_MISMATCH');
 const source = parsed.data.source;
 if (source.text !== expected.value.text || source.mode !== expected.value.mode ||
  ('intent' in source ? source.intent : undefined) !== ('intent' in expected.value ? expected.value.intent : undefined)) return failure('SOURCE_MISMATCH');
 const resolved = resolveAnnotations(source.text,parsed.data.annotations);
 if (!resolved.ok) return resolved;
 const ids = new Set(parsed.data.annotations.map(a => a.id));
 for (const item of [...parsed.data.strengths,...parsed.data.next_focus,...parsed.data.vocabulary,...parsed.data.verbs,...parsed.data.exercises]) {
  if (ids.has(item.id)) return failure('DUPLICATE_ID');
  ids.add(item.id);
  const anchor = resolveAnchor(source.text,item.anchor);
  if (!anchor.ok) return anchor;
 }
 return {ok:true,value:parsed.data};
}
