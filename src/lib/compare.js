/**
 * Guess evaluation: how one parse row lines up against the answer.
 *
 * Verdicts are the usual traffic lights — `hit` (exact), `near` (right
 * neighbourhood: same class, same raid, a close number) and `miss` — plus a
 * `direction` on numeric fields telling you which way the answer sits.
 */

/** @typedef {'hit'|'near'|'miss'} Verdict */
/** @typedef {'up'|'down'|null} Direction */

export const MAX_GUESSES = 5;

/** Ordered weakest to strongest, so a guess can point up or down. */
export const DIFFICULTY_ORDER = ['LFR', 'Normal', 'Heroic', 'Mythic'];

/** Numeric fields count as `near` inside these windows. */
export const NEAR_WINDOWS = { percentile: 8, ilvl: 6 };

/** Every column the board knows how to draw, in order. */
export const FIELDS = [
  { key: 'class', label: 'Class' },
  { key: 'spec', label: 'Spec' },
  { key: 'role', label: 'Role' },
  { key: 'region', label: 'Region' },
  { key: 'guild', label: 'Guild' },
  { key: 'boss', label: 'Boss' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'percentile', label: 'Parse %' },
  { key: 'ilvl', label: 'Item level' },
];

/**
 * Columns worth showing for a given pool.
 *
 * A pool drawn from one guild's own logs has the same guild and region on
 * every row, and a column that is always green teaches nothing. Anything with
 * a single distinct value drops out; the identifying columns always stay.
 *
 * @param {object[]} pool
 * @param {{key: string, label: string}[]} [fields]
 */
export function activeFields(pool, fields = FIELDS) {
  const ALWAYS = new Set(['class', 'spec', 'boss', 'percentile']);
  if (!pool || pool.length < 2) return fields;
  return fields.filter(({ key }) => ALWAYS.has(key) || new Set(pool.map((p) => p[key])).size > 1);
}

function compareNumeric(guess, answer, window) {
  const delta = answer - guess;
  if (delta === 0) return { verdict: 'hit', direction: null, delta };
  return {
    verdict: Math.abs(delta) <= window ? 'near' : 'miss',
    direction: delta > 0 ? 'up' : 'down',
    delta,
  };
}

/**
 * Score a single field of a guess.
 * @returns {{verdict: Verdict, direction: Direction, delta?: number}}
 */
export function compareField(key, guess, answer) {
  switch (key) {
    case 'spec':
      // Same spec is a hit; the right class with the wrong spec is a near.
      if (guess.spec === answer.spec && guess.class === answer.class) {
        return { verdict: 'hit', direction: null };
      }
      return { verdict: guess.class === answer.class ? 'near' : 'miss', direction: null };

    case 'boss':
      // Wrong boss but the right raid narrows it down a lot.
      if (guess.boss === answer.boss) return { verdict: 'hit', direction: null };
      return { verdict: guess.raid === answer.raid ? 'near' : 'miss', direction: null };

    case 'difficulty': {
      const g = DIFFICULTY_ORDER.indexOf(guess.difficulty);
      const a = DIFFICULTY_ORDER.indexOf(answer.difficulty);
      if (g === a) return { verdict: 'hit', direction: null };
      return { verdict: 'miss', direction: a > g ? 'up' : 'down', delta: a - g };
    }

    case 'percentile':
      return compareNumeric(guess.percentile, answer.percentile, NEAR_WINDOWS.percentile);

    case 'ilvl':
      return compareNumeric(guess.ilvl, answer.ilvl, NEAR_WINDOWS.ilvl);

    default:
      return { verdict: guess[key] === answer[key] ? 'hit' : 'miss', direction: null };
  }
}

/**
 * Score a whole guess against the answer, over the given board columns.
 * @returns {{parse: object, correct: boolean, fields: Record<string, object>}}
 */
export function evaluateGuess(guess, answer, boardFields = FIELDS) {
  const fields = {};
  for (const { key } of boardFields) fields[key] = compareField(key, guess, answer);
  return { parse: guess, correct: guess.id === answer.id, fields };
}

/**
 * Game state after a list of guesses.
 * @returns {{status: 'playing'|'won'|'lost', guessesUsed: number, guessesLeft: number}}
 */
export function gameStatus(guesses, maxGuesses = MAX_GUESSES) {
  const won = guesses.some((g) => g.correct);
  const used = guesses.length;
  return {
    status: won ? 'won' : used >= maxGuesses ? 'lost' : 'playing',
    guessesUsed: used,
    guessesLeft: Math.max(0, maxGuesses - used),
  };
}
