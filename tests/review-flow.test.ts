import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { LocalReviewService } from '../shared/lib/review/local-review-service';
import { LocalSettingsStore } from '../shared/lib/settings/local-settings-store';
import { createRequestUrlFetch, type RequestUrlLike } from '../src/transport';
import { SECRET_ID, createSecretVault, parsePluginData, providerRecordPersistence, type PluginData, type SecretStorageLike } from '../src/settings';
import type { Review } from '../shared/lib/review/schema';
import { STUDY_ADDENDUM, STUDY_POLICY } from '../src/study-policy';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/valid-codazo-v1.json', import.meta.url), 'utf8')) as Review;
const { source, ...feedback } = fixture;
const request = { schema_version: 'codazo.request/1', request_id: 'f3f6a7c0-1111-4222-8333-444455556666', revision: 0, source, level: 'A2', locale: 'es-MX' };
const config = { provider: 'openai', model: 'synthetic-model', maxOutputTokens: 4096, tokenLimitField: 'max_completion_tokens', responseFormat: 'json_object', storage: 'persistent', apiKey: 'SYNTHETIC-KEY' } as const;

function fakeObsidian() {
  let data: PluginData = parsePluginData(null);
  const secrets = new Map<string, string>();
  const storage: SecretStorageLike = { getSecret: id => secrets.get(id) ?? null, setSecret: (id, value) => { secrets.set(id, value); } };
  const calls: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = [];
  const requestUrl: RequestUrlLike = async input => {
    calls.push(input);
    const body = JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ ...feedback, schema_version: 'codazo.feedback/1' }) } }] });
    return { status: 200, headers: { 'content-type': 'application/json' }, arrayBuffer: new TextEncoder().encode(body).buffer as ArrayBuffer };
  };
  // The fake Secret Storage keeps values off to the side, so an (empty) Local-Storage-like store proves the canary is not stored in plaintext.
  const webStore = { length: 0, key: () => null, getItem: () => null };
  const persistence = providerRecordPersistence(() => data, async next => { data = next; });
  const store = new LocalSettingsStore(persistence, createSecretVault(storage, undefined, webStore));
  return { store, service: new LocalReviewService(store, createRequestUrlFetch(requestUrl)), calls, data: () => data, secrets };
}

test('nothing is sent on load or configuration; exactly one call carries only the source, intent, prompt, and provider metadata', async () => {
  const world = fakeObsidian();
  await world.store.save(config);
  expect(world.calls).toHaveLength(0);
  const result = await world.service.review(request);
  expect(result.review).toEqual(fixture);
  expect(result.generatedBy).toContain('OpenAI · synthetic-model');
  expect(world.calls).toHaveLength(1);
  const call = world.calls[0]!;
  expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
  expect(call.method).toBe('POST');
  expect(call.headers?.authorization).toBe('Bearer SYNTHETIC-KEY');
  const body = JSON.parse(call.body!);
  expect(body.stream).toBe(false);
  expect(body.store).toBe(false);
  expect(JSON.parse(body.messages[1].content)).toEqual({ preferences: { level: 'A2', locale: 'es-MX' }, source });
  expect(call.body).not.toMatch(/Diario|\.md|vault/i);
});

test('the key lives only in Secret Storage; plugin data holds the non-secret record and forgets it on clear', async () => {
  const world = fakeObsidian();
  await world.store.save(config);
  expect(JSON.stringify(world.data())).not.toContain('SYNTHETIC-KEY');
  expect(world.data().provider).toContain('"provider":"openai"');
  expect(world.secrets.get('codazo-provider-key')).toContain('SYNTHETIC-KEY');
  await world.store.clear();
  expect(world.data().provider).toBeNull();
  expect(world.secrets.get('codazo-provider-key')).toBe('');
  expect(await createSecretVault({ getSecret: () => '', setSecret: () => {} }).read()).toBeNull();
});

test('without Secret Storage the key stays session-only and persistent mode fails closed', async () => {
  let data: PluginData = parsePluginData({ version: 1, artifactFolder: 'Codazo', level: 'B1', provider: null, storageDisclosureSeen: true });
  const store = new LocalSettingsStore(providerRecordPersistence(() => data, async next => { data = next; }), createSecretVault(undefined));
  await expect(store.save(config)).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');
  await store.save({ ...config, storage: 'session' });
  expect((await store.view()).secureStorageAvailable).toBe(false);
  expect(data.provider).toBeNull();
  expect((await store.snapshot()).apiKey).toBe('SYNTHETIC-KEY');
});

test('damaged plugin data falls back to defaults rather than guessing', () => {
  expect(parsePluginData({ version: 2 })).toEqual(parsePluginData(null));
  expect(parsePluginData({ version: 1, artifactFolder: 'Notas', level: 'C1', provider: null, storageDisclosureSeen: false, extra: 1 })).toEqual(parsePluginData(null));
  expect(parsePluginData(null).artifactFolder).toBe('Codazo');
  // Data written before the auto-save toggle existed still loads.
  expect(parsePluginData({ version: 1, artifactFolder: 'Notas', level: 'C1', provider: null, storageDisclosureSeen: true }).autoSaveReviews).toBe(false);
  expect(parsePluginData({ version: 1, artifactFolder: 'Notas', level: 'C1', provider: null, storageDisclosureSeen: true }).level).toBe('C1');
});

test('a provider failure surfaces as an error, is never retried, and an aborted signal never reaches requestUrl', async () => {
  let attempts = 0;
  const failing: RequestUrlLike = async () => { attempts++; return { status: 500, headers: {}, arrayBuffer: new ArrayBuffer(0) }; };
  const store = { snapshot: async () => ({ baseURL: 'https://api.openai.com/v1', apiKey: 'SYNTHETIC-KEY', model: 'm', maxOutputTokens: 512, timeoutMs: 5000 }) };
  await expect(new LocalReviewService(store, createRequestUrlFetch(failing)).review(request)).rejects.toThrow('UPSTREAM_ERROR');
  expect(attempts).toBe(1);
  const controller = new AbortController(); controller.abort();
  await expect(createRequestUrlFetch(failing)('https://example.invalid', { signal: controller.signal })).rejects.toThrow('aborted');
  expect(attempts).toBe(1);
});

test('the secret ID satisfies Obsidian Secret Storage rules: lowercase alphanumeric with dashes only', () => {
  expect(SECRET_ID).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  const storage: SecretStorageLike = { getSecret: () => null, setSecret: id => { if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid secret ID'); } };
  return expect(createSecretVault(storage).write('x')).resolves.toBeUndefined();
});

test('study mode sends the same contract with the study addendum and accepts an empty-observation response', async () => {
  const world = fakeObsidian();
  await world.store.save(config);
  const result = await world.service.review(request, STUDY_POLICY);
  expect(result.review.annotations).toEqual(fixture.annotations);
  const system = JSON.parse(world.calls[0]!.body!).messages[0].content as string;
  expect(system).toContain(STUDY_ADDENDUM);
  expect(system).toContain('Feedback JSON schema');
  expect(STUDY_POLICY.schema).toBe('codazo.review/1');
});

test('provider failures name a diagnostic category without model or learner text', async () => {
  const store = { snapshot: async () => ({ baseURL: 'https://api.openai.com/v1', apiKey: 'SYNTHETIC-KEY', model: 'm', maxOutputTokens: 512, timeoutMs: 5000 }) };
  const respond = (status: number, body: string): RequestUrlLike => async () => ({ status, headers: {}, arrayBuffer: new TextEncoder().encode(body).buffer as ArrayBuffer });
  const envelope = (content: string) => JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  const run = (impl: RequestUrlLike) => new LocalReviewService(store, createRequestUrlFetch(impl)).review(request).catch((e: unknown) => e);
  const { describeError } = await import('../src/labels');
  expect(describeError(await run(respond(401, '{}')))).toContain('(http 401)');
  expect(describeError(await run(respond(200, '{"nope":1}')))).toContain('(envelope:choices)');
  expect(describeError(await run(respond(200, envelope('SECRET LEARNER PROSE {not json'))))).toMatch(/\(not_json\)$/);
  expect(describeError(await run(respond(200, envelope(JSON.stringify({ ...feedback, schema_version: 'codazo.feedback/1', annotations: [{ ...feedback.annotations[0], anchor: { quote: 'zzz', occurrence: 1 } }] })))))).toContain('(contract:ANCHOR_NOT_FOUND)');
  expect(describeError(await run(respond(200, envelope(JSON.stringify({ ...feedback, schema_version: 'codazo.feedback/1', extra: 1 })))))).toContain('(schema:unknown-key)');
  for (const text of [describeError(await run(respond(200, envelope('SECRET LEARNER PROSE {not json'))))]) expect(text).not.toContain('SECRET');
});

test('a union failure inside an annotation names the offending field', async () => {
  const { parseProviderOutput } = await import('../shared/lib/review/provider-output');
  const bad = { ...feedback, schema_version: 'codazo.feedback/1', annotations: [feedback.annotations[0], feedback.annotations[1], { ...feedback.annotations[2], suggestion: { ...feedback.annotations[2]!.suggestion, kind: 'optional_alternative' } }] };
  expect(() => parseProviderOutput(JSON.stringify(bad), source)).toThrow(expect.objectContaining({ detail: expect.stringMatching(/^schema:annotations\.2\.(suggestion\.kind|category)$/) }));
});
