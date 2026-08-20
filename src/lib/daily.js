/**
 * Daily puzzle selection.
 *
 * Everyone gets the same parse on the same UTC day, with no server involved:
 * the day number seeds a deterministic shuffle of the whole pool, so a puzzle
 * only repeats once every parse has been used.
 */

/** Day 1 of Parsedle, as a UTC date. */
export const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;

/** @param {Date} [date] @returns {string} e.g. `2026-08-20` */
export function dayKey(date = new Date()) {
  return new Date(dayStartUTC(date)).toISOString().slice(0, 10);
}

/** Midnight UTC of the day `date` falls in. */
export function dayStartUTC(date = new Date()) {
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  return Math.floor(t / DAY_MS) * DAY_MS;
}

/** Milliseconds until the next puzzle unlocks. */
export function msUntilNextPuzzle(date = new Date()) {
  return dayStartUTC(date) + DAY_MS - (date instanceof Date ? date.getTime() : Date.parse(date));
}

/** Puzzle number, 1-based. Days before the epoch count backwards, harmlessly. */
export function puzzleNumber(date = new Date()) {
  return Math.round((dayStartUTC(date) - EPOCH_UTC) / DAY_MS) + 1;
}

/** FNV-1a, 32-bit. Small, stable across engines, plenty for a shuffle seed. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — one seed in, a repeatable stream of [0,1) out. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded RNG. Does not mutate `items`. */
export function seededShuffle(items, seed) {
  const out = items.slice();
  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The parse everyone is guessing on `date`.
 *
 * The pool is reshuffled once per full cycle, so within a cycle every parse
 * appears exactly once and consecutive days never repeat an answer.
 *
 * @template {{id: string}} T
 * @param {T[]} pool
 * @param {Date} [date]
 * @returns {T}
 */
export function pickDaily(pool, date = new Date()) {
  if (!pool.length) throw new Error('pickDaily: empty pool');
  const n = puzzleNumber(date) - 1;
  const size = pool.length;
  const cycle = Math.floor(n / size);
  const offset = ((n % size) + size) % size;
  return seededShuffle(pool, hashString(`parsedle:cycle:${cycle}`))[offset];
}
