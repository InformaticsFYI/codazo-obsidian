import { SignInError, type LoopbackListener } from './oauth';

/**
 * The sign-in callback: a one-shot HTTP listener on 127.0.0.1 (never another
 * interface) that accepts a single GET to the callback path carrying the
 * expected state, answers with a short page telling the learner to return to
 * Obsidian, and hands the query back. Anything else is answered and ignored.
 * Desktop only: it needs Node's http module from the host.
 */
type NodeRequire = (id: string) => unknown;
type NodeIncoming = { method?: string; url?: string; headers: Record<string, string | string[] | undefined> };
type NodeOutgoing = { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void };
type NodeServer = { listen(options: { port: number; host: string }, cb: () => void): void; address(): { port: number } | string | null; close(): void; closeAllConnections?(): void; on(event: 'error', cb: (error: Error) => void): void; requestTimeout?: number; headersTimeout?: number };
type NodeHttp = { createServer(handler: (req: NodeIncoming, res: NodeOutgoing) => void): NodeServer };

const CALLBACK_PATH = '/auth/callback';
const PAGE = '<!doctype html><html lang="es"><meta charset="utf-8"><title>Codazo</title><style>body{font:17px system-ui;max-width:32rem;margin:18vh auto;padding:24px}</style><h1>Vuelve a Obsidian</h1><p>Codazo terminará de conectar tu cuenta de ChatGPT. Puedes cerrar esta pestaña.</p></html>';

export function createLoopbackListener(requireFn: NodeRequire | null): (state: string, signal: AbortSignal) => Promise<LoopbackListener> {
  return async (state, signal) => {
    if (!requireFn) throw new SignInError('SIGNIN_LISTENER');
    let http: NodeHttp;
    try { http = requireFn('http') as NodeHttp; } catch { throw new SignInError('SIGNIN_LISTENER'); }
    let settle: (params: URLSearchParams) => void = () => {};
    let fail: (error: Error) => void = () => {};
    let settled = false;
    const result = new Promise<URLSearchParams>((resolve, reject) => { settle = resolve; fail = reject; });
    void result.catch(() => {});
    let port = 0;
    const server = http.createServer((req, res) => {
      const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" };
      let url: URL;
      try { url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`); } catch { res.writeHead(400, headers); res.end('Invalid request'); return; }
      if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}` || url.pathname !== CALLBACK_PATH || settled) { res.writeHead(404, headers); res.end('Not found'); return; }
      if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) { res.writeHead(400, headers); res.end('Invalid sign-in state. Return to the browser tab that started sign-in.'); return; }
      settled = true;
      res.writeHead(200, headers); res.end(PAGE);
      settle(url.searchParams);
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    const close = () => { signal.removeEventListener('abort', abort); server.close(); server.closeAllConnections?.(); };
    const abort = () => { if (!settled) { settled = true; fail(new SignInError('SIGNIN_CANCELLED')); } close(); };
    await new Promise<void>((resolve, reject) => {
      server.on('error', error => { if (!settled) { settled = true; fail(new SignInError('SIGNIN_LISTENER')); } reject(error); });
      server.listen({ port: 0, host: '127.0.0.1' }, () => { const address = server.address(); if (address && typeof address !== 'string') port = address.port; resolve(); });
    }).catch(() => { throw new SignInError('SIGNIN_LISTENER'); });
    if (signal.aborted) { abort(); throw new SignInError('SIGNIN_CANCELLED'); }
    signal.addEventListener('abort', abort, { once: true });
    return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, result, close };
  };
}
