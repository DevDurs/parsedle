#!/usr/bin/env node
/**
 * Report list CLI — the same operations as the admin API, for when you would
 * rather `docker compose exec` than paste a token into a form.
 *
 *   node server/cli.js add https://www.warcraftlogs.com/reports/<code> ["Week 12 Mythic"]
 *   node server/cli.js list
 *   node server/cli.js remove <code>
 *   node server/cli.js check          # fetch the sampled reports and show the pool
 */

import { createPoolProvider } from './pool.js';
import { createWclClient, WclError } from './wcl.js';
import { loadConfig } from './config.js';
import { ReportStore, sortNewestFirst, SAMPLE_SIZE } from './store.js';

const config = loadConfig();
const store = new ReportStore(config.reportsFile);
const [command, ...args] = process.argv.slice(2);

function makeClient() {
  try {
    return createWclClient(config.wcl);
  } catch (err) {
    if (err instanceof WclError) return null;
    throw err;
  }
}

async function list() {
  const reports = sortNewestFirst(await store.read());
  if (!reports.length) {
    console.log('No reports yet. Add one with:  node server/cli.js add <url>');
    return;
  }
  reports.forEach((r, i) => {
    const sampled = i < SAMPLE_SIZE ? ' *' : '  ';
    const when = r.startTime ? new Date(r.startTime).toISOString().slice(0, 10) : `added ${r.addedAt.slice(0, 10)}`;
    console.log(`${sampled} ${r.code}  ${when}  ${r.label ?? ''}`);
  });
  console.log(`\n* = sampled by today's puzzle (newest ${SAMPLE_SIZE}).`);
}

async function main() {
  switch (command) {
    case 'add': {
      const { report, added } = await store.add(args[0], { label: args[1] ?? null });
      console.log(added ? `Added ${report.code}` : `${report.code} was already on the list`);
      await list();
      break;
    }
    case 'remove': {
      const { removed } = await store.remove(args[0]);
      console.log(removed ? `Removed ${args[0]}` : `No report ${args[0]} on the list`);
      break;
    }
    case 'list':
    case undefined:
      await list();
      break;
    case 'check': {
      const pools = createPoolProvider({ store, client: makeClient() });
      const { pool, sources, sample, warnings } = await pools.getPool({ force: true });
      for (const warning of warnings) console.warn(`! ${warning}`);
      for (const source of sources) console.log(`report ${source.code} — ${source.title}`);
      console.log(`${pool.length} raiders in the pool${sample ? ' (bundled sample data)' : ''}`);
      for (const p of pool.slice(0, 10)) {
        console.log(`  ${p.player.padEnd(16)} ${String(p.percentile).padStart(3)}  ${p.spec} ${p.class} — ${p.boss}`);
      }
      if (pool.length > 10) console.log(`  … and ${pool.length - 10} more`);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage: node server/cli.js [add <url> [label] | remove <code> | list | check]');
      process.exitCode = 1;
  }
}

await main();
