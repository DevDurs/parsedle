#!/usr/bin/env node
/**
 * Parsedle server entry point.
 */

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { createPoolProvider } from './pool.js';
import { createWclClient, WclError } from './wcl.js';
import { loadConfig } from './config.js';
import { ReportStore } from './store.js';

const config = loadConfig();
const store = new ReportStore(config.reportsFile);

let client = null;
try {
  client = createWclClient(config.wcl);
} catch (err) {
  if (!(err instanceof WclError)) throw err;
  console.warn(`[parsedle] ${err.message} — serving the bundled sample pool.`);
}

const pools = createPoolProvider({ store, client });
const server = createServer(
  createApp({
    store,
    pools,
    adminToken: config.adminToken,
    staticRoot: config.staticRoot,
    mounts: config.mounts,
  }),
);

server.listen(config.port, config.host, async () => {
  console.log(`[parsedle] listening on http://${config.host}:${config.port}`);
  console.log(`[parsedle] reports file: ${config.reportsFile}`);
  if (!config.adminToken) console.warn('[parsedle] ADMIN_TOKEN is unset — the admin API is disabled.');

  // Warm the pool so the first player does not pay for the WCL round trip.
  try {
    const { pool, sources, sample, warnings } = await pools.getPool();
    for (const warning of warnings) console.warn(`[parsedle] ${warning}`);
    console.log(
      `[parsedle] pool: ${pool.length} raiders from ${sources.length} report(s)${sample ? ' (sample data)' : ''}`,
    );
  } catch (err) {
    console.error('[parsedle] could not build the pool at startup:', err.message);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[parsedle] ${signal} — shutting down`);
    server.close(() => process.exit(0));
    // Don't let a hung keep-alive hold the container open.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
