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

import { buildPuzzleView, rosterOf } from './puzzle.js';

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
export function createApp({ store, pools, roster = null, adminToken = '', staticRoot, mounts = {}, now = Date.now }) {
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

  /** GET /api/puzzle and POST /api/guess share one view. */
  async function handlePuzzle(req, res, session) {
    const { pool, sources, sample, warnings } = await pools.getPool();
    const view = buildPuzzleView(pool, { ...session, now: now() });
    sendJson(res, 200, { ...view, roster: rosterOf(pool), sources, sample, warnings });
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
        await handlePuzzle(req, res, {
          guessIds: [],
          startedAt: Number(url.searchParams.get('startedAt')) || now(),
        });
        return;
      }

      if (pathname === '/api/guess' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const guessIds = Array.isArray(body.guessIds) ? body.guessIds.slice(0, 20).map(String) : [];
        await handlePuzzle(req, res, { guessIds, startedAt: Number(body.startedAt) || now() });
        return;
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
