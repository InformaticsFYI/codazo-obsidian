/**
 * Adapter from a `requestUrl`-shaped function to `fetch`. Not used by the
 * desktop release: native `requestUrl` follows redirects and forwards the
 * bearer and body (Canvas 70), so the plugin dispatches through
 * node-transport.ts instead. Kept for tests that drive the shared service
 * with a scripted transport; a future mobile build must not reuse it without
 * a redirect policy.
 */
export type RequestUrlLike = (request: {
  url: string; method?: string; headers?: Record<string, string>; body?: string; throw?: boolean;
}) => Promise<{ status: number; headers: Record<string, string>; arrayBuffer: ArrayBuffer }>;

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

export function createRequestUrlFetch(requestUrl: RequestUrlLike): typeof fetch {
  return async (input, init) => {
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    if (init?.body !== undefined && typeof init.body !== 'string') throw new TypeError('Only string request bodies are supported');
    const result = await requestUrl({ url, method: init?.method ?? 'GET', headers, body: init?.body, throw: false });
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(result.headers ?? {})) responseHeaders.set(key, String(value));
    return new Response(NULL_BODY_STATUS.has(result.status) ? null : result.arrayBuffer, { status: result.status, headers: responseHeaders });
  };
}
