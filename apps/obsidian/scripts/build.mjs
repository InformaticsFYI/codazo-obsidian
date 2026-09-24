import console from 'node:console';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Bundles the Codazo Obsidian plugin into dist/: main.js, manifest.json,
 * styles.css. Browser platform, no Node built-ins, Obsidian and CodeMirror
 * left external (Obsidian supplies them). Fails if hosted, Electron, React
 * Native, or Node code reaches the bundle. Prints composition and hashes.
 */
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(app, '../..');
const out = join(app, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const serverOnly = { name: 'server-only-marker', setup(builder) { builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'marker' })); builder.onLoad({ filter: /.*/, namespace: 'marker' }, () => ({ contents: 'export {};', loader: 'js' })); } };
const guard = { name: 'no-platform-imports', setup(builder) { builder.onResolve({ filter: /^(?:electron|node:|react-native|expo|better-auth|fs|path|os|child_process|net|crypto)(?:$|\/)/ }, args => ({ errors: [{ text: `Forbidden plugin import: ${args.path} (from ${args.importer})` }] })); } };

const result = await build({
  absWorkingDir: root, entryPoints: ['apps/obsidian/src/main.ts'], outfile: join(out, 'main.js'), bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'], plugins: [serverOnly, guard], metafile: true, sourcemap: false, minify: false, // readable main.js: Obsidian reviewers and learners can read the shipped code legalComments: 'inline', logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const packages = new Map();
for (const [path, input] of Object.entries(result.metafile.inputs)) {
  if (/^apps\/(web|desktop|mobile|mcp|marketing)\/|better-auth|components\/auth|lib\/auth|server-review|local-preview|provider-config|review-budget|request-origin/.test(path)) throw new Error(`Forbidden code in plugin bundle: ${path}`);
  const key = path.startsWith('node_modules/') ? path.slice(13).split('/').slice(0, path.startsWith('node_modules/@') ? 2 : 1).join('/') : path.startsWith('packages/shared/') ? 'packages/shared' : 'apps/obsidian';
  packages.set(key, (packages.get(key) ?? 0) + input.bytes);
}
await cp(join(app, 'manifest.json'), join(out, 'manifest.json'));
await cp(join(app, 'styles.css'), join(out, 'styles.css'));
await writeFile(join(app, 'dist-meta.json'), JSON.stringify(result.metafile, null, 2));
// Third-party license notices travel inside the installed file itself: main.js is what a vault actually receives, so the
// notices cannot live only in a release attachment. Full texts, from the packages that reached the bundle.
const bundledPackages = [...new Set(Object.keys(result.metafile.inputs).filter(path => path.startsWith('node_modules/')).map(path => { const parts = path.slice(13).split('/'); return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]; }))].sort();
let banner = '/*!\n * Codazo for Obsidian. Licensed under the Apache License 2.0; see LICENSE in the source repository.\n *\n * This file bundles the following third-party packages under their own licenses, reproduced in full below.\n';
for (const name of bundledPackages) {
  const dir = join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const licenseFile = (await readdir(dir)).find(file => /^(LICENSE|LICENCE|COPYING)(\..*)?$/i.test(file));
  if (!licenseFile) throw new Error(`No license file found for bundled package ${name}`);
  const text = (await readFile(join(dir, licenseFile), 'utf8')).replace(/\*\//g, '* /').trim().split('\n').map(line => ` * ${line}`.trimEnd()).join('\n');
  banner += ` *\n * ---- ${name} ${pkg.version} (${pkg.license ?? 'see text'}) ----\n${text}\n`;
}
banner += ' */\n';
await writeFile(join(out, 'main.js'), banner + (await readFile(join(out, 'main.js'), 'utf8')));
const hashes = {};
for (const name of ['main.js', 'manifest.json', 'styles.css']) { const bytes = await readFile(join(out, name)); hashes[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }
console.log('Bundle composition (input bytes):');
for (const [name, bytes] of [...packages].sort((a, b) => b[1] - a[1])) console.log(`  ${name.padEnd(36)} ${(bytes / 1024).toFixed(1)} KiB`);
console.log('Artifacts:');
for (const [name, info] of Object.entries(hashes)) console.log(`  ${name.padEnd(16)} ${(info.bytes / 1024).toFixed(1)} KiB  sha256 ${info.sha256}`);
if (process.env.CODAZO_OBSIDIAN_VAULT) {
  const target = join(process.env.CODAZO_OBSIDIAN_VAULT, '.obsidian/plugins/codazo');
  await mkdir(target, { recursive: true });
  for (const name of Object.keys(hashes)) await cp(join(out, name), join(target, name));
  console.log(`Installed into ${target}`);
}
