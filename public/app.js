/**
 * Parsedle — the page.
 *
 * The answer never reaches the browser: the server scores each guess and hands
 * back the board, the hints earned so far, and the answer only once the round
 * is over. This file renders that response and keeps the guess list.
 */

import { formatDuration, formatOutput } from '/lib/hints.js';
import { shareGrid, shareText } from '/lib/share.js';
import { loadStats, recordResult } from '/lib/storage.js';

const $ = (id) => document.getElementById(id);
const ARROWS = { up: '↑', down: '↓' };
const PROGRESS_KEY = 'parsedle:progress';

const state = {
  /** @type {?object} the latest server view */
  view: null,
  guessIds: [],
  startedAt: Date.now(),
  roster: [],
  suggestions: [],
  highlighted: -1,
  countdownMs: 0,
  hintTimer: null,
};

/* --------------------------------------------------------------- progress */

/** The UTC day, used only as a cache key — the server decides the real puzzle. */
function localDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function restoreProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null');
    if (!saved || saved.dayKey !== localDayKey()) return;
    state.guessIds = Array.isArray(saved.guessIds) ? saved.guessIds : [];
    state.startedAt = saved.startedAt ?? Date.now();
  } catch {
    /* storage disabled — the round just won't survive a reload. */
  }
}

function persistProgress() {
  try {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ dayKey: state.view?.dayKey ?? localDayKey(), guessIds: state.guessIds, startedAt: state.startedAt }),
    );
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ fetch */

async function refresh() {
  const res = await fetch('/api/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guessIds: state.guessIds, startedAt: state.startedAt }),
  });
  if (!res.ok) throw new Error(`Server said ${res.status}`);
  const view = await res.json();

  // The server drops ids it no longer knows (a rebuilt pool, a new day), so
  // its guess list — not ours — is the truth.
  state.guessIds = view.guesses.map((g) => g.parse.id);
  state.view = view;
  state.roster = view.roster;
  state.countdownMs = view.msUntilNextPuzzle;

  persistProgress();
  renderAll();
  scheduleHintRefresh();
  return view;
}

/** Hints open on a clock the server owns, so ask again when one is due. */
function scheduleHintRefresh() {
  clearTimeout(state.hintTimer);
  const wait = state.view?.msUntilNextHint;
  if (typeof wait !== 'number') return;
  state.hintTimer = setTimeout(() => refresh().catch(showError), Math.max(1000, wait + 500));
}

/* ----------------------------------------------------------------- render */

/**
 * The unit is withheld until the role hint opens, or HPS would name a healer
 * on sight. It still needs a per-second marker in the meantime, though —
 * a bare `868K` reads as a total rather than a rate.
 */
function formatAmount(amount, unit) {
  return `${formatOutput(amount)} ${unit ?? '/sec'}`;
}

function renderHeader() {
  const { puzzleNumber, dayKey } = state.view;
  $('puzzle-no').textContent = `#${puzzleNumber} · ${dayKey}`;
}

function renderClue() {
  const { clue } = state.view;
  $('parse-stats').innerHTML = [
    ['Output', formatAmount(clue.amount, clue.unit)],
    ['Pull length', formatDuration(clue.durationSec)],
  ]
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
}

function renderHints() {
  $('hints').innerHTML = state.view.hints
    .map(
      (h) => `<div class="hint ${h.locked ? 'locked' : 'open'}" role="listitem">
        <span class="hint-label">${escapeHtml(h.label)}</span>
        <span class="hint-value">${escapeHtml(h.value)}</span>
      </div>`,
    )
    .join('');

  const wait = state.view.msUntilNextHint;
  $('hint-timer').textContent =
    state.view.status !== 'playing'
      ? ''
      : wait === null
        ? 'Every hint is open.'
        : `Next hint in ${formatDuration(Math.ceil(wait / 1000))} — or guess to open it now.`;
}

function renderBoard() {
  const { fields, guesses, status, guessesLeft } = state.view;
  $('board-head').innerHTML =
    '<th scope="col">Raider</th>' + fields.map((f) => `<th scope="col">${escapeHtml(f.label)}</th>`).join('');

  $('board-body').innerHTML = guesses
    .map((g) => {
      const cells = fields
        .map(({ key }) => {
          const res = g.fields[key];
          const arrow = res.direction ? ` <span class="arrow">${ARROWS[res.direction]}</span>` : '';
          return `<td class="cell ${res.verdict}">${escapeHtml(g.parse[key])}${arrow}</td>`;
        })
        .join('');
      return `<tr><th scope="row" class="player ${g.correct ? 'hit' : ''}">${escapeHtml(g.parse.player)}</th>${cells}</tr>`;
    })
    .join('');

  // The sample pool is not a raid night, so it gets the plain wording.
  const { raidSize, sample } = state.view;
  const left = `${guessesLeft} guess${guessesLeft === 1 ? '' : 'es'} left`;
  $('guess-meta').textContent =
    status !== 'playing'
      ? 'Puzzle over — come back tomorrow.'
      : sample
        ? `${left}.`
        : `${left} — from the ${raidSize} raiders who were there that night.`;
}

function renderResult() {
  const { status, answer, guesses, puzzleNumber, fields, maxGuesses } = state.view;
  if (status === 'playing' || !answer) {
    $('result').hidden = true;
    return;
  }

  const won = status === 'won';
  $('result').hidden = false;
  $('result-title').textContent = won ? 'Called it.' : 'Out of guesses.';
  $('result-detail').innerHTML =
    `${won ? '' : 'It was '}<strong>${escapeHtml(answer.player)}</strong> — ${escapeHtml(answer.spec)} ` +
    `${escapeHtml(answer.class)}, ${answer.percentile} on ${escapeHtml(answer.difficulty)} ${escapeHtml(answer.boss)}` +
    (answer.report ? ` · <a href="https://www.warcraftlogs.com/reports/${encodeURIComponent(answer.report.code)}#fight=${encodeURIComponent(answer.report.fightID)}" target="_blank" rel="noopener">see the log</a>` : '') +
    '.';
  $('share-grid').textContent = shareGrid(guesses, fields);

  recordResult({ won, guessCount: guesses.length, puzzleNumber });
  renderStats();
  $('result').dataset.maxGuesses = maxGuesses;
}

function renderStats() {
  const stats = loadStats();
  const winRate = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  $('stats').innerHTML = [
    ['Played', stats.played],
    ['Win rate', `${winRate}%`],
    ['Streak', stats.currentStreak],
    ['Best streak', stats.maxStreak],
  ]
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
}

function renderSources() {
  const { sources = [], sample, warnings = [] } = state.view;
  const notice = $('notice');
  notice.hidden = !sample && warnings.length === 0;
  notice.textContent = warnings[0] ?? '';

  $('sources').innerHTML = sources.length
    ? `Drawn from ${sources
        .map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`)
        .join(' and ')}.`
    : 'Playing the bundled sample pool.';
}

function renderCountdown() {
  const left = Math.max(0, state.countdownMs);
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('next-puzzle').textContent = `Next parse in ${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function renderAll() {
  renderHeader();
  renderClue();
  renderHints();
  renderBoard();
  renderResult();
  renderSources();
  renderCountdown();
  const over = state.view.status !== 'playing';
  $('guess-input').disabled = over;
  $('guess-submit').disabled = over;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function showError(err) {
  $('message').textContent = `Could not reach the server: ${err.message}`;
}

/* ------------------------------------------------------------ suggestions */

export function matchPlayers(query, roster, exclude = new Set()) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return roster
    .filter((p) => !exclude.has(p.id) && p.player.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.player.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.player.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.player.localeCompare(b.player);
    })
    .slice(0, 8);
}

function renderSuggestions() {
  const list = $('suggestions');
  const input = $('guess-input');
  if (!state.suggestions.length) {
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    return;
  }
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  list.innerHTML = state.suggestions
    .map(
      (p, i) =>
        `<li role="option" id="sugg-${i}" aria-selected="${i === state.highlighted}"
             class="${i === state.highlighted ? 'active' : ''}" data-id="${escapeHtml(p.id)}">
           <span class="sugg-name">${escapeHtml(p.player)}</span>
         </li>`,
    )
    .join('');
}

function updateSuggestions() {
  state.suggestions = matchPlayers($('guess-input').value, state.roster, new Set(state.guessIds));
  state.highlighted = state.suggestions.length ? 0 : -1;
  renderSuggestions();
}

function clearSuggestions() {
  state.suggestions = [];
  state.highlighted = -1;
  renderSuggestions();
}

/* -------------------------------------------------------------- game flow */

async function submitGuess(entry) {
  if (!entry || state.view.status !== 'playing') return;
  if (state.guessIds.includes(entry.id)) {
    $('message').textContent = `You already guessed ${entry.player}.`;
    return;
  }

  state.guessIds = [...state.guessIds, entry.id];
  $('guess-input').value = '';
  clearSuggestions();
  $('message').textContent = '';

  try {
    const view = await refresh();
    if (view.status === 'playing') $('message').textContent = 'A hint just opened up.';
  } catch (err) {
    state.guessIds = state.guessIds.filter((id) => id !== entry.id);
    showError(err);
  }
}

function resolveTypedGuess() {
  if (state.highlighted >= 0 && state.suggestions[state.highlighted]) return state.suggestions[state.highlighted];
  const typed = $('guess-input').value.trim().toLowerCase();
  return state.roster.find((p) => p.player.toLowerCase() === typed) ?? null;
}

/* -------------------------------------------------------------- listeners */

$('guess-input').addEventListener('input', () => {
  $('message').textContent = '';
  updateSuggestions();
});

$('guess-input').addEventListener('keydown', (event) => {
  if (!state.suggestions.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const n = state.suggestions.length;
    state.highlighted = (state.highlighted + step + n) % n;
    renderSuggestions();
  } else if (event.key === 'Escape') {
    clearSuggestions();
  }
});

$('suggestions').addEventListener('mousedown', (event) => {
  const li = event.target.closest('li[data-id]');
  if (!li) return;
  event.preventDefault();
  submitGuess(state.roster.find((p) => p.id === li.dataset.id));
});

$('guess-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const entry = resolveTypedGuess();
  if (!entry) {
    $('message').textContent = 'No raider by that name. Try the suggestions.';
    return;
  }
  submitGuess(entry);
});

$('share-btn').addEventListener('click', async () => {
  const { puzzleNumber, guesses, status, hints, fields, maxGuesses } = state.view;
  const text = shareText({
    puzzleNumber,
    guesses,
    won: status === 'won',
    maxGuesses,
    fields,
    hintsUsed: Math.max(0, hints.filter((h) => !h.locked).length - 1),
  });
  try {
    await navigator.clipboard.writeText(text);
    $('share-btn').textContent = 'Copied!';
  } catch {
    $('share-btn').textContent = 'Copy failed — select the grid';
  }
  setTimeout(() => ($('share-btn').textContent = 'Copy result'), 2000);
});

/* ------------------------------------------------------------------- boot */

restoreProgress();
refresh().catch(showError);

setInterval(() => {
  if (!state.view) return;
  state.countdownMs = Math.max(0, state.countdownMs - 1000);
  if (state.view.msUntilNextHint !== null && typeof state.view.msUntilNextHint === 'number') {
    state.view.msUntilNextHint = Math.max(0, state.view.msUntilNextHint - 1000);
  }
  renderCountdown();
  renderHints();
}, 1000);
