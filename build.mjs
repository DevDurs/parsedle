#!/usr/bin/env node
/**
 * The only build step in the project, and it exists for one reason: the
 * Discord Embedded App SDK is an npm module, and the page has to load it
 * from somewhere.
 *
 * Everything else here is still hand-written ES modules served straight off
 * disk. This bundles the SDK — and nothing else — into public/vendor/, so the
 * game's own source stays readable in the browser's debugger.
 */

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir(new URL('./public/vendor/', import.meta.url), { recursive: true });

const result = await build({
  entryPoints: ['src/vendor/embedded-app-sdk.entry.js'],
  outfile: 'public/vendor/embedded-app-sdk.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`[parsedle] embedded-app-sdk bundled: ${(bytes / 1024).toFixed(0)} kB`);
