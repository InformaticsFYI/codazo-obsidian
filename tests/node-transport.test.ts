/**
 * R2 prevention (Canvas 70): the desktop transport must never forward the key
 * or body past a redirect. Real loopback servers, dummy credentials only.
 */
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createNodeFetch } from '../src/node-transport';
import { createOpenAICompatibleProvider } from '../shared/lib/review/openai-compatible';
import { REVIEW_POLICY } from '../shared/lib/review/prompt';

const sink: { hits: number; auth: string[]; bytes: number } = { hits: 0, auth: [], bytes: 0 };
let redirector: Server, sinkServer: Server, okServer: Server, ports = { a: 0, b: 0, ok: 0 };
const listen = (server: Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));

beforeAll(async () => {
  sinkServer = createServer((req, res) => { let n = 0; req.on('data', c => { n += c.length; }); req.on('end', () => { sink.hits++; sink.auth.push(req.headers.authorization ?? ''); sink.bytes += n; res.writeHead(502); res.end(); }); });
  redirector = createServer((req, res) => { res.writeHead(307, { Location: `http://localhost:${ports.b}${req.url}` }); res.end(); });
  okServer = createServer((req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ echoedAuth: req.headers.authorization, method: req.method, bytes: body.length })); }); });
  ports = { b: await listen(sinkServer), a: 0, ok: await listen(okServer) };
  ports.a = await listen(redirector);
});
afterAll(() => { redirector.close(); sinkServer.close(); okServer.close(); });

const nodeRequire = createRequire(import.meta.url);
const fetchImpl = createNodeFetch(nodeRequire)!;

test('a 307 from the destination is returned as a failed response; the sink never sees the bearer or body', async () => {
  const response = await fetchImpl(`http://127.0.0.1:${ports.a}/v1/chat/completions`, { method: 'POST', redirect: 'error', headers: { authorization: 'Bearer PROBE-DUMMY', 'content-type': 'application/json' }, body: JSON.stringify({ synthetic: 'x'.repeat(2000) }) });
  expect(response.status).toBe(307);
  expect(response.redirected).toBe(false);
  expect(sink.hits).toBe(0);
});

test('through the shared provider a redirecting endpoint is UPSTREAM_ERROR before any disclosure, with one request only', async () => {
  const provider = createOpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${ports.a}/v1`, apiKey: 'PROBE-DUMMY', model: 'm', maxOutputTokens: 256, timeoutMs: 5000, allowPrivateHttp: true }, fetchImpl);
  await expect(provider.generate({ policy: REVIEW_POLICY, learnerData: JSON.stringify({ text: 'Hola.', mode: 'spanish_only' }), preferences: { level: 'A2', locale: 'es-MX' }, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', detail: 'http 307' });
  expect(sink.hits).toBe(0);
  expect(sink.auth).toEqual([]);
  expect(sink.bytes).toBe(0);
});

test('a direct destination receives exactly the request; abort destroys the socket', async () => {
  const response = await fetchImpl(`http://127.0.0.1:${ports.ok}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer PROBE-DUMMY' }, body: '{"a":1}' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ echoedAuth: 'Bearer PROBE-DUMMY', method: 'POST', bytes: 7 });
  const controller = new AbortController(); controller.abort();
  await expect(fetchImpl(`http://127.0.0.1:${ports.ok}/`, { signal: controller.signal })).rejects.toThrow('aborted');
});

test('without a host require the transport is absent rather than downgraded', () => {
  expect(createNodeFetch(null)).toBeNull();
  expect(createNodeFetch(() => { throw new Error('no modules'); })).toBeNull();
});
