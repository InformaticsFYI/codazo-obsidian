import { z } from 'zod';
import type { FetchLike } from '../../shared/lib/review/openai-compatible';

/**
 * Sign in with ChatGPT: OpenID Connect with PKCE, written for this plugin
 * from OpenAI's published flow. The learner's browser signs in at OpenAI; the
 * plugin receives a one-time code on a loopback callback, exchanges it, and
 * verifies the signed identity before keeping anything. The access token is a
 * credential and lives where API keys live. The plugin never sees a password.
 *
 * Nothing here follows a redirect, and the issuer, token endpoint, and key
 * set must all share one origin.
 */
export const CHATGPT_ISSUER = 'https://auth.openai.com';
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1';
export const CHATGPT_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';
const REGISTRATION_CLIENT = 'dynamic_agent_client';
const CLIENT_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const PRINTABLE = /^[\x21-\x7e]{1,4096}$/;
/** Refresh this long before the access token expires. */
const REFRESH_SKEW_MS = 60_000;

export const ConnectionSchema = z.strictObject({
  version: z.literal(1),
  clientId: z.string().regex(CLIENT_ID),
  subject: z.string().min(1).max(200),
  email: z.string().max(320).optional(),
  name: z.string().max(200).optional(),
  scopes: z.array(z.string().max(100)).max(20),
  accessToken: z.string().regex(PRINTABLE),
  expiresAt: z.number().int().nonnegative(),
  refreshToken: z.string().regex(PRINTABLE).optional(),
});
export type ChatGPTConnection = z.infer<typeof ConnectionSchema>;

/** What the host supplies: a redirect-refusing transport, a way to open the system browser, and a loopback listener. */
export interface OAuthHost {
  fetch: FetchLike;
  openBrowser: (url: string) => void;
  listen: (state: string, signal: AbortSignal) => Promise<LoopbackListener>;
  subtle: SubtleCrypto;
  now: () => number;
  /** Tests point this at a loopback issuer; production uses OpenAI's. */
  issuer?: string;
}
export interface LoopbackListener { redirectUri: string; result: Promise<URLSearchParams>; close(): void }

/** Codes name what went wrong without echoing anything the issuer said. */
export type SignInCode = 'SIGNIN_DISCOVERY' | 'SIGNIN_LISTENER' | 'SIGNIN_DENIED' | 'SIGNIN_CANCELLED' | 'SIGNIN_INCOMPLETE' | 'SIGNIN_TOKEN' | 'SIGNIN_IDENTITY' | 'ACCOUNT_MISMATCH' | 'CONNECTION_EXPIRED';
export class SignInError extends Error { constructor(code: SignInCode, public readonly detail?: string) { super(code); this.name = 'SignInError'; } }

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };

const encoder = new TextEncoder();
const base64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64url = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 64 * 1024) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

async function discover(host: OAuthHost, signal: AbortSignal): Promise<Discovery> {
  const issuer = host.issuer ?? CHATGPT_ISSUER;
  let data: unknown;
  try {
    const response = await host.fetch(`${issuer}/.well-known/openid-configuration`, { method: 'GET', signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error();
    data = await readJson(response);
  } catch { throw new SignInError('SIGNIN_DISCOVERY'); }
  if (!data || typeof data !== 'object') throw new SignInError('SIGNIN_DISCOVERY');
  const record = data as Record<string, unknown>;
  if (record.issuer !== issuer) throw new SignInError('SIGNIN_DISCOVERY');
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    const value = record[key];
    if (typeof value !== 'string') throw new SignInError('SIGNIN_DISCOVERY');
    try { if (new URL(value).origin !== new URL(issuer).origin) throw new Error(); } catch { throw new SignInError('SIGNIN_DISCOVERY'); }
  }
  return record as Discovery;
}

async function tokenRequest(host: OAuthHost, discovery: Discovery, body: URLSearchParams, signal: AbortSignal): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string | null }> {
  let response: Response;
  try { response = await host.fetch(discovery.token_endpoint, { method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() }); }
  catch { throw new SignInError('SIGNIN_TOKEN', 'network'); }
  const data = await readJson(response);
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  if (!response.ok) return { ok: false, error: record && typeof record.error === 'string' ? record.error : null };
  if (!record) throw new SignInError('SIGNIN_TOKEN', 'shape');
  return { ok: true, data: record };
}

function credentialsFrom(data: Record<string, unknown>, now: number, previousScopes?: string[]): Pick<ChatGPTConnection, 'accessToken' | 'expiresAt' | 'refreshToken' | 'scopes'> {
  const scope = typeof data.scope === 'string' ? data.scope : previousScopes?.join(' ');
  if (typeof data.access_token !== 'string' || !PRINTABLE.test(data.access_token) || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' || typeof data.expires_in !== 'number' || !(data.expires_in > 0) || typeof scope !== 'string') throw new SignInError('SIGNIN_TOKEN', 'shape');
  const refreshToken = typeof data.refresh_token === 'string' && PRINTABLE.test(data.refresh_token) ? data.refresh_token : undefined;
  return { accessToken: data.access_token, expiresAt: now + Math.floor(data.expires_in * 1000), scopes: scope.split(/\s+/).filter(Boolean).slice(0, 20), ...(refreshToken ? { refreshToken } : {}) };
}

/** RS256 identity token verification with WebCrypto: signature against the issuer's published keys, then the claims that bind it to this sign-in. */
export async function verifyIdToken(idToken: string, options: { jwks: JsonWebKey[]; issuer: string; clientId: string; nonce?: string; now: number; subtle: SubtleCrypto }): Promise<{ subject: string; email?: string; name?: string }> {
  const fail = () => new SignInError('SIGNIN_IDENTITY');
  const parts = idToken.split('.');
  if (parts.length !== 3 || idToken.length > 16 * 1024) throw fail();
  let header: Record<string, unknown>; let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0]))) as Record<string, unknown>;
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as Record<string, unknown>;
  } catch { throw fail(); }
  if (header.alg !== 'RS256') throw fail();
  const candidates = options.jwks.filter(key => key.kty === 'RSA' && (key.alg === undefined || key.alg === 'RS256') && (header.kid === undefined || (key as { kid?: string }).kid === header.kid));
  if (candidates.length !== 1) throw fail();
  let verified = false;
  try {
    const key = await options.subtle.importKey('jwk', { kty: 'RSA', n: candidates[0].n, e: candidates[0].e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    verified = await options.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, fromBase64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  } catch { throw fail(); }
  if (!verified) throw fail();
  const nowSeconds = Math.floor(options.now / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== options.issuer || !audiences.includes(options.clientId) || (audiences.length > 1 && payload.azp !== options.clientId) || (payload.azp !== undefined && payload.azp !== options.clientId)) throw fail();
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || payload.exp <= nowSeconds - 5 || payload.iat > nowSeconds + 5) throw fail();
  if (options.nonce !== undefined && payload.nonce !== options.nonce) throw fail();
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 200) throw fail();
  return { subject: payload.sub, ...(typeof payload.email === 'string' && payload.email.length <= 320 ? { email: payload.email } : {}), ...(typeof payload.name === 'string' && payload.name.length <= 200 ? { name: payload.name } : {}) };
}

async function fetchJwks(host: OAuthHost, discovery: Discovery, signal: AbortSignal): Promise<JsonWebKey[]> {
  try {
    const response = await host.fetch(discovery.jwks_uri, { method: 'GET', signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error();
    const data = await readJson(response);
    const keys = data && typeof data === 'object' ? (data as { keys?: unknown }).keys : undefined;
    if (!Array.isArray(keys)) throw new Error();
    return keys.filter((key): key is JsonWebKey => !!key && typeof key === 'object');
  } catch { throw new SignInError('SIGNIN_IDENTITY', 'keys'); }
}

export async function signIn(host: OAuthHost, options: { appName: string; previous?: ChatGPTConnection; signal: AbortSignal }): Promise<ChatGPTConnection> {
  const { signal, previous } = options;
  const discovery = await discover(host, signal);
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const challenge = base64url(await host.subtle.digest('SHA-256', encoder.encode(verifier)));
  let listener: LoopbackListener;
  try { listener = await host.listen(state, signal); } catch { throw new SignInError('SIGNIN_LISTENER'); }
  try {
    const authorization = new URL(discovery.authorization_endpoint);
    authorization.search = new URLSearchParams({
      client_id: previous?.clientId ?? REGISTRATION_CLIENT, response_type: 'code', redirect_uri: listener.redirectUri, scope: CHATGPT_SCOPES, resource: CHATGPT_RESOURCE,
      state, nonce, code_challenge_method: 'S256', code_challenge: challenge,
    }).toString();
    if (!previous) authorization.searchParams.set('agent_name_hint', options.appName);
    if (previous?.email) authorization.searchParams.set('login_hint', previous.email);
    host.openBrowser(authorization.toString());
    const params = await listener.result;
    if (params.has('error')) throw new SignInError(params.get('error') === 'access_denied' ? 'SIGNIN_DENIED' : 'SIGNIN_INCOMPLETE');
    const code = params.get('code');
    const returnedClient = params.get('client_id');
    const clientId = returnedClient ?? previous?.clientId;
    if (!code || params.getAll('code').length !== 1 || !clientId || !CLIENT_ID.test(clientId) || clientId === REGISTRATION_CLIENT || (previous && returnedClient !== null && returnedClient !== previous.clientId)) throw new SignInError('SIGNIN_INCOMPLETE');
    const exchange = await tokenRequest(host, discovery, new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: listener.redirectUri, resource: CHATGPT_RESOURCE }), signal);
    if (!exchange.ok) throw new SignInError('SIGNIN_TOKEN', exchange.error ?? undefined);
    if (typeof exchange.data.id_token !== 'string') throw new SignInError('SIGNIN_IDENTITY');
    const identity = await verifyIdToken(exchange.data.id_token, { jwks: await fetchJwks(host, discovery, signal), issuer: discovery.issuer, clientId, nonce, now: host.now(), subtle: host.subtle });
    if (previous && identity.subject !== previous.subject) throw new SignInError('ACCOUNT_MISMATCH');
    const credentials = credentialsFrom(exchange.data, host.now());
    if (!credentials.refreshToken) throw new SignInError('SIGNIN_TOKEN', 'shape');
    return ConnectionSchema.parse({ version: 1, clientId, ...identity, ...credentials });
  } finally { listener.close(); }
}

export function needsRefresh(connection: Pick<ChatGPTConnection, 'expiresAt'>, now: number): boolean {
  return connection.expiresAt - now < REFRESH_SKEW_MS;
}

/** Codes the token endpoint uses when a refresh grant is no longer usable. */
const EXPIRED_GRANT = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

export async function refreshConnection(host: OAuthHost, previous: ChatGPTConnection, signal: AbortSignal): Promise<ChatGPTConnection> {
  if (!previous.refreshToken) throw new SignInError('CONNECTION_EXPIRED');
  const discovery = await discover(host, signal);
  const result = await tokenRequest(host, discovery, new URLSearchParams({ grant_type: 'refresh_token', client_id: previous.clientId, refresh_token: previous.refreshToken, resource: CHATGPT_RESOURCE }), signal);
  if (!result.ok) throw new SignInError(result.error && EXPIRED_GRANT.has(result.error) ? 'CONNECTION_EXPIRED' : 'SIGNIN_TOKEN', result.error ?? undefined);
  const credentials = credentialsFrom(result.data, host.now(), previous.scopes);
  let identity: { subject: string; email?: string; name?: string } = { subject: previous.subject, ...(previous.email ? { email: previous.email } : {}), ...(previous.name ? { name: previous.name } : {}) };
  if (result.data.id_token !== undefined) {
    if (typeof result.data.id_token !== 'string') throw new SignInError('SIGNIN_IDENTITY');
    identity = await verifyIdToken(result.data.id_token, { jwks: await fetchJwks(host, discovery, signal), issuer: discovery.issuer, clientId: previous.clientId, now: host.now(), subtle: host.subtle });
    if (identity.subject !== previous.subject) throw new SignInError('ACCOUNT_MISMATCH');
  }
  return ConnectionSchema.parse({ version: 1, clientId: previous.clientId, ...identity, ...credentials, refreshToken: credentials.refreshToken ?? previous.refreshToken });
}
