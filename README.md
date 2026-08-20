# Parsedle

A daily guessing game over LuckyDo's own Warcraft Logs: one parse from the last
two raid nights, five guesses to name the raider who put it up. Everybody gets
the same parse on the same UTC day, and the answer is always one of ours —
never a pug.

```sh
cp .env.example .env          # WCL credentials + an admin token
docker compose up -d --build  # http://localhost:8080
```

### The Warcraft Logs client

Create one at <https://www.warcraftlogs.com/api/clients/> and copy the id and
secret into `.env`. The form also demands a **redirect URL**, which is the one
confusing part: that field belongs to the user-login (authorization code)
flow, and Parsedle authenticates as itself with client credentials, so nothing
is ever redirected anywhere. Register any URL you control and forget it:

```
https://parsedle.example.com/oauth/callback     # or wherever you deploy
http://localhost:8080/oauth/callback            # fine for local testing
```

The trade-off that comes with client credentials is **the logs have to be
public**. A private or unlisted report reads as "not found" — the error says
so — because only a token issued to a logged-in user can see those. If your
guild logs privately, say so and the user-login flow is a day's work to add.

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
| `GET` | `/api/roster` | — (`?refresh=1` re-reads the site roster) |
| `POST` | `/api/roster` | `{"include": […], "exclude": […], "forget": […]}` |

Send the token as `x-admin-token` (or `Authorization: Bearer …`). With
`ADMIN_TOKEN` unset the admin API is disabled outright rather than left open —
use the CLI in that case.

A report URL, a permalink with `#fight=…`, or a bare code all work. Adding the
same report twice is a no-op.

### What a report becomes

Everyone who is not on the guild roster is dropped first (see below). Each
remaining raider is then reduced to **one row: their best parse across the
sampled nights**. That keeps names unique — a name has to identify exactly one
row — and "your best parse of the week" is the row worth arguing about anyway.
Only ranked kills carry a percentile, so wipes never become answers, but the
wipe count for the answer's boss shows up as a hint.

Columns that never vary are dropped: every row shares a region, and a column
that is always green teaches nothing. There is no guild column at all — only
LuckyDo raiders are ever in the pool, so it would say the same thing on every
line.

## Only our raiders

A pug who filled a spot on Tuesday is not a fair thing to ask people to name,
so **only guild members can ever be the answer**. Membership is:

```
members = (LuckyDo's Warcraft Logs roster ∪ include) \ exclude
```

The site roster is read once every six hours. The two override lists live in
`data/roster.json` and cover what the site roster is always slightly wrong
about — a trial who has not been invited on Warcraft Logs yet, an alt under
another name, someone who has left:

```sh
node server/cli.js roster                  # who counts, and where the list came from
node server/cli.js roster refresh          # re-read the site roster now
node server/cli.js roster add <name…>      # vouch for someone the roster misses
node server/cli.js roster exclude <name…>  # bar someone the roster still lists
node server/cli.js roster forget <name…>   # drop a local override
node server/cli.js roster import [<code>]  # seed from a report, then prune the pugs
```

The same lists are on `GET`/`POST /api/roster` and in a panel on
`/admin.html`. Names match case-insensitively and ignore a realm suffix, so
`Thalvira`, `thalvira` and `Thalvira-Draenor` are one person.

**If membership cannot be established, nobody plays rather than everybody**:
an unreachable roster, an empty one, or no guild configured all fall back to
the sample pool with the reason shown on the page. That way a bad roster fetch
can never quietly promote a pug into the answer pool. `roster import` is the
quickest way out of that state — seed from a real report and then
`roster exclude` the handful who were not ours.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET` | — | Warcraft Logs v2 client, from <https://www.warcraftlogs.com/api/clients/>. The redirect URL that form asks for is unused |
| `GUILD_NAME` | `LuckyDo` | The guild whose members can be answers |
| `GUILD_SERVER` / `GUILD_REGION` | — | Realm slug and region, e.g. `draenor` / `EU`. Needed to read the roster |
| `GUILD_ID` | — | Use instead of name + server + region, if you know it |
| `ADMIN_TOKEN` | — | Guards the report list and the roster. Unset disables the admin API |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | Where `reports.json` and `roster.json` live — mount this |
| `STATIC_ROOT` | `./public` | The served page |

Without credentials, before the first report is added, or with no roster to
check names against, the game serves a bundled sample pool of fictional
raiders and says so on the page. That makes `docker compose up` playable
before you have set anything up.

Warcraft Logs is rate limited, so each report is fetched at most once every 30
minutes and the built pool is cached until the list changes.

## Layout

| Path | What lives there |
| --- | --- |
| `server/wcl.js` | OAuth + GraphQL against the Warcraft Logs v2 API |
| `server/transform.js` | Report JSON → parse rows (pure, heavily tested) |
| `server/store.js` | The report list, one JSON file |
| `server/roster.js` | Who counts as a guild member |
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
npm test                 # 115 assertions, no network
npm start                # serve on :8080 with whatever is in the environment
node server/cli.js check # what would today's pool be?
```

The rules live in `src/lib` as pure functions, which is why they are testable
without a browser or an API key. `server/app.js` decides nothing about the
game; `public/app.js` only renders what the server sends.
