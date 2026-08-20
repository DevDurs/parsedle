/**
 * What everybody scored, and the group streak that falls out of it.
 *
 * This is the file that makes the round authoritative. While progress lived in
 * the browser, clearing localStorage undid a loss; once results feed a public
 * scoreboard that is not good enough, so the server owns the guess list and
 * the client is told what it has done.
 *
 * Shape: dayKey -> discordId -> round. One file, written atomically, the same
 * pattern as the report list and the roster.
 */

import { readJson, writeJson } from './json-store.js';
import { MAX_GUESSES } from '../src/lib/compare.js';

/** Days back a streak may reach. A year is far more than anyone will hold. */
const MAX_STREAK_LOOKBACK = 400;

const DAY_MS = 86400000;

/** `2026-08-20` -> `2026-08-19`. */
export function previousDayKey(dayKey) {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

export class ResultStore {
  constructor(file) {
    this.file = file;
  }

  async read() {
    const saved = await readJson(this.file, { days: {} });
    return saved?.days && typeof saved.days === 'object' ? saved.days : {};
  }

  async write(days) {
    await writeJson(this.file, { days }, { name: 'results' });
    return days;
  }

  /** One player's round, or null if they have not started today. */
  async round(dayKey, userId) {
    return (await this.read())[dayKey]?.[userId] ?? null;
  }

  async day(dayKey) {
    return (await this.read())[dayKey] ?? {};
  }

  /**
   * Append a guess to a player's round, and return the round as it now stands.
   *
   * Refuses to extend a finished round, so a replayed request cannot turn a
   * loss into a win or push someone past five guesses.
   *
   * @param {{dayKey: string, userId: string, guessId: string, correct: boolean, puzzleNumber: number, now?: number}} entry
   */
  async recordGuess({ dayKey, userId, guessId, correct, puzzleNumber, now = Date.now() }) {
    const days = await this.read();
    const day = (days[dayKey] ??= {});
    const round = (day[userId] ??= {
      puzzleNumber,
      guessIds: [],
      won: false,
      startedAt: new Date(now).toISOString(),
      finishedAt: null,
    });

    if (round.finishedAt) return { round, added: false };
    if (round.guessIds.includes(guessId)) return { round, added: false };

    round.guessIds.push(guessId);
    round.won = Boolean(correct);
    if (round.won || round.guessIds.length >= MAX_GUESSES) {
      round.finishedAt = new Date(now).toISOString();
    }

    await this.write(days);
    return { round, added: true };
  }

  /**
   * Erase every round belonging to one player.
   *
   * The privacy policy promises deletion on request, so this exists to make
   * that a command rather than a hand edit. Days left empty are dropped too,
   * so no trace of the player's participation remains in the shape of the
   * file.
   */
  async forget(userId) {
    const days = await this.read();
    let removed = 0;
    for (const [dayKey, day] of Object.entries(days)) {
      if (!(userId in day)) continue;
      delete day[userId];
      removed += 1;
      if (Object.keys(day).length === 0) delete days[dayKey];
    }
    if (removed) await this.write(days);
    return { removed };
  }

  /** Everything held about one player, for a "what do you have on me" request. */
  async export(userId) {
    const days = await this.read();
    const rounds = {};
    for (const [dayKey, day] of Object.entries(days)) {
      if (day[userId]) rounds[dayKey] = day[userId];
    }
    return rounds;
  }

  /** Marks a round started before the first guess, so "who is playing" can fire. */
  async startRound({ dayKey, userId, puzzleNumber, now = Date.now() }) {
    const days = await this.read();
    const day = (days[dayKey] ??= {});
    if (day[userId]) return { round: day[userId], started: false };

    day[userId] = {
      puzzleNumber,
      guessIds: [],
      won: false,
      startedAt: new Date(now).toISOString(),
      finishedAt: null,
    };
    await this.write(days);
    return { round: day[userId], started: true };
  }
}

/** Everyone who finished on `dayKey`, best score first. */
export function scoreboard(day = {}) {
  return Object.entries(day)
    .filter(([, round]) => round.finishedAt)
    .map(([userId, round]) => ({
      userId,
      guesses: round.guessIds.length,
      won: round.won,
      finishedAt: round.finishedAt,
      // A loss sorts below every win, then ties break on who finished first.
      rank: round.won ? round.guessIds.length : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
}

/**
 * The group streak: consecutive days, counting back from `dayKey`, on which at
 * least `minPlayers` people finished.
 *
 * Derived rather than stored — the results are the only source of truth, and
 * at a few hundred days this costs nothing.
 */
export function groupStreak(days, dayKey, { minPlayers = 1 } = {}) {
  let streak = 0;
  let cursor = dayKey;
  for (let i = 0; i < MAX_STREAK_LOOKBACK; i++) {
    const finished = scoreboard(days[cursor] ?? {}).length;
    if (finished < minPlayers) break;
    streak += 1;
    cursor = previousDayKey(cursor);
  }
  return streak;
}

/** Anyone who has started but not finished — the "is playing" list. */
export function playing(day = {}) {
  return Object.entries(day)
    .filter(([, round]) => !round.finishedAt)
    .map(([userId, round]) => ({ userId, startedAt: round.startedAt }))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** Everyone who touched the puzzle, in the order they arrived. */
export function participants(day = {}) {
  return Object.entries(day)
    .sort((a, b) => Date.parse(a[1].startedAt) - Date.parse(b[1].startedAt))
    .map(([userId]) => userId);
}
