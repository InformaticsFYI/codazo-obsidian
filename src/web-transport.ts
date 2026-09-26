/**
 * Mobile transport: the app webview's own fetch, with redirects refused.
 *
 * Obsidian on iPad and iPhone has no Node http client. Obsidian's `requestUrl`
 * is not used because it follows redirects and forwards the key and body to
 * the new address (release review R2). The Fetch standard's `redirect: 'error'`
 * makes a 3xx answer a network error instead, so the key and text can only
 * reach the destination the learner confirmed. The cost is that the webview
 * enforces cross-origin rules: a server that does not allow requests from the
 * Obsidian app fails with a network error, which is reported, never worked
 * around.
 *
 * The safety options are set here, after the caller's, so no caller can
 * loosen them. Cookies and the referrer are never sent.
 */
type HostFetch = (input: string, init: RequestInit) => Promise<Response>;

export function createWebFetch(host: { fetch?: unknown } | undefined): HostFetch | null {
  const hostFetch = host?.fetch;
  if (typeof hostFetch !== 'function') return null;
  const call = hostFetch.bind(host) as HostFetch;
  return (input, init) => call(input, { ...init, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors' });
}
