import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DiscordAuthError, UserStore, createDiscordAuth } from '../server/identity.js';

const CONFIG = {
  clientId: 'app-id',
  clientSecret: 'app-secret',
  redirectUri: 'https://parsedle.example.com/auth/discord/callback',
};

const PROFILE = { id: '123', username: 'durs', global_name: 'Durs', avatar: 'hash' };

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fake Discord: records calls, answers the token and profile endpoints. */
function fakeDiscord({ profile = PROFILE, member = true, tokenStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/oauth2/token')) {
      return tokenStatus === 200
        ? jsonResponse({ access_token: 'access-123', token_type: 'Bearer', expires_in: 604800 })
        : jsonResponse({ error: 'invalid_grant' }, tokenStatus);
    }
    if (url.endsWith('/users/@me')) return jsonResponse(profile);
    if (url.includes('/guilds/')) return member ? jsonResponse({ user: profile }) : jsonResponse({}, 404);
    throw new Error(`unexpected call to ${url}`);
  };
  return { calls, fetchImpl };
}

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-users-'));
  return new UserStore(join(dir, 'users.json'));
}

test('credentials are required up front', () => {
  assert.throws(() => createDiscordAuth({ ...CONFIG, clientId: '' }), DiscordAuthError);
});

test('the authorize URL carries our app, scope and state', () => {
  const auth = createDiscordAuth({ ...CONFIG, fetchImpl: fakeDiscord().fetchImpl });
  const url = new URL(auth.authorizeUrl('state-abc'));
  assert.equal(url.searchParams.get('client_id'), 'app-id');
  assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('state'), 'state-abc');
});

test('a login exchanges the code and reads the profile', async () => {
  const discord = fakeDiscord();
  const auth = createDiscordAuth({ ...CONFIG, fetchImpl: discord.fetchImpl });
  const { token, profile } = await auth.login('the-code');

  assert.equal(token.access_token, 'access-123');
  assert.equal(profile.id, '123');

  const exchange = new URLSearchParams(discord.calls[0].options.body);
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.equal(exchange.get('code'), 'the-code');
  assert.equal(exchange.get('client_secret'), 'app-secret');
  assert.equal(exchange.get('redirect_uri'), CONFIG.redirectUri);
  assert.equal(discord.calls[1].options.headers.Authorization, 'Bearer access-123');
});

test('the Activity exchanges without a redirect_uri', async () => {
  const discord = fakeDiscord();
  const auth = createDiscordAuth({ ...CONFIG, fetchImpl: discord.fetchImpl });
  await auth.login('sdk-code', { withRedirect: false });
  assert.equal(new URLSearchParams(discord.calls[0].options.body).get('redirect_uri'), null);
});

test('a rejected code fails loudly', async () => {
  const auth = createDiscordAuth({ ...CONFIG, fetchImpl: fakeDiscord({ tokenStatus: 400 }).fetchImpl });
  await assert.rejects(() => auth.login('stale'), /Discord refused the code \(400\)/);
});

test('server membership is only checked when it is required', async () => {
  const open = fakeDiscord({ member: false });
  await createDiscordAuth({ ...CONFIG, fetchImpl: open.fetchImpl }).login('code');
  assert.ok(!open.calls.some((c) => c.url.includes('/guilds/')), 'not asked for');

  const guarded = fakeDiscord({ member: false });
  const auth = createDiscordAuth({
    ...CONFIG,
    guildId: '999',
    requireGuildMember: true,
    fetchImpl: guarded.fetchImpl,
  });
  assert.deepEqual(auth.scopes, ['identify', 'guilds.members.read'], 'and the scope is asked for');
  await assert.rejects(() => auth.login('code'), /not in the server/);
});

test('a member of the server gets in', async () => {
  const auth = createDiscordAuth({
    ...CONFIG,
    guildId: '999',
    requireGuildMember: true,
    fetchImpl: fakeDiscord({ member: true }).fetchImpl,
  });
  assert.equal((await auth.login('code')).profile.id, '123');
});

test('requiring membership without a guild id is a configuration error', async () => {
  const auth = createDiscordAuth({ ...CONFIG, requireGuildMember: true, fetchImpl: fakeDiscord().fetchImpl });
  await assert.rejects(() => auth.login('code'), /DISCORD_GUILD_ID/);
});

test('users are stored under their display name and keep their first-seen date', async () => {
  const store = await freshStore();
  let clock = Date.parse('2026-08-01T00:00:00Z');
  const first = await store.upsert(PROFILE, { now: () => clock });
  assert.equal(first.username, 'Durs', 'global_name wins over the legacy username');
  assert.equal(first.firstSeen, '2026-08-01T00:00:00.000Z');

  clock = Date.parse('2026-08-20T00:00:00Z');
  const renamed = await store.upsert({ ...PROFILE, global_name: 'Durs the Bold' }, { now: () => clock });
  assert.equal(renamed.username, 'Durs the Bold');
  assert.equal(renamed.firstSeen, '2026-08-01T00:00:00.000Z', 'unchanged');
  assert.equal(renamed.lastSeen, '2026-08-20T00:00:00.000Z');
  assert.equal(Object.keys(await store.read()).length, 1);
});

test('an unwritten user store reads as empty', async () => {
  const store = await freshStore();
  assert.deepEqual(await store.read(), {});
  assert.equal(await store.get('nobody'), null);
});
