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
import { parsesFromReport } from './transform.js';
import { createRosterProvider, RosterStore } from './roster.js';
import { createWclClient, WclError } from './wcl.js';
import { loadConfig } from './config.js';
import { ReportStore, sortNewestFirst, SAMPLE_SIZE } from './store.js';
import { previousDayKey, scoreboard } from './results.js';
import { todayKey } from './digest.js';
import { wireDiscord } from './wiring.js';

const config = loadConfig();
const store = new ReportStore(config.reportsFile);
const rosterStore = new RosterStore(config.rosterFile);
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

function makeRoster(client) {
  return createRosterProvider({ store: rosterStore, client, guild: config.guild });
}

async function showRoster({ force = false } = {}) {
  const members = await makeRoster(makeClient()).getMembers({ force });
  const overrides = await rosterStore.read();

  console.log(`Guild: ${config.guild.name}${config.guild.server ? ` — ${config.guild.server} (${config.guild.region})` : ''}`);
  if (members.error) console.warn(`! Warcraft Logs roster unavailable: ${members.error}`);
  if (!members.configured) console.warn('! No guild configured — set GUILD_NAME, GUILD_SERVER and GUILD_REGION.');
  console.log(`${members.size} member${members.size === 1 ? '' : 's'} (source: ${members.source})`);
  if (overrides.include.length) console.log(`  vouched for: ${overrides.include.join(', ')}`);
  if (overrides.exclude.length) console.log(`  barred:      ${overrides.exclude.join(', ')}`);
  if (members.size === 0) {
    console.warn('\n! Nobody can be verified as a member, so no real parse can be an answer yet.');
    console.warn('  Add names with:  node server/cli.js roster add <name> [<name>…]');
  }
}

/**
 * Seed the roster from a report's own players — far less typing than 25 names,
 * and pugs are easy to prune afterwards with `roster exclude`.
 */
async function importRoster(code) {
  const client = makeClient();
  if (!client) {
    console.error('Importing needs Warcraft Logs credentials (WCL_CLIENT_ID / WCL_CLIENT_SECRET).');
    process.exitCode = 1;
    return;
  }
  const target = code ?? (await store.latest(1))[0]?.code;
  if (!target) {
    console.error('No report to import from. Add one first, or pass a report code.');
    process.exitCode = 1;
    return;
  }

  const players = [...new Set(parsesFromReport(await client.fetchReport(target)).map((r) => r.player))].sort();
  const { added } = await rosterStore.add('include', players);
  console.log(`Imported ${added.length} of ${players.length} player(s) from ${target}.`);
  console.log('Prune anyone who was a pug:  node server/cli.js roster exclude <name>');
}

/** Yesterday's post, printed or sent. */
async function digest(args) {
  const client = makeClient();
  const pools = createPoolProvider({ store, client, roster: makeRoster(client) });
  const discord = wireDiscord(config, { pools });
  for (const warning of discord.warnings) console.warn(`! ${warning}`);

  const dayKey = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? previousDayKey(todayKey());
  const dryRun = args.includes('--dry-run') || !discord.client;
  const force = args.includes('--now');

  if (!discord.client && !args.includes('--dry-run')) {
    console.warn('! No bot configured, so this is a dry run.');
  }

  const message = await discord.announcer.postDigest({ dayKey, dryRun, force });
  if (!message) {
    console.log(`Nothing to post for ${dayKey} — nobody finished, or it has already gone out (use --now to repost).`);
    return;
  }

  console.log(`--- ${dayKey} ---\n${message.content}`);
  if (message.embeds) console.log(`\n[${message.embeds[0].fields.length} grid(s) attached]`);
  console.log(dryRun ? '\n(dry run — nothing was posted)' : '\nPosted.');
}

/** What a given day looked like. */
async function results(args) {
  const discord = wireDiscord(config);
  const dayKey = args[0] ?? todayKey();
  const day = await discord.results.day(dayKey);
  const users = await discord.users.read();
  const rows = scoreboard(day);

  console.log(`${dayKey}: ${Object.keys(day).length} player(s), ${rows.length} finished`);
  for (const row of rows) {
    const name = users[row.userId]?.username ?? row.userId;
    console.log(`  ${(row.won ? `${row.guesses}/5` : 'X/5').padEnd(4)} ${name}`);
  }
  for (const [userId, round] of Object.entries(day)) {
    if (round.finishedAt) continue;
    console.log(`  ...  ${users[userId]?.username ?? userId} (still playing, ${round.guessIds.length} guesses)`);
  }
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
    case 'roster': {
      const [action, ...names] = args;
      if (action === 'add' || action === 'include') {
        const { added } = await rosterStore.add('include', names);
        console.log(added.length ? `Vouched for ${added.join(', ')}` : 'Nothing new to add');
      } else if (action === 'exclude' || action === 'remove') {
        const { added } = await rosterStore.add('exclude', names);
        console.log(added.length ? `Barred ${added.join(', ')}` : 'Nothing new to bar');
      } else if (action === 'import') {
        await importRoster(names[0]);
      } else if (action === 'forget') {
        const { removed } = await rosterStore.forget(names);
        console.log(removed.length ? `Forgot ${removed.join(', ')}` : 'No such override');
      } else if (action && action !== 'refresh' && action !== 'list') {
        console.error(`Unknown roster command: ${action}`);
        process.exitCode = 1;
        return;
      }
      await showRoster({ force: action === 'refresh' });
      break;
    }
    case 'check': {
      const client = makeClient();
      const pools = createPoolProvider({ store, client, roster: makeRoster(client) });
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
    case 'digest':
      await digest(args);
      break;
    case 'results':
      await results(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error(
        'Usage: node server/cli.js [add <url> [label] | remove <code> | list | check | ' +
          'roster [refresh|add|exclude|forget|import] <name…> | digest [--dry-run|--now] [day] | results [day]]',
      );
      process.exitCode = 1;
  }
}

await main();
