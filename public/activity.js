/**
 * Booting inside Discord.
 *
 * Discord loads the page in an iframe with `frame_id` in the query string;
 * that parameter is the whole detection. From there the SDK handshake runs
 * before the game does:
 *
 *   ready() → authorize() → our /api/activity/token → authenticate()
 *
 * The session comes back as a bearer token rather than a cookie, because a
 * page framed by another origin should not be relying on cookie policy it
 * does not control.
 */

import { DiscordSDK, patchUrlMappings } from '/vendor/embedded-app-sdk.js';
import { start } from '/app.js';

const params = new URLSearchParams(location.search);

/** Discord only ever loads us with a frame_id; the open web never has one. */
export function isActivity(search = location.search) {
  return new URLSearchParams(search).has('frame_id');
}

/** How long to wait on Discord before deciding the handshake is not coming. */
const HANDSHAKE_TIMEOUT_MS = 10_000;

function say(text, { showLink = false } = {}) {
  const detail = document.getElementById('login-detail');
  const login = document.getElementById('login');
  if (!detail || !login) return;
  login.hidden = false;
  detail.textContent = text;
  document.querySelector('.login-card .button-link')?.remove();
  if (showLink) {
    const link = document.createElement('a');
    link.className = 'button-link';
    link.href = location.origin;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open Parsedle in a browser';
    document.querySelector('.login-card')?.append(link);
  }
}

/**
 * `ready()` waits on a parent that answers the RPC handshake. When the page is
 * opened outside Discord with a stray frame_id — or Discord is having a bad
 * day — it never settles, and the player is left staring at nothing. A
 * deadline turns that into a sentence they can act on.
 */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function boot() {
  // The client id is public, so the server just hands it over rather than the
  // static page being templated for it.
  const { discordClientId: clientId } = await fetch('/api/me').then((r) => r.json());
  if (!clientId) {
    say('This Activity is not configured: the server has no Discord client id.');
    return;
  }

  try {
    const sdk = new DiscordSDK(clientId);
    await withTimeout(sdk.ready(), HANDSHAKE_TIMEOUT_MS, 'Discord did not answer the handshake');

    // Requests already go through Discord's proxy on our own origin, so there
    // is nothing to rewrite; the mapping is declared for the sake of anything
    // added later that forgets.
    patchUrlMappings([], { patchFetch: false, patchWebSocket: false, patchXhr: false });

    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: 'code',
      prompt: 'none',
      scope: ['identify'],
    });

    const res = await fetch('/api/activity/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Server said ${res.status}`);
    const { access_token, session } = await res.json();

    // Discord wants its own token back to consider us authenticated; the
    // session is ours, for every request after this one.
    await sdk.commands.authenticate({ access_token });

    document.getElementById('login').hidden = true;
    await start({ bearer: session });
  } catch (err) {
    say(`Could not start inside Discord: ${err.message}.`, { showLink: true });
  }
}

if (isActivity(location.search)) boot();
