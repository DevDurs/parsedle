# Parsedle

A daily guessing game in the Wordle / LoLdle mould: you get one Warcraft raid
parse and five guesses to name the raider who put it up. Everyone in the world
plays the same parse on the same day.

```
npm test        # logic tests, no dependencies
npm start       # serves the static site on http://localhost:8080
```

No build step, no backend, no dependencies — it is an ES-module static site.

## How a round plays

You start with almost nothing: the output (DPS or HPS), the pull length, and
the raid it came from. Then two clocks run against each other:

- **Guesses.** Each guess is a raider from the pool. The board scores it column
  by column against the answer — 🟩 exact, 🟨 close, ⬛ miss, with ↑/↓ on the
  numbers telling you which way the answer sits. "Close" means the right class
  with the wrong spec, the right raid with the wrong boss, or a number within
  8 percentile / 6 item levels.
- **Time.** A new hint about the answer opens every three minutes whether you
  guess or not — role, then armor type, difficulty, percentile bracket, region,
  and finally the guild's initial and length.

Guessing pulls the next hint forward immediately, so there is a real choice:
burn a guess to learn faster, or sit on the puzzle and let it come to you. Five
guesses, then the answer reveals itself and you get an emoji grid to paste into
guild chat.

## Layout

| Path | What lives there |
| --- | --- |
| `index.html`, `assets/styles.css` | The page and its styling |
| `src/main.js` | Rendering and event wiring only |
| `src/lib/daily.js` | Which parse is today's, and the countdown to the next |
| `src/lib/compare.js` | Guess scoring — the 🟩/🟨/⬛ rules |
| `src/lib/hints.js` | The hint ladder and its unlock schedule |
| `src/lib/share.js` | The emoji grid, which never leaks the answer |
| `src/lib/storage.js` | Mid-puzzle progress, streaks, distribution |
| `src/data/parses.js` | The answer pool |
| `test/` | `node --test` suites over every module above |

The rules all live in `src/lib` as pure functions, which is why they are
testable without a browser; `src/main.js` never decides anything on its own.

## Picking the daily parse

`pickDaily` needs no server. The UTC day number indexes into a shuffle of the
pool seeded by the cycle number, so:

- everyone gets the same answer on the same UTC day,
- no parse repeats until all of them have been used,
- each new cycle reshuffles instead of replaying the same order.

Day 1 is `2026-01-01` (`EPOCH_UTC` in `src/lib/daily.js`) — move it if you want
different puzzle numbering.

## Using real data

The raiders and parses in `src/data/parses.js` are invented. To play with real
logs, replace that file's export with rows in the same shape:

```js
{
  id, player, class, spec, role,          // role: 'dps' | 'healer' | 'tank'
  region, guild,
  raid, boss, difficulty,                 // 'LFR' | 'Normal' | 'Heroic' | 'Mythic'
  percentile, ilvl, amount, durationSec,
}
```

A Warcraft Logs v2 (GraphQL) rankings query fills every field directly. Two
things the game assumes: `player` is unique across the pool (a name identifies
one parse), and the pool is large enough that a cycle is not obviously
memorisable — a few hundred rows makes for a much better game than forty.

Keep the pool in a file the client can fetch, or swap the import for a `fetch`
of your own endpoint. Nothing else in the game needs to change.
