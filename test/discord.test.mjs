import test from 'node:test';
import assert from 'node:assert/strict';

import { DiscordApiError, createDiscordClient, mention, playNowButton } from '../server/discord.js';

const CONFIG = { botToken: 'bot-token', channelId: '555' };

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('a bot token and a channel are both required', () => {
  assert.throws(() => createDiscordClient({ botToken: '', channelId: '5' }), DiscordApiError);
  assert.throws(() => createDiscordClient({ botToken: 'x', channelId: '' }), DiscordApiError);
});

test('posting hits the channel with the bot authorization', async () => {
  const calls = [];
  const client = createDiscordClient({
    ...CONFIG,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ id: 'msg-1' });
    },
  });

  const posted = await client.postMessage({ content: 'hello' });
  assert.equal(posted.id, 'msg-1');
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/555/messages');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bot bot-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { content: 'hello' });
});

test('editing patches the message we posted', async () => {
  const calls = [];
  const client = createDiscordClient({
    ...CONFIG,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ id: 'msg-1' });
    },
  });

  await client.editMessage('msg-1', { content: 'hello again' });
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/555/messages/msg-1');
  assert.equal(calls[0].options.method, 'PATCH');
});

test('a rate limit is waited out and retried once', async () => {
  const waits = [];
  let attempts = 0;
  const client = createDiscordClient({
    ...CONFIG,
    sleep: async (ms) => waits.push(ms),
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? jsonResponse({ retry_after: 0.75 }, 429) : jsonResponse({ id: 'msg-2' });
    },
  });

  assert.equal((await client.postMessage({ content: 'hi' })).id, 'msg-2');
  assert.deepEqual(waits, [750], 'waits exactly as long as Discord asked');
  assert.equal(attempts, 2);
});

test('a second rate limit gives up rather than looping', async () => {
  let attempts = 0;
  const client = createDiscordClient({
    ...CONFIG,
    sleep: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ retry_after: 1 }, 429);
    },
  });

  await assert.rejects(() => client.postMessage({ content: 'hi' }), /Discord returned 429/);
  assert.equal(attempts, 2);
});

test('an error carries the status and Discord’s own complaint', async () => {
  const client = createDiscordClient({
    ...CONFIG,
    fetchImpl: async () => jsonResponse({ message: 'Missing Access', code: 50001 }, 403),
  });
  await assert.rejects(
    () => client.postMessage({ content: 'hi' }),
    (err) => err.status === 403 && err.body.code === 50001,
  );
});

test('the play button is a link button, and absent without a URL', () => {
  const [row] = playNowButton('https://parsedle.example.com');
  assert.equal(row.components[0].style, 5, 'link style needs no interaction handler');
  assert.equal(row.components[0].url, 'https://parsedle.example.com');
  assert.equal(row.components[0].label, 'Play now!');
  assert.deepEqual(playNowButton(''), []);
});

test('mentions are rendered the way Discord expects', () => {
  assert.equal(mention('123'), '<@123>');
});
