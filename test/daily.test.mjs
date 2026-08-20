import test from 'node:test';
import assert from 'node:assert/strict';

import PARSES from '../src/data/parses.js';
import { dayKey, hashString, msUntilNextPuzzle, pickDaily, puzzleNumber, seededShuffle } from '../src/lib/daily.js';

const at = (iso) => new Date(iso);

test('dayKey and puzzleNumber follow UTC days, not local ones', () => {
  assert.equal(dayKey(at('2026-01-01T00:00:00Z')), '2026-01-01');
  assert.equal(dayKey(at('2026-01-01T23:59:59Z')), '2026-01-01');
  assert.equal(puzzleNumber(at('2026-01-01T12:00:00Z')), 1);
  assert.equal(puzzleNumber(at('2026-01-02T00:00:00Z')), 2);
  assert.equal(puzzleNumber(at('2026-08-20T09:00:00Z')), 232);
});

test('everyone playing the same UTC day gets the same parse', () => {
  const morning = pickDaily(PARSES, at('2026-03-04T00:00:01Z'));
  const evening = pickDaily(PARSES, at('2026-03-04T23:59:59Z'));
  assert.equal(morning.id, evening.id);
});

test('consecutive days differ, and a full cycle uses every parse once', () => {
  const seen = [];
  for (let i = 0; i < PARSES.length; i++) {
    seen.push(pickDaily(PARSES, at(`2026-01-01T12:00:00Z`)).id);
  }
  // Same day, same answer — determinism first.
  assert.equal(new Set(seen).size, 1);

  const cycle = [];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < PARSES.length; i++) {
    cycle.push(pickDaily(PARSES, new Date(start + i * 86400000)).id);
  }
  assert.equal(new Set(cycle).size, PARSES.length, 'no repeats within a cycle');
});

test('the next cycle reshuffles rather than replaying the same order', () => {
  const start = Date.UTC(2026, 0, 1);
  const day = 86400000;
  const first = [];
  const second = [];
  for (let i = 0; i < PARSES.length; i++) {
    first.push(pickDaily(PARSES, new Date(start + i * day)).id);
    second.push(pickDaily(PARSES, new Date(start + (i + PARSES.length) * day)).id);
  }
  assert.notDeepEqual(first, second);
  assert.deepEqual(new Set(second).size, PARSES.length);
});

test('pickDaily leaves the pool untouched', () => {
  const before = PARSES.map((p) => p.id);
  pickDaily(PARSES, at('2026-05-05T00:00:00Z'));
  assert.deepEqual(PARSES.map((p) => p.id), before);
});

test('pickDaily rejects an empty pool', () => {
  assert.throws(() => pickDaily([], at('2026-05-05T00:00:00Z')), /empty pool/);
});

test('dates before the epoch still resolve to a parse', () => {
  const parse = pickDaily(PARSES, at('2025-11-11T00:00:00Z'));
  assert.ok(PARSES.some((p) => p.id === parse.id));
});

test('hashString is stable and seededShuffle is a permutation', () => {
  assert.equal(hashString('parsedle'), hashString('parsedle'));
  assert.notEqual(hashString('a'), hashString('b'));
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const shuffled = seededShuffle(items, 1234);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
  assert.deepEqual(shuffled, seededShuffle(items, 1234));
});

test('the countdown runs a full day and never goes negative', () => {
  const left = msUntilNextPuzzle(at('2026-08-20T23:00:00Z'));
  assert.equal(left, 3600000);
  assert.ok(msUntilNextPuzzle(at('2026-08-20T00:00:00Z')) === 86400000);
});
