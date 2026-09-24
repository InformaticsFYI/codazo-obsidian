import { z } from 'zod';
import { SourceSchema } from '../review/schema';
import { LIMITS } from '../review/limits';
import type { createDeadline } from './deadline';
import { parseStrictJson } from './strict-json';

export class InputError extends Error {
  constructor(public readonly status: 400 | 413 | 415, public readonly code: 'INVALID_REQUEST' | 'REQUEST_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE') { super(code); }
}
export async function readBoundedJson(request: Request, deadline: ReturnType<typeof createDeadline>, maxBytes: number = LIMITS.requestBytes): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') ||
      !['identity', null].includes(request.headers.get('content-encoding'))) throw new InputError(415, 'UNSUPPORTED_MEDIA_TYPE');
  const length = request.headers.get('content-length');
  if (length !== null && !/^\d+$/.test(length)) throw new InputError(400, 'INVALID_REQUEST');
  if (length !== null && Number(length) > maxBytes) throw new InputError(413, 'REQUEST_TOO_LARGE');
  if (!request.body) throw new InputError(400, 'INVALID_REQUEST');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  let done = false;
  try {
    while (true) {
      const chunk = await deadline.wait(() => reader.read());
      if (chunk.done) { done = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new InputError(413, 'REQUEST_TOO_LARGE');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return parseStrictJson(text);
  } finally {
    if (!done) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Transport envelope only; all review/source semantics live in the shared contract. */
export const ReviewRequestSchema = z.strictObject({
  schema_version: z.literal('codazo.request/1'),
  request_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  source: SourceSchema,
  level: z.enum(['beginner', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
  locale: z.literal('es-MX'),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
