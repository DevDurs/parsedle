/**
 * Progressive hints.
 *
 * The board only tells you about the parses you spend guesses on. Hints leak
 * facts about the answer itself, and they unlock two ways: after each guess,
 * or simply by sitting with the puzzle. Whichever comes first — a patient
 * player and an impatient one both get there.
 */

/** A hint tier opens every this many milliseconds spent on the puzzle. */
export const HINT_INTERVAL_MS = 3 * 60 * 1000;

export const ARMOR_BY_CLASS = {
  'Death Knight': 'Plate', Paladin: 'Plate', Warrior: 'Plate',
  Hunter: 'Mail', Shaman: 'Mail', Evoker: 'Mail',
  'Demon Hunter': 'Leather', Druid: 'Leather', Monk: 'Leather', Rogue: 'Leather',
  Mage: 'Cloth', Priest: 'Cloth', Warlock: 'Cloth',
};

export const ROLE_LABELS = { dps: 'Damage', healer: 'Healer', tank: 'Tank' };

/** The decade a percentile sits in, e.g. 94 -> `90-99`. 100 stands alone. */
export function percentileBracket(percentile) {
  if (percentile >= 100) return '100 (rank one)';
  const floor = Math.floor(percentile / 10) * 10;
  return `${floor}-${floor + 9}`;
}

export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function formatAmount(amount, role) {
  const unit = role === 'healer' ? 'HPS' : 'DPS';
  return `${(amount / 1_000_000).toFixed(2)}M ${unit}`;
}

/**
 * Every hint for a parse, weakest first. Index 0 is free; index n opens after
 * n guesses or n intervals.
 *
 * Pass the pool and hints that would be the same for every possible answer are
 * dropped: one guild's own logs share a guild and a region, and a hint that
 * rules nothing out is just a row of noise. The raid always opens the puzzle,
 * constant or not, because it frames what you are looking at.
 *
 * @param {object} parse
 * @param {object[]} [pool] the full answer pool, when it is known
 * @returns {{id: string, label: string, value: string}[]}
 */
export function hintsFor(parse, pool) {
  const all = [
    { id: 'raid', label: 'Raid', value: parse.raid, field: 'raid' },
    { id: 'role', label: 'Role', value: ROLE_LABELS[parse.role] ?? parse.role, field: 'role' },
    { id: 'armor', label: 'Armor type', value: ARMOR_BY_CLASS[parse.class] ?? 'Unknown', field: 'class' },
    { id: 'difficulty', label: 'Difficulty', value: parse.difficulty, field: 'difficulty' },
    {
      id: 'wipes',
      label: 'Wipes on this boss',
      value: parse.wipes === 0 ? 'None — clean kill' : `${parse.wipes}`,
      field: 'wipes',
      skip: typeof parse.wipes !== 'number',
    },
    { id: 'percentile', label: 'Parse percentile', value: percentileBracket(parse.percentile), field: 'percentile' },
    { id: 'region', label: 'Region', value: parse.region, field: 'region' },
    {
      id: 'guild',
      label: 'Guild',
      value: `${parse.guild?.[0] ?? '?'}${'·'.repeat(Math.max(0, (parse.guild?.length ?? 1) - 1))}`,
      field: 'guild',
    },
  ];

  const varies = (field) => !pool || pool.length < 2 || new Set(pool.map((p) => p[field])).size > 1;
  return all
    .filter((hint) => !hint.skip && (hint.id === 'raid' || varies(hint.field)))
    .map(({ field, skip, ...hint }) => hint);
}

/**
 * How many hints are open right now.
 *
 * @param {{guessesMade?: number, elapsedMs?: number, total: number}} opts
 */
export function unlockedHintCount({ guessesMade = 0, elapsedMs = 0, total }) {
  const byTime = Math.floor(elapsedMs / HINT_INTERVAL_MS);
  return Math.min(total, 1 + Math.max(guessesMade, byTime));
}

/** Milliseconds until the next hint opens, or null if they are all open. */
export function msUntilNextHint({ guessesMade = 0, elapsedMs = 0, total }) {
  if (unlockedHintCount({ guessesMade, elapsedMs, total }) >= total) return null;
  const nextTier = Math.floor(elapsedMs / HINT_INTERVAL_MS) + 1;
  return nextTier * HINT_INTERVAL_MS - elapsedMs;
}

/**
 * The hints a player can see, with locked ones masked so the board can still
 * show the row shape.
 */
export function visibleHints(parse, opts, pool) {
  const all = hintsFor(parse, pool);
  const open = unlockedHintCount({ ...opts, total: all.length });
  return all.map((hint, i) => (i < open ? { ...hint, locked: false } : { ...hint, value: '???', locked: true }));
}
