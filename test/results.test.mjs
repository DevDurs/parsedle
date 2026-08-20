import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ResultStore,
  groupStreak,
  participants,
  playing,
  previousDayKey,
  scoreboard,
} from '../server/results.js';

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-results-'));
  return new ResultStore(join(dir, 'results.json'));
}

const at = (iso) => Date.parse(iso);

/** A finished round, for the pure helpers. */
const round = (guesses, won, finishedAt = '2026-08-20T10:00:00.000Z') => ({
  puzzleNumber: 232,
  guessIds: Array.from({ length: guesses }, (_, i) => `g${i}`),
  won,
  startedAt: '2026-08-20T09:00:00.000Z',
  finishedAt,
});

test('day keys step backwards across month and year ends', () => {
  assert.equal(previousDayKey('2026-08-20'), '2026-08-19');
  assert.equal(previousDayKey('2026-08-01'), '2026-07-31');
  assert.equal(previousDayKey('2026-01-01'), '2025-12-31');
  assert.equal(previousDayKey('2028-03-01'), '2028-02-29', 'leap years too');
});

test('a round records guesses and closes itself on a win', async () => {
  const store = await freshStore();
  const entry = { dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232 };

  await store.recordGuess({ ...entry, guessId: 'a', correct: false });
  const { round: r } = await store.recordGuess({ ...entry, guessId: 'b', correct: true });

  assert.deepEqual(r.guessIds, ['a', 'b']);
  assert.equal(r.won, true);
  assert.ok(r.finishedAt, 'a win ends the round');
});

test('a fifth wrong guess closes the round as a loss', async () => {
  const store = await freshStore();
  const entry = { dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232 };
  for (const guessId of ['a', 'b', 'c', 'd', 'e']) {
    await store.recordGuess({ ...entry, guessId, correct: false });
  }
  const r = await store.round('2026-08-20', 'u1');
  assert.equal(r.guessIds.length, 5);
  assert.equal(r.won, false);
  assert.ok(r.finishedAt);
});

test('a finished round cannot be extended or un-lost', async () => {
  const store = await freshStore();
  const entry = { dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232 };
  for (const guessId of ['a', 'b', 'c', 'd', 'e']) {
    await store.recordGuess({ ...entry, guessId, correct: false });
  }

  const { added } = await store.recordGuess({ ...entry, guessId: 'f', correct: true });
  assert.equal(added, false, 'a replayed request cannot turn a loss into a win');
  const r = await store.round('2026-08-20', 'u1');
  assert.equal(r.won, false);
  assert.equal(r.guessIds.length, 5);
});

test('the same guess twice is not counted twice', async () => {
  const store = await freshStore();
  const entry = { dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232, guessId: 'a', correct: false };
  await store.recordGuess(entry);
  const { added } = await store.recordGuess(entry);
  assert.equal(added, false);
  assert.equal((await store.round('2026-08-20', 'u1')).guessIds.length, 1);
});

test('days and players do not bleed into each other', async () => {
  const store = await freshStore();
  await store.recordGuess({ dayKey: '2026-08-20', userId: 'u1', guessId: 'a', correct: true, puzzleNumber: 232 });
  await store.recordGuess({ dayKey: '2026-08-21', userId: 'u1', guessId: 'b', correct: false, puzzleNumber: 233 });
  await store.recordGuess({ dayKey: '2026-08-20', userId: 'u2', guessId: 'c', correct: false, puzzleNumber: 232 });

  assert.equal((await store.round('2026-08-20', 'u1')).won, true);
  assert.equal((await store.round('2026-08-21', 'u1')).won, false);
  assert.equal(Object.keys(await store.day('2026-08-20')).length, 2);
  assert.equal(await store.round('2026-08-22', 'u1'), null);
});

test('starting a round is idempotent and does not count as a guess', async () => {
  const store = await freshStore();
  const first = await store.startRound({ dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232 });
  const second = await store.startRound({ dayKey: '2026-08-20', userId: 'u1', puzzleNumber: 232 });
  assert.equal(first.started, true);
  assert.equal(second.started, false, 'only the first arrival announces anyone');
  assert.deepEqual(first.round.guessIds, []);
});

test('the scoreboard ranks wins by guesses, then by who finished first', () => {
  const day = {
    slow: round(2, true, '2026-08-20T11:00:00.000Z'),
    quick: round(2, true, '2026-08-20T09:30:00.000Z'),
    best: round(1, true, '2026-08-20T12:00:00.000Z'),
    lost: round(5, false, '2026-08-20T08:00:00.000Z'),
  };
  assert.deepEqual(scoreboard(day).map((r) => r.userId), ['best', 'quick', 'slow', 'lost']);
  assert.equal(scoreboard(day).at(-1).won, false, 'a loss sorts below every win');
});

test('an unfinished round is on nobody’s scoreboard', () => {
  const day = { done: round(3, true), midway: { ...round(2, false), finishedAt: null } };
  assert.deepEqual(scoreboard(day).map((r) => r.userId), ['done']);
  assert.deepEqual(playing(day).map((r) => r.userId), ['midway']);
  assert.deepEqual(participants(day).sort(), ['done', 'midway']);
});

test('the group streak counts back over consecutive played days', () => {
  const days = {
    '2026-08-20': { a: round(3, true) },
    '2026-08-19': { a: round(4, true) },
    '2026-08-18': { b: round(5, false) },
    // 17th missed entirely
    '2026-08-16': { a: round(2, true) },
  };
  assert.equal(groupStreak(days, '2026-08-20'), 3, 'a loss still counts as playing');
  assert.equal(groupStreak(days, '2026-08-19'), 2);
  assert.equal(groupStreak(days, '2026-08-17'), 0, 'the gap breaks it');
});

test('a day nobody finished does not extend the streak', () => {
  const days = {
    '2026-08-20': { a: { ...round(1, false), finishedAt: null } },
    '2026-08-19': { a: round(3, true) },
  };
  assert.equal(groupStreak(days, '2026-08-20'), 0, 'starting is not playing');
  assert.equal(groupStreak(days, '2026-08-19'), 1);
});

test('the streak can demand more than one player', () => {
  const days = {
    '2026-08-20': { a: round(3, true), b: round(4, true) },
    '2026-08-19': { a: round(3, true) },
    '2026-08-18': { a: round(3, true), b: round(2, true), c: round(5, false) },
  };
  assert.equal(groupStreak(days, '2026-08-20', { minPlayers: 2 }), 1, 'the 19th had only one');
  assert.equal(groupStreak(days, '2026-08-20', { minPlayers: 1 }), 3);
});

test('an empty history is a zero streak, not a crash', () => {
  assert.equal(groupStreak({}, '2026-08-20'), 0);
  assert.deepEqual(scoreboard(undefined), []);
  assert.deepEqual(playing(), []);
});

test('forgetting a player removes every round they played', async () => {
  const store = await freshStore();
  for (const dayKey of ['2026-08-18', '2026-08-19']) {
    await store.recordGuess({ dayKey, userId: 'gone', guessId: 'a', correct: true, puzzleNumber: 1 });
    await store.recordGuess({ dayKey, userId: 'stays', guessId: 'b', correct: false, puzzleNumber: 1 });
  }

  const { removed } = await store.forget('gone');
  assert.equal(removed, 2);
  assert.equal(await store.round('2026-08-18', 'gone'), null);
  assert.ok(await store.round('2026-08-18', 'stays'), 'everyone else is untouched');
});

test('a day left empty by a deletion is dropped, not left as a husk', async () => {
  const store = await freshStore();
  await store.recordGuess({ dayKey: '2026-08-20', userId: 'gone', guessId: 'a', correct: true, puzzleNumber: 1 });
  await store.forget('gone');
  assert.deepEqual(await store.read(), {}, 'no trace of having played remains');
});

test('forgetting somebody who never played is a no-op', async () => {
  const store = await freshStore();
  await store.recordGuess({ dayKey: '2026-08-20', userId: 'stays', guessId: 'a', correct: true, puzzleNumber: 1 });
  assert.deepEqual(await store.forget('nobody'), { removed: 0 });
  assert.ok(await store.round('2026-08-20', 'stays'));
});

test('export hands over everything held about one player, and nothing else', async () => {
  const store = await freshStore();
  await store.recordGuess({ dayKey: '2026-08-19', userId: 'me', guessId: 'a', correct: true, puzzleNumber: 1 });
  await store.recordGuess({ dayKey: '2026-08-19', userId: 'other', guessId: 'b', correct: true, puzzleNumber: 1 });
  await store.recordGuess({ dayKey: '2026-08-20', userId: 'me', guessId: 'c', correct: false, puzzleNumber: 2 });

  const mine = await store.export('me');
  assert.deepEqual(Object.keys(mine).sort(), ['2026-08-19', '2026-08-20']);
  assert.equal(JSON.stringify(mine).includes('other'), false);
  assert.deepEqual(await store.export('never-played'), {});
});
