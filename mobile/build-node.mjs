// Assembles www/nodejs/, the project the Node.js engine in the Android app runs:
// main.cjs (entry), server.mjs (the bundled BeatVote server) and web/ (the built UI, served by the server).
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // …/mobile
const out = join(here, 'www', 'nodejs');
const common = { bundle: true, platform: 'node', target: 'node18', logLevel: 'info' };

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  ...common,
  entryPoints: [join(here, '..', 'server', 'src', 'index.ts')],
  format: 'esm',
  outfile: join(out, 'server.mjs'),
  // Same shim as desktop/build-server.mjs: @fastify/websocket is CJS and calls require('node:*').
  banner: {
    js: `import { createRequire as __beatvoteCr } from 'node:module';\nconst require = __beatvoteCr(import.meta.url);`,
  },
});

await build({
  ...common,
  entryPoints: [join(here, 'node', 'main.cjs')],
  format: 'cjs',
  outfile: join(out, 'main.cjs'),
  external: ['./server.mjs'],
});

await writeFile(join(out, 'package.json'), JSON.stringify({ name: 'beatvote-node', main: 'main.cjs' }) + '\n');
await cp(join(here, '..', 'web', 'dist'), join(out, 'web'), { recursive: true });
