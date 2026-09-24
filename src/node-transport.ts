/**
 * Desktop transport: Node's http/https client, which Obsidian desktop exposes
 * to plugins. Unlike `requestUrl`, it never follows a redirect on its own, so
 * a 3xx answer is returned to the provider adapter as a failed response and
 * the key and body are never forwarded to an unapproved destination. It is
 * also free of webview CORS, so every OpenAI-compatible endpoint works.
 *
 * The modules are resolved at runtime through the host's `require` so the
 * browser-platform bundle stays free of static Node imports; without it (not
 * desktop) the transport refuses instead of falling back to something weaker.
 */
type NodeRequire = (id: string) => unknown;
type NodeHttpModule = { request: (url: URL, options: { method: string; headers: Record<string, string> }, callback: (res: NodeIncoming) => void) => NodeOutgoing };
type NodeIncoming = { statusCode?: number; headers: Record<string, string | string[] | undefined>; on(event: 'data', cb: (chunk: Uint8Array) => void): void; on(event: 'end', cb: () => void): void; on(event: 'error', cb: (error: Error) => void): void };
type NodeOutgoing = { on(event: 'error', cb: (error: Error) => void): void; end(body?: string): void; destroy(error?: Error): void };

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

export function hostRequire(): NodeRequire | null {
  // Obsidian desktop exposes Node's require on the window; use the window rather than globalThis so popout windows resolve the same host.
  const candidate = typeof window === 'undefined' ? undefined : (window as Window & { require?: unknown }).require;
  return typeof candidate === 'function' ? (candidate as NodeRequire) : null;
}

export function createNodeFetch(requireFn: NodeRequire | null = hostRequire()): typeof fetch | null {
  if (!requireFn) return null;
  let http: NodeHttpModule, https: NodeHttpModule;
  try { http = requireFn('http') as NodeHttpModule; https = requireFn('https') as NodeHttpModule; } catch { return null; }
  if (typeof http?.request !== 'function' || typeof https?.request !== 'function') return null;
  return (input, init) => new Promise<Response>((resolve, reject) => {
    const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
    if (init?.signal?.aborted) { reject(abortError()); return; }
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') { reject(new TypeError('Unsupported protocol')); return; }
    if (init?.body !== undefined && typeof init.body !== 'string') { reject(new TypeError('Only string request bodies are supported')); return; }
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method: init?.method ?? 'GET', headers }, res => {
      const chunks: Uint8Array[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
        const total = chunks.reduce((n, c) => n + c.byteLength, 0);
        const body = new Uint8Array(total); let offset = 0; for (const c of chunks) { body.set(c, offset); offset += c.byteLength; }
        // Redirects are not followed: a 3xx comes back as-is and the provider adapter treats it as an upstream failure.
        resolve(new Response(NULL_BODY_STATUS.has(status) || status < 200 ? null : body, { status: status >= 200 && status <= 599 ? status : 502, headers: responseHeaders }));
      });
    });
    req.on('error', error => reject(init?.signal?.aborted ? abortError() : error));
    init?.signal?.addEventListener('abort', () => req.destroy(abortError()), { once: true });
    req.end(init?.body);
  });
}
