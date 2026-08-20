# Parsedle

A daily guessing game over your guild's own Warcraft Logs: one parse from the
last two raid nights, five guesses to name the raider who put it up. Everybody
gets the same parse on the same UTC day.

```sh
cp .env.example .env          # WCL credentials + an admin token
docker compose up -d --build  # http://localhost:8080
```

Then add a log — every week, one URL:

```sh
docker compose exec parsedle node server/cli.js add https://www.warcraftlogs.com/reports/<code> "Week 12"
```

…or paste it into `/admin.html`, which does the same thing through the API.

## How a round plays

You open with almost nothing: the output, the pull length, and the raid. Then
two clocks race each other.

- **Guesses.** Each guess is a raider from the pool, scored column by column
  against the answer — 🟩 exact, 🟨 close, ⬛ miss, with ↑/↓ on the numbers
  showing which way the answer sits. "Close" is the right class with the wrong
  spec, the right raid with the wrong boss, or a number within 8 percentile /
  6 item levels.
- **Time.** A hint opens every three minutes whether you guess or not: role,
  armor type, difficulty, how many times the raid wiped on that boss, the
  percentile bracket, and so on down to the guild's initial.

Guessing pulls the next hint forward immediately, so there is a real choice —
spend a guess to learn faster, or let the clock feed you. Five guesses, then
the answer reveals itself with a link to the pull in the log, and you get an
emoji grid to paste into guild chat.

The answer stays on the server. The browser is sent the roster, the clue and
whatever hints it has earned; guesses are scored server-side and the answer
only appears in a response once the round is over.

## The weekly upload

The report list is the only state the game has. Puzzles are always drawn from
the **newest two reports** on it — each report contributes every boss the raid
killed that night, and the wipes ride along as a hint.

```sh
node server/cli.js add <url> ["label"]   # add this week's log
node server/cli.js list                  # newest first; * marks the two in play
node server/cli.js remove <code>         # take one off the list
node server/cli.js check                 # fetch and print the pool as it stands
```

The same operations are on the HTTP API, guarded by `ADMIN_TOKEN`:

| Method | Path | Body |
| --- | --- | --- |
| `POST` | `/api/reports` | `{"url": "…", "label": "…"}` |
| `GET` | `/api/reports` | — |
| `DELETE` | `/api/reports/:code` | — |

Send the token as `x-admin-token` (or `Authorization: Bearer …`). With
`ADMIN_TOKEN` unset the admin API is disabled outright rather than left open —
use the CLI in that case.

A report URL, a permalink with `#fight=…`, or a bare code all work. Adding the
same report twice is a no-op.

### What a report becomes

Each raider is reduced to **one row: their best parse across the sampled
nights**. That keeps names unique — a name has to identify exactly one row —
and "your best parse of the week" is the row worth arguing about anyway. Only
ranked kills carry a percentile, so wipes never become answers, but the wipe
count for the answer's boss shows up as a hint.

Columns that never vary are dropped: playing on one guild's logs, every row
shares a guild and a region, and a column that is always green teaches
nothing.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` | — | Warcraft Logs v2 client, from <https://www.warcraftlogs.com/api/clients/> |
| `ADMIN_TOKEN` | — | Guards the report list. Unset disables the admin API |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | Where `reports.json` lives — mount this |
| `STATIC_ROOT` | `./public` | The served page |

Without credentials, or before the first report is added, the game serves a
bundled sample pool of fictional raiders and says so on the page. That makes
`docker compose up` playable before you have set anything up.

Warcraft Logs is rate limited, so each report is fetched at most once every 30
minutes and the built pool is cached until the list changes.

## Layout

| Path | What lives there |
| --- | --- |
| `server/wcl.js` | OAuth + GraphQL against the Warcraft Logs v2 API |
| `server/transform.js` | Report JSON → parse rows (pure, heavily tested) |
| `server/store.js` | The report list, one JSON file |
| `server/pool.js` | Newest two reports → the answer pool, cached |
| `server/puzzle.js` | What a player is allowed to see |
| `server/app.js` | Routes and static serving, no framework |
| `server/cli.js` | The report list from a shell |
| `src/lib/` | Game rules shared by the server and the page |
| `public/` | The page, the admin form, the stylesheet |
| `test/` | `node --test` suites over all of the above |

Zero dependencies, so `npm install` has nothing to do and the image is Node
plus this source.

## Picking the daily parse

The UTC day number indexes a shuffle of the pool seeded by the cycle number,
so everyone gets the same answer on the same day, nothing repeats until the
whole pool is used, and each cycle reshuffles instead of replaying. Day 1 is
`2026-01-01` (`EPOCH_UTC` in `src/lib/daily.js`).

A pool of 20-30 raiders is a good game; the fallback kicks in below 6.

## Development

```sh
npm test                 # 94 assertions, no network
npm start                # serve on :8080 with whatever is in the environment
node server/cli.js check # what would today's pool be?
```

The rules live in `src/lib` as pure functions, which is why they are testable
without a browser or an API key. `server/app.js` decides nothing about the
game; `public/app.js` only renders what the server sends.
