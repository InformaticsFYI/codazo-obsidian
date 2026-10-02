import { t } from './strings';

/** Labels used inside saved notes (Codazo output): always the studio's Spanish, independent of the interface language. */
export const CATEGORY_LABELS = { spelling: 'Ortografía / acento', grammar: 'Gramática', verb: 'Verbo / tiempo', alternative: 'Alternativa natural' } as const;
export const LEVELS = ['beginner', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/** Error codes raised by the shared review library or this plugin that have no dedicated message. */
const KNOWN_CODES = new Set(['INVALID_CONFIG', 'INVALID_INPUT', 'RESPONSE_TOO_LARGE', 'NO_PAYLOAD', 'PAYLOAD_TOO_LARGE', 'INVALID_PAYLOAD', 'INVALID_REVIEW', 'INVALID_SOURCE', 'INVALID_JSON', 'REQUEST_TOO_LARGE', 'SOURCE_MISMATCH', 'INVALID_ANCHOR', 'ANCHOR_NOT_FOUND', 'OVERLAPPING_ANNOTATIONS', 'DUPLICATE_ID', 'LIBRARY_CONFLICT']);
/** Shape of the diagnostics the shared provider produces; anything else is dropped. */
const DETAIL_SHAPE = /^(?:http \d{3}|redirect|network|not_json|too_large|envelope:[a-z0-9_.-]{1,60}|schema:[a-z0-9_.-]{1,60}|contract:[A-Z_]{3,40}|plan_limit|failed|stream_interrupted|stream_event|signin:[a-z_]{1,40})$/;

/** `mobile` adds a hint to network failures, which on iPad and iPhone are most often a server that refuses requests from the Obsidian app. */
export function describeError(error: unknown, options: { mobile?: boolean } = {}): string {
  const code = error instanceof Error ? error.message : String(error);
  // Provider errors carry a short diagnostic (HTTP status or a fixed category). Only diagnostics of the expected shape are shown. Sign-in diagnostics are prefixed so a token-endpoint code is never mistaken for one of ours.
  const own = error instanceof Error && 'detail' in error && typeof error.detail === 'string' ? error.detail : '';
  const raw = error instanceof Error && error.name === 'SignInError' && own ? `signin:${own.toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 40)}` : own;
  const detail = DETAIL_SHAPE.test(raw) ? ` (${raw})` : '';
  // The learner's ChatGPT plan allowance for Codazo is used up: say so plainly; the pane adds the Manage usage action.
  if (code === 'UPSTREAM_ERROR' && raw === 'plan_limit') return t().planLimit;
  const known = t().errors[code];
  if (known) return known + detail + (options.mobile && raw === 'network' ? ' ' + t().networkMobileHint : '');
  // Only codes this plugin or the shared library actually raise are named; anything else, however code-shaped, gets the fixed generic message.
  return KNOWN_CODES.has(code) ? t().errorWithReason(code) : t().errorGeneric;
}

/** True when a provider error means the learner's ChatGPT plan allowance for this app is used up. */
export function isPlanLimit(error: unknown): boolean {
  return error instanceof Error && error.message === 'UPSTREAM_ERROR' && 'detail' in error && error.detail === 'plan_limit';
}
