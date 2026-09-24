import 'server-only';
import type { ReviewPolicy } from './prompt';
import type { ReviewRequest } from '../security/input-limits';
export interface ProviderInput {
  readonly preferences: Pick<ReviewRequest, 'level' | 'locale'>;
  readonly policy: ReviewPolicy;
  readonly learnerData: string;
  readonly signal: AbortSignal;
}
export interface ProviderResult {
  /** Untrusted model JSON, never used as metadata or raw fallback. */
  text: string;
  /** Adapter metadata, obtained independently of model-authored text. */
  completion: 'complete' | 'refused' | 'truncated';
  usage?: { billedUnits: number };
}
/** Separate live contract: deliberately not assignable to ReviewProvider. */
export interface LiveReviewProvider {
  readonly mode: 'live';
  generate(input: ProviderInput): Promise<ProviderResult>;
}

/** Mock-only service contract; existing service gates remain unchanged. */
export interface ReviewProvider {
  readonly mode: 'mock';
  generate(input: ProviderInput): Promise<ProviderResult>;
}
