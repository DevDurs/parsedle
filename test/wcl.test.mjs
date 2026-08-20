import test from 'node:test';
import assert from 'node:assert/strict';

import { createWclClient, WclError } from '../server/wcl.js';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fake Warcraft Logs: records calls, answers tokens and one report. */
function fakeWcl({ report = { code: 'X' }, tokenTtl = 3600 } = {}) {
  const calls = [];
  let issued = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/oauth/token')) {
      issued += 1;
      return jsonResponse({ access_token: `token-${issued}`, expires_in: tokenTtl });
    }
    return jsonResponse({ data: { reportData: { report } } });
  };
  return { calls, fetchImpl, get issued() { return issued; } };
}

test('credentials are required up front, not at the first call', () => {
  assert.throws(() => createWclClient({ clientId: '', clientSecret: 'x' }), WclError);
});

test('a report fetch authenticates once and reuses the token', async () => {
  const wcl = fakeWcl();
  const client = createWclClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: wcl.fetchImpl });

  await client.fetchReport('AbCd1234EfGh5678');
  await client.fetchReport('AbCd1234EfGh5678');

  assert.equal(wcl.issued, 1, 'one token for both calls');
  const token = wcl.calls.find((c) => c.url.includes('/oauth/token'));
  assert.match(token.options.headers.Authorization, /^Basic /);
  assert.equal(token.options.body, 'grant_type=client_credentials');

  const query = wcl.calls.find((c) => c.url.includes('/api/v2/client'));
  assert.equal(query.options.headers.Authorization, 'Bearer token-1');
  assert.match(JSON.parse(query.options.body).query, /ParsedleReport/);
  assert.deepEqual(JSON.parse(query.options.body).variables, { code: 'AbCd1234EfGh5678' });
});

test('an expiring token is refreshed before it lapses', async () => {
  const wcl = fakeWcl({ tokenTtl: 120 });
  let clock = 0;
  const client = createWclClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: wcl.fetchImpl,
    now: () => clock,
  });

  await client.fetchReport('code12345678');
  clock += 90_000; // inside the 120s life, but past the 60s safety margin
  await client.fetchReport('code12345678');
  assert.equal(wcl.issued, 2);
});

test('concurrent calls share a single token request', async () => {
  const wcl = fakeWcl();
  const client = createWclClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: wcl.fetchImpl });
  await Promise.all([client.fetchReport('a'), client.fetchReport('b'), client.fetchReport('c')]);
  assert.equal(wcl.issued, 1);
});

test('bad credentials fail loudly', async () => {
  const client = createWclClient({
    clientId: 'id',
    clientSecret: 'nope',
    fetchImpl: async () => jsonResponse({ error: 'invalid_client' }, 401),
  });
  await assert.rejects(() => client.fetchReport('code12345678'), /rejected the credentials \(401\)/);
});

test('a GraphQL error becomes a WclError carrying the details', async () => {
  const client = createWclClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async (url) =>
      url.includes('token')
        ? jsonResponse({ access_token: 't', expires_in: 3600 })
        : jsonResponse({ errors: [{ message: 'This report does not exist.' }] }),
  });
  await assert.rejects(() => client.fetchReport('code12345678'), /This report does not exist/);
});

test('a missing report reads as a 404, not an empty game', async () => {
  const wcl = fakeWcl({ report: null });
  const client = createWclClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: wcl.fetchImpl });
  await assert.rejects(() => client.fetchReport('code12345678'), (err) => err.status === 404);
});

test('the guild roster is followed across pages', async () => {
  const pages = {
    1: { current_page: 1, has_more_pages: true, data: [{ name: 'Thalvira' }, { name: 'Brokktar' }] },
    2: { current_page: 2, has_more_pages: false, data: [{ name: 'Sunweaver' }] },
  };
  const asked = [];
  const client = createWclClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async (url, options) => {
      if (url.includes('token')) return jsonResponse({ access_token: 't', expires_in: 3600 });
      const variables = JSON.parse(options.body).variables;
      asked.push(variables);
      return jsonResponse({
        data: { guildData: { guild: { id: 7, name: 'LuckyDo', members: pages[variables.page] } } },
      });
    },
  });

  const roster = await client.fetchGuildRoster({ name: 'LuckyDo', server: 'draenor', region: 'EU' });
  assert.deepEqual(roster.members, ['Thalvira', 'Brokktar', 'Sunweaver']);
  assert.deepEqual(roster.guild, { id: 7, name: 'LuckyDo' });
  assert.deepEqual(asked.map((v) => v.page), [1, 2], 'stops as soon as the pages run out');
  assert.equal(asked[0].name, 'LuckyDo');
});

test('a guild needs enough identity to be looked up', async () => {
  const wcl = fakeWcl();
  const client = createWclClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: wcl.fetchImpl });
  await assert.rejects(() => client.fetchGuildRoster({ name: 'LuckyDo' }), /id, or by name \+ server \+ region/);
  assert.equal(wcl.issued, 0, 'no pointless round trip');
});

test('an unknown guild is a 404, not an empty roster', async () => {
  const client = createWclClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl: async (url) =>
      url.includes('token')
        ? jsonResponse({ access_token: 't', expires_in: 3600 })
        : jsonResponse({ data: { guildData: { guild: null } } }),
  });
  await assert.rejects(
    () => client.fetchGuildRoster({ name: 'Nope', server: 'draenor', region: 'EU' }),
    (err) => err.status === 404,
  );
});
