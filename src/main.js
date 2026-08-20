/**
 * Parsedle — wiring. All the rules live in ./lib; this file only renders them
 * and listens for clicks.
 */

import PARSES from './data/parses.js';
import { dayKey, msUntilNextPuzzle, pickDaily, puzzleNumber } from './lib/daily.js';
import { FIELDS, MAX_GUESSES, evaluateGuess, gameStatus } from './lib/compare.js';
import {
  ROLE_LABELS,
  formatAmount,
  formatDuration,
  hintsFor,
  msUntilNextHint,
  unlockedHintCount,
  visibleHints,
} from './lib/hints.js';
import { shareGrid, shareText } from './lib/share.js';
import { loadProgress, loadStats, recordResult, saveProgress } from './lib/storage.js';

const $ = (id) => document.getElementById(id);
const ARROWS = { up: '↑', down: '↓' };

const today = new Date();
const KEY = dayKey(today);
const NUMBER = puzzleNumber(today);
const ANSWER = pickDaily(PARSES, today);
const HINT_TOTAL = hintsFor(ANSWER).length;

const state = {
  guesses: /** @type {ReturnType<typeof evaluateGuess>[]} */ ([]),
  startedAt: Date.now(),
  finished: false,
  highlighted: -1,
  suggestions: /** @type {typeof PARSES} */ ([]),
};

/* ---------------------------------------------------------------- restore */

function restore() {
  const saved = loadProgress(KEY);
  if (!saved) return;
  state.startedAt = saved.startedAt ?? Date.now();
  for (const id of saved.guessIds ?? []) {
    const parse = PARSES.find((p) => p.id === id);
    if (parse) state.guesses.push(evaluateGuess(parse, ANSWER));
  }
  state.finished = gameStatus(state.guesses).status !== 'playing';
}

function persist() {
  saveProgress({
    dayKey: KEY,
    guessIds: state.guesses.map((g) => g.parse.id),
    startedAt: state.startedAt,
    finished: state.finished,
  });
}

/* ----------------------------------------------------------------- render */

function elapsedMs() {
  return Date.now() - state.startedAt;
}

function hintOpts() {
  return { guessesMade: state.guesses.length, elapsedMs: elapsedMs(), total: HINT_TOTAL };
}

function renderParseCard() {
  $('puzzle-no').textContent = `#${NUMBER} · ${KEY}`;
  $('parse-stats').innerHTML = [
    ['Output', formatAmount(ANSWER.amount, ANSWER.role)],
    ['Pull length', formatDuration(ANSWER.durationSec)],
  ]
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
}

function renderHints() {
  const hints = visibleHints(ANSWER, hintOpts());
  $('hints').innerHTML = hints
    .map(
      (h) => `<div class="hint ${h.locked ? 'locked' : 'open'}" role="listitem">
        <span class="hint-label">${h.label}</span>
        <span class="hint-value">${h.value}</span>
      </div>`,
    )
    .join('');

  const wait = msUntilNextHint(hintOpts());
  $('hint-timer').textContent = state.finished
    ? ''
    : wait === null
      ? 'Every hint is open.'
      : `Next hint in ${formatDuration(Math.ceil(wait / 1000))} — or guess to open it now.`;
}

function cellContent(key, result, parse) {
  const raw = key === 'role' ? ROLE_LABELS[parse.role] ?? parse.role : parse[key];
  const arrow = result.direction ? ` <span class="arrow">${ARROWS[result.direction]}</span>` : '';
  return `${raw}${arrow}`;
}

function renderBoard() {
  $('board-head').innerHTML =
    '<th scope="col">Raider</th>' + FIELDS.map((f) => `<th scope="col">${f.label}</th>`).join('');

  $('board-body').innerHTML = state.guesses
    .map((g) => {
      const cells = FIELDS.map(({ key }) => {
        const res = g.fields[key];
        return `<td class="cell ${res.verdict}">${cellContent(key, res, g.parse)}</td>`;
      }).join('');
      return `<tr><th scope="row" class="player ${g.correct ? 'hit' : ''}">${g.parse.player}</th>${cells}</tr>`;
    })
    .join('');

  const { guessesLeft } = gameStatus(state.guesses);
  $('guess-meta').textContent = state.finished
    ? 'Puzzle over — come back tomorrow.'
    : `${guessesLeft} guess${guessesLeft === 1 ? '' : 'es'} left.`;
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

function renderResult() {
  const { status } = gameStatus(state.guesses);
  if (status === 'playing') {
    $('result').hidden = true;
    return;
  }
  const won = status === 'won';
  $('result').hidden = false;
  $('result-title').textContent = won ? 'Called it.' : 'Out of guesses.';
  $('result-detail').innerHTML = won
    ? `<strong>${ANSWER.player}</strong> — ${ANSWER.spec} ${ANSWER.class} of ${ANSWER.guild} (${ANSWER.region}),
       ${ANSWER.percentile} on ${ANSWER.difficulty} ${ANSWER.boss}.`
    : `It was <strong>${ANSWER.player}</strong> — ${ANSWER.spec} ${ANSWER.class} of ${ANSWER.guild} (${ANSWER.region}),
       ${ANSWER.percentile} on ${ANSWER.difficulty} ${ANSWER.boss}.`;
  $('share-grid').textContent = shareGrid(state.guesses);
  renderStats();
}

function renderCountdown() {
  const left = Math.max(0, msUntilNextPuzzle(new Date()));
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('next-puzzle').textContent = `Next parse in ${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function renderAll() {
  renderParseCard();
  renderHints();
  renderBoard();
  renderResult();
  renderCountdown();
  $('guess-input').disabled = state.finished;
  $('guess-submit').disabled = state.finished;
}

/* ------------------------------------------------------------ suggestions */

function guessedIds() {
  return new Set(state.guesses.map((g) => g.parse.id));
}

export function matchPlayers(query, pool = PARSES, exclude = new Set()) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const used = exclude;
  return pool
    .filter((p) => !used.has(p.id) && p.player.toLowerCase().includes(q))
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
             class="${i === state.highlighted ? 'active' : ''}" data-id="${p.id}">
           <span class="sugg-name">${p.player}</span>
           <span class="sugg-meta">${p.spec} ${p.class}</span>
         </li>`,
    )
    .join('');
}

function updateSuggestions() {
  state.suggestions = matchPlayers($('guess-input').value, PARSES, guessedIds());
  state.highlighted = state.suggestions.length ? 0 : -1;
  renderSuggestions();
}

function clearSuggestions() {
  state.suggestions = [];
  state.highlighted = -1;
  renderSuggestions();
}

/* -------------------------------------------------------------- game flow */

function say(text) {
  $('message').textContent = text;
}

function submitGuess(parse) {
  if (state.finished || !parse) return;
  if (guessedIds().has(parse.id)) {
    say(`You already guessed ${parse.player}.`);
    return;
  }

  state.guesses.push(evaluateGuess(parse, ANSWER));
  const { status } = gameStatus(state.guesses);
  state.finished = status !== 'playing';
  if (state.finished) {
    recordResult({ won: status === 'won', guessCount: state.guesses.length, puzzleNumber: NUMBER });
  }

  $('guess-input').value = '';
  clearSuggestions();
  say(state.finished ? '' : 'A hint just opened up.');
  persist();
  renderAll();
}

function resolveTypedGuess() {
  const typed = $('guess-input').value.trim().toLowerCase();
  if (state.highlighted >= 0 && state.suggestions[state.highlighted]) {
    return state.suggestions[state.highlighted];
  }
  return PARSES.find((p) => p.player.toLowerCase() === typed) ?? null;
}

/* ---------------------------------------------------------------- listeners */

$('guess-input').addEventListener('input', () => {
  say('');
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
  submitGuess(PARSES.find((p) => p.id === li.dataset.id));
});

$('guess-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const parse = resolveTypedGuess();
  if (!parse) {
    say('No raider by that name. Try the suggestions.');
    return;
  }
  submitGuess(parse);
});

$('share-btn').addEventListener('click', async () => {
  const text = shareText({
    puzzleNumber: NUMBER,
    guesses: state.guesses,
    won: gameStatus(state.guesses).status === 'won',
    // The first hint is free; everything past it is what you actually leaned on.
    hintsUsed: Math.max(0, unlockedHintCount(hintOpts()) - 1),
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

restore();
renderAll();
// Hints open on a clock, and the countdown ticks, so keep repainting both.
setInterval(() => {
  renderHints();
  renderCountdown();
}, 1000);
