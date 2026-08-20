import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createPoolProvider } from '../server/pool.js';
import { createAnnouncer } from '../server/digest.js';
import { createDiscordAuth, UserStore } from '../server/identity.js';
import { ResultStore } from '../server/results.js';
import { createRosterProvider, RosterStore } from '../server/roster.js';
import { createSessions } from '../server/sessions.js';
import { StateStore } from '../server/state.js';
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

/* ------------------------------------------------- the Discord half, wired */

/** A server with login on, backed by a fake Discord. */
async function startWithDiscord(t, { member = true, client = fakeDiscordClient() } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-discord-'));
  const store = new ReportStore(join(dir, 'reports.json'));
  const pools = createPoolProvider({ store, client: null });
  const sessions = createSessions({ secret: 'test-secret' });
  const users = new UserStore(join(dir, 'users.json'));
  const results = new ResultStore(join(dir, 'results.json'));
  const state = new StateStore(join(dir, 'discord.json'));

  const auth = createDiscordAuth({
    clientId: 'app',
    clientSecret: 'secret',
    redirectUri: 'https://parsedle.test/auth/discord/callback',
    guildId: '999',
    requireGuildMember: !member,
    fetchImpl: async (url) => {
      if (url.includes('/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
      if (url.endsWith('/users/@me')) {
        return { ok: true, status: 200, json: async () => ({ id: 'u1', username: 'durs', avatar: null }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });

  const announcer = createAnnouncer({ client, results, users, state, pools, playUrl: 'https://parsedle.test' });
  const server = createServer(
    createApp({
      store,
      pools,
      adminToken: ADMIN_TOKEN,
      staticRoot: join(repoRoot, 'public'),
      mounts: { '/lib': join(repoRoot, 'src/lib') },
      sessions,
      auth,
      users,
      results,
      announcer,
      secureCookies: false,
    }),
  );
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));

  const base = `http://127.0.0.1:${server.address().port}`;
  const token = sessions.issue({ id: 'u1', username: 'durs' });
  return {
    base,
    results,
    state,
    client,
    sessions,
    token,
    get: (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' }),
    guess: (guessId, headers = {}) =>
      fetch(`${base}/api/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ guessId }),
      }),
  };
}

function fakeDiscordClient() {
  const posted = [];
  const edited = [];
  return {
    posted,
    edited,
    async postMessage(m) {
      posted.push(m);
      return { id: `m${posted.length}` };
    },
    async editMessage(id, m) {
      edited.push({ id, message: m });
      return { id };
    },
  };
}

test('with login on, the puzzle is closed to strangers', async (t) => {
  const app = await startWithDiscord(t);
  const res = await app.get('/api/puzzle');
  assert.equal(res.status, 401);
  assert.equal((await res.json()).login, '/auth/discord');
});

test('a session opens it, by cookie or by bearer', async (t) => {
  const app = await startWithDiscord(t);
  assert.equal((await app.get('/api/puzzle', { cookie: `parsedle_session=${app.token}` })).status, 200);

  const res = await app.get('/api/puzzle', { authorization: `Bearer ${app.token}` });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).player.username, 'durs');
});

test('the login redirect carries a state cookie, and the callback checks it', async (t) => {
  const app = await startWithDiscord(t);
  const start = await app.get('/auth/discord');
  assert.equal(start.status, 302);
  assert.match(start.headers.get('location'), /^https:\/\/discord\.com\/oauth2\/authorize\?/);

  const state = /parsedle_oauth_state=([^;]+)/.exec(start.headers.get('set-cookie'))[1];
  assert.equal((await app.get(`/auth/discord/callback?code=c&state=${state}`)).status, 400, 'no cookie sent back');

  const forged = await app.get('/auth/discord/callback?code=c&state=not-the-one', {
    cookie: `parsedle_oauth_state=${state}`,
  });
  assert.equal(forged.status, 400, 'a mismatched state is refused');

  const ok = await app.get(`/auth/discord/callback?code=c&state=${state}`, {
    cookie: `parsedle_oauth_state=${state}`,
  });
  assert.equal(ok.status, 302);
  assert.match(String(ok.headers.get('set-cookie')), /parsedle_session=/);
});

test('guesses are stored against the player, not the browser', async (t) => {
  const app = await startWithDiscord(t);
  const auth = { authorization: `Bearer ${app.token}` };
  const { roster } = await (await app.get('/api/puzzle', auth)).json();

  await app.guess(roster[0].id, auth);
  await app.guess(roster[1].id, auth);

  // A "fresh browser" — no local state at all — still sees the round.
  const view = await (await app.get('/api/puzzle', auth)).json();
  assert.equal(view.guesses.length, 2, 'clearing localStorage does not undo a round');

  const round = await app.results.round(view.dayKey, 'u1');
  assert.deepEqual(round.guessIds, [roster[0].id, roster[1].id]);
});

test('a round cannot be replayed past its end', async (t) => {
  const app = await startWithDiscord(t);
  const auth = { authorization: `Bearer ${app.token}` };
  const { roster, dayKey } = await (await app.get('/api/puzzle', auth)).json();

  for (const entry of roster.slice(0, 5)) await app.guess(entry.id, auth);
  const sixth = await (await app.guess(roster[5].id, auth)).json();

  assert.equal(sixth.guesses.length, 5, 'the sixth guess is refused');
  assert.equal((await app.results.round(dayKey, 'u1')).guessIds.length, 5);
});

test('the first guess of the day announces the player, the rest do not', async (t) => {
  const app = await startWithDiscord(t);
  const auth = { authorization: `Bearer ${app.token}` };
  const { roster } = await (await app.get('/api/puzzle', auth)).json();

  await app.guess(roster[0].id, auth);
  assert.equal(app.client.posted.length, 1);
  assert.match(app.client.posted[0].content, /is playing Parsedle #/);

  await app.guess(roster[1].id, auth);
  assert.equal(app.client.posted.length, 1, 'one notification per day');
  assert.equal(app.client.edited.length, 0, 'and no pointless edits');
});

test('the Activity trades its code for a token and a session', async (t) => {
  const app = await startWithDiscord(t);
  const res = await fetch(`${app.base}/api/activity/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'sdk-code' }),
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.access_token, 'tok', 'the SDK needs Discord’s token for authenticate()');
  assert.equal(app.sessions.verify(body.session).id, 'u1', 'and we need our own');

  const view = await app.get('/api/puzzle', { authorization: `Bearer ${body.session}` });
  assert.equal(view.status, 200);
});

test('/api/me reports who is signed in', async (t) => {
  const app = await startWithDiscord(t);
  assert.deepEqual(await (await app.get('/api/me')).json(), {
    player: null,
    loginRequired: true,
    discordClientId: '',
  });
  const mine = await (await app.get('/api/me', { authorization: `Bearer ${app.token}` })).json();
  assert.equal(mine.player.username, 'durs');
});

test('without Discord configured the game stays open and anonymous', async (t) => {
  const app = await startServer(t);
  const body = await (await app.get('/api/puzzle')).json();
  assert.equal(body.loginRequired, false);
  assert.equal(body.player, null);
  assert.equal((await app.get('/auth/discord')).status, 503);
});

test('html is framable by Discord and nobody else', async (t) => {
  const app = await startServer(t);
  const page = await app.get('/');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors/);
  assert.match(csp, /https:\/\/\*\.discordsays\.com/);
  assert.ok(!csp.includes("'self' *"), 'not an open invitation');

  const css = await app.get('/assets/styles.css');
  assert.equal(css.headers.get('content-security-policy'), null, 'only the pages need it');
});

test('the Activity bundle is served', async (t) => {
  const app = await startServer(t);
  const res = await app.get('/vendor/embedded-app-sdk.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
});
