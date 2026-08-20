/**
 * Progress and stats, kept in localStorage.
 *
 * Progress is stored under the day key so a reload mid-puzzle restores the
 * board, and yesterday's board never bleeds into today's.
 */

import { MAX_GUESSES } from './compare.js';

const PROGRESS_KEY = 'parsedle:progress';
const STATS_KEY = 'parsedle:stats';

/** localStorage is absent in Node and throws in private-mode Safari. */
function safeStore() {
  try {
    if (typeof localStorage === 'undefined') return null;
    localStorage.setItem('parsedle:probe', '1');
    localStorage.removeItem('parsedle:probe');
    return localStorage;
  } catch {
    return null;
  }
}

function read(key, fallback) {
  const store = safeStore();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  const store = safeStore();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or disabled storage — the game still plays, it just forgets. */
  }
}

export function emptyStats() {
  return {
    played: 0,
    won: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedNumber: null,
    distribution: Array.from({ length: MAX_GUESSES }, () => 0),
  };
}

export function loadProgress(dayKey) {
  const saved = read(PROGRESS_KEY, null);
  if (!saved || saved.dayKey !== dayKey) return null;
  return saved;
}

/** @param {{dayKey: string, guessIds: string[], startedAt: number, finished: boolean}} progress */
export function saveProgress(progress) {
  write(PROGRESS_KEY, progress);
}

export function loadStats() {
  return { ...emptyStats(), ...read(STATS_KEY, {}) };
}

/**
 * Fold one finished puzzle into the stats. Recording the same puzzle twice is
 * a no-op, so a reload after the result screen cannot inflate a streak.
 *
 * @param {{won: boolean, guessCount: number, puzzleNumber: number}} result
 */
export function recordResult({ won, guessCount, puzzleNumber }, stats = loadStats()) {
  if (stats.lastPlayedNumber === puzzleNumber) return stats;

  const consecutive = stats.lastPlayedNumber === puzzleNumber - 1;
  const next = {
    ...stats,
    played: stats.played + 1,
    won: stats.won + (won ? 1 : 0),
    currentStreak: won ? (consecutive ? stats.currentStreak : 0) + 1 : 0,
    lastPlayedNumber: puzzleNumber,
    distribution: stats.distribution.slice(),
  };
  next.maxStreak = Math.max(stats.maxStreak, next.currentStreak);
  if (won && guessCount >= 1 && guessCount <= next.distribution.length) {
    next.distribution[guessCount - 1] += 1;
  }
  write(STATS_KEY, next);
  return next;
}
