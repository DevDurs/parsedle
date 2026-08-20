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
    reportsFile: resolve(env.REPORTS_FILE ?? join(env.DATA_DIR ?? join(repoRoot, 'data'), 'reports.json')),
    staticRoot: resolve(env.STATIC_ROOT ?? join(repoRoot, 'public')),
    // The page and the server share the rule modules; nothing else is served.
    mounts: { '/lib': join(repoRoot, 'src/lib') },
    adminToken: env.ADMIN_TOKEN ?? '',
    rosterFile: resolve(env.ROSTER_FILE ?? join(env.DATA_DIR ?? join(repoRoot, 'data'), 'roster.json')),
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
    repoRoot,
  };
}

function join(...parts) {
  return parts.join('/');
}
