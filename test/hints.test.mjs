import test from 'node:test';
import assert from 'node:assert/strict';

import PARSES from '../src/data/parses.js';
import {
  ARMOR_BY_CLASS,
  HINT_INTERVAL_MS,
  formatAmount,
  formatDuration,
  hintsFor,
  msUntilNextHint,
  percentileBracket,
  unlockedHintCount,
  visibleHints,
} from '../src/lib/hints.js';

test('every class in the pool has an armor type', () => {
  for (const p of PARSES) {
    assert.ok(ARMOR_BY_CLASS[p.class], `${p.class} is missing from ARMOR_BY_CLASS`);
  }
});

test('percentile brackets round down to the decade', () => {
  assert.equal(percentileBracket(94), '90-99');
  assert.equal(percentileBracket(90), '90-99');
  assert.equal(percentileBracket(55), '50-59');
  assert.equal(percentileBracket(100), '100 (rank one)');
});

test('formatting reads the way a log does', () => {
  assert.equal(formatDuration(604), '10:04');
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatAmount(1842000, 'dps'), '1.84M DPS');
  assert.equal(formatAmount(912000, 'healer'), '0.91M HPS');
});

test('the guild hint shows one letter and the length', () => {
  const guild = hintsFor(PARSES[0]).find((h) => h.id === 'guild');
  assert.ok(guild.value.startsWith(PARSES[0].guild[0]));
  assert.equal(guild.value.length, PARSES[0].guild.length);
  assert.ok(!guild.value.includes(PARSES[0].guild.slice(1)));
});

test('one hint is free, and guesses open the rest', () => {
  const total = hintsFor(PARSES[0]).length;
  assert.equal(unlockedHintCount({ guessesMade: 0, elapsedMs: 0, total }), 1);
  assert.equal(unlockedHintCount({ guessesMade: 3, elapsedMs: 0, total }), 4);
  assert.equal(unlockedHintCount({ guessesMade: 99, elapsedMs: 0, total }), total, 'capped at the number of hints');
});

test('waiting opens hints too, and the faster of the two wins', () => {
  const total = hintsFor(PARSES[0]).length;
  assert.equal(unlockedHintCount({ guessesMade: 0, elapsedMs: 2 * HINT_INTERVAL_MS, total }), 3);
  assert.equal(
    unlockedHintCount({ guessesMade: 4, elapsedMs: 2 * HINT_INTERVAL_MS, total }),
    5,
    'guesses are ahead of the clock here',
  );
});

test('the next-hint countdown tracks the clock, then stops', () => {
  const total = hintsFor(PARSES[0]).length;
  assert.equal(msUntilNextHint({ guessesMade: 0, elapsedMs: 0, total }), HINT_INTERVAL_MS);
  assert.equal(msUntilNextHint({ guessesMade: 0, elapsedMs: HINT_INTERVAL_MS - 1000, total }), 1000);
  assert.equal(msUntilNextHint({ guessesMade: 99, elapsedMs: 0, total }), null, 'nothing left to wait for');
});

test('locked hints are masked, not merely hidden', () => {
  const parse = PARSES[0];
  const hints = visibleHints(parse, { guessesMade: 0, elapsedMs: 0 });
  assert.equal(hints[0].locked, false);
  assert.equal(hints[0].value, parse.raid);
  for (const hint of hints.slice(1)) {
    assert.equal(hint.locked, true);
    assert.equal(hint.value, '???');
  }
});
