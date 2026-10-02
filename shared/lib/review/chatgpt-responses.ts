import 'server-only';
import { BoundaryError, createDeadline } from '../security/deadline';
import type { LiveReviewProvider, ProviderInput, ProviderResult } from './provider';
import { CHATGPT_RESPONSES_ENDPOINT, OpenAICompatibleError, prepareFeedbackRequest, type FetchLike } from './openai-compatible';
import { parseProviderOutput, ProviderOutputError } from './provider-output';

/**
 * ChatGPT plan usage: the Responses API with a Sign in with ChatGPT access
 * token. The plan route serves non-stored streaming requests, so the reply is
 * a server-sent event stream that is reassembled here and then validated by
 * the same contract as every other provider. A plan limit is reported as a
 * diagnostic the host can act on; it is never presented as feedback.
 */
export interface ChatGPTResponsesConfig {
  readonly kind: 'chatgpt';
  readonly accessToken: string;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly responseFormat?: 'prompt' | 'json_schema';
  /** Tests point this at a loopback server; production uses the public Responses API. */
  readonly endpoint?: string;
}

/** Error codes the plan route returns when the learner's ChatGPT allowance is used up or sharing is off. */
const PLAN_LIMIT_CODES = new Set(['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_v2_usage_limit_exceeded']);
const MAX_STREAM_BYTES = 512 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;
const TOKEN = /^[\x21-\x7e]{1,4096}$/;
const MODEL = /^[\x21-\x7e]{1,256}$/;

function errorCode(body: unknown): string | null {
  let node: unknown = body;
  for (let depth = 0; depth < 4 && node && typeof node === 'object'; depth += 1) {
    const record = node as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code;
    node = record.error ?? record.response ?? null;
  }
  return null;
}

export function createChatGPTResponsesProvider(configuration: ChatGPTResponsesConfig, fetchImpl: FetchLike): LiveReviewProvider {
  const config = configuration;
  if (config.kind !== 'chatgpt' || !TOKEN.test(config.accessToken) || !MODEL.test(config.model) || !Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens < 1 || config.maxOutputTokens > 8192 || !Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 300_000) throw new OpenAICompatibleError('INVALID_CONFIG');
  const endpoint = config.endpoint ?? CHATGPT_RESPONSES_ENDPOINT;
  if (endpoint !== CHATGPT_RESPONSES_ENDPOINT && !/^http:\/\/127\.0\.0\.1:\d+\//.test(endpoint)) throw new OpenAICompatibleError('INVALID_CONFIG');
  return {
    mode: 'live',
    async generate(input: ProviderInput): Promise<ProviderResult> {
      const { source, preferences, requestedSchema, instruction } = prepareFeedbackRequest(input);
      const deadline = createDeadline(config.timeoutMs, input.signal);
      try {
        let response: Response;
        try {
          response = await deadline.wait(() => fetchImpl(endpoint, {
            method: 'POST', redirect: 'error', signal: deadline.signal,
            headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({
              model: config.model, store: false, stream: true, max_output_tokens: config.maxOutputTokens,
              instructions: instruction + '\nFeedback JSON schema: ' + JSON.stringify(requestedSchema),
              input: [{ role: 'user', content: JSON.stringify({ preferences, source }) }],
              ...(config.responseFormat === 'json_schema' ? { text: { format: { type: 'json_schema', name: 'codazo_feedback', strict: false, schema: requestedSchema } } } : {}),
            }),
          }));
        } catch (error) {
          if (error instanceof BoundaryError) throw error;
          throw new OpenAICompatibleError('UPSTREAM_ERROR', false, 'network');
        }
        if (!response.ok || response.redirected) {
          const body = await readBounded(response, deadline).then(text => { try { return JSON.parse(text) as unknown; } catch { return null; } }).catch(() => null);
          const code = errorCode(body);
          throw new OpenAICompatibleError('UPSTREAM_ERROR', true, response.redirected ? 'redirect' : code && PLAN_LIMIT_CODES.has(code) ? 'plan_limit' : `http ${response.status}`);
        }
        const stream = await readStream(response, deadline);
        if (stream.outcome === 'failed') throw new OpenAICompatibleError('UPSTREAM_ERROR', true, stream.code && PLAN_LIMIT_CODES.has(stream.code) ? 'plan_limit' : 'failed');
        if (stream.outcome === 'incomplete') return { text: '', completion: stream.reason === 'content_filter' ? 'refused' : 'truncated' };
        if (stream.outcome === 'interrupted') throw new OpenAICompatibleError('INVALID_OUTPUT', true, 'stream_interrupted');
        try {
          const review = parseProviderOutput(stream.text, source);
          return { text: JSON.stringify(review), completion: 'complete' };
        } catch (error) { throw new OpenAICompatibleError('INVALID_OUTPUT', true, error instanceof ProviderOutputError ? error.detail : undefined); }
      } finally { deadline.close(); }
    },
  };
}

async function readBounded(response: Response, deadline: ReturnType<typeof createDeadline>): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const chunk = await deadline.wait(() => reader.read());
      if (chunk.done) return text + decoder.decode();
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > MAX_STREAM_BYTES) throw new OpenAICompatibleError('RESPONSE_TOO_LARGE', false);
    }
  } finally { await reader.cancel().catch(() => {}); }
}

type StreamOutcome = { outcome: 'completed'; text: string } | { outcome: 'incomplete'; reason: string } | { outcome: 'failed'; code: string | null } | { outcome: 'interrupted' };

/** Server-sent events: each `data:` line is JSON; a blank line ends the event. Only the event types the contract needs are read. */
async function readStream(response: Response, deadline: ReturnType<typeof createDeadline>): Promise<StreamOutcome> {
  const reader = response.body?.getReader();
  if (!reader) return { outcome: 'interrupted' };
  const decoder = new TextDecoder();
  let pending = '';
  let total = 0;
  let text = '';
  let dataLines: string[] = [];
  let result: StreamOutcome | null = null;
  const dispatch = () => {
    const data = dataLines.join('\n');
    dataLines = [];
    if (!data || data === '[DONE]' || result) return;
    let event: unknown;
    try { event = JSON.parse(data); } catch { throw new OpenAICompatibleError('INVALID_OUTPUT', true, 'stream_event'); }
    if (!event || typeof event !== 'object') return;
    const record = event as Record<string, unknown>;
    if (record.type === 'response.output_text.delta' && typeof record.delta === 'string') { text += record.delta; return; }
    if (record.type === 'response.completed') { result = { outcome: 'completed', text }; return; }
    if (record.type === 'response.incomplete') {
      const details = record.response && typeof record.response === 'object' ? (record.response as { incomplete_details?: { reason?: unknown } }).incomplete_details : undefined;
      result = { outcome: 'incomplete', reason: typeof details?.reason === 'string' ? details.reason : 'unknown' };
      return;
    }
    if (record.type === 'response.failed' || record.type === 'error') { result = { outcome: 'failed', code: errorCode(record) }; }
  };
  try {
    for (;;) {
      const chunk = await deadline.wait(() => reader.read());
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      total += chunk.value?.byteLength ?? 0;
      if (total > MAX_STREAM_BYTES) throw new OpenAICompatibleError('RESPONSE_TOO_LARGE', false);
      let consumed = 0;
      for (let index = 0; index < pending.length; index += 1) {
        const character = pending[index];
        if (character !== '\n' && character !== '\r') continue;
        if (character === '\r' && index === pending.length - 1 && !chunk.done) break;
        const line = pending.slice(consumed, index);
        if (line === '') dispatch();
        else if (line.startsWith('data:')) { const content = line.slice(5).replace(/^ /, ''); if (content.length > MAX_EVENT_BYTES) throw new OpenAICompatibleError('RESPONSE_TOO_LARGE', false); dataLines.push(content); }
        if (character === '\r' && pending[index + 1] === '\n') index += 1;
        consumed = index + 1;
      }
      pending = pending.slice(consumed);
      if (pending.length > MAX_EVENT_BYTES) throw new OpenAICompatibleError('RESPONSE_TOO_LARGE', false);
      if (chunk.done) { if (pending) { if (pending.startsWith('data:')) dataLines.push(pending.slice(5).replace(/^ /, '')); } dispatch(); break; }
      if (result) break;
    }
    return result ?? { outcome: 'interrupted' };
  } finally { await reader.cancel().catch(() => {}); }
}
