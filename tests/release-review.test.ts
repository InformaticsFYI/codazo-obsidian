/**
 * Prevention regressions for the public-release security review (Canvas 66).
 * Each test reproduces a probe from the review and asserts the safe behavior.
 */
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { LocalReviewService } from '../shared/lib/review/local-review-service';
import { parseProviderOutput } from '../shared/lib/review/provider-output';
import type { Review } from '../shared/lib/review/schema';
import { excerptNoteContent, md, reviewNoteContent, studyNoteContent } from '../src/artifacts';
import { describeError } from '../src/labels';
import { ProfileStore, profileFingerprint } from '../src/profiles';
import type { ReviewSession } from '../src/session';
import { createSecretVault, parsePluginData, profileSecretId, recordPersistence, type PluginData, type SecretStorageLike } from '../src/settings';
import { planStudyNotes } from '../src/study-notes';
import { createRequestUrlFetch, type RequestUrlLike } from '../src/transport';

const fixture = JSON.parse(readFileSync('tests/fixtures/valid-codazo-v1.json', 'utf8')) as Review;
const { source, ...feedback } = fixture;
const request = { schema_version: 'codazo.request/1', request_id: 'f3f6a7c0-1111-4222-8333-444455556666', revision: 0, source, level: 'A2', locale: 'es-MX' };
const base = { name: 'P', model: 'm', tokenLimitField: 'max_tokens', responseFormat: 'json_object', maxOutputTokens: 1024, storage: 'session', timeoutSeconds: 40 } as const;

function world() {
  let data: PluginData = parsePluginData(null);
  const secrets = new Map<string, string>();
  const storage: SecretStorageLike = { getSecret: id => secrets.get(id) ?? null, setSecret: (id, value) => { secrets.set(id, value); } };
  const store = new ProfileStore(recordPersistence('profiles', () => data, async next => { data = next; }), id => createSecretVault(storage, profileSecretId(id)), async () => true);
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const requestUrl: RequestUrlLike = async input => { calls.push(input); const body = JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ ...feedback, schema_version: 'codazo.feedback/1' }) } }] }); return { status: 200, headers: {}, arrayBuffer: new TextEncoder().encode(body).buffer as ArrayBuffer }; };
  return { store, calls, service: new LocalReviewService(store, createRequestUrlFetch(requestUrl)) };
}

test('R1: a confirmed request goes to the confirmed profile even if the active profile changed meanwhile', async () => {
  const w = world();
  await w.store.save({ id: 'a', provider: 'openai', ...base }, 'KEY-A');
  await w.store.save({ id: 'b', provider: 'custom', baseURL: 'https://openrouter.ai/api/v1', ...base }, 'KEY-B');
  await w.store.setActive('a');
  const confirmed = { id: 'a', fingerprint: profileFingerprint(w.store.get('a')!) };
  await w.store.setActive('b'); // the learner switches profiles while the dialog is open
  await w.service.review(request, undefined, w.store.bound(confirmed.id, confirmed.fingerprint));
  expect(w.calls).toHaveLength(1);
  expect(w.calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
  expect(w.calls[0]!.headers?.authorization).toBe('Bearer KEY-A');
});

test('R1: editing the confirmed profile between confirmation and dispatch refuses the request; nothing is sent', async () => {
  const w = world();
  await w.store.save({ id: 'a', provider: 'openai', ...base }, 'KEY-A');
  const confirmed = { id: 'a', fingerprint: profileFingerprint(w.store.get('a')!) };
  await w.store.save({ id: 'a', provider: 'openai', ...base, model: 'other' });
  await expect(w.service.review(request, undefined, w.store.bound(confirmed.id, confirmed.fingerprint))).rejects.toThrow('PROFILE_CHANGED');
  expect(w.calls).toHaveLength(0);
  expect(describeError(new Error('PROFILE_CHANGED'))).toContain('No se envió nada');
});

test('R3: unknown property names and free-text error messages never reach a notice', () => {
  const marker = 'PRIVATE-TEXT-MARKER-' + 'x'.repeat(4096);
  const withUnknown = { ...feedback, schema_version: 'codazo.feedback/1', [marker]: 1 };
  let detail = '';
  try { parseProviderOutput(JSON.stringify(withUnknown), source); } catch (error) { detail = (error as { detail?: string }).detail ?? ''; }
  expect(detail).toBe('schema:unknown-key');
  const nested = { ...feedback, schema_version: 'codazo.feedback/1', vocabulary: [{ ...feedback.vocabulary[0]!, [marker]: true }] };
  try { parseProviderOutput(JSON.stringify(nested), source); } catch (error) { detail = (error as { detail?: string }).detail ?? ''; }
  expect(detail).toBe('schema:vocabulary.0.unknown-key');
  expect(detail.length).toBeLessThanOrEqual(80);
  const shown = describeError(new Error('Invalid secret sk-DUMMY-KEY-MARKER for storage'));
  expect(shown).not.toContain('sk-DUMMY');
  expect(shown).toBe('Codazo no pudo completar la acción.');
  expect(describeError(new Error('SOME_FIXED_CODE'))).toBe('Codazo no pudo completar la acción.');
});

test('R4: generated prose is inert Markdown in every saved note; learner source is quoted as written', () => {
  const hostile = '![synthetic](https://example.invalid/pixel?marker=synthetic) <img src=x> [link](https://evil.invalid) `code` **bold**';
  const review: Review = { ...fixture, strengths: [{ ...fixture.strengths[0]!, text: hostile }], vocabulary: [{ ...fixture.vocabulary[0]!, meaning: hostile, examples: [hostile] }], verbs: [{ ...fixture.verbs[0]!, reason: hostile }], annotations: [{ ...fixture.annotations[0]!, explanation: hostile }] };
  const session: ReviewSession = { id: 'f3f6a7c0-1111-4222-8333-444455556666', kind: 'excerpt', excerptKind: 'phrase', notePath: 'Lecturas/Cuento.md', source: review.source, sourceHash: 'ab'.repeat(32), offset: 0, reviewedAt: '2026-09-23T13:00:00.000Z', review, generatedBy: 'Live AI feedback — OpenAI · m; AI may be wrong', provider: 'openai', model: 'm' };
  const notes = [reviewNoteContent(session, { source: '[[Cuento]]' }), studyNoteContent(session, { source: '[[Cuento]]' }), excerptNoteContent(session, { source: '[[Cuento]]' }), ...planStudyNotes(review, session, 'Codazo', '[[Cuento]]').map(p => p.content)];
  for (const note of notes) {
    const prose = note.split('```json codazo-review')[0]!; // the payload is a fenced code block and is inert by construction
    expect(prose).not.toMatch(/!\[synthetic\]\(/);
    expect(prose).not.toMatch(/(^|[^\\])<img/);
    expect(prose).not.toMatch(/\[link\]\(https/);
    expect(prose).toContain('\\!\\[synthetic\\]');
  }
  expect(md('a|b')).toBe('a\\|b');
  // The learner's own text is not escaped.
  expect(reviewNoteContent(session, { source: '[[Cuento]]' })).toContain('> ' + review.source.text);
});

test('R3 follow-up: only known codes and well-formed diagnostics are shown; code-shaped strangers are not', () => {
  expect(describeError(new Error('SYNTHETIC_PRIVATE_KEY'))).toBe('Codazo no pudo completar la acción.');
  expect(describeError(new Error('ANCHOR_NOT_FOUND'))).toContain('ANCHOR_NOT_FOUND');
  const withBadDetail = Object.assign(new Error('INVALID_OUTPUT'), { detail: 'sk-SYNTHETIC-PRIVATE-DETAIL' });
  expect(describeError(withBadDetail)).not.toContain('SYNTHETIC');
  const withGoodDetail = Object.assign(new Error('INVALID_OUTPUT'), { detail: 'schema:vocabulary.0.unknown-key' });
  expect(describeError(withGoodDetail)).toContain('(schema:vocabulary.0.unknown-key)');
  expect(describeError(Object.assign(new Error('UPSTREAM_ERROR'), { detail: 'http 401' }))).toContain('(http 401)');
});

test.each(['session', 'persistent'] as const)('N1: editing an old persistent profile into %s mode requires re-entry when encryption is unavailable', async storageMode => {
  let data: PluginData = parsePluginData(null);
  const secrets = new Map<string, string>();
  const read = vi.fn((id: string) => secrets.get(id) ?? null);
  let secure = true;
  const storage: SecretStorageLike = { getSecret: read, setSecret: (id, value) => { secrets.set(id, value); } };
  const store = new ProfileStore(recordPersistence('profiles', () => data, async next => { data = next; }), id => createSecretVault(storage, profileSecretId(id)), async () => secure);
  const old = await store.save({ id: 'legacy', provider: 'openai', ...base, storage: 'persistent' }, 'DUMMY-OLD-KEY');
  secure = false;
  read.mockClear();

  await expect(store.save({ ...old, storage: storageMode })).rejects.toThrow('KEY_REQUIRED');
  expect(read).not.toHaveBeenCalled();
  expect(store.get(old.id)?.storage).toBe('persistent');
  await expect(store.snapshot()).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');

  // Explicit replacement permits session use without recovering the old vault value.
  await store.save({ ...old, storage: 'session' }, 'DUMMY-REPLACEMENT-KEY');
  expect((await store.snapshot()).apiKey).toBe('DUMMY-REPLACEMENT-KEY');
  expect(read).not.toHaveBeenCalled();
});

test('N1: persistent mode is refused when Secret Storage stores plaintext; allowed when the canary is not visible', async () => {
  const { probeSecretEncryption } = await import('../src/settings');
  // A storage that writes plaintext into a Local-Storage-like store, as Obsidian does when the OS keychain is unavailable.
  const plaintextStore = new Map<string, string>();
  const plaintext: SecretStorageLike = { getSecret: id => { const raw = plaintextStore.get('app-secrets-encrypted'); return raw ? (JSON.parse(raw)[id] ?? null) : null; }, setSecret: (id, v) => { const raw = plaintextStore.get('app-secrets-encrypted'); const obj = raw ? JSON.parse(raw) : {}; obj[id] = v; plaintextStore.set('app-secrets-encrypted', JSON.stringify(obj)); } };
  const asStore = (m: Map<string, string>) => ({ get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null });
  expect(probeSecretEncryption(plaintext, asStore(plaintextStore))).toBe(false);
  // Encrypted: what lands in the store is not the token.
  const encStore = new Map<string, string>(); const values = new Map<string, string>();
  const encrypted: SecretStorageLike = { getSecret: id => values.get(id) ?? null, setSecret: (id, v) => { values.set(id, v); encStore.set('app-secrets-encrypted', Buffer.from(JSON.stringify([...values])).toString('base64')); } };
  expect(probeSecretEncryption(encrypted, asStore(encStore))).toBe(true);
  // No inspectable store → not established → refused.
  expect(probeSecretEncryption(encrypted, undefined)).toBe(false);
  // The canary does not linger as a usable secret.
  expect(values.get('codazo-provider-key-canary')).toBe('');
  // Through the vault and store: a persistent save is refused with the plaintext storage, and an already-persisted key is not read while encryption is off.
  let data: PluginData = parsePluginData(null);
  const secure = { on: true };
  const store = new ProfileStore(recordPersistence('profiles', () => data, async next => { data = next; }), id => createSecretVault(encrypted, profileSecretId(id), asStore(encStore)), async () => secure.on);
  await store.save({ id: 'a', provider: 'openai', ...base, storage: 'persistent' }, 'KEY-A');
  expect((await store.snapshot()).apiKey).toBe('KEY-A');
  secure.on = false; // encryption became unavailable (e.g. keychain locked/missing) after the key was persisted
  await expect(store.snapshot()).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');
  expect(await store.hasKey('a')).toBe(false);
  await expect(store.save({ id: 'b', provider: 'openai', ...base, storage: 'persistent' }, 'KEY-B')).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE');
  expect(JSON.stringify([...encStore.values()])).not.toContain('KEY-B');
});
