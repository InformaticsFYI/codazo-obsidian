/**
 * Mobile transport: the webview's fetch with redirects refused. Node's fetch
 * follows the same Fetch standard, so real loopback servers stand in for the
 * provider and for a redirect target. Dummy credentials only.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createWebFetch } from '../src/web-transport';
import { LocalReviewService } from '../shared/lib/review/local-review-service';

const sink = { hits: 0, auth: [] as string[], bytes: 0 };
let redirector: Server, sinkServer: Server, okServer: Server;
const ports = { redirect: 0, sink: 0, ok: 0 };
const listen = (server: Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));

beforeAll(async () => {
  sinkServer = createServer((req, res) => { let n = 0; req.on('data', c => { n += c.length; }); req.on('end', () => { sink.hits++; sink.auth.push(req.headers.authorization ?? ''); sink.bytes += n; res.writeHead(502); res.end(); }); });
  redirector = createServer((req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${ports.sink}${req.url}` }); res.end(); });
  okServer = createServer((req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ auth: req.headers.authorization, cookie: req.headers.cookie ?? null, bytes: body.length })); }); });
  ports.sink = await listen(sinkServer); ports.ok = await listen(okServer); ports.redirect = await listen(redirector);
});
afterAll(() => { redirector.close(); sinkServer.close(); okServer.close(); });

const host = { fetch: globalThis.fetch.bind(globalThis) };

test('without a fetch on the host there is no transport', () => {
  expect(createWebFetch(undefined)).toBeNull();
  expect(createWebFetch({})).toBeNull();
});

test('a redirect is refused even if the caller asked to follow it; the redirect target never sees the bearer or body', async () => {
  const fetchImpl = createWebFetch(host)!;
  await expect(fetchImpl(`http://127.0.0.1:${ports.redirect}/v1/chat/completions`, { method: 'POST', redirect: 'follow', headers: { authorization: 'Bearer PROBE-DUMMY' }, body: JSON.stringify({ synthetic: 'x'.repeat(2000) }) })).rejects.toThrow();
  expect(sink).toEqual({ hits: 0, auth: [], bytes: 0 });
});

test('a normal request carries the bearer and body to the confirmed destination, without cookies', async () => {
  const fetchImpl = createWebFetch(host)!;
  const response = await fetchImpl(`http://127.0.0.1:${ports.ok}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer PROBE-DUMMY' }, body: 'abc' });
  expect(await response.json()).toEqual({ auth: 'Bearer PROBE-DUMMY', cookie: null, bytes: 3 });
});

test('the transport sets its safety options itself, overriding the caller', async () => {
  const seen: RequestInit[] = [];
  const fetchImpl = createWebFetch({ fetch: (_input: string, init: RequestInit) => { seen.push(init); return Promise.resolve(new Response('{}')); } })!;
  await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST', redirect: 'follow', credentials: 'include', body: '{}' });
  expect(seen[0]).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
});

test('through the review service, a redirect or an unreachable server is an upstream error tagged network', async () => {
  const fetchImpl = createWebFetch(host)!;
  const { source } = JSON.parse(readFileSync(new URL('./fixtures/valid-codazo-v1.json', import.meta.url), 'utf8')) as { source: unknown };
  const run = (baseURL: string, n: number) => new LocalReviewService({ snapshot: async () => ({ baseURL, apiKey: 'PROBE-DUMMY', model: 'm', maxOutputTokens: 512, timeoutMs: 5000, allowPrivateHttp: true }) }, fetchImpl)
    .review({ schema_version: 'codazo.request/1', request_id: `f3f6a7c0-1111-4222-8333-44445555666${n}`, revision: 0, source, level: 'A2', locale: 'es-MX' })
    .catch((error: unknown) => error);
  const { describeError } = await import('../src/labels');
  expect(describeError(await run(`http://127.0.0.1:${ports.redirect}/v1`, 1))).toContain('(network)');
  expect(describeError(await run('http://127.0.0.1:1/v1', 2))).toContain('(network)');
  expect(sink.hits).toBe(0);
  // On mobile the message adds a plain explanation; desktop keeps the short form.
  const mobile = describeError(await run('http://127.0.0.1:1/v1', 3), { mobile: true });
  expect(mobile).toContain('(network)');
  expect(mobile.length).toBeGreaterThan(describeError(await run('http://127.0.0.1:1/v1', 4)).length);
});
