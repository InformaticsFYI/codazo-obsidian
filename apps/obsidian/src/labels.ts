import { t } from './strings';

/** Labels used inside saved notes (Codazo output): always the studio's Spanish, independent of the interface language. */
export const CATEGORY_LABELS = { spelling: 'Ortografía / acento', grammar: 'Gramática', verb: 'Verbo / tiempo', alternative: 'Alternativa natural' } as const;
export const LEVELS = ['beginner', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/** Error codes raised by the shared review library or this plugin that have no dedicated message. */
const KNOWN_CODES = new Set(['INVALID_CONFIG', 'INVALID_INPUT', 'RESPONSE_TOO_LARGE', 'NO_PAYLOAD', 'PAYLOAD_TOO_LARGE', 'INVALID_PAYLOAD', 'INVALID_REVIEW', 'INVALID_SOURCE', 'INVALID_JSON', 'REQUEST_TOO_LARGE', 'SOURCE_MISMATCH', 'INVALID_ANCHOR', 'ANCHOR_NOT_FOUND', 'OVERLAPPING_ANNOTATIONS', 'DUPLICATE_ID', 'LIBRARY_CONFLICT']);
/** Shape of the diagnostics the shared provider produces; anything else is dropped. */
const DETAIL_SHAPE = /^(?:http \d{3}|redirect|not_json|too_large|envelope:[a-z0-9_.-]{1,60}|schema:[a-z0-9_.-]{1,60}|contract:[A-Z_]{3,40})$/;

export function describeError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  // Provider errors carry a short diagnostic (HTTP status or a fixed category). Only diagnostics of the expected shape are shown.
  const raw = error instanceof Error && 'detail' in error && typeof error.detail === 'string' ? error.detail : '';
  const detail = DETAIL_SHAPE.test(raw) ? ` (${raw})` : '';
  const known = t().errors[code];
  if (known) return known + detail;
  // Only codes this plugin or the shared library actually raise are named; anything else, however code-shaped, gets the fixed generic message.
  return KNOWN_CODES.has(code) ? t().errorWithReason(code) : t().errorGeneric;
}
