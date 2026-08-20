/**
 * Assembling the Discord half, once, for both the server and the CLI.
 *
 * Every piece is optional and degrades on its own: no credentials means no
 * login, no bot token means nothing is posted, and the game still plays. What
 * it must never do is half-start — a login that cannot issue a session, or an
 * announcer with no results to read.
 */

import { createAnnouncer } from './digest.js';
import { createDiscordClient, DiscordApiError } from './discord.js';
import { createDiscordAuth, DiscordAuthError, UserStore } from './identity.js';
import { ResultStore } from './results.js';
import { createSessions } from './sessions.js';
import { StateStore } from './state.js';

/**
 * @param {object} config from loadConfig()
 * @param {{pools?: object, log?: Console}} deps
 */
export function wireDiscord(config, { pools = null, log = console } = {}) {
  const { discord } = config;
  const warnings = [];

  const users = new UserStore(config.usersFile);
  const results = new ResultStore(config.resultsFile);
  const state = new StateStore(config.stateFile);

  // Login needs three things together; any one missing and we stay anonymous
  // rather than half-authenticating.
  let sessions = null;
  let auth = null;
  if (discord.clientId && discord.clientSecret && config.sessionSecret) {
    sessions = createSessions({ secret: config.sessionSecret });
    try {
      auth = createDiscordAuth({
        clientId: discord.clientId,
        clientSecret: discord.clientSecret,
        redirectUri: discord.redirectUri,
        guildId: discord.guildId,
        requireGuildMember: discord.requireGuildMember,
      });
    } catch (err) {
      if (!(err instanceof DiscordAuthError)) throw err;
      sessions = null;
      warnings.push(`${err.message} — Discord login is off.`);
    }
  } else if (discord.clientId || discord.clientSecret) {
    warnings.push(
      'Discord login needs DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and SESSION_SECRET together — login is off.',
    );
  }

  let client = null;
  if (discord.botToken && discord.channelId) {
    try {
      client = createDiscordClient({ botToken: discord.botToken, channelId: discord.channelId });
    } catch (err) {
      if (!(err instanceof DiscordApiError)) throw err;
      warnings.push(`${err.message} — nothing will be posted to Discord.`);
    }
  } else if (discord.botToken || discord.channelId) {
    warnings.push('Posting needs DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID together — nothing will be posted.');
  }

  const announcer = createAnnouncer({
    client,
    results,
    users,
    state,
    pools,
    playUrl: config.publicUrl,
    streakMinPlayers: discord.streakMinPlayers,
    includeGrids: discord.includeGrids,
    log,
  });

  return { sessions, auth, users, results, state, client, announcer, warnings };
}
