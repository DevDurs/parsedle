import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPoolProvider, REPORT_TTL_MS } from '../server/pool.js';
import { createRosterProvider, RosterStore } from '../server/roster.js';
import { ReportStore } from '../server/store.js';
import { makeReport } from './fixtures/report.js';

/** A roster provider that simply knows these names. */
async function rosterOf(names) {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-pool-roster-'));
  return createRosterProvider({
    store: new RosterStore(join(dir, 'roster.json')),
    client: { fetchGuildRoster: async () => ({ guild: { id: 1, name: 'LuckyDo' }, members: names }) },
    guild: { name: 'LuckyDo', server: 'draenor', region: 'EU' },
  });
}

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-pool-'));
  return new ReportStore(join(dir, 'reports.json'));
}

/** A client that counts fetches and can be told to fail. */
function fakeClient(reports) {
  const fetched = [];
  return {
    fetched,
    async fetchReport(code) {
      fetched.push(code);
      const report = reports[code];
      if (!report) throw new Error(`No report found for code ${code}`);
      return typeof report === 'function' ? report() : report;
    },
  };
}

/** Enough distinct raiders to clear MIN_POOL. */
function bigReport(code, playerCount = 8, startTime = 1_755_000_000_000) {
  const characters = Array.from({ length: playerCount }, (_, i) => ({
    id: i,
    name: `Raider${i}`,
    class: 'Mage',
    spec: 'Fire',
    amount: 1_000_000 + i,
    rankPercent: 50 + i,
    bracketData: 680,
  }));
  return {
    ...makeReport({ code, startTime }),
    rankings: {
      data: [
        {
          fightID: 3,
          kill: 1,
          difficulty: 5,
          duration: 300000,
          encounter: { id: 3129, name: 'Plexus Sentinel' },
          roles: { dps: { characters } },
        },
      ],
    },
  };
}

test('with no reports the game falls back to the sample pool', async () => {
  const store = await freshStore();
  const pools = createPoolProvider({ store, client: fakeClient({}) });
  const { pool, sample, warnings } = await pools.getPool();
  assert.ok(pool.length > 0);
  assert.equal(sample, true);
  assert.match(warnings[0], /No reports added yet/);
});

test('with no credentials the game still plays', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  const { sample, warnings } = await createPoolProvider({ store, client: null }).getPool();
  assert.equal(sample, true);
  assert.match(warnings[0], /No Warcraft Logs credentials/);
});

test('the pool is built from the newest two reports only', async () => {
  const store = await freshStore();
  for (const code of ['AAAA1111AAAA1111', 'BBBB2222BBBB2222', 'CCCC3333CCCC3333']) {
    await store.add(code, { now: Date.parse(`2026-08-${code[0] === 'A' ? '01' : code[0] === 'B' ? '08' : '15'}T20:00:00Z`) });
  }
  const client = fakeClient({
    AAAA1111AAAA1111: bigReport('AAAA1111AAAA1111'),
    BBBB2222BBBB2222: bigReport('BBBB2222BBBB2222'),
    CCCC3333CCCC3333: bigReport('CCCC3333CCCC3333'),
  });

  const { pool, sources, sample } = await createPoolProvider({ store, client }).getPool();
  assert.equal(sample, false);
  assert.deepEqual(client.fetched, ['CCCC3333CCCC3333', 'BBBB2222BBBB2222']);
  assert.deepEqual(sources.map((s) => s.code), ['CCCC3333CCCC3333', 'BBBB2222BBBB2222']);
  assert.equal(pool.length, 8, 'the same eight raiders, deduplicated across both nights');
});

test('a report is fetched once per TTL, then re-fetched', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  const client = fakeClient({ AAAA1111AAAA1111: bigReport('AAAA1111AAAA1111') });
  let clock = Date.now();
  const pools = createPoolProvider({ store, client, now: () => clock });

  await pools.getPool();
  await pools.getPool();
  assert.equal(client.fetched.length, 1, 'the second player pays nothing');

  clock += REPORT_TTL_MS + 1;
  await pools.getPool();
  assert.equal(client.fetched.length, 2, 'a stale night is refreshed');
});

test('adding a report invalidates the cache', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  const client = fakeClient({
    AAAA1111AAAA1111: bigReport('AAAA1111AAAA1111'),
    BBBB2222BBBB2222: bigReport('BBBB2222BBBB2222'),
  });
  const pools = createPoolProvider({ store, client });

  await pools.getPool();
  await store.add('BBBB2222BBBB2222');
  pools.invalidate();
  const { sources } = await pools.getPool();
  assert.deepEqual(sources.map((s) => s.code).sort(), ['AAAA1111AAAA1111', 'BBBB2222BBBB2222']);
});

test('one unreachable report is a warning, not an outage', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111', { now: Date.parse('2026-08-01T20:00:00Z') });
  await store.add('DEAD9999DEAD9999', { now: Date.parse('2026-08-08T20:00:00Z') });
  const client = fakeClient({ AAAA1111AAAA1111: bigReport('AAAA1111AAAA1111') });

  const { pool, sample, warnings } = await createPoolProvider({ store, client }).getPool();
  assert.equal(sample, false);
  assert.equal(pool.length, 8);
  assert.match(warnings[0], /Could not load report DEAD9999DEAD9999/);
});

test('too few parses to be a game falls back with an explanation', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  const client = fakeClient({ AAAA1111AAAA1111: bigReport('AAAA1111AAAA1111', 3) });

  const { sample, warnings } = await createPoolProvider({ store, client }).getPool();
  assert.equal(sample, true);
  assert.match(warnings.at(-1), /Only 3 ranked parses/);
});

test('the raid night time is written back so ordering settles', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  const client = fakeClient({ AAAA1111AAAA1111: bigReport('AAAA1111AAAA1111', 8, 1_700_000_000_000) });
  await createPoolProvider({ store, client }).getPool();
  assert.equal((await store.read())[0].startTime, 1_700_000_000_000);
});

test('only guild members can be the answer', async (t) => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');

  // Eight of ours, plus a pug who out-parsed all of them.
  const report = bigReport('AAAA1111AAAA1111');
  report.rankings.data[0].roles.dps.characters.push({
    id: 99,
    name: 'Pugsley',
    class: 'Rogue',
    spec: 'Outlaw',
    amount: 9_000_000,
    rankPercent: 100,
    bracketData: 700,
  });

  const pools = createPoolProvider({
    store,
    client: fakeClient({ AAAA1111AAAA1111: report }),
    roster: await rosterOf(Array.from({ length: 8 }, (_, i) => `Raider${i}`)),
  });

  const { pool, warnings, sample } = await pools.getPool();
  assert.equal(sample, false);
  assert.ok(!pool.some((p) => p.player === 'Pugsley'), 'the pug is not in the pool at any percentile');
  assert.equal(pool.length, 8);
  assert.ok(warnings.some((w) => /Skipped 1 raider not on the guild roster/.test(w)));
});

test('an unreadable guild roster stops real parses being served at all', async (t) => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-pool-roster-'));
  const roster = createRosterProvider({
    store: new RosterStore(join(dir, 'roster.json')),
    client: { fetchGuildRoster: async () => { throw new Error('Warcraft Logs returned 503'); } },
    guild: { name: 'LuckyDo', server: 'draenor', region: 'EU' },
  });

  const pools = createPoolProvider({
    store,
    client: fakeClient({ AAAA1111AAAA1111: bigReport('AAAA1111AAAA1111') }),
    roster,
  });

  const { sample, warnings } = await pools.getPool();
  assert.equal(sample, true, 'better the sample pool than a pug');
  assert.match(warnings.at(-1), /Could not read the guild roster \(Warcraft Logs returned 503\)/);
});

test('a report of nothing but pugs falls back rather than emptying the game', async (t) => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  const pools = createPoolProvider({
    store,
    client: fakeClient({ AAAA1111AAAA1111: bigReport('AAAA1111AAAA1111') }),
    roster: await rosterOf(['Someone', 'Else']),
  });

  const { sample, warnings } = await pools.getPool();
  assert.equal(sample, true);
  assert.ok(warnings.some((w) => /Skipped 8 raiders not on the guild roster/.test(w)));
  assert.match(warnings.at(-1), /Only 0 ranked parses/);
});
