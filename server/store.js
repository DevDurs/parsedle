/**
 * The report list.
 *
 * One JSON file on a mounted volume — the whole persistent state of the game.
 * You add a report a week; the game samples the newest two.
 */

import { readJson, writeJson } from './json-store.js';
import { parseReportCode } from './transform.js';

/** How many reports each puzzle is drawn from. */
export const SAMPLE_SIZE = 2;

export class ReportStore {
  /** @param {string} file path to reports.json */
  constructor(file) {
    this.file = file;
  }

  async read() {
    const saved = await readJson(this.file, { reports: [] });
    return Array.isArray(saved?.reports) ? saved.reports : [];
  }

  async write(reports) {
    await writeJson(this.file, { reports }, { name: 'reports' });
    return reports;
  }

  /**
   * Add this week's log. Re-adding a report already on the list is a no-op
   * rather than an error, so a double-submit is harmless.
   *
   * @param {string} input report URL or bare code
   * @param {{label?: string, now?: number}} [opts]
   */
  async add(input, { label = null, now = Date.now() } = {}) {
    const code = parseReportCode(input);
    if (!code) throw new Error(`Not a Warcraft Logs report URL or code: ${input}`);

    const reports = await this.read();
    const existing = reports.find((r) => r.code === code);
    if (existing) return { report: existing, added: false, reports };

    const report = {
      code,
      url: `https://www.warcraftlogs.com/reports/${code}`,
      label,
      addedAt: new Date(now).toISOString(),
      startTime: null,
    };
    reports.push(report);
    await this.write(reports);
    return { report, added: true, reports };
  }

  async remove(input) {
    const code = parseReportCode(input);
    const reports = await this.read();
    const kept = reports.filter((r) => r.code !== code);
    if (kept.length === reports.length) return { removed: false, reports };
    await this.write(kept);
    return { removed: true, reports: kept };
  }

  /** Record when a raid night actually happened, so ordering survives backfill. */
  async noteStartTime(code, startTime) {
    const reports = await this.read();
    const report = reports.find((r) => r.code === code);
    if (!report || report.startTime === startTime) return reports;
    report.startTime = startTime ?? null;
    return this.write(reports);
  }

  /** The newest reports first — raid time when we know it, upload time otherwise. */
  async latest(count = SAMPLE_SIZE) {
    return sortNewestFirst(await this.read()).slice(0, count);
  }
}

export function sortNewestFirst(reports) {
  const rank = (r) => r.startTime ?? Date.parse(r.addedAt ?? 0) ?? 0;
  return [...reports].sort((a, b) => rank(b) - rank(a));
}
