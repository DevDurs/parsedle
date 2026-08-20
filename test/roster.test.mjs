import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RosterStore, ROSTER_TTL_MS, createRosterProvider, filterToMembers, normaliseName } from '../server/roster.js';

const GUILD = { name: 'LuckyDo', server: 'draenor', region: 'EU' };

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-roster-'));
  return new RosterStore(join(dir, 'roster.json'));
}

/** A client whose roster call can be counted and made to fail. */
function fakeClient(members, { fail = null } = {}) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async fetchGuildRoster() {
      calls += 1;
      if (fail) throw new Error(fail);
      return { guild: { id: 1, name: 'LuckyDo' }, members };
    },
  };
}

test('names match across case and realm suffixes', () => {
  assert.equal(normaliseName('Thalvira'), 'thalvira');
  assert.equal(normaliseName('thalvira'), 'thalvira');
  assert.equal(normaliseName('Thalvira-Draenor'), 'thalvira');
  assert.equal(normaliseName('  Thalvira  '), 'thalvira');
  assert.equal(normaliseName(undefined), '');
});

test('the guild roster from the site is who plays', async () => {
  const provider = createRosterProvider({
    store: await freshStore(),
    client: fakeClient(['Thalvira', 'Brokktar']),
    guild: GUILD,
  });
  const members = await provider.getMembers();
  assert.deepEqual([...members.names].sort(), ['brokktar', 'thalvira']);
  assert.equal(members.source, 'warcraftlogs');
  assert.equal(await provider.isMember('thalvira-draenor'), true);
  assert.equal(await provider.isMember('Pugsley'), false);
});

test('the site roster is fetched once per TTL', async () => {
  const client = fakeClient(['Thalvira']);
  let clock = Date.now();
  const provider = createRosterProvider({ store: await freshStore(), client, guild: GUILD, now: () => clock });

  await provider.getMembers();
  await provider.getMembers();
  assert.equal(client.calls, 1);

  clock += ROSTER_TTL_MS + 1;
  await provider.getMembers();
  assert.equal(client.calls, 2);
});

test('a local override vouches for someone the site roster misses', async () => {
  const store = await freshStore();
  await store.add('include', ['Newtrial']);
  const provider = createRosterProvider({ store, client: fakeClient(['Thalvira']), guild: GUILD });
  assert.deepEqual([...(await provider.getMembers()).names].sort(), ['newtrial', 'thalvira']);
});

test('a local override bars someone the site roster still lists', async () => {
  const store = await freshStore();
  await store.add('exclude', ['Thalvira']);
  const provider = createRosterProvider({ store, client: fakeClient(['Thalvira', 'Brokktar']), guild: GUILD });
  assert.deepEqual([...(await provider.getMembers()).names], ['brokktar']);
});

test('the two override lists can never disagree about a name', async () => {
  const store = await freshStore();
  await store.add('include', ['Borderline']);
  await store.add('exclude', ['borderline-Draenor']);
  const overrides = await store.read();
  assert.deepEqual(overrides.include, []);
  assert.deepEqual(overrides.exclude, ['borderline-Draenor']);
});

test('adding the same name twice does not duplicate it', async () => {
  const store = await freshStore();
  await store.add('include', ['Thalvira']);
  const { added } = await store.add('include', ['thalvira']);
  assert.deepEqual(added, []);
  assert.deepEqual((await store.read()).include, ['Thalvira']);
});

test('forget drops an override from whichever list held it', async () => {
  const store = await freshStore();
  await store.add('include', ['A']);
  await store.add('exclude', ['B']);
  const { removed, overrides } = await store.forget(['a', 'b']);
  assert.deepEqual(removed.sort(), ['A', 'B']);
  assert.deepEqual(overrides, { include: [], exclude: [] });
});

test('an unreadable roster means nobody, never everybody', async () => {
  const provider = createRosterProvider({
    store: await freshStore(),
    client: fakeClient([], { fail: 'Warcraft Logs returned 503' }),
    guild: GUILD,
  });
  const members = await provider.getMembers();
  assert.equal(members.size, 0);
  assert.match(members.error, /503/);
  assert.equal(members.configured, true);
});

test('with no guild configured the site is never asked', async () => {
  const client = fakeClient(['Thalvira']);
  const provider = createRosterProvider({ store: await freshStore(), client, guild: { name: 'LuckyDo' } });
  const members = await provider.getMembers();
  assert.equal(client.calls, 0, 'a name alone cannot identify a guild');
  assert.equal(members.configured, false);
  assert.equal(members.size, 0);
});

test('overrides alone are enough to play without a site roster', async () => {
  const store = await freshStore();
  await store.add('include', ['Thalvira', 'Brokktar']);
  const provider = createRosterProvider({ store, client: null, guild: GUILD });
  const members = await provider.getMembers();
  assert.equal(members.source, 'overrides');
  assert.equal(members.size, 2);
});

test('filtering keeps our raiders and drops the pugs', () => {
  const rows = [{ player: 'Thalvira' }, { player: 'Pugsley' }, { player: 'brokktar-Draenor' }];
  const kept = filterToMembers(rows, new Set(['thalvira', 'brokktar']));
  assert.deepEqual(kept.map((r) => r.player), ['Thalvira', 'brokktar-Draenor']);
});
