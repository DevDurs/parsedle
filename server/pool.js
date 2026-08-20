/**
 * The answer pool: the newest two reports, fetched, transformed and cached.
 *
 * Warcraft Logs is rate limited and a raid night's data stops changing once
 * the night is over, so a report is fetched at most once per TTL and the built
 * pool is reused until the list changes.
 */

import PARSES from '../src/data/parses.js';
import { buildPool } from './transform.js';
import { SAMPLE_SIZE } from './store.js';

/** A report is re-fetched after this long, in case the night is still going. */
export const REPORT_TTL_MS = 30 * 60 * 1000;

/** Below this, a puzzle is guessable by elimination alone. */
export const MIN_POOL = 6;

/**
 * @param {{store: import('./store.js').ReportStore, client: ?{fetchReport: (code: string) => Promise<object>}, roster?: ?ReturnType<typeof import('./roster.js').createRosterProvider>, sampleSize?: number, now?: () => number}} deps
 */
export function createPoolProvider({ store, client, roster = null, sampleSize = SAMPLE_SIZE, now = Date.now }) {
  /** @type {Map<string, {fetchedAt: number, report: object}>} */
  const reportCache = new Map();
  let built = null;

  async function fetchReport(code) {
    const cached = reportCache.get(code);
    if (cached && now() - cached.fetchedAt < REPORT_TTL_MS) return cached.report;
    const report = await client.fetchReport(code);
    reportCache.set(code, { fetchedAt: now(), report });
    if (report.startTime) await store.noteStartTime(code, report.startTime);
    return report;
  }

  /**
   * @returns {Promise<{pool: object[], sources: object[], sample: boolean, warnings: string[], builtAt: number}>}
   */
  async function getPool({ force = false } = {}) {
    const listed = await store.latest(sampleSize);
    const key = listed.map((r) => r.code).join(',');

    if (!force && built && built.key === key && now() - built.builtAt < REPORT_TTL_MS) {
      return built.value;
    }

    // No credentials or no reports yet: play the bundled sample pool rather
    // than serving an empty game.
    if (!client || listed.length === 0) {
      const value = {
        pool: PARSES,
        sources: [],
        sample: true,
        warnings: [
          !client
            ? 'No Warcraft Logs credentials configured — playing the bundled sample pool.'
            : 'No reports added yet — playing the bundled sample pool.',
        ],
        builtAt: now(),
      };
      built = { key, builtAt: now(), value };
      return value;
    }

    const warnings = [];
    const reports = [];
    for (const listedReport of listed) {
      try {
        reports.push(await fetchReport(listedReport.code));
      } catch (err) {
        warnings.push(`Could not load report ${listedReport.code}: ${err.message}`);
      }
    }

    // Pugs fill spots on plenty of nights, and nobody can be expected to name
    // one. Only guild members are ever the answer — and if we cannot say who
    // those are, nobody is, rather than everybody.
    const members = roster ? await roster.getMembers() : null;
    if (members && members.size === 0) {
      warnings.push(
        members.error
          ? `Could not read the guild roster (${members.error}) — nobody can be verified as a member, so the sample pool is playing instead.`
          : members.configured
            ? 'The guild roster came back empty — add members with `node server/cli.js roster add <name>` to start playing on real logs.'
            : 'No guild configured (GUILD_NAME / GUILD_SERVER / GUILD_REGION) — the sample pool is playing so no pug can become the answer.',
      );
      const value = { pool: PARSES, sources: [], sample: true, warnings, builtAt: now() };
      built = { key, builtAt: now(), value };
      return value;
    }

    const { pool, skipped } = buildPool(reports, { members: members?.names ?? null });
    if (skipped.length) {
      warnings.push(`Skipped ${skipped.length} raider${skipped.length === 1 ? '' : 's'} not on the guild roster.`);
    }

    if (pool.length < MIN_POOL) {
      warnings.push(
        `Only ${pool.length} ranked parse${pool.length === 1 ? '' : 's'} in the sampled reports — ` +
          'playing the bundled sample pool instead.',
      );
      const value = { pool: PARSES, sources: [], sample: true, warnings, builtAt: now() };
      built = { key, builtAt: now(), value };
      return value;
    }

    const value = {
      pool,
      sources: reports.map((r) => ({
        code: r.code,
        title: r.title ?? r.code,
        url: `https://www.warcraftlogs.com/reports/${r.code}`,
        startTime: r.startTime ?? null,
        zone: r.zone?.name ?? null,
      })),
      sample: false,
      warnings,
      builtAt: now(),
    };
    built = { key, builtAt: now(), value };
    return value;
  }

  return {
    getPool,
    /** Drop every cache — used after the report list changes. */
    invalidate() {
      reportCache.clear();
      built = null;
    },
  };
}
