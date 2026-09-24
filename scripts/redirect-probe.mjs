// Native redirect probe for the Obsidian plugin (release review R2 / F3).
// Two loopback-only HTTP servers with no real credentials: A answers every
// request with a 307 redirect to B; B records whether an Authorization header
// or a request body arrived. In Obsidian desktop, create a custom profile with
// base URL http://127.0.0.1:4311/v1, key "PROBE-DUMMY", any model, and run a
// review on synthetic text. Watch this process's output.
//
//   node scripts/obsidian-redirect-probe.mjs
//
// Outcomes to record (A-hit / B-hit / plugin result):
//   A hit, B hit with DUMMY BEARER FORWARDED  -> requestUrl follows redirects and forwards credentials; custom endpoints are trusted-only.
//   A hit, B not hit, plugin shows an error   -> redirects are not followed.
//   A not hit                                 -> the probe was not reached; inconclusive, check the profile URL.
// Only one hop across loopback ports is exercised; cross-host and HTTPS-downgrade behavior are separate cases.
import console from 'node:console';
import { createServer } from 'node:http';
import process from 'node:process';

const HOST = '127.0.0.1', A = 4311, B = 4312;
const hits = { a: 0, b: 0, bearer: 0, bodyBytes: 0 };

const serverA = createServer((req, res) => { hits.a++; console.log(`[A] ${req.method} ${req.url} -> 307 to B`); res.writeHead(307, { Location: `http://${HOST}:${B}${req.url}` }); res.end(); });
const serverB = createServer((req, res) => {
  let size = 0; req.on('data', chunk => { size += chunk.length; });
  req.on('end', () => {
    hits.b++; hits.bodyBytes += size;
    const auth = req.headers.authorization ?? '';
    if (auth.includes('PROBE-DUMMY')) hits.bearer++;
    console.log(`[B] ${req.method} ${req.url}  authorization=${auth ? (auth.includes('PROBE-DUMMY') ? 'DUMMY BEARER FORWARDED' : 'present') : 'absent'}  body=${size} bytes`);
    res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"probe"}');
  });
});
for (const [name, server] of [['A', serverA], ['B', serverB]]) server.on('error', error => { console.error(`[${name}] failed to bind: ${error.message}`); process.exit(1); });

let ready = 0;
const onReady = () => { if (++ready === 2) console.log(`Probe ready on loopback only: A=http://${HOST}:${A}/v1 (redirects)  B=http://${HOST}:${B} (records). Ctrl-C to stop and print the summary.`); };
serverA.listen(A, HOST, onReady);
serverB.listen(B, HOST, onReady);

const shutdown = () => {
  console.log(`\nSummary: A hits=${hits.a}  B hits=${hits.b}  dummy bearer forwarded=${hits.bearer}  body bytes at B=${hits.bodyBytes}`);
  console.log(hits.a === 0 ? 'Result: INCONCLUSIVE (A never reached).' : hits.bearer > 0 || hits.bodyBytes > 0 ? 'Result: REDIRECT FOLLOWED WITH CREDENTIALS/BODY (custom endpoints must be trusted-only).' : hits.b > 0 ? 'Result: redirect followed without credentials or body.' : 'Result: redirect NOT followed.');
  serverA.close(); serverB.close(); process.exit(0);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
