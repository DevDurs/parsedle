#!/usr/bin/env node
/**
 * Parsedle server entry point.
 */

import { createServer } from 'node:http';

import { createApp } from './app.js';
import { createPoolProvider } from './pool.js';
import { createWclClient, WclError } from './wcl.js';
import { loadConfig } from './config.js';
import { createRosterProvider, RosterStore } from './roster.js';
import { scheduleDigest } from './digest.js';
import { ReportStore } from './store.js';
import { wireDiscord } from './wiring.js';

const config = loadConfig();
const store = new ReportStore(config.reportsFile);

let client = null;
try {
  client = createWclClient(config.wcl);
} catch (err) {
  if (!(err instanceof WclError)) throw err;
  console.warn(`[parsedle] ${err.message} — serving the bundled sample pool.`);
}

const roster = createRosterProvider({
  store: new RosterStore(config.rosterFile),
  client,
  guild: config.guild,
});
const pools = createPoolProvider({ store, client, roster });
const discord = wireDiscord(config, { pools });
for (const warning of discord.warnings) console.warn(`[parsedle] ${warning}`);

const server = createServer(
  createApp({
    store,
    pools,
    roster,
    adminToken: config.adminToken,
    staticRoot: config.staticRoot,
    mounts: config.mounts,
    sessions: discord.sessions,
    auth: discord.auth,
    users: discord.users,
    results: discord.results,
    announcer: discord.announcer,
    secureCookies: config.secureCookies,
    activity: { clientId: config.discord.clientId },
  }),
);

server.listen(config.port, config.host, async () => {
  console.log(`[parsedle] listening on http://${config.host}:${config.port}`);
  console.log(`[parsedle] reports file: ${config.reportsFile}`);
  if (!config.adminToken) console.warn('[parsedle] ADMIN_TOKEN is unset — the admin API is disabled.');
  console.log(`[parsedle] guild: ${config.guild.name}${config.guild.server ? ` — ${config.guild.server} (${config.guild.region})` : ''}`);
  console.log(
    discord.sessions
      ? `[parsedle] Discord login on${config.discord.requireGuildMember ? ' (server members only)' : ''}`
      : '[parsedle] Discord login off — anyone with the URL can play, anonymously',
  );

  // The digest catches up on boot if the container was down at its hour.
  if (discord.client) {
    console.log(`[parsedle] posting to channel ${config.discord.channelId}, digest at ${config.discord.digestHour}:00 UTC`);
    scheduleDigest({ announcer: discord.announcer, hour: config.discord.digestHour }).start();
  }

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
