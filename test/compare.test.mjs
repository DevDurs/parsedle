import test from 'node:test';
import assert from 'node:assert/strict';

import PARSES from '../src/data/parses.js';
import { FIELDS, MAX_GUESSES, compareField, evaluateGuess, gameStatus } from '../src/lib/compare.js';

const byId = (id) => PARSES.find((p) => p.id === id);

test('the dataset is well formed', () => {
  assert.equal(new Set(PARSES.map((p) => p.id)).size, PARSES.length);
  assert.equal(new Set(PARSES.map((p) => p.player)).size, PARSES.length, 'players are unique, so a name identifies a parse');
  for (const p of PARSES) {
    assert.ok(['dps', 'healer', 'tank'].includes(p.role), `${p.player} role`);
    assert.ok(p.percentile >= 0 && p.percentile <= 100, `${p.player} percentile`);
    assert.ok(p.ilvl > 0 && p.durationSec > 0 && p.amount > 0, `${p.player} numbers`);
  }
});

test('a field matches exactly or not at all', () => {
  const a = byId('p001');
  assert.equal(compareField('region', a, a).verdict, 'hit');
  assert.equal(compareField('region', byId('p002'), a).verdict, 'miss');
});

test('spec is near when the class is right but the spec is not', () => {
  const answer = byId('p001'); // Shadow Priest
  assert.equal(compareField('spec', byId('p040'), answer).verdict, 'hit', 'same class and spec');
  assert.equal(compareField('spec', byId('p016'), answer).verdict, 'near', 'Discipline Priest');
  assert.equal(compareField('spec', byId('p002'), answer).verdict, 'miss', 'Fury Warrior');
});

test('boss is near when the raid matches', () => {
  const answer = byId('p001'); // Dimensius, Manaforge Omega
  assert.equal(compareField('boss', byId('p009'), answer).verdict, 'hit');
  assert.equal(compareField('boss', byId('p006'), answer).verdict, 'near', 'same raid, other boss');
  assert.equal(compareField('boss', byId('p019'), answer).verdict, 'miss', 'different raid');
});

test('difficulty points up or down the ladder', () => {
  const mythic = byId('p001');
  const heroic = byId('p003');
  const normal = byId('p017');
  assert.deepEqual(compareField('difficulty', heroic, mythic).direction, 'up');
  assert.deepEqual(compareField('difficulty', mythic, normal).direction, 'down');
  assert.equal(compareField('difficulty', mythic, byId('p002')).verdict, 'hit');
});

test('numbers are hit, near inside the window, or a signposted miss', () => {
  const answer = { percentile: 90, ilvl: 680 };
  assert.deepEqual(compareField('percentile', { percentile: 90 }, answer), { verdict: 'hit', direction: null, delta: 0 });

  const near = compareField('percentile', { percentile: 85 }, answer);
  assert.equal(near.verdict, 'near');
  assert.equal(near.direction, 'up');

  const far = compareField('percentile', { percentile: 40 }, answer);
  assert.equal(far.verdict, 'miss');
  assert.equal(far.direction, 'up');

  const above = compareField('ilvl', { ilvl: 700 }, answer);
  assert.equal(above.direction, 'down', 'the answer is lower than the guess');
});

test('guessing the answer lights up every column', () => {
  const answer = byId('p014');
  const result = evaluateGuess(answer, answer);
  assert.equal(result.correct, true);
  for (const { key } of FIELDS) {
    assert.equal(result.fields[key].verdict, 'hit', `${key} should be a hit`);
  }
});

test('game status tracks wins, losses and guesses left', () => {
  const answer = byId('p010');
  const wrong = evaluateGuess(byId('p011'), answer);
  const right = evaluateGuess(answer, answer);

  assert.deepEqual(gameStatus([]), { status: 'playing', guessesUsed: 0, guessesLeft: MAX_GUESSES });
  assert.equal(gameStatus([wrong, right]).status, 'won');
  assert.equal(gameStatus([wrong, wrong, wrong, wrong]).status, 'playing');
  assert.equal(gameStatus([wrong, wrong, wrong, wrong, wrong]).status, 'lost');
  assert.equal(gameStatus([wrong, wrong, wrong, wrong, wrong]).guessesLeft, 0);
});
