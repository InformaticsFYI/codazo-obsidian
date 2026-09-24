import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { LocalReviewService } from '../shared/lib/review/local-review-service';
import { createOpenAICompatibleProvider, isPrivateHost } from '../shared/lib/review/openai-compatible';
import type { Review } from '../shared/lib/review/schema';
import { ProfileStore, profileLabel, validateCustomURL } from '../src/profiles';
import { createSecretVault, migrateLegacyProvider, parsePluginData, profileSecretId, recordPersistence, type PluginData, type SecretStorageLike } from '../src/settings';
import { createRequestUrlFetch, type RequestUrlLike } from '../src/transport';

/** Configuration-only assertions never reach the transport. */
const unusedFetch = () => Promise.reject(new Error('unused'));

const fixture = JSON.parse(readFileSync('tests/fixtures/valid-codazo-v1.json', 'utf8')) as Review;
const { source, ...feedback } = fixture;
const request = { schema_version: 'codazo.request/1', request_id: 'f3f6a7c0-1111-4222-8333-444455556666', revision: 0, source, level: 'A2', locale: 'es-MX' };
const base = { name: 'Mine', model: 'm', tokenLimitField: 'max_tokens', responseFormat: 'json_object', maxOutputTokens: 1024, storage: 'persistent' } as const;

function world(secure = true) {
  let data: PluginData = parsePluginData(null);
  const secrets = new Map<string, string>();
  const storage: SecretStorageLike | undefined = secure ? { getSecret: id => secrets.get(id) ?? null, setSecret: (id, value) => { secrets.set(id, value); } } : undefined;
  const store = new ProfileStore(recordPersistence('profiles', () => data, async next => { data = next; }), id => createSecretVault(storage, profileSecretId(id)), async () => storage !== undefined);
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const requestUrl: RequestUrlLike = async input => { calls.push(input); const body = JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ ...feedback, schema_version: 'codazo.feedback/1' }) } }] }); return { status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(body).buffer as ArrayBuffer }; };
  return { store, secrets, data: () => data, calls, service: new LocalReviewService(store, createRequestUrlFetch(requestUrl)) };
}

test('several profiles, one active; keys live per profile in Secret Storage, never in plugin data', async () => {
  const w = world();
  await w.store.save({ id: 'a', provider: 'openai', ...base }, 'KEY-A');
  await w.store.save({ id: 'b', provider: 'custom', baseURL: 'https://openrouter.ai/api/v1', ...base, name: 'OpenRouter' }, 'KEY-B');
  expect(w.store.active()?.id).toBe('a');
  expect(JSON.stringify(w.data())).not.toMatch(/KEY-[AB]/);
  expect(w.secrets.get('codazo-provider-key-b')).toContain('"destination":"https://openrouter.ai/api/v1"');
  await w.store.setActive('b');
  const result = await w.service.review(request);
  expect(w.calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(w.calls[0]!.headers?.authorization).toBe('Bearer KEY-B');
  expect(result.generatedBy).toContain('openrouter.ai · m');
  expect(profileLabel(w.store.get('b')!)).toBe('OpenRouter · openrouter.ai · m');
  expect(profileLabel({ name: 'OpenAI', provider: 'openai', model: 'gpt-5.6-terra' })).toBe('OpenAI · gpt-5.6-terra');
  expect(profileLabel({ name: 'Work', provider: 'openai', model: 'm' })).toBe('Work · OpenAI · m');
  const reloaded = new ProfileStore(recordPersistence('profiles', w.data, async () => {}), id => createSecretVault({ getSecret: id => w.secrets.get(id) ?? null, setSecret: () => {} }, profileSecretId(id)), async () => true);
  await reloaded.load();
  expect(reloaded.active()?.id).toBe('b');
  expect((await reloaded.snapshot()).apiKey).toBe('KEY-B');
  await w.store.remove('b');
  expect(w.store.active()).toBeNull();
  expect(w.secrets.get('codazo-provider-key-b')).toBe('');
});

test('custom URLs: https anywhere, http only for loopback or private hosts, nothing else', () => {
  expect(validateCustomURL('https://openrouter.ai/api/v1')).toBeNull();
  expect(validateCustomURL('http://localhost:11434/v1')).toBeNull();
  expect(validateCustomURL('http://192.168.1.20:8080/v1')).toBeNull();
  expect(validateCustomURL('http://mymac.local:11434/v1')).toBeNull();
  expect(validateCustomURL('http://ollama.home.local/v1')).toBeNull();
  expect(validateCustomURL('http://evil.local.example.com/v1')).toBe('HTTPS_REQUIRED');
  expect(validateCustomURL('http://openrouter.ai/api/v1')).toBe('HTTPS_REQUIRED');
  expect(validateCustomURL('https://user:pw@host/v1')).toBe('INVALID_BASE_URL');
  expect(validateCustomURL('https://host/v1?x=1')).toBe('INVALID_BASE_URL');
  expect(validateCustomURL('ftp://host/v1')).toBe('INVALID_BASE_URL');
  expect(validateCustomURL('not a url')).toBe('INVALID_BASE_URL');
  expect(isPrivateHost('172.31.0.1')).toBe(true);
  expect(isPrivateHost('172.32.0.1')).toBe(false);
  expect(isPrivateHost('8.8.8.8')).toBe(false);
});

test('the shared provider refuses http unless the local target opts in for a private host', () => {
  const config = { apiKey: 'k', model: 'm', maxOutputTokens: 256, timeoutMs: 1000 };
  expect(() => createOpenAICompatibleProvider({ ...config, baseURL: 'http://localhost:11434/v1' }, unusedFetch)).toThrow('INVALID_CONFIG');
  expect(() => createOpenAICompatibleProvider({ ...config, baseURL: 'http://localhost:11434/v1', allowPrivateHttp: true }, unusedFetch)).not.toThrow();
  expect(() => createOpenAICompatibleProvider({ ...config, baseURL: 'http://example.com/v1', allowPrivateHttp: true }, unusedFetch)).toThrow('INVALID_CONFIG');
});

test('a custom profile with a bad URL or a persistent key without Secret Storage is refused', async () => {
  const w = world();
  await expect(w.store.save({ id: 'c', provider: 'custom', baseURL: 'http://openrouter.ai/api/v1', ...base }, 'K')).rejects.toThrow('HTTPS_REQUIRED');
  await expect(w.store.save({ id: 'c', provider: 'custom', ...base }, 'K')).rejects.toThrow('INVALID_BASE_URL');
  await expect(w.store.save({ id: 'c', provider: 'openai', ...base }, undefined)).rejects.toThrow('KEY_REQUIRED');
  const insecure = world(false);
  await expect(insecure.store.save({ id: 'd', provider: 'openai', ...base }, 'K')).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');
  await insecure.store.save({ id: 'd', provider: 'openai', ...base, storage: 'session' }, 'K');
  expect((await insecure.store.snapshot()).apiKey).toBe('K');
  expect(insecure.data().profiles).not.toContain('K');
});

test('changing a profile destination requires a new key; same destination keeps it', async () => {
  const w = world();
  await w.store.save({ id: 'a', provider: 'openai', ...base }, 'KEY-A');
  await w.store.save({ id: 'a', provider: 'openai', ...base, model: 'other' });
  expect((await w.store.snapshot()).model).toBe('other');
  await expect(w.store.save({ id: 'a', provider: 'ollama', ...base })).rejects.toThrow('KEY_REQUIRED');
});

test('the single provider of earlier builds migrates into a default profile with its secret', () => {
  const legacy = JSON.stringify({ version: 1, configuration: { provider: 'ollama', model: 'gpt-oss:120b', tokenLimitField: 'max_tokens', responseFormat: 'prompt', maxOutputTokens: 2048, storage: 'persistent' } });
  const migrated = migrateLegacyProvider(legacy, '{"version":1,"destination":"https://ollama.com/v1","apiKey":"OLD"}');
  expect(migrated?.secret).toContain('OLD');
  expect(JSON.parse(migrated!.profiles)).toEqual({ version: 1, active: 'default', profiles: [{ id: 'default', name: 'Ollama Cloud', provider: 'ollama', model: 'gpt-oss:120b', tokenLimitField: 'max_tokens', responseFormat: 'prompt', maxOutputTokens: 2048, storage: 'persistent' }] });
  expect(migrateLegacyProvider(null, null)).toBeNull();
  expect(migrateLegacyProvider('garbage', null)).toBeNull();
  expect(parsePluginData({ version: 1, artifactFolder: 'Codazo', level: 'A2', provider: null, storageDisclosureSeen: false, autoSaveReviews: false }).profiles).toBeNull();
});

test('a profile may raise the provider timeout up to five minutes; stored profiles without one keep the default', async () => {
  const w = world();
  await w.store.save({ id: 'a', provider: 'openai', ...base, timeoutSeconds: 180 }, 'K');
  expect((await w.store.snapshot()).timeoutMs).toBe(180_000);
  await expect(w.store.save({ id: 'a', provider: 'openai', ...base, timeoutSeconds: 600 })).rejects.toThrow('INVALID_PROFILE');
  await w.store.save({ id: 'b', provider: 'openai', ...base }, 'K');
  expect(w.store.get('b')?.timeoutSeconds).toBe(40);
  expect(() => createOpenAICompatibleProvider({ baseURL: 'https://api.openai.com/v1', apiKey: 'k', model: 'm', maxOutputTokens: 256, timeoutMs: 300_000 }, unusedFetch)).not.toThrow();
  expect(() => createOpenAICompatibleProvider({ baseURL: 'https://api.openai.com/v1', apiKey: 'k', model: 'm', maxOutputTokens: 256, timeoutMs: 300_001 }, unusedFetch)).toThrow('INVALID_CONFIG');
});
