/**
 * Environment -> configuration, in one place so the container's knobs are
 * discoverable and the defaults are visible.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: resolve(env.DATA_DIR ?? join(repoRoot, 'data')),
    reportsFile: dataPath(env, 'reports.json', env.REPORTS_FILE),
    staticRoot: resolve(env.STATIC_ROOT ?? join(repoRoot, 'public')),
    // The page and the server share the rule modules; nothing else is served.
    mounts: { '/lib': join(repoRoot, 'src/lib') },
    adminToken: env.ADMIN_TOKEN ?? '',
    rosterFile: dataPath(env, 'roster.json', env.ROSTER_FILE),
    wcl: {
      clientId: env.WCL_CLIENT_ID ?? '',
      clientSecret: env.WCL_CLIENT_SECRET ?? '',
    },
    // Only members of this guild are ever the answer.
    guild: {
      id: env.GUILD_ID ? Number(env.GUILD_ID) : null,
      name: env.GUILD_NAME ?? 'LuckyDo',
      server: env.GUILD_SERVER ?? '',
      region: env.GUILD_REGION ?? '',
    },
    // Everything below is the Discord half. All of it is optional: with none
    // of it set the game plays anonymously and says nothing to anybody.
    sessionSecret: env.SESSION_SECRET ?? '',
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    // Browsers refuse a Secure cookie over plain http://localhost.
    secureCookies: env.INSECURE_COOKIES !== '1',
    usersFile: dataPath(env, 'users.json', env.USERS_FILE),
    resultsFile: dataPath(env, 'results.json', env.RESULTS_FILE),
    stateFile: dataPath(env, 'discord.json', env.DISCORD_STATE_FILE),
    discord: {
      clientId: env.DISCORD_CLIENT_ID ?? '',
      clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
      botToken: env.DISCORD_BOT_TOKEN ?? '',
      channelId: env.DISCORD_CHANNEL_ID ?? '',
      guildId: env.DISCORD_GUILD_ID ?? '',
      requireGuildMember: env.DISCORD_REQUIRE_GUILD_MEMBER === '1',
      digestHour: clampHour(env.DISCORD_DIGEST_HOUR, 10),
      streakMinPlayers: Math.max(1, Number(env.DISCORD_STREAK_MIN_PLAYERS ?? 1) || 1),
      includeGrids: env.DISCORD_DIGEST_GRIDS === '1',
      redirectUri:
        env.DISCORD_REDIRECT_URI ??
        `${(env.PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, '')}/auth/discord/callback`,
    },
    repoRoot,
  };
}

function dataPath(env, filename, override) {
  return resolve(override ?? join(env.DATA_DIR ?? join(repoRoot, 'data'), filename));
}

function clampHour(value, fallback) {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
}

function join(...parts) {
  return parts.join('/');
}
