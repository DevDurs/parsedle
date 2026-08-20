/**
 * The two things Parsedle says out loud.
 *
 * 1. "durs is playing Parsedle #232" — posted when the first person starts,
 *    then *edited* as others join, so the channel gets one notification a day
 *    rather than one per raider.
 * 2. Yesterday's scoreboard with the group streak, posted each morning.
 *
 * Message text is built by pure functions so the wording can be tested, and
 * `cli.js digest --dry-run` can print it without posting.
 */

import { answerFor, buildPuzzleView } from './puzzle.js';
import { groupStreak, participants, previousDayKey, scoreboard } from './results.js';
import { mention, playNowButton } from './discord.js';
import { MAX_GUESSES } from '../src/lib/compare.js';
import { shareGrid } from '../src/lib/share.js';

const DAY_MS = 86400000;

/** "a, b and c" — the Wordle line reads as a sentence, not a list. */
export function nameList(names) {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const displayName = (users, id) => users[id]?.username ?? mention(id);

/** "durs and CMRN are playing Parsedle #232". */
export function playingMessage({ day, users, puzzleNumber, playUrl }) {
  const names = participants(day).map((id) => `**${displayName(users, id)}**`);
  const verb = names.length === 1 ? 'is' : 'are';
  return {
    content: `${nameList(names)} ${verb} playing Parsedle #${puzzleNumber}`,
    components: playNowButton(playUrl),
  };
}

/**
 * Yesterday's results, grouped by score the way the Wordle bot does it, with
 * the crown on whoever needed fewest guesses.
 */
export function digestMessage({ day, users, streak, puzzleNumber, answer, playUrl, includeGrids = false, guessGrids = {} }) {
  const finished = scoreboard(day);
  if (!finished.length) return null;

  const byScore = new Map();
  for (const entry of finished) {
    const key = entry.won ? `${entry.guesses}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
    if (!byScore.has(key)) byScore.set(key, []);
    byScore.get(key).push(mention(entry.userId));
  }

  const lines = [...byScore.entries()].map(([score, mentions], i) => {
    const crown = i === 0 && finished[0].won ? '👑 ' : '';
    return `${crown}${score}: ${mentions.join(' ')}`;
  });

  const header =
    streak > 1
      ? `**Your group is on a ${streak} day streak!** 🔥 Here are yesterday's results:`
      : "**Here are yesterday's results:**";

  const content = [header, ...lines, '', answer ? `It was **${answer.player}** — ${describe(answer)}.` : '']
    .filter((line) => line !== undefined)
    .join('\n')
    .trim();

  const message = { content, components: playNowButton(playUrl) };

  if (includeGrids) {
    // One field per player: the emoji grid never contains the answer, which is
    // covered by a test in test/share-storage.test.mjs.
    const fields = finished
      .filter((entry) => guessGrids[entry.userId])
      .slice(0, 25)
      .map((entry) => ({
        name: displayName(users, entry.userId),
        value: guessGrids[entry.userId],
        inline: true,
      }));
    if (fields.length) message.embeds = [{ title: `Parsedle #${puzzleNumber}`, fields, color: 0x4cc79a }];
  }

  return message;
}

function describe(answer) {
  return `${answer.spec} ${answer.class}, ${answer.percentile} on ${answer.difficulty} ${answer.boss}`;
}

/**
 * Bookkeeping: which message is today's "playing" post, and which day has
 * already had its digest. Persisted so a restart neither double-posts nor
 * skips a morning.
 */
export function createAnnouncer({
  client,
  results,
  users,
  state,
  pools,
  playUrl = '',
  streakMinPlayers = 1,
  includeGrids = false,
  now = Date.now,
  log = console,
}) {
  /** Look up display names for everyone in a day, in one read. */
  async function nameMap() {
    return users ? await users.read() : {};
  }

  /**
   * Called after every recorded guess. Posts on the first arrival of the day,
   * edits on each new face after that.
   */
  async function onGuess({ dayKey, view }) {
    if (!client) return;
    try {
      const day = await results.day(dayKey);
      const saved = await state.read();
      const message = playingMessage({
        day,
        users: await nameMap(),
        puzzleNumber: view.puzzleNumber,
        playUrl,
      });

      if (saved.playing?.dayKey === dayKey && saved.playing.messageId) {
        // Only bother Discord when the sentence actually changed.
        if (saved.playing.content === message.content) return;
        await client.editMessage(saved.playing.messageId, message);
        await state.write({ ...saved, playing: { ...saved.playing, content: message.content } });
        return;
      }

      const posted = await client.postMessage(message);
      await state.write({ ...saved, playing: { dayKey, messageId: posted.id, content: message.content } });
    } catch (err) {
      // A channel we cannot post to must never break someone's game.
      log.warn?.(`[parsedle] could not announce play: ${err.message}`);
    }
  }

  /**
   * Yesterday's scoreboard. Returns the message it posted (or would have, when
   * `dryRun`), or null when there was nothing to say.
   */
  async function postDigest({ dayKey = previousDayKey(todayKey(now())), dryRun = false, force = false } = {}) {
    const saved = await state.read();
    if (!force && saved.digest?.lastDayKey === dayKey) return null;

    const days = await results.read();
    const day = days[dayKey] ?? {};
    const finished = scoreboard(day);
    if (!finished.length) {
      if (!dryRun) await state.write({ ...saved, digest: { lastDayKey: dayKey } });
      return null;
    }

    const answer = await answerOf(dayKey);
    const message = digestMessage({
      day,
      users: await nameMap(),
      streak: groupStreak(days, dayKey, { minPlayers: streakMinPlayers }),
      puzzleNumber: Object.values(day)[0]?.puzzleNumber ?? 0,
      answer,
      playUrl,
      includeGrids,
      guessGrids: includeGrids ? await gridsFor(dayKey, day) : {},
    });

    if (dryRun || !client) return message;

    await client.postMessage(message);
    await state.write({ ...saved, digest: { lastDayKey: dayKey, postedAt: new Date(now()).toISOString() } });
    return message;
  }

  /** Yesterday's answer, so the digest can name it — spoiler-free by then. */
  async function answerOf(dayKey) {
    if (!pools) return null;
    const { pool } = await pools.getPool();
    return answerFor(pool, noonOn(dayKey));
  }

  /** Everyone's emoji grid for that day, replayed from their stored guesses. */
  async function gridsFor(dayKey, day) {
    if (!pools) return {};
    const { pool } = await pools.getPool();
    const grids = {};
    for (const [userId, round] of Object.entries(day)) {
      if (!round.finishedAt) continue;
      const view = buildPuzzleView(pool, {
        date: noonOn(dayKey),
        now: Date.parse(`${dayKey}T12:00:00Z`),
        guessIds: round.guessIds,
      });
      grids[userId] = shareGrid(view.guesses, view.fields);
    }
    return grids;
  }

  return { onGuess, postDigest };
}

/**
 * Fires the digest once a day at `hour` UTC, and catches up on boot if the
 * hour has already passed and today's has not gone out.
 */
export function scheduleDigest({ announcer, hour = 10, now = Date.now, setTimer = setTimeout, log = console }) {
  let timer = null;

  async function run() {
    try {
      const message = await announcer.postDigest();
      if (message) log.log?.('[parsedle] posted the daily digest');
    } catch (err) {
      log.warn?.(`[parsedle] digest failed: ${err.message}`);
    }
    schedule();
  }

  function schedule() {
    const wait = msUntilHour(hour, now());
    timer = setTimer(run, wait);
    timer?.unref?.();
    return wait;
  }

  // On boot, the catch-up: if we are past the hour and today's digest never
  // went out — the container was down at 10am — post it now.
  async function start() {
    await run.call(null);
    return timer;
  }

  return { start, schedule, stop: () => clearTimeout(timer) };
}

export function msUntilHour(hour, from = Date.now()) {
  const next = new Date(from);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= from) next.setTime(next.getTime() + DAY_MS);
  return next.getTime() - from;
}

/** Midday on a given day, safely inside it whatever the timezone. */
function noonOn(dayKey) {
  return new Date(`${dayKey}T12:00:00Z`);
}

export function todayKey(at = Date.now()) {
  return new Date(Math.floor(at / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}
