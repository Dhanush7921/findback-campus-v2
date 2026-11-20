// Bundles server/dev.ts and starts the local API (8787) + built site (4173). Usage: npm run dev:stack
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const out = path.resolve('node_modules/.tmp/dev-stack.mjs');
await build({ entryPoints: ['server/dev.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
await import(pathToFileURL(out).href);
