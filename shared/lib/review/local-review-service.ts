import { createOpenAICompatibleProvider, destinationLabel } from './openai-compatible';
import { REVIEW_POLICY, type ReviewPolicy } from './prompt';
import { ReviewRequestSchema } from '../security/input-limits';
import { inspectJSONValue, LIMITS } from './limits';
import { validateReview, validateSource } from './validate';
import type { FetchLike, OpenAICompatibleConfig } from './openai-compatible';

/** Whatever holds the learner's provider configuration in the app's one trusted process. */
export interface ReviewSettingsSource { snapshot(): Promise<OpenAICompatibleConfig> }

/**
 * Review dispatch for local application targets that hold the learner's own provider key.
 * One in-flight review, bounded distinct request IDs per process lifetime, no retry,
 * no provider switch, and cancellation that suppresses late results.
 */

export class LocalReviewService {
  private seen = new Set<string>();
  private active: { id: string; controller: AbortController } | null = null;
  cancel(input: unknown): null {
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 1 || !('requestId' in input) || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.requestId)) throw new Error('INVALID_REQUEST');
    if (this.active?.id === input.requestId) this.active.controller.abort();
    return null;
  }
  dispose() { this.active?.controller.abort(); }
  /** The host supplies the transport (Obsidian desktop: the Node http client); the provider still enforces its own limits. */
  constructor(private settings: ReviewSettingsSource, private readonly fetchImpl: FetchLike) {}
  /** `policy` defaults to the full review; a host may pass a derived policy that keeps the same contract. `settings` lets a host bind one request to the exact configuration the learner confirmed. */
  async review(input: unknown, policy: ReviewPolicy = REVIEW_POLICY, settings: ReviewSettingsSource = this.settings) {
    if (inspectJSONValue(input, LIMITS.requestBytes) !== 'ok') throw new Error('INVALID_REQUEST');
    const parsed = ReviewRequestSchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_REQUEST');
    const request = parsed.data;
    const source = validateSource(request.source);
    if (!source.ok) throw new Error('INVALID_REQUEST');
    if (this.seen.has(request.request_id)) throw new Error('ALREADY_PROCESSED');
    if (this.seen.size >= 1000) throw new Error('WINDOW_REQUEST_LIMIT');
    if (this.active) throw new Error('IN_FLIGHT');
    const active = { id: request.request_id, controller: new AbortController() };
    this.active = active;
    try {
    const configuration = await settings.snapshot();
    if (active.controller.signal.aborted) throw new Error('CANCELLED');
    this.seen.add(request.request_id);
    const provider = createOpenAICompatibleProvider(configuration, this.fetchImpl);
    const result = await provider.generate({ policy, learnerData: JSON.stringify(source.value), preferences: { level: request.level, locale: request.locale }, signal: active.controller.signal });
    if (active.controller.signal.aborted) throw new Error('CANCELLED');
    if (result.completion !== 'complete') throw new Error('PROVIDER_REFUSED');
    const review = validateReview(JSON.parse(result.text), source.value);
    if (!review.ok) throw new Error('INVALID_OUTPUT');
    return { review: review.value, generatedBy: `Live AI feedback — ${destinationLabel(configuration.baseURL)} · ${configuration.model}; AI may be wrong` };
    } finally { if (this.active === active) this.active = null; }
  }
}
