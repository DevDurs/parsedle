import test from 'node:test';
import assert from 'node:assert/strict';

import PARSES from '../src/data/parses.js';
import { buildPuzzleView, clampElapsed, publicParse, rosterOf } from '../server/puzzle.js';
import { pickDaily } from '../src/lib/daily.js';
import { HINT_INTERVAL_MS } from '../src/lib/hints.js';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const answer = pickDaily(PARSES, new Date(NOW));
const other = PARSES.find((p) => p.id !== answer.id);

const view = (session = {}) => buildPuzzleView(PARSES, { now: NOW, ...session });

test('a fresh view gives the clue and nothing else', () => {
  const v = view();
  assert.equal(v.answer, null);
  assert.equal(v.status, 'playing');
  assert.equal(v.guesses.length, 0);
  assert.equal(v.clue.amount, answer.amount);
  assert.equal(v.clue.durationSec, answer.durationSec);
});

test('the output unit stays hidden until the role hint opens', () => {
  assert.equal(view().clue.unit, null, 'HPS would give away a healer');
  assert.equal(view({ guessIds: [other.id] }).clue.unit, answer.role === 'healer' ? 'HPS' : 'DPS');
});

test('locked hints are masked server-side, so the payload cannot be read ahead', () => {
  const v = view();
  const serialised = JSON.stringify(v);
  assert.equal(v.hints.filter((h) => !h.locked).length, 1);
  for (const hint of v.hints.filter((h) => h.locked)) assert.equal(hint.value, '???');
  assert.ok(!serialised.includes(answer.player), 'the answer name is not in the response');
  assert.ok(!serialised.includes(answer.boss), 'nor the boss');
});

test('hints open on guesses and on the clock alike', () => {
  assert.equal(view({ guessIds: [other.id] }).hints.filter((h) => !h.locked).length, 2);
  assert.equal(
    view({ startedAt: NOW - 2 * HINT_INTERVAL_MS }).hints.filter((h) => !h.locked).length,
    3,
    'six minutes of patience is worth two guesses',
  );
});

test('a guess comes back scored, with the guessed row filled in', () => {
  const v = view({ guessIds: [other.id] });
  assert.equal(v.guesses.length, 1);
  assert.equal(v.guesses[0].parse.player, other.player);
  assert.equal(v.guesses[0].correct, false);
  for (const field of v.fields) assert.ok(v.guesses[0].fields[field.key], `${field.key} scored`);
  assert.equal(v.guessesLeft, 4);
});

test('guessing right ends the round and reveals the answer', () => {
  const v = view({ guessIds: [other.id, answer.id] });
  assert.equal(v.status, 'won');
  assert.equal(v.answer.player, answer.player);
  assert.ok(v.hints.every((h) => !h.locked), 'the rest of the hints open once it is over');
  assert.equal(v.msUntilNextHint, null);
});

test('running out of guesses reveals it too', () => {
  const wrong = PARSES.filter((p) => p.id !== answer.id).slice(0, 5).map((p) => p.id);
  const v = view({ guessIds: wrong });
  assert.equal(v.status, 'lost');
  assert.equal(v.answer.player, answer.player);
  assert.equal(v.guessesLeft, 0);
});

test('guesses past the limit, duplicates and unknown ids are ignored', () => {
  const wrong = PARSES.filter((p) => p.id !== answer.id).map((p) => p.id);
  assert.equal(view({ guessIds: wrong.slice(0, 9) }).guesses.length, 5, 'capped at five');
  assert.equal(view({ guessIds: [other.id, other.id] }).guesses.length, 1, 'deduplicated');
  assert.equal(view({ guessIds: ['nope', other.id] }).guesses.length, 1, 'stale ids drop out');
});

test('guesses after a win are discarded rather than scored', () => {
  const v = view({ guessIds: [answer.id, other.id] });
  assert.equal(v.guesses.length, 1);
  assert.equal(v.status, 'won');
});

test('a pool from one guild hides the columns that never vary', () => {
  const oneGuild = PARSES.filter((p) => p.guild === 'Nine Circles');
  const keys = buildPuzzleView(oneGuild, { now: NOW }).fields.map((f) => f.key);
  assert.ok(!keys.includes('guild'), 'everyone shares a guild');
  assert.ok(keys.includes('class') && keys.includes('percentile'));
});

test('a forged startedAt cannot rush the hints or break the view', () => {
  assert.equal(clampElapsed(NOW + 10_000_000, NOW), 0, 'the future reads as no time at all');
  assert.equal(clampElapsed(NOW - 999 * 86400000, NOW), 86400000, 'capped at a day');
  assert.equal(clampElapsed('nonsense', NOW), 0);
  assert.equal(view({ startedAt: NOW - 999 * 86400000 }).hints.every((h) => !h.locked), true);
});

test('the roster is names and ids only', () => {
  const roster = rosterOf(PARSES);
  assert.equal(roster.length, PARSES.length);
  assert.deepEqual(Object.keys(roster[0]).sort(), ['id', 'player']);
  assert.deepEqual(roster.map((r) => r.player), [...roster.map((r) => r.player)].sort((a, b) => a.localeCompare(b)));
});

test('a published parse links its log but drops the internal fields', () => {
  const published = publicParse({ ...answer, reportCode: 'AbCd1234EfGh5678', reportTitle: 'Wednesday', fightID: 3 });
  assert.deepEqual(published.report, { code: 'AbCd1234EfGh5678', title: 'Wednesday', fightID: 3 });
  assert.equal(published.reportCode, undefined);
  assert.equal(publicParse(answer).report, null);
});

test('the board gets readable role labels, not the raw enum', () => {
  const v = view({ guessIds: [other.id] });
  assert.ok(['Damage', 'Healer', 'Tank'].includes(v.guesses[0].parse.role), v.guesses[0].parse.role);
});
