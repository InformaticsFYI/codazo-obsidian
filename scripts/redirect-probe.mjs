// Native redirect probe (release review R2 / F3). Two HTTP servers with no real
// credentials: A answers every request with a 307 redirect to B; B records
// whether an Authorization header or a request body arrived. Both answer
// cross-origin preflight checks, so on iPad, iPhone, and Android the real
// request reaches A and the redirect is actually exercised; without that, a
// refused preflight would make the probe pass for the wrong reason.
//
//   node scripts/redirect-probe.mjs          # desktop: loopback only
//   node scripts/redirect-probe.mjs --lan    # mobile: reachable from devices on this network
//
// Desktop: create a custom profile with base URL http://127.0.0.1:4311/v1.
// Mobile: use the http://<this computer's address>:4311/v1 URL printed at start;
// iOS asks for local network permission the first time.
// Use key "PROBE-DUMMY", any model, and review synthetic text. Watch this output.
//
// Outcomes to record (A-hit / B-hit / plugin result):
//   A POST hit, B hit with DUMMY BEARER FORWARDED -> redirects are followed with credentials; this must never happen.
//   A POST hit, B not hit, plugin shows an error  -> redirects are not followed. Expected.
//   A preflight only, no A POST                   -> the request was stopped before sending; inconclusive for redirects.
//   A not hit                                     -> the probe was not reached; inconclusive, check the profile URL and network.
// Only one hop between two ports on one host is exercised; cross-host and HTTPS-downgrade behavior are separate cases.
import console from 'node:console';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import process from 'node:process';

const LAN = process.argv.includes('--lan');
const BIND = LAN ? '0.0.0.0' : '127.0.0.1', A = 4311, B = 4312;
const hits = { aPreflight: 0, a: 0, bPreflight: 0, b: 0, bearer: 0, bodyBytes: 0 };

// Permissive preflight answers: this probe only ever receives dummy credentials.
const allowCors = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'authorization, content-type');
};
const hostOf = req => (req.headers.host ?? '127.0.0.1').replace(/:\d+$/, '');

const serverA = createServer((req, res) => {
  allowCors(req, res);
  if (req.method === 'OPTIONS') { hits.aPreflight++; console.log(`[A] preflight ${req.url} from ${req.headers.origin ?? 'no origin'} -> allowed`); res.writeHead(204); res.end(); return; }
  hits.a++; console.log(`[A] ${req.method} ${req.url} -> 307 to B`);
  res.writeHead(307, { Location: `http://${hostOf(req)}:${B}${req.url}` }); res.end();
});
const serverB = createServer((req, res) => {
  allowCors(req, res);
  if (req.method === 'OPTIONS') { hits.bPreflight++; console.log(`[B] preflight ${req.url} -> the redirect was being followed`); res.writeHead(204); res.end(); return; }
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

const addresses = () => LAN ? Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address) : ['127.0.0.1'];
let ready = 0;
const onReady = () => {
  if (++ready !== 2) return;
  console.log(`Probe ready (${LAN ? 'local network' : 'loopback only'}). Profile base URL:`);
  for (const address of addresses()) console.log(`  http://${address}:${A}/v1`);
  console.log('Ctrl-C to stop and print the summary.');
};
serverA.listen(A, BIND, onReady);
serverB.listen(B, BIND, onReady);

const shutdown = () => {
  console.log(`\nSummary: A preflights=${hits.aPreflight}  A requests=${hits.a}  B preflights=${hits.bPreflight}  B requests=${hits.b}  dummy bearer forwarded=${hits.bearer}  body bytes at B=${hits.bodyBytes}`);
  const verdict = hits.a === 0 && hits.aPreflight === 0 ? 'INCONCLUSIVE (A never reached).'
    : hits.a === 0 ? 'INCONCLUSIVE (preflight only; the request itself never reached A).'
    : hits.bearer > 0 || hits.bodyBytes > 0 ? 'REDIRECT FOLLOWED WITH CREDENTIALS/BODY. This must never happen.'
    : hits.b > 0 || hits.bPreflight > 0 ? 'redirect followed without credentials or body.'
    : 'redirect NOT followed. Expected.';
  console.log(`Result: ${verdict}`);
  serverA.close(); serverB.close(); process.exit(0);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
