/**
 * Sign in with ChatGPT: OpenID Connect with PKCE against a fake issuer on
 * loopback. The test plays the browser by visiting the callback. Identity
 * tokens are signed with a key generated here; nothing real is contacted.
 */
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { ConnectionSchema, needsRefresh, refreshConnection, signIn, verifyIdToken, type ChatGPTConnection, type OAuthHost } from '../src/chatgpt/oauth';
import { createLoopbackListener } from '../src/chatgpt/loopback';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
let keys: { privateKey: CryptoKey; publicKey: CryptoKey }; let jwk: JsonWebKey & { kid: string };
async function idToken(claims: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const signature = await subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keys.privateKey, Buffer.from(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(signature)}`;
}

// Fake issuer: discovery, token endpoint, JWKS. It records the token requests and plays back a scripted response.
let issuer: Server; let issuerURL = '';
const tokenRequests: URLSearchParams[] = [];
let tokenResponse: (params: URLSearchParams) => Promise<{ status: number; body: unknown }>;
beforeAll(async () => {
  keys = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as { privateKey: CryptoKey; publicKey: CryptoKey };
  jwk = { ...(await subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', use: 'sig', alg: 'RS256' } as JsonWebKey & { kid: string };
  issuer = createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; });
    req.on('end', () => {
      void (async () => {
        if (req.url === '/.well-known/openid-configuration') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ issuer: issuerURL, authorization_endpoint: `${issuerURL}/oauth/authorize`, token_endpoint: `${issuerURL}/oauth/token`, jwks_uri: `${issuerURL}/.well-known/jwks.json` })); return; }
        if (req.url === '/.well-known/jwks.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); return; }
        if (req.url === '/oauth/token') { const params = new URLSearchParams(raw); tokenRequests.push(params); const reply = await tokenResponse(params); res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.body)); return; }
        res.writeHead(404); res.end();
      })();
    });
  });
  await new Promise<void>(resolve => issuer.listen(0, '127.0.0.1', () => { issuerURL = `http://127.0.0.1:${(issuer.address() as { port: number }).port}`; resolve(); }));
});
afterAll(() => issuer.close());

const nodeRequire = createRequire(import.meta.url);
const opened: URL[] = [];
/** The "browser": records the authorization URL, then visits the callback the way the issuer would redirect. */
function host(visit: (authorization: URL) => Promise<void>): OAuthHost {
  return {
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
    openBrowser: url => { const parsed = new URL(url); opened.push(parsed); void visit(parsed); },
    listen: createLoopbackListener(nodeRequire),
    subtle, now: () => Date.now(), issuer: issuerURL,
  };
}
const redirectTo = async (authorization: URL, params: Record<string, string>) => { const callback = new URL(authorization.searchParams.get('redirect_uri')!); for (const [k, v] of Object.entries(params)) callback.searchParams.set(k, v); await fetch(callback); };
const grant = (claims: Record<string, unknown>, extra: Record<string, unknown> = {}) => async () => ({ status: 200, body: { access_token: 'ACCESS-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'REFRESH-1', scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', id_token: await idToken(claims), ...extra } });

test('a first sign-in registers the app, exchanges the code with PKCE, verifies the identity, and returns a connection', async () => {
  opened.length = 0; tokenRequests.length = 0;
  let nonce = '';
  const h = host(async authorization => { nonce = authorization.searchParams.get('nonce')!; await redirectTo(authorization, { code: 'CODE-1', state: authorization.searchParams.get('state')!, client_id: 'client-abc' }); });
  tokenResponse = async () => ({ status: 200, body: { access_token: 'ACCESS-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'REFRESH-1', scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', id_token: await idToken({ iss: issuerURL, aud: 'client-abc', sub: 'user-1', email: 'learner@example.com', nonce, exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000) }) } });
  const connection = await signIn(h, { appName: 'Codazo', signal: AbortSignal.timeout(10_000) });
  const authorization = opened[0]!;
  expect(authorization.origin).toBe(issuerURL);
  expect(authorization.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect(authorization.searchParams.get('agent_name_hint')).toBe('Codazo');
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorization.searchParams.get('resource')).toBe('https://api.openai.com/v1');
  expect(authorization.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
  expect(authorization.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  const exchange = tokenRequests[0]!;
  expect(exchange.get('grant_type')).toBe('authorization_code');
  expect(exchange.get('client_id')).toBe('client-abc');
  expect(exchange.get('code')).toBe('CODE-1');
  const verifier = exchange.get('code_verifier')!;
  expect(b64url(await subtle.digest('SHA-256', Buffer.from(verifier)))).toBe(authorization.searchParams.get('code_challenge'));
  expect(connection).toMatchObject({ version: 1, clientId: 'client-abc', subject: 'user-1', email: 'learner@example.com', accessToken: 'ACCESS-1', refreshToken: 'REFRESH-1' });
  expect(ConnectionSchema.safeParse(connection).success).toBe(true);
  expect(connection.expiresAt).toBeGreaterThan(Date.now() + 3000_000);
});

test('a callback with the wrong state is ignored and the sign-in keeps waiting; a denial ends it', async () => {
  const h = host(async authorization => { await redirectTo(authorization, { code: 'X', state: 'wrong' }); await redirectTo(authorization, { error: 'access_denied', state: authorization.searchParams.get('state')! }); });
  await expect(signIn(h, { appName: 'Codazo', signal: AbortSignal.timeout(10_000) })).rejects.toMatchObject({ message: 'SIGNIN_DENIED' });
});

test('a sign-in that returns a different account than the saved profile is refused', async () => {
  const previous: ChatGPTConnection = { version: 1, clientId: 'client-abc', subject: 'user-1', email: 'learner@example.com', scopes: [], accessToken: 'OLD', expiresAt: 0, refreshToken: 'R' };
  let nonce = '';
  const h = host(async authorization => { nonce = authorization.searchParams.get('nonce')!; await redirectTo(authorization, { code: 'CODE-2', state: authorization.searchParams.get('state')! }); });
  tokenResponse = grant({ iss: issuerURL, aud: 'client-abc', sub: 'someone-else', nonce: '', exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000) });
  tokenResponse = async () => ({ status: 200, body: { access_token: 'A', token_type: 'Bearer', expires_in: 3600, refresh_token: 'R2', scope: 'openid offline_access chatgpt.tokens.use.direct', id_token: await idToken({ iss: issuerURL, aud: 'client-abc', sub: 'someone-else', nonce, exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000) }) } });
  await expect(signIn(h, { appName: 'Codazo', previous, signal: AbortSignal.timeout(10_000) })).rejects.toMatchObject({ message: 'ACCOUNT_MISMATCH' });
  expect(opened.at(-1)!.searchParams.get('client_id')).toBe('client-abc');
  expect(opened.at(-1)!.searchParams.get('login_hint')).toBe('learner@example.com');
});

test('identity tokens are verified: signature, issuer, audience, nonce, and expiry', async () => {
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: issuerURL, aud: 'client-abc', sub: 'user-1', nonce: 'n', exp: now + 300, iat: now };
  const options = { jwks: [jwk], issuer: issuerURL, clientId: 'client-abc', nonce: 'n', now: Date.now(), subtle };
  expect((await verifyIdToken(await idToken(good), options)).subject).toBe('user-1');
  await expect(verifyIdToken(await idToken({ ...good, iss: 'https://evil.example' }), options)).rejects.toMatchObject({ message: 'SIGNIN_IDENTITY' });
  await expect(verifyIdToken(await idToken({ ...good, aud: 'other-client' }), options)).rejects.toMatchObject({ message: 'SIGNIN_IDENTITY' });
  await expect(verifyIdToken(await idToken({ ...good, nonce: 'stolen' }), options)).rejects.toMatchObject({ message: 'SIGNIN_IDENTITY' });
  await expect(verifyIdToken(await idToken({ ...good, exp: now - 60 }), options)).rejects.toMatchObject({ message: 'SIGNIN_IDENTITY' });
  const token = await idToken(good);
  const [h, p, s] = token.split('.');
  await expect(verifyIdToken(`${h}.${p}.${s!.slice(0, -4)}AAAA`, options)).rejects.toMatchObject({ message: 'SIGNIN_IDENTITY' });
  await expect(verifyIdToken(await idToken(good, 'unknown-kid'), options)).rejects.toMatchObject({ message: 'SIGNIN_IDENTITY' });
});

test('refresh rotates the tokens with the resource and keeps the account; an expired grant asks for a new sign-in', async () => {
  tokenRequests.length = 0;
  const previous: ChatGPTConnection = { version: 1, clientId: 'client-abc', subject: 'user-1', scopes: ['openid', 'offline_access', 'chatgpt.tokens.use.direct'], accessToken: 'OLD', expiresAt: Date.now() + 30_000, refreshToken: 'REFRESH-1' };
  expect(needsRefresh(previous, Date.now())).toBe(true);
  expect(needsRefresh({ ...previous, expiresAt: Date.now() + 600_000 }, Date.now())).toBe(false);
  const h = host(async () => {});
  tokenResponse = async () => ({ status: 200, body: { access_token: 'ACCESS-2', token_type: 'Bearer', expires_in: 3600, refresh_token: 'REFRESH-2' } });
  const next = await refreshConnection(h, previous, AbortSignal.timeout(10_000));
  expect(tokenRequests[0]!.get('grant_type')).toBe('refresh_token');
  expect(tokenRequests[0]!.get('refresh_token')).toBe('REFRESH-1');
  expect(tokenRequests[0]!.get('resource')).toBe('https://api.openai.com/v1');
  expect(next).toMatchObject({ clientId: 'client-abc', subject: 'user-1', accessToken: 'ACCESS-2', refreshToken: 'REFRESH-2', scopes: previous.scopes });
  tokenResponse = async () => ({ status: 400, body: { error: 'invalid_grant' } });
  await expect(refreshConnection(h, previous, AbortSignal.timeout(10_000))).rejects.toMatchObject({ message: 'CONNECTION_EXPIRED' });
  tokenResponse = async () => ({ status: 200, body: { access_token: 'ACCESS-3', token_type: 'Bearer', expires_in: 3600, refresh_token: 'REFRESH-3', id_token: await idToken({ iss: issuerURL, aud: 'client-abc', sub: 'other', exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000) }) } });
  await expect(refreshConnection(h, previous, AbortSignal.timeout(10_000))).rejects.toMatchObject({ message: 'ACCOUNT_MISMATCH' });
});

test('the loopback listener accepts only its own callback path and host, and stops when the sign-in is cancelled', async () => {
  const listen = createLoopbackListener(nodeRequire);
  const controller = new AbortController();
  const listener = await listen('STATE', controller.signal);
  const port = new URL(listener.redirectUri).port;
  expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
  expect((await fetch(`http://127.0.0.1:${port}/auth/callback?state=nope&code=x`)).status).toBe(400);
  controller.abort();
  await expect(listener.result).rejects.toMatchObject({ message: 'SIGNIN_CANCELLED' });
  await expect(fetch(`http://127.0.0.1:${port}/auth/callback`)).rejects.toThrow();
});

test('sign-in and plan-limit failures are described without echoing the issuer, and the plan limit names the action', async () => {
  const { describeError, isPlanLimit } = await import('../src/labels');
  const { SignInError } = await import('../src/chatgpt/oauth');
  const { OpenAICompatibleError } = await import('../shared/lib/review/openai-compatible');
  const { t } = await import('../src/strings');
  expect(describeError(new SignInError('SIGNIN_TOKEN', 'invalid_grant'))).toBe(`${t().errors.SIGNIN_TOKEN} (signin:invalid_grant)`);
  expect(describeError(new SignInError('SIGNIN_TOKEN', 'Weird Server Text <b>'))).toBe(`${t().errors.SIGNIN_TOKEN} (signin:weird_server_text__b_)`);
  expect(describeError(new SignInError('ACCOUNT_MISMATCH'))).toBe(t().errors.ACCOUNT_MISMATCH);
  const limit = new OpenAICompatibleError('UPSTREAM_ERROR', true, 'plan_limit');
  expect(isPlanLimit(limit)).toBe(true);
  expect(describeError(limit)).toBe(t().planLimit);
  expect(isPlanLimit(new OpenAICompatibleError('UPSTREAM_ERROR', true, 'http 429'))).toBe(false);
});
