/**
 * Vendor-specific request fields go only to that vendor. Google's
 * OpenAI-compatible endpoint rejects the whole request over an unknown field
 * (`store`), so it is sent only to api.openai.com, where it turns off retention.
 */
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { LocalReviewService } from '../shared/lib/review/local-review-service';

const { source } = JSON.parse(readFileSync('tests/fixtures/valid-codazo-v1.json', 'utf8')) as { source: unknown };
const request = { schema_version: 'codazo.request/1', request_id: 'f3f6a7c0-1111-4222-8333-444455556666', revision: 0, source, level: 'A2', locale: 'es-MX' };

async function bodySentTo(baseURL: string): Promise<Record<string, unknown>> {
  let captured = '';
  const fetchImpl = (_url: string, init: RequestInit) => { captured = String(init.body); return Promise.reject(new Error('captured')); };
  const service = new LocalReviewService({ snapshot: async () => ({ baseURL, apiKey: 'DUMMY', model: 'm', maxOutputTokens: 512, timeoutMs: 5000 }) }, fetchImpl);
  await service.review(request).catch(() => {});
  return JSON.parse(captured) as Record<string, unknown>;
}

test('store: false is sent to OpenAI and to nobody else', async () => {
  expect((await bodySentTo('https://api.openai.com/v1')).store).toBe(false);
  expect(await bodySentTo('https://generativelanguage.googleapis.com/v1beta/openai')).not.toHaveProperty('store');
  expect(await bodySentTo('https://openrouter.ai/api/v1')).not.toHaveProperty('store');
});
