import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createPoolProvider } from '../server/pool.js';
import { createRosterProvider, RosterStore } from '../server/roster.js';
import { ReportStore } from '../server/store.js';
import { makeReport } from './fixtures/report.js';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ADMIN_TOKEN = 'test-token';

/** A server on an ephemeral port, torn down with the test. */
async function startServer(t, { client = null, adminToken = ADMIN_TOKEN, roster = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-api-'));
  const store = new ReportStore(join(dir, 'reports.json'));
  const pools = createPoolProvider({ store, client, roster });
  const server = createServer(
    createApp({
      store,
      pools,
      roster,
      adminToken,
      staticRoot: join(repoRoot, 'public'),
      mounts: { '/lib': join(repoRoot, 'src/lib') },
    }),
  );
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));

  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store,
    base,
    get: (path, init) => fetch(base + path, init),
    postJson: (path, body, headers = {}) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
  };
}

test('the health check answers before anything is configured', async (t) => {
  const app = await startServer(t);
  const res = await app.get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('GET /api/puzzle serves a playable puzzle with the answer withheld', async (t) => {
  const app = await startServer(t);
  const body = await (await app.get('/api/puzzle')).json();
  assert.equal(body.answer, null);
  assert.equal(body.status, 'playing');
  assert.ok(body.roster.length > 0);
  assert.ok(body.fields.length > 0);
  assert.equal(body.hints.filter((h) => !h.locked).length, 1);
});

test('POST /api/guess scores the guesses it is sent', async (t) => {
  const app = await startServer(t);
  const { roster } = await (await app.get('/api/puzzle')).json();
  const body = await (await app.postJson('/api/guess', { guessIds: [roster[0].id], startedAt: Date.now() })).json();
  assert.equal(body.guesses.length, 1);
  assert.equal(body.guesses[0].parse.player, roster[0].player);
  assert.equal(body.guessesLeft, 4);
});

test('a junk body is a 400, not a 500', async (t) => {
  const app = await startServer(t);
  const res = await fetch(`${app.base}/api/guess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json at all',
  });
  assert.equal(res.status, 400);
});

test('the admin API needs the token', async (t) => {
  const app = await startServer(t);
  assert.equal((await app.get('/api/reports')).status, 401);
  assert.equal((await app.postJson('/api/reports', { url: 'AAAA1111AAAA1111' })).status, 401);
  assert.equal(
    (await app.postJson('/api/reports', { url: 'AAAA1111AAAA1111' }, { 'x-admin-token': 'wrong' })).status,
    401,
  );
});

test('with no token configured the admin API is closed, not open', async (t) => {
  const app = await startServer(t, { adminToken: '' });
  const res = await app.postJson('/api/reports', { url: 'AAAA1111AAAA1111' }, { 'x-admin-token': '' });
  assert.equal(res.status, 503);
});

test('adding this week’s log lands on the list and rebuilds the pool', async (t) => {
  const report = makeReport();
  const client = { fetchReport: async () => report };
  const app = await startServer(t, { client });

  const res = await app.postJson(
    '/api/reports',
    { url: `https://www.warcraftlogs.com/reports/${report.code}#fight=3`, label: 'Week 12' },
    { 'x-admin-token': ADMIN_TOKEN },
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.added, true);
  assert.equal(body.report.code, report.code);
  assert.deepEqual((await app.store.read()).map((r) => r.code), [report.code]);

  const listed = await (await app.get('/api/reports', { headers: { 'x-admin-token': ADMIN_TOKEN } })).json();
  assert.equal(listed.reports[0].label, 'Week 12');
});

test('a bad report URL is refused with a message worth reading', async (t) => {
  const app = await startServer(t);
  const res = await app.postJson('/api/reports', { url: 'https://example.com/nope' }, { 'x-admin-token': ADMIN_TOKEN });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Not a Warcraft Logs report/);
});

test('a report can be taken off the list again', async (t) => {
  const app = await startServer(t, { client: { fetchReport: async () => makeReport() } });
  await app.postJson('/api/reports', { url: 'AAAA1111AAAA1111' }, { 'x-admin-token': ADMIN_TOKEN });
  const res = await fetch(`${app.base}/api/reports/AAAA1111AAAA1111`, {
    method: 'DELETE',
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await app.store.read(), []);
});

test('the page, its stylesheet and the shared rules are served', async (t) => {
  const app = await startServer(t);
  const page = await app.get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Parsedle/);

  assert.equal((await app.get('/assets/styles.css')).status, 200);
  assert.equal((await app.get('/admin.html')).status, 200);
  assert.match(await (await app.get('/lib/share.js')).text(), /shareGrid/);
});

test('nothing outside the served roots is reachable', async (t) => {
  const app = await startServer(t);
  for (const path of [
    '/../server/wcl.js',
    '/lib/../../server/wcl.js',
    '/%2e%2e/server/config.js',
    '/lib/%2e%2e/data/parses.js',
    '/../package.json',
  ]) {
    const res = await app.get(path);
    assert.ok(res.status === 403 || res.status === 404, `${path} -> ${res.status}`);
    assert.ok(!(await res.text()).includes('WCL_CLIENT_SECRET'), `${path} leaked the server source`);
  }
});

test('unknown endpoints and methods answer honestly', async (t) => {
  const app = await startServer(t);
  assert.equal((await app.get('/api/nope')).status, 404);
  assert.equal((await app.postJson('/nope', {})).status, 405);
  assert.equal((await app.get('/nope.html')).status, 404);
});

test('the roster is readable and editable behind the admin token', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-api-roster-'));
  const rosterStore = new RosterStore(join(dir, 'roster.json'));
  const roster = createRosterProvider({
    store: rosterStore,
    client: { fetchGuildRoster: async () => ({ guild: { id: 1, name: 'LuckyDo' }, members: ['Thalvira'] }) },
    guild: { name: 'LuckyDo', server: 'draenor', region: 'EU' },
  });
  const app = await startServer(t, { roster });

  assert.equal((await app.get('/api/roster')).status, 401, 'the roster is not public');

  const listed = await (await app.get('/api/roster', { headers: { 'x-admin-token': ADMIN_TOKEN } })).json();
  assert.deepEqual(listed.members, ['thalvira']);
  assert.equal(listed.source, 'warcraftlogs');

  const updated = await (
    await app.postJson('/api/roster', { include: ['Newtrial'], exclude: ['Thalvira'] }, { 'x-admin-token': ADMIN_TOKEN })
  ).json();
  assert.deepEqual(updated.members, ['newtrial']);
  assert.equal(updated.source, 'warcraftlogs', 'the edit response says where the list came from');
  assert.deepEqual(await rosterStore.read(), { include: ['Newtrial'], exclude: ['Thalvira'] });

  const forgotten = await (
    await app.postJson('/api/roster', { forget: ['Thalvira'] }, { 'x-admin-token': ADMIN_TOKEN })
  ).json();
  assert.deepEqual(forgotten.members.sort(), ['newtrial', 'thalvira']);
});
