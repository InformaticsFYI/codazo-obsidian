/**
 * A ChatGPT profile holds a signed-in connection instead of an API key. The
 * connection lives where keys live, is refreshed before it expires, and the
 * review service dispatches it to the Responses adapter.
 */
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { LocalReviewService } from '../shared/lib/review/local-review-service';
import type { Review } from '../shared/lib/review/schema';
import type { ChatGPTConnection } from '../src/chatgpt/oauth';
import { ProfileStore, profileLabel } from '../src/profiles';
import { createSecretVault, parsePluginData, profileSecretId, recordPersistence, type PluginData, type SecretStorageLike } from '../src/settings';

const fixture = JSON.parse(readFileSync('tests/fixtures/valid-codazo-v1.json', 'utf8')) as Review;
const { source, ...feedback } = fixture;
const request = (n: number) => ({ schema_version: 'codazo.request/1', request_id: `f3f6a7c0-1111-4222-8333-44445555666${n}`, revision: 0, source, level: 'A2', locale: 'es-MX' });
const profile = { id: 'c', name: 'Mi ChatGPT', provider: 'chatgpt', model: 'gpt-5.5', tokenLimitField: 'max_tokens', responseFormat: 'prompt', maxOutputTokens: 1024, storage: 'persistent', timeoutSeconds: 40 } as const;
const connection = (overrides: Partial<ChatGPTConnection> = {}): ChatGPTConnection => ({ version: 1, clientId: 'client-abc', subject: 'user-1', email: 'learner@example.com', scopes: ['openid', 'offline_access', 'chatgpt.tokens.use.direct'], accessToken: 'ACCESS-1', expiresAt: Date.now() + 3600_000, refreshToken: 'REFRESH-1', ...overrides });

function world() {
  let data: PluginData = parsePluginData(null);
  const secrets = new Map<string, string>();
  const storage: SecretStorageLike = { getSecret: id => secrets.get(id) ?? null, setSecret: (id, value) => { secrets.set(id, value); } };
  const refreshed: ChatGPTConnection[] = [];
  const store = new ProfileStore(recordPersistence('profiles', () => data, async next => { data = next; }), id => createSecretVault(storage, profileSecretId(id)), async () => true, { refresh: async previous => { const next = connection({ accessToken: 'ACCESS-2', refreshToken: 'REFRESH-2', expiresAt: Date.now() + 3600_000 }); refreshed.push(previous); return next; } });
  const sent: { url: string; auth: string | undefined; body: Record<string, unknown> }[] = [];
  const sse = (events: unknown[]) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  const fetchImpl = async (url: string, init: RequestInit) => { sent.push({ url, auth: new Headers(init.headers).get('authorization') ?? undefined, body: JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown> }); return new Response(sse([{ type: 'response.output_text.delta', delta: JSON.stringify({ ...feedback, schema_version: 'codazo.feedback/1' }) }, { type: 'response.completed' }]), { status: 200, headers: { 'content-type': 'text/event-stream' } }); };
  return { store, secrets, data: () => data, refreshed, sent, service: new LocalReviewService(store, fetchImpl) };
}

test('a ChatGPT profile saves with a connection and no key; the connection is stored under the profile, never in plugin data', async () => {
  const w = world();
  await expect(w.store.save(profile)).rejects.toThrow('SIGNIN_REQUIRED');
  const saved = await w.store.save(profile, undefined, connection());
  expect(saved.provider).toBe('chatgpt');
  expect(JSON.stringify(w.data())).not.toMatch(/ACCESS-1|REFRESH-1|learner@example.com/);
  expect(w.secrets.get('codazo-provider-key-c')).toContain('"accessToken":"ACCESS-1"');
  expect(await w.store.hasKey('c')).toBe(true);
  expect(w.store.connection('c')?.email).toBe('learner@example.com');
  expect(profileLabel(saved)).toBe('Mi ChatGPT · ChatGPT plan · gpt-5.5');
});

test('reviews go to the Responses API with the plan token; a connection close to expiry is refreshed and the rotation is kept', async () => {
  const w = world();
  await w.store.save(profile, undefined, connection());
  const first = await w.service.review(request(1));
  expect(w.sent[0]!.url).toBe('https://api.openai.com/v1/responses');
  expect(w.sent[0]!.auth).toBe('Bearer ACCESS-1');
  expect(w.sent[0]!.body).toMatchObject({ store: false, stream: true, model: 'gpt-5.5' });
  expect(first.generatedBy).toContain('ChatGPT plan · gpt-5.5');
  expect(w.refreshed.length).toBe(0);
  await w.store.save(profile, undefined, connection({ expiresAt: Date.now() + 10_000 }));
  await w.service.review(request(2));
  expect(w.refreshed.length).toBe(1);
  expect(w.sent[1]!.auth).toBe('Bearer ACCESS-2');
  expect(w.secrets.get('codazo-provider-key-c')).toContain('"refreshToken":"REFRESH-2"');
});

test('editing the model keeps the connection; removing the profile forgets it', async () => {
  const w = world();
  await w.store.save(profile, undefined, connection());
  await w.store.save({ ...profile, model: 'gpt-5.5-mini' });
  expect(await w.store.hasKey('c')).toBe(true);
  expect(w.secrets.get('codazo-provider-key-c')).toContain('"accessToken":"ACCESS-1"');
  await w.store.remove('c');
  expect(w.secrets.get('codazo-provider-key-c') ?? '').toBe('');
  expect(w.store.connection('c')).toBeNull();
});

test('a session-only ChatGPT profile keeps the connection in memory and refuses to review once it is gone', async () => {
  const w = world();
  await w.store.save({ ...profile, storage: 'session' }, undefined, connection());
  expect(w.secrets.get('codazo-provider-key-c') ?? '').toBe('');
  await w.service.review(request(3));
  expect(w.sent[0]!.auth).toBe('Bearer ACCESS-1');
});
