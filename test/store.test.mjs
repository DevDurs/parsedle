import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReportStore, sortNewestFirst } from '../server/store.js';

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'parsedle-'));
  return new ReportStore(join(dir, 'nested', 'reports.json'));
}

test('an unwritten list reads as empty', async () => {
  const store = await freshStore();
  assert.deepEqual(await store.read(), []);
  assert.deepEqual(await store.latest(), []);
});

test('adding a report creates the file and normalises the URL', async () => {
  const store = await freshStore();
  const { report, added } = await store.add('https://www.warcraftlogs.com/reports/AbCd1234EfGh5678#fight=3');
  assert.equal(added, true);
  assert.equal(report.code, 'AbCd1234EfGh5678');
  assert.equal(report.url, 'https://www.warcraftlogs.com/reports/AbCd1234EfGh5678');

  const onDisk = JSON.parse(await readFile(store.file, 'utf8'));
  assert.equal(onDisk.reports.length, 1);
});

test('re-adding the same log is a no-op, not an error', async () => {
  const store = await freshStore();
  await store.add('AbCd1234EfGh5678');
  const second = await store.add('https://www.warcraftlogs.com/reports/AbCd1234EfGh5678');
  assert.equal(second.added, false);
  assert.equal((await store.read()).length, 1);
});

test('a bad URL is refused before it reaches the API', async () => {
  const store = await freshStore();
  await assert.rejects(() => store.add('https://example.com/not-a-log'), /Not a Warcraft Logs report/);
});

test('the newest two are what the puzzle samples', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111', { now: Date.parse('2026-08-01T20:00:00Z') });
  await store.add('BBBB2222BBBB2222', { now: Date.parse('2026-08-08T20:00:00Z') });
  await store.add('CCCC3333CCCC3333', { now: Date.parse('2026-08-15T20:00:00Z') });

  assert.deepEqual((await store.latest()).map((r) => r.code), ['CCCC3333CCCC3333', 'BBBB2222BBBB2222']);
  assert.equal((await store.latest(1)).length, 1);
});

test('a known raid time outranks the upload time', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111', { now: Date.parse('2026-08-01T20:00:00Z') });
  await store.add('BBBB2222BBBB2222', { now: Date.parse('2026-08-08T20:00:00Z') });
  // A backfilled log: uploaded last, but raided first.
  await store.add('CCCC3333CCCC3333', { now: Date.parse('2026-08-15T20:00:00Z') });
  await store.noteStartTime('CCCC3333CCCC3333', Date.parse('2026-07-01T20:00:00Z'));

  assert.deepEqual((await store.latest()).map((r) => r.code), ['BBBB2222BBBB2222', 'AAAA1111AAAA1111']);
});

test('removing takes a code or a URL, and reports whether it hit', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  assert.deepEqual(await store.remove('https://www.warcraftlogs.com/reports/AAAA1111AAAA1111'), {
    removed: true,
    reports: [],
  });
  assert.equal((await store.remove('AAAA1111AAAA1111')).removed, false);
});

test('a corrupt file surfaces as an error rather than silent data loss', async () => {
  const store = await freshStore();
  await store.add('AAAA1111AAAA1111');
  await writeFile(store.file, '{ not json');
  await assert.rejects(() => store.read(), SyntaxError);
});

test('sortNewestFirst leaves its input alone', () => {
  const input = [
    { code: 'a', addedAt: '2026-01-01T00:00:00.000Z' },
    { code: 'b', addedAt: '2026-02-01T00:00:00.000Z' },
  ];
  assert.deepEqual(sortNewestFirst(input).map((r) => r.code), ['b', 'a']);
  assert.deepEqual(input.map((r) => r.code), ['a', 'b']);
});
