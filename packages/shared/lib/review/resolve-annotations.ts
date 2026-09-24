import { z } from 'zod';
import { codePointLength, inspectJSONValue, LIMITS } from './limits';
import { AnchorSchema, AnnotationSchema, SourceSchema, type Annotation } from './schema';
import type { ValidationResult } from './validate';
export type ResolvedSpan = { start: number; end: number };
export type ResolvedAnnotation = ResolvedSpan & { id: string; annotation: Annotation };
/** UTF-16 half-open offsets. Count overlapping exact matches left to right. */
export function resolveAnchor(source: unknown, anchor: unknown): ValidationResult<ResolvedSpan> {
 if (inspectJSONValue(anchor,LIMITS.responseBytes) !== 'ok') return {ok:false,error:{code:'INVALID_ANCHOR'}};
 const parsed = AnchorSchema.safeParse(anchor);
 if (typeof source !== 'string' || source.length > LIMITS.sourceCodePoints * 2 || codePointLength(source) > LIMITS.sourceCodePoints || !parsed.success) return {ok:false,error:{code:'INVALID_ANCHOR'}};
 const { quote, occurrence } = parsed.data;
 // Never split a UTF-16 surrogate pair; no normalization or newline rewriting.
 const boundaries = new Set<number>([0]);
 let offset = 0;
 for (const point of source) { offset += point.length; boundaries.add(offset); }
 let from = 0;
 for (let count = 1; ; count++) {
  const start = source.indexOf(quote, from);
  if (start < 0) return {ok:false,error:{code:'ANCHOR_NOT_FOUND'}};
  const end = start + quote.length;
  if (count === occurrence) {
   if (!boundaries.has(start) || !boundaries.has(end)) return {ok:false,error:{code:'INVALID_ANCHOR'}};
   return {ok:true,value:{start,end}};
  }
  from = start + 1;
 }
}
export function resolveAnnotations(source: unknown, annotations: unknown): ValidationResult<ResolvedAnnotation[]> {
 if (!SourceSchema.safeParse({text:source,mode:'spanish_only'}).success) return {ok:false,error:{code:'INVALID_SOURCE'}};
 if (inspectJSONValue(annotations,LIMITS.responseBytes) !== 'ok') return {ok:false,error:{code:'INVALID_REVIEW'}};
 const parsed = z.array(AnnotationSchema).max(LIMITS.annotations).safeParse(annotations);
 if (!parsed.success) return {ok:false,error:{code:'INVALID_REVIEW'}};
 const result: ResolvedAnnotation[] = [];
 const ids = new Set<string>();
 for (const annotation of parsed.data) {
  if (ids.has(annotation.id)) return {ok:false,error:{code:'DUPLICATE_ID'}};
  ids.add(annotation.id);
  const span = resolveAnchor(source, annotation.anchor);
  if (!span.ok) return span;
  result.push({...span.value, id:annotation.id, annotation});
 }
 result.sort((a,b) => a.start - b.start);
 for (let i = 1; i < result.length; i++) {
  if (result[i].start < result[i-1].end) return {ok:false,error:{code:'OVERLAPPING_ANNOTATIONS'}};
 }
 return {ok:true,value:result};
}
