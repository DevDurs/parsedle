import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bestParsePerPlayer,
  buildPool,
  difficultyName,
  isPlayableParse,
  parseReportCode,
  parsesFromReport,
  wipesByEncounter,
} from '../server/transform.js';
import { makeReport } from './fixtures/report.js';

test('report codes come out of URLs, permalinks and bare codes', () => {
  const code = 'AbCd1234EfGh5678';
  assert.equal(parseReportCode(`https://www.warcraftlogs.com/reports/${code}`), code);
  assert.equal(parseReportCode(`https://www.warcraftlogs.com/reports/${code}#fight=12&type=damage-done`), code);
  assert.equal(parseReportCode(`https://www.warcraftlogs.com/reports/a:${code}`), code);
  assert.equal(parseReportCode(`  ${code}  `), code);
});

test('junk is rejected rather than guessed at', () => {
  assert.equal(parseReportCode('https://example.com/nothing'), null);
  assert.equal(parseReportCode('short'), null);
  assert.equal(parseReportCode(''), null);
  assert.equal(parseReportCode(undefined), null);
});

test('difficulty ids map to the names the board shows', () => {
  assert.equal(difficultyName(5), 'Mythic');
  assert.equal(difficultyName(4), 'Heroic');
  assert.equal(difficultyName(3), 'Normal');
  assert.equal(difficultyName(1), 'LFR');
  assert.equal(difficultyName(undefined), 'Normal', 'an unknown id still plays');
});

test('wipes are counted per encounter', () => {
  assert.deepEqual(wipesByEncounter(makeReport().fights), { 3129: 2 });
});

test('a report becomes one row per ranked player per kill', () => {
  const rows = parsesFromReport(makeReport());
  assert.equal(rows.length, 6, 'four ranked on the first kill, two on the second');
  assert.ok(!rows.some((r) => r.player === 'Ghostparse'), 'unranked rows are skipped');
  assert.ok(!rows.some((r) => r.boss === 'Plexus Sentinel' && r.difficulty !== 'Mythic'));
});

test('rows carry the fight, the guild and the night that produced them', () => {
  const row = parsesFromReport(makeReport()).find((r) => r.player === 'Thalvira' && r.boss === 'Plexus Sentinel');
  assert.equal(row.class, 'Priest');
  assert.equal(row.spec, 'Shadow');
  assert.equal(row.role, 'dps');
  assert.equal(row.guild, 'Whispers of Ash');
  assert.equal(row.region, 'EU');
  assert.equal(row.raid, 'Manaforge Omega');
  assert.equal(row.difficulty, 'Mythic');
  assert.equal(row.percentile, 99, 'percentiles are rounded');
  assert.equal(row.ilvl, 691);
  assert.equal(row.durationSec, 300);
  assert.equal(row.wipes, 2, 'the two wipes on that boss ride along');
  assert.equal(row.reportCode, 'AbCd1234EfGh5678');
  assert.equal(row.id, 'AbCd1234EfGh5678:3:Thalvira');
});

test('roles come from the bucket the character sat in', () => {
  const rows = parsesFromReport(makeReport());
  assert.equal(rows.find((r) => r.player === 'Grimhollow').role, 'tank');
  assert.equal(rows.find((r) => r.player === 'Sunweaver').role, 'healer');
  assert.equal(rows.find((r) => r.player === 'Emberlyn').role, 'dps');
});

test('item level is read from whichever field carries it', () => {
  const rows = parsesFromReport(makeReport());
  assert.equal(rows.find((r) => r.player === 'Emberlyn').ilvl, 690, 'itemLevel');
  assert.equal(rows.find((r) => r.player === 'Grimhollow').ilvl, 686, 'bracketData');
});

test('a missing or empty report yields nothing rather than throwing', () => {
  assert.deepEqual(parsesFromReport(null), []);
  assert.deepEqual(parsesFromReport({ code: 'x', fights: [], rankings: null }), []);
});

test('each raider is reduced to their best parse', () => {
  const best = bestParsePerPlayer(parsesFromReport(makeReport()));
  assert.equal(new Set(best.map((r) => r.player)).size, best.length, 'names are unique');
  const thalvira = best.find((r) => r.player === 'Thalvira');
  assert.equal(thalvira.percentile, 100, 'the 99.9 on Naazindhri beats the 98.7');
  assert.equal(best.find((r) => r.player === 'Sunweaver').boss, 'Plexus Sentinel');
});

test('ties break on output, then stably on id', () => {
  const rows = [
    { id: 'b', player: 'Tie', percentile: 90, amount: 100 },
    { id: 'a', player: 'Tie', percentile: 90, amount: 200 },
    { id: 'c', player: 'Tie', percentile: 90, amount: 200 },
  ];
  assert.equal(bestParsePerPlayer(rows)[0].id, 'a');
  assert.equal(bestParsePerPlayer(rows.slice().reverse())[0].id, 'a', 'order in does not change order out');
});

test('rows missing what the board needs are dropped', () => {
  const good = parsesFromReport(makeReport())[0];
  assert.equal(isPlayableParse(good), true);
  assert.equal(isPlayableParse({ ...good, ilvl: null }), false);
  assert.equal(isPlayableParse({ ...good, amount: 0 }), false);
  assert.equal(isPlayableParse(null), false);
});

test('two reports build one pool, newest performance winning', () => {
  const second = makeReport({
    code: 'ZZZZ9999YYYY8888',
    rankings: {
      data: [
        {
          fightID: 9,
          kill: 1,
          difficulty: 5,
          duration: 200000,
          encounter: { id: 3135, name: 'Dimensius' },
          roles: {
            dps: {
              characters: [
                { id: 13, name: 'Thalvira', class: 'Priest', spec: 'Shadow', amount: 1900000, rankPercent: 100, bracketData: 692 },
                { id: 16, name: 'Vireska', class: 'Druid', spec: 'Balance', amount: 1673000, rankPercent: 94, bracketData: 682 },
              ],
            },
          },
        },
      ],
    },
  });

  const pool = buildPool([makeReport(), second]);
  assert.deepEqual(pool.map((p) => p.player), ['Emberlyn', 'Grimhollow', 'Sunweaver', 'Thalvira', 'Vireska']);
  const thalvira = pool.find((p) => p.player === 'Thalvira');
  assert.equal(thalvira.boss, 'Dimensius', 'her 100 in the newer report wins');
  assert.equal(thalvira.reportCode, 'ZZZZ9999YYYY8888');
});
