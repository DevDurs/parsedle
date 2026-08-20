/**
 * The HTTP layer: a static file server for the page, a small JSON API for the
 * game, and a token-gated corner for adding this week's log.
 *
 * No framework — node:http is enough for four routes, and it keeps the image
 * dependency-free.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { buildPuzzleView } from './puzzle.js';
import { COOKIE_NAME, STATE_COOKIE_NAME, clearCookieHeader, cookieHeader, newState, parseCookies } from './sessions.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Body is not valid JSON');
  }
}

/** Constant-time, and never true for an unset token. */
function tokenMatches(expected, provided) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{store: import('./store.js').ReportStore, pools: ReturnType<typeof import('./pool.js').createPoolProvider>, adminToken?: string, staticRoot: string, now?: () => number}} deps
 */
export function createApp({
  store,
  pools,
  roster = null,
  adminToken = '',
  staticRoot,
  mounts = {},
  // The Discord half. All optional: without it the game still plays, it just
  // has nobody's name on it.
  sessions = null,
  auth = null,
  users = null,
  results = null,
  announcer = null,
  secureCookies = true,
  now = Date.now,
}) {
  const root = resolve(staticRoot);
  // Extra read-only trees grafted into the URL space — /lib serves the shared
  // rule modules the page imports, without exposing the whole repo.
  const mountPoints = Object.entries(mounts).map(([prefix, dir]) => [prefix, resolve(dir)]);

  /** Resolve a URL path to a file, refusing anything outside its own root. */
  function resolveStatic(pathname) {
    for (const [prefix, dir] of mountPoints) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        return within(dir, pathname.slice(prefix.length) || '/index.html');
      }
    }
    return within(root, pathname === '/' ? '/index.html' : pathname);
  }

  function within(dir, relative) {
    const target = resolve(join(dir, normalize(decodeURIComponent(relative))));
    return target === dir || target.startsWith(dir + sep) ? target : null;
  }

  async function serveStatic(req, res) {
    const url = new URL(req.url, 'http://localhost');
    // normalize + prefix check: no amount of ../ escapes the served roots.
    const target = resolveStatic(url.pathname);
    if (!target) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const info = await stat(target);
      if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      res.writeHead(200, {
        'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-cache',
      });
      createReadStream(target).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  }

  function requireAdmin(req, res) {
    if (!adminToken) {
      sendJson(res, 503, { error: 'Admin API disabled: set ADMIN_TOKEN to enable it.' });
      return false;
    }
    const provided = req.headers['x-admin-token'] ?? (req.headers.authorization ?? '').replace(/^Bearer /i, '');
    if (!tokenMatches(adminToken, provided)) {
      sendJson(res, 401, { error: 'Bad admin token.' });
      return false;
    }
    return true;
  }

  /**
   * The login round trip, plus the Activity's version of it.
   *
   * Returns true when it handled the request, so the router can fall through
   * to static files when Discord is not configured.
   */
  async function handleAuth(req, res, url, pathname) {
    if (!auth || !sessions || !users) {
      if (pathname === '/auth/discord') {
        sendJson(res, 503, { error: 'Discord login is not configured on this server.' });
        return true;
      }
      return false;
    }

    if (pathname === '/auth/discord' && req.method === 'GET') {
      const state = newState();
      res.writeHead(302, {
        Location: auth.authorizeUrl(state),
        // Five minutes is more than enough to click "Authorize".
        'Set-Cookie': cookieHeader(STATE_COOKIE_NAME, state, { maxAgeMs: 5 * 60 * 1000, secure: secureCookies }),
      });
      res.end();
      return true;
    }

    if (pathname === '/auth/discord/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const expected = parseCookies(req.headers.cookie)[STATE_COOKIE_NAME];

      // No state, no login: this is the only thing standing between us and a
      // login-CSRF that silently attributes someone's scores to another account.
      if (!code || !state || !expected || state !== expected) {
        sendJson(res, 400, { error: 'That login attempt did not check out. Try again from the start.' });
        return true;
      }

      try {
        const { profile } = await auth.login(code);
        const user = await users.upsert(profile, { now });
        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': [
            cookieHeader(COOKIE_NAME, sessions.issue(user), { maxAgeMs: sessions.ttlMs, secure: secureCookies }),
            clearCookieHeader(STATE_COOKIE_NAME, { secure: secureCookies }),
          ],
        });
        res.end();
      } catch (err) {
        sendJson(res, err.status === 403 ? 403 : 502, { error: err.message });
      }
      return true;
    }

    if (pathname === '/auth/logout' && req.method === 'POST') {
      res.writeHead(302, { Location: '/', 'Set-Cookie': clearCookieHeader(COOKIE_NAME, { secure: secureCookies }) });
      res.end();
      return true;
    }

    // The Activity's login: the SDK hands the page a code, the page hands it
    // here, and we hand back both Discord's token (which authenticate() wants)
    // and our own session (which every later request wants).
    if (pathname === '/api/activity/token' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.code) {
        sendJson(res, 400, { error: 'No code supplied' });
        return true;
      }
      try {
        const { token, profile } = await auth.login(String(body.code), { withRedirect: false });
        const user = await users.upsert(profile, { now });
        sendJson(res, 200, { access_token: token.access_token, session: sessions.issue(user), user });
      } catch (err) {
        sendJson(res, err.status === 403 ? 403 : 502, { error: err.message });
      }
      return true;
    }

    return false;
  }

  /** The signed-in player, or null when the game is running open. */
  function playerOf(req) {
    return sessions ? sessions.fromRequest(req) : null;
  }

  /**
   * Login is only enforced once Discord is configured. A deployment without
   * it — the default `docker compose up` — stays anonymous and playable.
   */
  function requirePlayer(req, res) {
    if (!sessions) return { id: null, username: null };
    const player = playerOf(req);
    if (!player) {
      sendJson(res, 401, { error: 'Sign in with Discord to play.', login: '/auth/discord' });
      return null;
    }
    return player;
  }

  /**
   * The view a player is entitled to.
   *
   * With results stored server-side the guess list comes from the store, not
   * from the browser: clearing localStorage no longer undoes a loss.
   */
  async function handlePuzzle(req, res, player, { extraGuessId = null, clientState = null } = {}) {
    const { pool, sources, sample, warnings } = await pools.getPool();
    const preview = buildPuzzleView(pool, { now: now() });
    const dayKey = preview.dayKey;

    // Without Discord there is nobody to store a round against, so the browser
    // keeps its own progress exactly as it used to. That keeps a bare
    // `docker compose up` playable.
    let guessIds = clientState?.guessIds ?? [];
    let startedAt = clientState?.startedAt ?? now();

    if (results && player?.id) {
      const { round } = await results.startRound({
        dayKey,
        userId: player.id,
        puzzleNumber: preview.puzzleNumber,
        now: now(),
      });
      startedAt = Date.parse(round.startedAt);
      guessIds = round.guessIds;

      if (extraGuessId) {
        // Score it against the answer before it is written down, so the store
        // never holds a guess the rules would have refused.
        const scored = buildPuzzleView(pool, { guessIds: [...guessIds, extraGuessId], startedAt, now: now() });
        const landed = scored.guesses.at(-1);
        if (landed?.parse.id === extraGuessId) {
          const { round: updated, added } = await results.recordGuess({
            dayKey,
            userId: player.id,
            guessId: extraGuessId,
            correct: landed.correct,
            puzzleNumber: preview.puzzleNumber,
            now: now(),
          });
          guessIds = updated.guessIds;
          if (added && announcer) await announcer.onGuess({ dayKey, player, round: updated, view: scored });
        }
      }
    }

    const view = buildPuzzleView(pool, { guessIds, startedAt, now: now() });
    sendJson(res, 200, {
      ...view,
      sources,
      sample,
      warnings,
      player: player?.id ? { id: player.id, username: player.username, avatar: player.avatar ?? null } : null,
      loginRequired: Boolean(sessions),
    });
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    try {
      if (pathname === '/healthz') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/puzzle' && req.method === 'GET') {
        const player = requirePlayer(req, res);
        if (!player) return;
        await handlePuzzle(req, res, player, {
          clientState: { guessIds: [], startedAt: Number(url.searchParams.get('startedAt')) || now() },
        });
        return;
      }

      if (pathname === '/api/guess' && req.method === 'POST') {
        const player = requirePlayer(req, res);
        if (!player) return;
        const body = await readJsonBody(req);
        await handlePuzzle(req, res, player, {
          extraGuessId: body.guessId ? String(body.guessId) : null,
          clientState: {
            guessIds: Array.isArray(body.guessIds) ? body.guessIds.slice(0, 20).map(String) : [],
            startedAt: Number(body.startedAt) || now(),
          },
        });
        return;
      }

      if (pathname === '/api/me' && req.method === 'GET') {
        const player = playerOf(req);
        sendJson(res, 200, { player: player ? { id: player.id, username: player.username } : null, loginRequired: Boolean(sessions) });
        return;
      }

      if (pathname.startsWith('/auth/') || pathname === '/api/activity/token') {
        if (await handleAuth(req, res, url, pathname)) return;
      }

      if (pathname === '/api/reports') {
        if (req.method === 'GET') {
          if (!requireAdmin(req, res)) return;
          sendJson(res, 200, { reports: await store.read() });
          return;
        }
        if (req.method === 'POST') {
          if (!requireAdmin(req, res)) return;
          const body = await readJsonBody(req);
          const { report, added } = await store.add(body.url ?? body.code, { label: body.label ?? null });
          pools.invalidate();
          const { pool, sources, sample, warnings } = await pools.getPool({ force: true });
          sendJson(res, added ? 201 : 200, {
            report,
            added,
            poolSize: pool.length,
            sources,
            sample,
            warnings,
          });
          return;
        }
      }

      if (pathname === '/api/roster' && roster) {
        if (!requireAdmin(req, res)) return;

        if (req.method === 'GET') {
          const members = await roster.getMembers({ force: url.searchParams.get('refresh') === '1' });
          sendJson(res, 200, {
            members: [...members.names].sort(),
            size: members.size,
            source: members.source,
            error: members.error,
            overrides: await roster.store.read(),
          });
          return;
        }

        // { include: [names] } vouches for someone; { exclude: [names] } bars
        // them; { forget: [names] } drops the override either way.
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          for (const list of ['include', 'exclude']) {
            if (Array.isArray(body[list]) && body[list].length) await roster.store.add(list, body[list].map(String));
          }
          if (Array.isArray(body.forget) && body.forget.length) await roster.store.forget(body.forget.map(String));
          roster.invalidate();
          pools.invalidate();
          const members = await roster.getMembers();
          sendJson(res, 200, {
            members: [...members.names].sort(),
            size: members.size,
            source: members.source,
            error: members.error,
            overrides: await roster.store.read(),
          });
          return;
        }
      }

      const removal = pathname.match(/^\/api\/reports\/([A-Za-z0-9]+)$/);
      if (removal && req.method === 'DELETE') {
        if (!requireAdmin(req, res)) return;
        const { removed, reports } = await store.remove(removal[1]);
        pools.invalidate();
        sendJson(res, removed ? 200 : 404, { removed, reports });
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'No such endpoint' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      await serveStatic(req, res);
    } catch (err) {
      const status = /too large|valid JSON|Warcraft Logs report URL/i.test(err.message) ? 400 : 500;
      if (status === 500) console.error('[parsedle]', err);
      sendJson(res, status, { error: err.message });
    }
  };
}
