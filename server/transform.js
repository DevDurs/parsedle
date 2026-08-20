/**
 * Warcraft Logs report JSON -> Parsedle rows.
 *
 * Pure functions, so the shape-wrangling that breaks when Blizzard renames a
 * boss is testable without touching the network.
 */

import { filterToMembers } from './roster.js';

/** WCL fight difficulty ids. */
export const DIFFICULTY_BY_ID = { 1: 'LFR', 2: 'Normal', 3: 'Normal', 4: 'Heroic', 5: 'Mythic' };

const ROLE_BY_BUCKET = { tanks: 'tank', healers: 'healer', dps: 'dps' };

/** A Warcraft Logs report URL, permalink or bare code -> the report code. */
export function parseReportCode(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const fromUrl = raw.match(/reports\/(?:a:)?([a-zA-Z0-9]{8,})/);
  const code = fromUrl ? fromUrl[1] : raw;
  return /^[a-zA-Z0-9]{8,}$/.test(code) ? code : null;
}

export function difficultyName(id) {
  return DIFFICULTY_BY_ID[id] ?? 'Normal';
}

/** Percentiles arrive as floats; the board reads better in whole numbers. */
function roundPercentile(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** WCL has moved item level between fields over the years; take what's there. */
function itemLevelOf(character) {
  const candidates = [character.itemLevel, character.bracketData, character.ilvl];
  const found = candidates.find((v) => typeof v === 'number' && v > 0);
  return found ?? null;
}

/**
 * How many times the raid wiped on each encounter, keyed by encounter id.
 * "All the bosses killed and failed" — the failures become a hint.
 */
export function wipesByEncounter(fights = []) {
  const wipes = {};
  for (const fight of fights) {
    if (fight.kill) continue;
    wipes[fight.encounterID] = (wipes[fight.encounterID] ?? 0) + 1;
  }
  return wipes;
}

/**
 * Every ranked parse in a report, one row per player per killed boss.
 *
 * Only kills carry a percentile — that is what "a parse" means — but the wipe
 * count for the same boss rides along on every row from that night.
 *
 * @param {object} report the `reportData.report` node
 * @returns {object[]}
 */
export function parsesFromReport(report) {
  if (!report) return [];

  const fights = report.fights ?? [];
  const fightById = new Map(fights.map((f) => [f.id, f]));
  const wipes = wipesByEncounter(fights);
  const region = report.guild?.server?.region?.compactName ?? 'Unknown';
  const raid = report.zone?.name ?? 'Unknown raid';
  const rankingRows = report.rankings?.data ?? [];

  const rows = [];
  for (const ranking of rankingRows) {
    if (ranking.kill === 0 || ranking.kill === false) continue;
    const fight = fightById.get(ranking.fightID);
    const boss = ranking.encounter?.name ?? fight?.name;
    if (!boss) continue;

    const difficulty = difficultyName(ranking.difficulty ?? fight?.difficulty);
    const durationSec = Math.round(
      (ranking.duration ?? (fight ? fight.endTime - fight.startTime : 0)) / 1000,
    );
    const encounterID = ranking.encounter?.id ?? fight?.encounterID;

    for (const [bucket, role] of Object.entries(ROLE_BY_BUCKET)) {
      for (const character of ranking.roles?.[bucket]?.characters ?? []) {
        const percentile = roundPercentile(
          character.rankPercent ?? character.historicalPercent ?? character.bracketPercent,
        );
        if (percentile === null || !character.name) continue;

        rows.push({
          id: `${report.code}:${ranking.fightID}:${character.name}`,
          player: character.name,
          class: character.class ?? 'Unknown',
          spec: character.spec ?? 'Unknown',
          role,
          region,
          raid,
          boss,
          difficulty,
          percentile,
          ilvl: itemLevelOf(character),
          amount: Math.round(character.amount ?? 0),
          durationSec,
          wipes: wipes[encounterID] ?? 0,
          reportCode: report.code,
          reportTitle: report.title ?? report.code,
          reportStart: report.startTime ?? null,
          fightID: ranking.fightID,
        });
      }
    }
  }
  return rows;
}

/**
 * One row per raider: their best parse across everything sampled.
 *
 * The game needs player names to be unique — a name has to identify exactly
 * one row — and "your best parse of the week" is the row worth guessing about
 * anyway. Ties break on raw output, then on the row id so the pool is stable.
 *
 * Each row also carries `reports`: every report the player was ranked in, not
 * just the one their best parse came from. That is what lets the guess list be
 * narrowed to the raid the answer actually happened in — somebody's best parse
 * can be from Tuesday while they also raided on Wednesday.
 */
export function bestParsePerPlayer(rows) {
  const best = new Map();
  const appearances = new Map();
  for (const row of rows) {
    if (row.reportCode) {
      if (!appearances.has(row.player)) appearances.set(row.player, new Set());
      appearances.get(row.player).add(row.reportCode);
    }
    const held = best.get(row.player);
    if (!held || row.percentile > held.percentile) {
      best.set(row.player, row);
      continue;
    }
    if (row.percentile === held.percentile) {
      if (row.amount > held.amount || (row.amount === held.amount && row.id < held.id)) {
        best.set(row.player, row);
      }
    }
  }
  return [...best.values()]
    .map((row) => {
      const seen = appearances.get(row.player);
      return seen ? { ...row, reports: [...seen].sort() } : row;
    })
    .sort((a, b) => a.player.localeCompare(b.player));
}

/** Rows a parse must have to be playable at all. */
export function isPlayableParse(row) {
  return Boolean(
    row &&
      row.player &&
      row.class &&
      row.spec &&
      typeof row.percentile === 'number' &&
      typeof row.ilvl === 'number' &&
      row.amount > 0 &&
      row.durationSec > 0,
  );
}

/**
 * The answer pool for a set of reports: every guild member who logged a ranked
 * kill, represented by their best parse.
 *
 * Pass `members` — a Set of normalised names — and everyone else is dropped
 * before the pool is built, so a pug can never become the answer. Omit it and
 * every ranked raider is a candidate, which is only ever right for tests and
 * for the bundled sample data.
 *
 * @param {object[]} reports
 * @param {{members?: ?Set<string>}} [opts]
 * @returns {{pool: object[], skipped: string[]}}
 */
export function buildPool(reports, { members = null } = {}) {
  const rows = reports.flatMap((report) => parsesFromReport(report)).filter(isPlayableParse);
  const kept = members ? filterToMembers(rows, members) : rows;
  const keptNames = new Set(kept.map((r) => r.player));
  const skipped = [...new Set(rows.map((r) => r.player))].filter((name) => !keptNames.has(name));
  return { pool: bestParsePerPlayer(kept), skipped: skipped.sort() };
}
