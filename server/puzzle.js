/**
 * Building the view a player is allowed to see.
 *
 * The answer lives on the server. A client sends the guesses it has made and
 * gets back the scored board, whatever hints it has earned, and — only once
 * the round is over — who it actually was.
 */

import { activeFields, evaluateGuess, gameStatus, MAX_GUESSES } from '../src/lib/compare.js';
import { dayKey, msUntilNextPuzzle, pickDaily, puzzleNumber } from '../src/lib/daily.js';
import { hintsFor, unlockedHintCount, msUntilNextHint, ROLE_LABELS } from '../src/lib/hints.js';

/** A session cannot be older than the puzzle it is playing. */
const DAY_MS = 86400000;

export function clampElapsed(startedAt, now) {
  // A missing start reads as "just opened", never as the epoch.
  if (startedAt === null || startedAt === undefined || startedAt === '') return 0;
  const started = Number(startedAt);
  if (!Number.isFinite(started) || started <= 0) return 0;
  return Math.max(0, Math.min(DAY_MS, now - started));
}

/**
 * @param {object[]} pool
 * @param {{guessIds?: string[], startedAt?: number, now?: number, date?: Date}} [session]
 */
export function buildPuzzleView(pool, { guessIds = [], startedAt = null, now = Date.now(), date } = {}) {
  const when = date ?? new Date(now);
  const answer = pickDaily(pool, when);
  const fields = activeFields(pool);
  const byId = new Map(pool.map((p) => [p.id, p]));

  // Unknown ids are dropped rather than rejected: a stale localStorage from
  // before the pool was rebuilt should not brick someone's board.
  const seen = new Set();
  const guesses = [];
  for (const id of guessIds) {
    if (seen.has(id) || !byId.has(id) || guesses.length >= MAX_GUESSES) continue;
    seen.add(id);
    guesses.push(evaluateGuess(byId.get(id), answer, fields));
    if (guesses.at(-1).correct) break;
  }

  const status = gameStatus(guesses);
  const finished = status.status !== 'playing';
  const elapsedMs = clampElapsed(startedAt, now);
  const allHints = hintsFor(answer, pool);
  const hintOpts = { guessesMade: guesses.length, elapsedMs, total: allHints.length };
  const open = finished ? allHints.length : unlockedHintCount(hintOpts);
  const roleOpen = allHints.findIndex((h) => h.id === 'role') < open;

  return {
    puzzleNumber: puzzleNumber(when),
    dayKey: dayKey(when),
    msUntilNextPuzzle: msUntilNextPuzzle(when),
    maxGuesses: MAX_GUESSES,
    fields,
    // The prompt itself. The unit stays hidden until the role hint opens,
    // because "HPS" would give the role away for free.
    clue: {
      amount: answer.amount,
      unit: roleOpen ? (answer.role === 'healer' ? 'HPS' : 'DPS') : null,
      role: roleOpen ? ROLE_LABELS[answer.role] ?? answer.role : null,
      durationSec: answer.durationSec,
    },
    hints: allHints.map((hint, i) => (i < open ? { ...hint, locked: false } : { ...hint, value: '???', locked: true })),
    msUntilNextHint: finished ? null : msUntilNextHint(hintOpts),
    guesses: guesses.map((g) => ({ parse: publicParse(g.parse), correct: g.correct, fields: g.fields })),
    status: status.status,
    guessesLeft: status.guessesLeft,
    answer: finished ? publicParse(answer) : null,
  };
}

/**
 * Everything about a parse that is safe to show once it is on the board.
 *
 * Roles are relabelled here rather than in the page: the board prints these
 * values straight, so `dps` becomes `Damage` on the way out.
 */
export function publicParse(parse) {
  const { reportCode, reportTitle, fightID, ...rest } = parse;
  return {
    ...rest,
    role: ROLE_LABELS[parse.role] ?? parse.role,
    report: reportCode ? { code: reportCode, title: reportTitle, fightID } : null,
  };
}

/** Names only — the board fills in the details as they are guessed. */
export function rosterOf(pool) {
  return pool.map((p) => ({ id: p.id, player: p.player })).sort((a, b) => a.player.localeCompare(b.player));
}
