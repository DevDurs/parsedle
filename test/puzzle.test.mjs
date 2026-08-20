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
  const wrong = PARSES.filter((p) => p.id !== answer.id).map((p) => p.id);
  assert.equal(view().clue.unit, null, 'HPS would give away a healer on sight');
  assert.equal(view({ guessIds: wrong.slice(0, 2) }).clue.unit, null, 'still hidden two guesses in');
  assert.equal(
    view({ guessIds: wrong.slice(0, 3) }).clue.unit,
    answer.role === 'healer' ? 'HPS' : 'DPS',
    'it appears with the role hint, not before',
  );
});

test('role is late in the ladder; percentile and armor come first', () => {
  const ids = view().hints.map((h) => h.id);
  assert.deepEqual(ids.slice(0, 4), ['raid', 'percentile', 'armor', 'role']);

  const opened = (guesses) =>
    view({ guessIds: PARSES.filter((p) => p.id !== answer.id).slice(0, guesses).map((p) => p.id) })
      .hints.filter((h) => !h.locked)
      .map((h) => h.id);
  assert.deepEqual(opened(0), ['raid'], 'the raid frames the puzzle and gives nothing away');
  assert.deepEqual(opened(1), ['raid', 'percentile']);
  assert.deepEqual(opened(2), ['raid', 'percentile', 'armor']);
  assert.ok(opened(3).includes('role'), 'role arrives on the third guess, not the first');
});

test('locked hints are masked server-side, so the payload cannot be read ahead', () => {
  const v = view();
  assert.equal(v.hints.filter((h) => !h.locked).length, 1);
  for (const hint of v.hints.filter((h) => h.locked)) assert.equal(hint.value, '???');

  // The answer's name is in the roster, as it must be — you have to be able to
  // guess them — but nothing marks it out, and no attribute of the parse rides
  // along outside the hints that have been earned.
  const withoutRoster = JSON.stringify({ ...v, roster: null });
  assert.ok(!withoutRoster.includes(answer.player), 'the name appears only among the other candidates');
  assert.ok(!JSON.stringify(v).includes(answer.boss), 'the boss is nowhere in the payload');
  assert.ok(!withoutRoster.includes(answer.spec), 'nor the spec');
  assert.ok(v.roster.some((r) => r.player === answer.player), 'and the answer is guessable');
  assert.deepEqual(Object.keys(v.roster[0]).sort(), ['id', 'player']);
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

test('columns that never vary are left off the board', () => {
  const oneRegion = PARSES.filter((p) => p.region === 'EU');
  const keys = buildPuzzleView(oneRegion, { now: NOW }).fields.map((f) => f.key);
  assert.ok(!keys.includes('region'), 'one guild, one region — the column would always be green');
  assert.ok(keys.includes('class') && keys.includes('percentile'));
  assert.ok(!keys.includes('guild'), 'guilds are gone entirely: only our own raiders play');
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

test('only raiders from the answer’s own night are guessable', () => {
  // Tuesday and Wednesday share one raider; two more sat out one night each.
  const pool = [
    { ...PARSES[0], id: 'a', player: 'Bothnights', reportCode: 'WED', reports: ['TUE', 'WED'] },
    { ...PARSES[1], id: 'b', player: 'Wednesdayonly', reportCode: 'WED', reports: ['WED'] },
    { ...PARSES[2], id: 'c', player: 'Tuesdayonly', reportCode: 'TUE', reports: ['TUE'] },
  ];

  // Whoever the day picks, the roster is exactly that night's raid.
  for (let day = 0; day < 6; day++) {
    const v = buildPuzzleView(pool, { now: NOW + day * 86400000 });
    const night = pool.find((p) => p.player === v.roster.find((r) => r.id === v.roster[0].id).player);
    const names = v.roster.map((r) => r.player).sort();
    assert.ok(
      names.join() === ['Bothnights', 'Wednesdayonly'].join() || names.join() === ['Bothnights', 'Tuesdayonly'].join(),
      `roster was ${names.join()}`,
    );
    assert.equal(v.raidSize, names.length);
    assert.ok(night, 'the roster only holds raiders from the pool');
  }
});

test('a raider whose best parse came from the other night still counts as present', () => {
  const pool = [
    // Best parse on Tuesday, but she raided Wednesday too.
    { ...PARSES[0], id: 'a', player: 'Bothnights', reportCode: 'TUE', reports: ['TUE', 'WED'] },
    { ...PARSES[1], id: 'b', player: 'Wednesdayonly', reportCode: 'WED', reports: ['WED'] },
  ];
  const wednesday = buildPuzzleView(pool, { now: NOW, date: new Date(NOW) });
  if (wednesday.roster.some((r) => r.player === 'Wednesdayonly')) {
    assert.ok(
      wednesday.roster.some((r) => r.player === 'Bothnights'),
      'she was there on Wednesday, so she is guessable on Wednesday',
    );
  }
});

test('a guess for someone who was not in that raid is dropped', () => {
  const pool = [
    { ...PARSES[0], id: 'a', player: 'Present', reportCode: 'WED', reports: ['WED'] },
    { ...PARSES[1], id: 'b', player: 'Alsopresent', reportCode: 'WED', reports: ['WED'] },
    { ...PARSES[2], id: 'c', player: 'Satout', reportCode: 'TUE', reports: ['TUE'] },
  ];
  const v = buildPuzzleView(pool, { now: NOW, guessIds: ['c', 'b'] });
  assert.ok(!v.roster.some((r) => r.player === 'Satout'));
  assert.deepEqual(v.guesses.map((g) => g.parse.player), ['Alsopresent'], 'the absent raider never reaches the board');
});

test('a pool with no report data — the bundled sample — stays whole', () => {
  const v = view();
  assert.equal(v.roster.length, PARSES.length);
  assert.equal(v.raidSize, PARSES.length);
});
