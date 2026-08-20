import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COOKIE_NAME,
  clearCookieHeader,
  cookieHeader,
  createSessions,
  newState,
  parseCookies,
} from '../server/sessions.js';

const user = { id: '123', username: 'durs', avatar: 'abc' };

test('a secret is not optional', () => {
  assert.throws(() => createSessions({ secret: '' }), /SESSION_SECRET/);
});

test('a session round-trips the identity it was issued for', () => {
  const sessions = createSessions({ secret: 's3cret' });
  const claims = sessions.verify(sessions.issue(user));
  assert.equal(claims.id, '123');
  assert.equal(claims.username, 'durs');
});

test('a tampered payload is rejected', () => {
  const sessions = createSessions({ secret: 's3cret' });
  const [payload, signature] = sessions.issue(user).split('.');
  const forged = Buffer.from(JSON.stringify({ id: '999', username: 'admin', exp: Date.now() + 1000 })).toString(
    'base64url',
  );
  assert.equal(sessions.verify(`${forged}.${signature}`), null);
  assert.equal(sessions.verify(`${payload}.${signature}x`), null);
});

test('another server’s secret does not open our sessions', () => {
  const ours = createSessions({ secret: 'ours' });
  const theirs = createSessions({ secret: 'theirs' });
  assert.equal(theirs.verify(ours.issue(user)), null);
});

test('an expired session stops working', () => {
  let clock = Date.parse('2026-08-20T00:00:00Z');
  const sessions = createSessions({ secret: 's3cret', ttlMs: 1000, now: () => clock });
  const token = sessions.issue(user);
  assert.ok(sessions.verify(token));
  clock += 1001;
  assert.equal(sessions.verify(token), null);
});

test('junk in is null out, never a throw', () => {
  const sessions = createSessions({ secret: 's3cret' });
  for (const junk of [undefined, null, '', 'nodot', 'a.b', '...', 42, {}]) {
    assert.equal(sessions.verify(junk), null, `${String(junk)}`);
  }
});

test('a session arrives by cookie or by bearer header', () => {
  const sessions = createSessions({ secret: 's3cret' });
  const token = sessions.issue(user);

  assert.equal(sessions.fromRequest({ headers: { cookie: `${COOKIE_NAME}=${token}` } }).id, '123');
  assert.equal(sessions.fromRequest({ headers: { authorization: `Bearer ${token}` } }).id, '123');
  assert.equal(sessions.fromRequest({ headers: {} }), null);
  assert.equal(sessions.fromRequest({ headers: { authorization: 'Bearer nonsense' } }), null);
});

test('cookies are parsed, including encoded values and stray whitespace', () => {
  assert.deepEqual(parseCookies('a=1; b=two%20words'), { a: '1', b: 'two words' });
  assert.deepEqual(parseCookies('  spaced = yes '), { spaced: 'yes' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test('the cookie is locked down, and cleared by expiry', () => {
  const header = cookieHeader(COOKIE_NAME, 'token');
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
  assert.match(clearCookieHeader(COOKIE_NAME), /Max-Age=0/);
  assert.ok(!cookieHeader(COOKIE_NAME, 'token', { secure: false }).includes('Secure'), 'plain localhost can opt out');
});

test('oauth state values are unguessable and unique', () => {
  const values = new Set(Array.from({ length: 100 }, newState));
  assert.equal(values.size, 100);
  assert.ok([...values].every((v) => v.length >= 20));
});
