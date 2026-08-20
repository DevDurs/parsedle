/**
 * Who counts as one of ours.
 *
 * Only guild members are ever the answer — a pug who happened to fill a spot
 * on Tuesday is not a fair thing to ask people to name. Membership comes from
 * the guild's Warcraft Logs roster, plus a local override file for the cases
 * the roster is always slightly wrong about: a trial who has not been invited
 * on the site yet, an alt logged under a different name, a raider who left.
 *
 *   members = (Warcraft Logs roster ∪ include) \ exclude
 */

import { readJson, writeJson } from './json-store.js';

/** The site roster changes rarely; re-reading it hourly is plenty. */
export const ROSTER_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Names are compared case-insensitively and without a realm suffix, because
 * `Thalvira`, `thalvira` and `Thalvira-Draenor` are one person.
 */
export function normaliseName(name) {
  return String(name ?? '')
    .trim()
    .split('-')[0]
    .toLowerCase();
}

export class RosterStore {
  /** @param {string} file path to roster.json */
  constructor(file) {
    this.file = file;
  }

  async read() {
    const saved = await readJson(this.file, {});
    return {
      include: Array.isArray(saved?.include) ? saved.include : [],
      exclude: Array.isArray(saved?.exclude) ? saved.exclude : [],
    };
  }

  async write(overrides) {
    return writeJson(this.file, overrides, { name: 'roster' });
  }

  /**
   * Put names on one list and off the other — marking someone included clears
   * any exclusion, and vice versa, so the two can never disagree.
   *
   * @param {'include'|'exclude'} list
   * @param {string[]} names
   */
  async add(list, names) {
    const other = list === 'include' ? 'exclude' : 'include';
    const overrides = await this.read();
    const added = [];
    for (const name of names.map((n) => String(n).trim()).filter(Boolean)) {
      overrides[other] = overrides[other].filter((n) => normaliseName(n) !== normaliseName(name));
      if (!overrides[list].some((n) => normaliseName(n) === normaliseName(name))) {
        overrides[list].push(name);
        added.push(name);
      }
    }
    await this.write(overrides);
    return { overrides, added };
  }

  /** Forget a name entirely, whichever list it was on. */
  async forget(names) {
    const overrides = await this.read();
    const wanted = names.map(normaliseName);
    const removed = [];
    for (const list of ['include', 'exclude']) {
      overrides[list] = overrides[list].filter((n) => {
        const hit = wanted.includes(normaliseName(n));
        if (hit) removed.push(n);
        return !hit;
      });
    }
    await this.write(overrides);
    return { overrides, removed };
  }
}

/**
 * Resolves the guild roster, caching the Warcraft Logs half.
 *
 * @param {{store: RosterStore, client: ?object, guild: {id?: number, name?: string, server?: string, region?: string}, now?: () => number}} deps
 */
export function createRosterProvider({ store, client, guild, now = Date.now }) {
  let cached = null;

  async function siteRoster() {
    if (!client || !(guild?.id || (guild?.name && guild?.server && guild?.region))) {
      return { members: [], error: null, configured: false };
    }
    if (cached && now() - cached.fetchedAt < ROSTER_TTL_MS) return cached.value;

    try {
      const { members } = await client.fetchGuildRoster(guild);
      const value = { members, error: null, configured: true };
      cached = { fetchedAt: now(), value };
      return value;
    } catch (err) {
      // A roster we cannot read must not silently become "everyone" — the
      // caller decides, and it has the message to explain itself with.
      const value = { members: [], error: err.message, configured: true };
      cached = { fetchedAt: now(), value };
      return value;
    }
  }

  /**
   * @returns {Promise<{names: Set<string>, size: number, source: string, error: ?string, configured: boolean}>}
   */
  async function getMembers({ force = false } = {}) {
    if (force) cached = null;
    const [{ members, error, configured }, overrides] = await Promise.all([siteRoster(), store.read()]);

    const names = new Set([...members, ...overrides.include].map(normaliseName));
    for (const name of overrides.exclude) names.delete(normaliseName(name));

    return {
      names,
      size: names.size,
      source: members.length ? 'warcraftlogs' : overrides.include.length ? 'overrides' : 'none',
      error,
      configured,
    };
  }

  return {
    store,
    getMembers,
    /** True when `player` is one of ours. */
    async isMember(player) {
      return (await getMembers()).names.has(normaliseName(player));
    },
    invalidate() {
      cached = null;
    },
  };
}

/** Keep only the rows belonging to guild members. */
export function filterToMembers(rows, names) {
  return rows.filter((row) => names.has(normaliseName(row.player)));
}
