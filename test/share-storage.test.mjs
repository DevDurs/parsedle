import test from 'node:test';
import assert from 'node:assert/strict';

import PARSES from '../src/data/parses.js';
import { evaluateGuess } from '../src/lib/compare.js';
import { shareGrid, shareText } from '../src/lib/share.js';
import { emptyStats, recordResult } from '../src/lib/storage.js';

const byId = (id) => PARSES.find((p) => p.id === id);
const answer = byId('p001');
const wrong = evaluateGuess(byId('p019'), answer);
const right = evaluateGuess(answer, answer);

test('the share grid is one row of squares per guess', () => {
  const grid = shareGrid([wrong, right]);
  const rows = grid.split('\n');
  assert.equal(rows.length, 2);
  assert.equal([...rows[1]].length, 9, 'one square per board column');
  assert.equal(rows[1], '🟩'.repeat(9), 'the winning guess is all green');
});

test('share text leads with the puzzle number and score', () => {
  const won = shareText({ puzzleNumber: 42, guesses: [wrong, right], won: true, hintsUsed: 2 });
  assert.match(won, /^Parsedle #42 2\/5 · 2 hints/);
  const lost = shareText({ puzzleNumber: 42, guesses: [wrong], won: false });
  assert.match(lost, /^Parsedle #42 X\/5\n/);
  assert.ok(!lost.includes('hint'), 'no hint note when none were opened');
});

test('the share text never leaks the answer', () => {
  const text = shareText({ puzzleNumber: 7, guesses: [wrong, right], won: true });
  assert.ok(!text.includes(answer.player));
  assert.ok(!text.includes(answer.boss));
});

test('a win extends the streak only on consecutive days', () => {
  let stats = emptyStats();
  stats = recordResult({ won: true, guessCount: 3, puzzleNumber: 10 }, stats);
  assert.deepEqual([stats.played, stats.won, stats.currentStreak, stats.maxStreak], [1, 1, 1, 1]);
  assert.equal(stats.distribution[2], 1);

  stats = recordResult({ won: true, guessCount: 1, puzzleNumber: 11 }, stats);
  assert.equal(stats.currentStreak, 2);

  stats = recordResult({ won: true, guessCount: 1, puzzleNumber: 20 }, stats);
  assert.equal(stats.currentStreak, 1, 'a skipped day restarts the streak');
  assert.equal(stats.maxStreak, 2);
});

test('a loss breaks the streak but still counts as played', () => {
  let stats = recordResult({ won: true, guessCount: 2, puzzleNumber: 5 }, emptyStats());
  stats = recordResult({ won: false, guessCount: 5, puzzleNumber: 6 }, stats);
  assert.deepEqual([stats.played, stats.won, stats.currentStreak], [2, 1, 0]);
  assert.equal(stats.distribution.reduce((a, b) => a + b, 0), 1, 'losses stay out of the distribution');
});

test('re-recording the same puzzle changes nothing', () => {
  const first = recordResult({ won: true, guessCount: 2, puzzleNumber: 30 }, emptyStats());
  const again = recordResult({ won: true, guessCount: 2, puzzleNumber: 30 }, first);
  assert.deepEqual(again, first);
});
