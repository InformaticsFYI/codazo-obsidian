/**
 * ChatGPT plan usage goes through the Responses API as a server-sent event
 * stream with `store: false`. A fake Responses server on loopback plays each
 * outcome; the adapter must reassemble the text, validate it against the
 * review contract, and report plan limits as a diagnostic, never as feedback.
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createChatGPTResponsesProvider } from '../shared/lib/review/chatgpt-responses';
import { REVIEW_POLICY } from '../shared/lib/review/prompt';
import type { Review } from '../shared/lib/review/schema';

const fixture = JSON.parse(readFileSync('tests/fixtures/valid-codazo-v1.json', 'utf8')) as Review;
const { source, ...feedback } = fixture;
const modelText = JSON.stringify({ ...feedback, schema_version: 'codazo.feedback/1' });

type Script = { status?: number; events?: unknown[]; body?: string; raw?: string };
let script: Script = {};
const seen: { headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];
let server: Server; let base = '';
const sse = (events: unknown[]) => events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; });
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> });
      if (script.status) { res.writeHead(script.status, { 'content-type': 'application/json' }); res.end(script.body ?? '{}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(script.raw ?? sse(script.events ?? []));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; resolve(); }));
});
afterAll(() => server.close());

const fetchImpl = (input: string, init: RequestInit) => fetch(input, { ...init, redirect: 'error' });
const provider = (overrides: Partial<Parameters<typeof createChatGPTResponsesProvider>[0]> = {}) => createChatGPTResponsesProvider({ kind: 'chatgpt', endpoint: `${base}/v1/responses`, accessToken: 'PLAN-TOKEN', model: 'gpt-5.5', maxOutputTokens: 4096, timeoutMs: 5000, ...overrides }, fetchImpl);
const generate = (p = provider()) => p.generate({ policy: REVIEW_POLICY, learnerData: JSON.stringify(source), preferences: { level: 'A2', locale: 'es-MX' }, signal: new AbortController().signal });
const chunks = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));

test('deltas are reassembled and validated; the request is a non-stored stream with the bearer and no cookies', async () => {
  seen.length = 0;
  script = { events: [{ type: 'response.created' }, ...chunks(modelText, 700).map(delta => ({ type: 'response.output_text.delta', delta })), { type: 'response.completed', response: { status: 'completed' } }] };
  const result = await generate();
  expect(result.completion).toBe('complete');
  expect((JSON.parse(result.text) as Review).annotations.length).toBe(feedback.annotations.length);
  const request = seen[0]!;
  expect(request.headers.authorization).toBe('Bearer PLAN-TOKEN');
  expect(request.headers.accept).toBe('text/event-stream');
  expect(request.body).toMatchObject({ model: 'gpt-5.5', store: false, stream: true, max_output_tokens: 4096 });
  expect(request.body).not.toHaveProperty('text');
  expect(Array.isArray(request.body.input)).toBe(true);
  expect(typeof request.body.instructions).toBe('string');
  expect(JSON.stringify(request.body)).toContain(source.text);
});

test('json_schema asks the Responses API for structured text output', async () => {
  seen.length = 0;
  script = { events: [{ type: 'response.output_text.delta', delta: modelText }, { type: 'response.completed' }] };
  await generate(provider({ responseFormat: 'json_schema' }));
  expect(seen[0]!.body.text).toMatchObject({ format: { type: 'json_schema', name: 'codazo_feedback', strict: false } });
});

test('a plan limit is an upstream error tagged plan_limit, whether it arrives as HTTP or as a failed event', async () => {
  script = { status: 429, body: JSON.stringify({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } }) };
  await expect(generate()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', detail: 'plan_limit' });
  script = { events: [{ type: 'response.failed', response: { status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } }] };
  await expect(generate()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', detail: 'plan_limit' });
  script = { status: 401, body: JSON.stringify({ error: { code: 'invalid_token' } }) };
  await expect(generate()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', detail: 'http 401' });
});

test('incomplete responses are reported, never shown: max_output_tokens is truncated and content_filter is refused', async () => {
  script = { events: [{ type: 'response.output_text.delta', delta: '{"schema' }, { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }] };
  expect((await generate()).completion).toBe('truncated');
  script = { events: [{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } } }] };
  expect((await generate()).completion).toBe('refused');
});

test('a stream that ends without completion, or text that is not the contract, is invalid output', async () => {
  script = { events: [{ type: 'response.output_text.delta', delta: modelText }] };
  await expect(generate()).rejects.toMatchObject({ code: 'INVALID_OUTPUT', detail: 'stream_interrupted' });
  script = { events: [{ type: 'response.output_text.delta', delta: 'SECRET LEARNER PROSE not json' }, { type: 'response.completed' }] };
  const error = await generate().then(() => null, (e: unknown) => e as { code: string; detail?: string });
  expect(error?.code).toBe('INVALID_OUTPUT');
  expect(JSON.stringify(error)).not.toContain('SECRET');
  script = { raw: 'data: {not json\n\n' };
  await expect(generate()).rejects.toMatchObject({ code: 'INVALID_OUTPUT', detail: 'stream_event' });
});

test('an oversized stream is cut off', async () => {
  script = { raw: `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'x'.repeat(600 * 1024) })}\n\n` };
  await expect(generate()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
});
