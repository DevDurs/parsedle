/**
 * What the bot has already said.
 *
 * Which message is today's "playing" post so it can be edited rather than
 * re-posted, and which day's digest has gone out so a restart does not send it
 * twice. Small, but it is the difference between a tidy channel and a spammy
 * one.
 */

import { readJson, writeJson } from './json-store.js';

export class StateStore {
  constructor(file) {
    this.file = file;
  }

  /** @returns {Promise<{playing?: {dayKey: string, messageId: string, content: string}, digest?: {lastDayKey: string, postedAt?: string}}>} */
  async read() {
    const saved = await readJson(this.file, {});
    return saved && typeof saved === 'object' ? saved : {};
  }

  async write(state) {
    return writeJson(this.file, state, { name: 'discord' });
  }
}
