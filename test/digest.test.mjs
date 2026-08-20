import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import PARSES from '../src/data/parses.js';
import { ResultStore } from '../server/results.js';
import { StateStore } from '../server/state.js';
import {
  createAnnouncer,
  digestMessage,
  msUntilHour,
  nameList,
  playingMessage,
  scheduleDigest,
  todayKey,
} from '../server/digest.js';

const USERS = {
  u1: { id: 'u1', username: 'durs' },
  u2: { id: 'u2', username: 'CMRN' },
  u3: { id: 'u3', username: 'Tusdar' },
};

const round = (guesses, won, finishedAt) => ({
  puzzleNumber: 232,
  guessIds: Array.from({ length: guesses }, (_, i) => `g${i}`),
  won,
  startedAt: '2026-08-20T09:00:00.000Z',
  finishedAt,
});

async function stores() {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-digest-'));
  return { results: new ResultStore(join(dir, 'results.json')), state: new StateStore(join(dir, 'discord.json')) };
}

/** A Discord that remembers what it was told. */
function fakeClient() {
  const posted = [];
  const edited = [];
  return {
    posted,
    edited,
    async postMessage(message) {
      posted.push(message);
      return { id: `msg-${posted.length}` };
    },
    async editMessage(id, message) {
      edited.push({ id, message });
      return { id };
    },
  };
}

test('names read as a sentence', () => {
  assert.equal(nameList([]), '');
  assert.equal(nameList(['durs']), 'durs');
  assert.equal(nameList(['durs', 'CMRN']), 'durs and CMRN');
  assert.equal(nameList(['durs', 'CMRN', 'Tusdar']), 'durs, CMRN and Tusdar');
});

test('the playing message names everyone who has started, and agrees with itself', () => {
  const one = playingMessage({
    day: { u1: round(1, false, null) },
    users: USERS,
    puzzleNumber: 232,
    playUrl: 'https://parsedle.example.com',
  });
  assert.equal(one.content, '**durs** is playing Parsedle #232');
  assert.equal(one.components[0].components[0].url, 'https://parsedle.example.com');

  const two = playingMessage({
    day: { u1: round(1, false, null), u2: round(0, false, null) },
    users: USERS,
    puzzleNumber: 232,
  });
  assert.equal(two.content, '**durs** and **CMRN** are playing Parsedle #232');
});

test('the digest groups by score, crowns the best and marks the losses', () => {
  const message = digestMessage({
    day: {
      u3: round(3, true, '2026-08-20T10:00:00.000Z'),
      u1: round(4, true, '2026-08-20T10:05:00.000Z'),
      u2: round(4, true, '2026-08-20T10:06:00.000Z'),
      u4: round(5, false, '2026-08-20T11:00:00.000Z'),
    },
    users: USERS,
    streak: 2,
    puzzleNumber: 232,
    answer: { player: 'Thalvira', spec: 'Shadow', class: 'Priest', percentile: 99, difficulty: 'Mythic', boss: 'Dimensius' },
  });

  const lines = message.content.split('\n');
  assert.equal(lines[0], "**Your group is on a 2 day streak!** 🔥 Here are yesterday's results:");
  assert.equal(lines[1], '👑 3/5: <@u3>');
  assert.equal(lines[2], '4/5: <@u1> <@u2>', 'a shared score shares a line');
  assert.equal(lines[3], 'X/5: <@u4>');
  assert.match(message.content, /It was \*\*Thalvira\*\* — Shadow Priest, 99 on Mythic Dimensius\./);
});

test('a one-day streak is not bragged about', () => {
  const message = digestMessage({
    day: { u1: round(2, true, '2026-08-20T10:00:00.000Z') },
    users: USERS,
    streak: 1,
    puzzleNumber: 232,
    answer: null,
  });
  assert.match(message.content, /^\*\*Here are yesterday's results:\*\*/);
  assert.ok(!message.content.includes('streak'));
});

test('nobody wins, nobody is crowned', () => {
  const message = digestMessage({
    day: { u1: round(5, false, '2026-08-20T10:00:00.000Z') },
    users: USERS,
    streak: 3,
    puzzleNumber: 232,
    answer: null,
  });
  assert.ok(!message.content.includes('👑'));
  assert.match(message.content, /X\/5: <@u1>/);
});

test('a day nobody finished produces no digest at all', () => {
  assert.equal(digestMessage({ day: {}, users: USERS, streak: 0, puzzleNumber: 232 }), null);
  assert.equal(digestMessage({ day: { u1: round(2, false, null) }, users: USERS, streak: 0, puzzleNumber: 232 }), null);
});

test('grids ride along only when asked for', () => {
  const day = { u1: round(2, true, '2026-08-20T10:00:00.000Z') };
  const plain = digestMessage({ day, users: USERS, streak: 1, puzzleNumber: 232, answer: null });
  assert.equal(plain.embeds, undefined);

  const withGrids = digestMessage({
    day,
    users: USERS,
    streak: 1,
    puzzleNumber: 232,
    answer: null,
    includeGrids: true,
    guessGrids: { u1: '⬛⬛🟨\n🟩🟩🟩' },
  });
  assert.equal(withGrids.embeds[0].fields[0].name, 'durs');
  assert.match(withGrids.embeds[0].fields[0].value, /🟩/);
});

test('the first player posts, the second edits the same message', async () => {
  const { results, state } = await stores();
  const client = fakeClient();
  const announcer = createAnnouncer({ client, results, users: { read: async () => USERS }, state, playUrl: 'https://p' });

  await results.startRound({ dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232 });
  await announcer.onGuess({ dayKey: '2026-08-20', view: { puzzleNumber: 232 } });
  assert.equal(client.posted.length, 1);
  assert.match(client.posted[0].content, /\*\*durs\*\* is playing/);

  await results.startRound({ dayKey: '2026-08-20', userId: 'u2', puzzleNumber: 232 });
  await announcer.onGuess({ dayKey: '2026-08-20', view: { puzzleNumber: 232 } });
  assert.equal(client.posted.length, 1, 'still one notification');
  assert.equal(client.edited.length, 1);
  assert.match(client.edited[0].message.content, /\*\*durs\*\* and \*\*CMRN\*\* are playing/);
});

test('further guesses by the same player say nothing new', async () => {
  const { results, state } = await stores();
  const client = fakeClient();
  const announcer = createAnnouncer({ client, results, users: { read: async () => USERS }, state });

  await results.startRound({ dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232 });
  await announcer.onGuess({ dayKey: '2026-08-20', view: { puzzleNumber: 232 } });
  await announcer.onGuess({ dayKey: '2026-08-20', view: { puzzleNumber: 232 } });
  assert.equal(client.posted.length, 1);
  assert.equal(client.edited.length, 0, 'the sentence did not change, so neither did the message');
});

test('a channel we cannot post to does not break the game', async () => {
  const { results, state } = await stores();
  const warnings = [];
  const client = {
    postMessage: async () => {
      throw new Error('Missing Access');
    },
    editMessage: async () => {},
  };
  const announcer = createAnnouncer({
    client,
    results,
    users: { read: async () => USERS },
    state,
    log: { warn: (m) => warnings.push(m) },
  });

  await results.startRound({ dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232 });
  await announcer.onGuess({ dayKey: '2026-08-20', view: { puzzleNumber: 232 } });
  assert.match(warnings[0], /could not announce play/);
});

test('the digest posts once and refuses to repeat itself', async () => {
  const { results, state } = await stores();
  const client = fakeClient();
  const pools = { getPool: async () => ({ pool: PARSES }) };
  const announcer = createAnnouncer({ client, results, users: { read: async () => USERS }, state, pools });

  await results.recordGuess({ dayKey: '2026-08-19', userId: 'u1', guessId: 'a', correct: true, puzzleNumber: 231 });

  assert.ok(await announcer.postDigest({ dayKey: '2026-08-19' }));
  assert.equal(client.posted.length, 1);
  assert.equal(await announcer.postDigest({ dayKey: '2026-08-19' }), null, 'a restart does not repost');
  assert.equal(client.posted.length, 1);
  assert.ok(await announcer.postDigest({ dayKey: '2026-08-19', force: true }), 'unless forced');
});

test('a dry run builds the message without posting it', async () => {
  const { results, state } = await stores();
  const client = fakeClient();
  const pools = { getPool: async () => ({ pool: PARSES }) };
  const announcer = createAnnouncer({ client, results, users: { read: async () => USERS }, state, pools });

  await results.recordGuess({ dayKey: '2026-08-19', userId: 'u1', guessId: 'a', correct: true, puzzleNumber: 231 });
  const message = await announcer.postDigest({ dayKey: '2026-08-19', dryRun: true });

  assert.match(message.content, /results/);
  assert.equal(client.posted.length, 0);
  assert.equal((await state.read()).digest, undefined, 'and does not mark the day as done');
});

test('the digest names yesterday’s answer, which is no longer a spoiler', async () => {
  const { results, state } = await stores();
  const pools = { getPool: async () => ({ pool: PARSES }) };
  const announcer = createAnnouncer({ client: fakeClient(), results, users: { read: async () => USERS }, state, pools });

  await results.recordGuess({ dayKey: '2026-08-19', userId: 'u1', guessId: 'a', correct: true, puzzleNumber: 231 });
  const message = await announcer.postDigest({ dayKey: '2026-08-19', dryRun: true });
  assert.match(message.content, /It was \*\*[A-Za-z]+\*\* —/);
});

test('a quiet day is marked done without a post', async () => {
  const { results, state } = await stores();
  const client = fakeClient();
  const announcer = createAnnouncer({ client, results, users: { read: async () => USERS }, state });

  assert.equal(await announcer.postDigest({ dayKey: '2026-08-19' }), null);
  assert.equal(client.posted.length, 0);
  assert.equal((await state.read()).digest.lastDayKey, '2026-08-19', 'so it is not retried all day');
});

test('the schedule waits for the next occurrence of the hour', () => {
  const monday10 = Date.parse('2026-08-20T10:00:00Z');
  assert.equal(msUntilHour(10, Date.parse('2026-08-20T09:00:00Z')), 3600000);
  assert.equal(msUntilHour(10, monday10), 86400000, 'exactly on the hour waits for tomorrow');
  assert.equal(msUntilHour(10, Date.parse('2026-08-20T23:00:00Z')), 11 * 3600000);
  assert.equal(todayKey(Date.parse('2026-08-20T23:59:00Z')), '2026-08-20');
});

test('the scheduler catches up on boot, then rearms', async () => {
  const runs = [];
  const timers = [];
  const announcer = {
    postDigest: async () => {
      runs.push('ran');
      return null;
    },
  };
  const scheduler = scheduleDigest({
    announcer,
    hour: 10,
    now: () => Date.parse('2026-08-20T14:00:00Z'),
    setTimer: (fn, ms) => {
      timers.push(ms);
      return { unref() {} };
    },
  });

  await scheduler.start();
  assert.deepEqual(runs, ['ran'], 'the missed morning is posted at boot');
  assert.equal(timers[0], 20 * 3600000, 'then it waits for 10:00 tomorrow');
});
