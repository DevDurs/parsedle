/**
 * Who is playing: Discord OAuth2.
 *
 * The `identify` scope, which buys exactly a user id, a display name and an
 * avatar hash — no email, no guild list unless we ask for it. Built as a
 * factory over an injectable `fetchImpl`, the same shape as server/wcl.js, so
 * the whole flow is testable without touching the network.
 */

import { readJson, writeJson } from './json-store.js';

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const API = 'https://discord.com/api/v10';

export class DiscordAuthError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'DiscordAuthError';
    this.status = status;
  }
}

/**
 * Everyone who has ever logged in: id -> display name and avatar.
 *
 * Kept so the daily digest can name people who did not play today, and so a
 * renamed account does not turn yesterday's scoreboard into raw snowflakes.
 */
export class UserStore {
  constructor(file) {
    this.file = file;
  }

  async read() {
    const saved = await readJson(this.file, { users: {} });
    return saved?.users && typeof saved.users === 'object' ? saved.users : {};
  }

  async write(users) {
    await writeJson(this.file, { users }, { name: 'users' });
    return users;
  }

  /** @param {{id: string, username: string, global_name?: ?string, avatar?: ?string}} profile */
  async upsert(profile, { now = Date.now } = {}) {
    const users = await this.read();
    const user = {
      id: profile.id,
      username: profile.global_name || profile.username,
      avatar: profile.avatar ?? null,
      firstSeen: users[profile.id]?.firstSeen ?? new Date(now()).toISOString(),
      lastSeen: new Date(now()).toISOString(),
    };
    users[profile.id] = user;
    await this.write(users);
    return user;
  }

  async get(id) {
    return (await this.read())[id] ?? null;
  }
}

/**
 * @param {{clientId: string, clientSecret: string, redirectUri: string, guildId?: string, requireGuildMember?: boolean, fetchImpl?: typeof fetch}} opts
 */
export function createDiscordAuth({
  clientId,
  clientSecret,
  redirectUri,
  guildId = '',
  requireGuildMember = false,
  fetchImpl = fetch,
}) {
  if (!clientId || !clientSecret) {
    throw new DiscordAuthError('Missing DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET');
  }

  // guilds.members.read is only worth asking for when we intend to check it.
  const scopes = requireGuildMember ? ['identify', 'guilds.members.read'] : ['identify'];

  function authorizeUrl(state) {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      prompt: 'none',
    });
    return `${AUTHORIZE_URL}?${params}`;
  }

  /**
   * Trade an authorization code for an access token.
   *
   * The Activity uses the same call without a redirect_uri — its code comes
   * from the SDK rather than a browser redirect.
   */
  async function exchangeCode(code, { withRedirect = true } = {}) {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
    });
    if (withRedirect) body.set('redirect_uri', redirectUri);

    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new DiscordAuthError(`Discord refused the code (${res.status})`, { status: res.status });
    }
    const token = await res.json();
    if (!token?.access_token) throw new DiscordAuthError('Discord returned no access token');
    return token;
  }

  async function fetchUser(accessToken) {
    const res = await fetchImpl(`${API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new DiscordAuthError(`Could not read the Discord profile (${res.status})`, { status: res.status });
    return res.json();
  }

  /**
   * Is this account in our server? Only called when the deployment asks for
   * it; a 404 from Discord is the honest "not a member" answer.
   */
  async function isGuildMember(accessToken) {
    if (!requireGuildMember) return true;
    if (!guildId) throw new DiscordAuthError('DISCORD_REQUIRE_GUILD_MEMBER is set but DISCORD_GUILD_ID is not');

    const res = await fetchImpl(`${API}/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new DiscordAuthError(`Could not check server membership (${res.status})`, { status: res.status });
    return true;
  }

  /** The whole login, from code to profile. */
  async function login(code, { withRedirect = true } = {}) {
    const token = await exchangeCode(code, { withRedirect });
    if (!(await isGuildMember(token.access_token))) {
      throw new DiscordAuthError('That account is not in the server', { status: 403 });
    }
    return { token, profile: await fetchUser(token.access_token) };
  }

  return { authorizeUrl, exchangeCode, fetchUser, isGuildMember, login, scopes };
}
