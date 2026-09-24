import 'server-only';
import { z } from 'zod';
import { BoundaryError, createDeadline } from '../security/deadline';
import { SCHEMA_VERSION } from './schema';
import type { LiveReviewProvider } from './provider';
import { LIMITS, utf8ByteLength } from './limits';
import { validateSource } from './validate';
import { FEEDBACK_SCHEMA_VERSION, FeedbackSchema, parseProviderOutput, ProviderOutputError } from './provider-output';
import { parseStrictJson } from '../security/strict-json';
import { ReviewRequestSchema } from '../security/input-limits';
const PreferencesSchema = ReviewRequestSchema.pick({ level: true, locale: true });

export interface OpenAICompatibleConfig {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly tokenLimitField?: 'max_tokens' | 'max_completion_tokens';
  readonly responseFormat?: 'prompt' | 'json_object' | 'json_schema';
  readonly reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
  /** Opt-in for local application targets: permit plain http to loopback or private-network hosts (a local LLM). Server deployments never set this. */
  readonly allowPrivateHttp?: boolean;
}
export type OpenAICompatibleErrorCode = 'INVALID_CONFIG' | 'INVALID_INPUT' | 'INVALID_OUTPUT' | 'RESPONSE_TOO_LARGE' | 'UPSTREAM_ERROR' | 'TIMEOUT' | 'CANCELLED';
export class OpenAICompatibleError extends Error {
  // True only after the bounded reader observed EOF, never merely on rejection
  // or cancellation. Callers may release concurrency, but must retain charges.
  /** `detail` is a short diagnostic: an HTTP status, or a fixed category such as `envelope` or `contract:ANCHOR_NOT_FOUND`. Never model or learner text. */
  constructor(public readonly code: OpenAICompatibleErrorCode, public readonly responseBodyConsumed = false, public readonly detail?: string) { super(code); this.name = 'OpenAICompatibleError'; }
}
const ConfigSchema = z.strictObject({
  baseURL: z.string().min(1).max(2048).refine(value => !/[\s\\?#]/u.test(value)),
  apiKey: z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/),
  model: z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/),
  maxOutputTokens: z.number().int().min(1).max(8192),
  // Server deployments keep their own 40 s bound; local application targets may configure up to 5 minutes for slow local models.
  timeoutMs: z.number().int().min(1).max(300_000),
  tokenLimitField: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
  responseFormat: z.enum(['prompt', 'json_object', 'json_schema']).optional(),
  reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),
  allowPrivateHttp: z.boolean().optional(),
});

/** Loopback and RFC 1918 / link-local / .local hosts, where plain http stays on the learner's own network. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1') return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/** Human-readable destination for provenance lines; never includes the key. */
export function destinationLabel(baseURL: string): string {
  if (baseURL === 'https://api.openai.com/v1') return 'OpenAI';
  if (baseURL === 'https://ollama.com/v1') return 'Ollama Cloud';
  try { return new URL(baseURL).host; } catch { return 'custom endpoint'; }
}
const MAX_ENVELOPE_BYTES = 512 * 1024;
async function readEnvelope(response: Response, deadline: ReturnType<typeof createDeadline>): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_ENVELOPE_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw new OpenAICompatibleError(/^\d+$/.test(length) ? 'RESPONSE_TOO_LARGE' : 'INVALID_OUTPUT');
  }
  if (!response.body) throw new OpenAICompatibleError('INVALID_OUTPUT');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  let done = false;
  try {
    while (true) {
      const chunk = await deadline.wait(() => reader.read());
      if (chunk.done) { done = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_ENVELOPE_BYTES) throw new OpenAICompatibleError('RESPONSE_TOO_LARGE');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return parseStrictJson(text + decoder.decode());
  } catch (error) {
    if (error instanceof OpenAICompatibleError || error instanceof BoundaryError) throw error;
    throw new OpenAICompatibleError('INVALID_OUTPUT', done);
  } finally {
    if (!done) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const EnvelopeSchema = z.object({
  choices: z.array(z.object({
    index: z.literal(0),
    finish_reason: z.enum(['stop', 'length', 'content_filter']),
    message: z.object({ role: z.literal('assistant'), content: z.string().nullable().optional(), refusal: z.string().nullable().optional(),
      // Some servers (LM Studio, vLLM) send an empty tool_calls list on every message. Empty or null is not a tool call; anything else is refused.
      tool_calls: z.array(z.never()).max(0).nullable().optional(), function_call: z.null().optional(),
    }),
  })).length(1),
});
const feedbackJSONSchema = z.toJSONSchema(FeedbackSchema);

/** The host supplies the transport; Obsidian desktop passes the Node http client, never a webview fetch. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Server-configured only. Never construct from request-supplied configuration. */
export function createOpenAICompatibleProvider(configuration: OpenAICompatibleConfig, fetchImpl: FetchLike): LiveReviewProvider {
  let config: OpenAICompatibleConfig;
  let endpoint: string;
  try {
    config = ConfigSchema.parse(configuration);
    if (!/^https?:\/\/[^/@]+(?:\/|$)/i.test(config.baseURL)) throw new Error();
    const url = new URL(config.baseURL);
    const privateHttp = url.protocol === 'http:' && config.allowPrivateHttp === true && isPrivateHost(url.hostname);
    if ((url.protocol !== 'https:' && !privateHttp) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
    url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
    endpoint = url.href;
  } catch { throw new OpenAICompatibleError('INVALID_CONFIG'); }
  return {
    mode: 'live',
    async generate(input) {
      let source;
      let preferences;
      try {
        if (typeof input.learnerData !== 'string' || input.learnerData.length > LIMITS.requestBytes || utf8ByteLength(input.learnerData) > LIMITS.requestBytes) throw new Error();
        const validated = validateSource(parseStrictJson(input.learnerData));
        if (!validated.ok) throw new Error();
        source = validated.value;
        preferences = PreferencesSchema.parse(input.preferences);
      } catch { throw new OpenAICompatibleError('INVALID_INPUT'); }
      const requestedSchema = structuredClone(feedbackJSONSchema);
      if (source.mode === 'spanish_only' && requestedSchema.properties) delete requestedSchema.properties.alignment;
      // Keep the shared teaching policy, adapting only this private wire contract.
      const instruction = input.policy.instruction
        .replaceAll(SCHEMA_VERSION, FEEDBACK_SCHEMA_VERSION)
        .replace('Preserve source exactly;', 'Do not return source; the server attaches the original source. Copy anchor quotes exactly from source.text, including punctuation, whitespace, and Unicode;');
      const deadline = createDeadline(config.timeoutMs, input.signal);
      try {
      let response: Response;
      try { response = await deadline.wait(() => fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', signal: deadline.signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, [config.tokenLimitField ?? 'max_tokens']: config.maxOutputTokens, stream: false, store: false,
          ...(config.reasoningEffort === undefined ? {} : { reasoning_effort: config.reasoningEffort }),
          ...(config.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
          // Zod-derived JSON Schema includes refinements enforced only locally and
          // does not claim compatibility with any vendor's strict-schema subset.
          ...(config.responseFormat === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: 'codazo_feedback', strict: false, schema: requestedSchema } } } : {}),
          messages: [
            { role: 'system', content: instruction + '\nFeedback JSON schema: ' + JSON.stringify(requestedSchema) },
            { role: 'user', content: JSON.stringify({ preferences, source }) },
          ],
        }),
      }).then(response => {
        if (deadline.signal.aborted) void response.body?.cancel().catch(() => {});
        return response;
      })); } catch (error) {
        if (error instanceof BoundaryError) throw error;
        throw new OpenAICompatibleError('UPSTREAM_ERROR');
      }
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw new OpenAICompatibleError('UPSTREAM_ERROR', false, response.redirected ? 'redirect' : `http ${response.status}`);
      }
      const parsed = EnvelopeSchema.safeParse(await readEnvelope(response, deadline));
      if (!parsed.success) throw new OpenAICompatibleError('INVALID_OUTPUT', true, `envelope:${parsed.error.issues[0]?.path.join('.') || 'root'}`);
      const choice = parsed.data.choices[0];
      if (choice.finish_reason === 'content_filter' || choice.message.refusal) return { text: '', completion: 'refused' };
      if (choice.finish_reason === 'length') return { text: '', completion: 'truncated' };
      const text = choice.message.content;
      try {
        const review = parseProviderOutput(text, source);
        return { text: JSON.stringify(review), completion: 'complete' };
      } catch (error) { throw new OpenAICompatibleError('INVALID_OUTPUT', true, error instanceof ProviderOutputError ? error.detail : undefined); }
      } catch (error) {
        if (error instanceof BoundaryError) throw new OpenAICompatibleError(error.code);
        if (error instanceof OpenAICompatibleError) throw error;
        throw new OpenAICompatibleError('UPSTREAM_ERROR');
      } finally { deadline.close(); }
    },
  };
}
