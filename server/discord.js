/**
 * Posting into the channel.
 *
 * A bot token and two endpoints — create a message, edit a message. That is
 * the whole surface, so there is no library here either. Components (the
 * "Play now!" button) are why this is a bot rather than an incoming webhook:
 * plain webhooks cannot carry them.
 */

const API = 'https://discord.com/api/v10';

/** Discord's button styles; 5 is a link, which needs no interaction handling. */
const LINK_BUTTON = 5;
const ACTION_ROW = 1;
const BUTTON = 2;

export class DiscordApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'DiscordApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {{botToken: string, channelId: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>}} opts
 */
export function createDiscordClient({ botToken, channelId, fetchImpl = fetch, sleep = defaultSleep }) {
  if (!botToken || !channelId) throw new DiscordApiError('Missing DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID');

  async function request(method, path, body, { retryOn429 = true } = {}) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Discord tells us exactly how long to wait; one retry is enough for a bot
    // that posts a handful of times a day.
    if (res.status === 429 && retryOn429) {
      const payload = await res.json().catch(() => ({}));
      await sleep(Math.ceil((payload.retry_after ?? 1) * 1000));
      return request(method, path, body, { retryOn429: false });
    }

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new DiscordApiError(`Discord returned ${res.status} for ${method} ${path}`, {
        status: res.status,
        body: payload,
      });
    }
    return res.json().catch(() => ({}));
  }

  return {
    /** @returns {Promise<{id: string}>} the created message */
    postMessage(message) {
      return request('POST', `/channels/${channelId}/messages`, message);
    },

    editMessage(messageId, message) {
      return request('PATCH', `/channels/${channelId}/messages/${messageId}`, message);
    },
  };
}

/** A one-button action row linking back to the game. */
export function playNowButton(url, label = 'Play now!') {
  if (!url) return [];
  return [{ type: ACTION_ROW, components: [{ type: BUTTON, style: LINK_BUTTON, label, url }] }];
}

/** Discord renders <@id> as a mention; anything else is just text. */
export function mention(userId) {
  return `<@${userId}>`;
}

function defaultSleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
