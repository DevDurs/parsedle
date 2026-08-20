/**
 * Share text — the emoji grid people paste into guild chat.
 */

import { FIELDS, MAX_GUESSES } from './compare.js';

const SQUARES = { hit: '🟩', near: '🟨', miss: '⬛' };

/** One row of squares per guess, one square per board column. */
export function shareGrid(guesses) {
  return guesses
    .map((g) => FIELDS.map(({ key }) => SQUARES[g.fields[key].verdict] ?? SQUARES.miss).join(''))
    .join('\n');
}

/**
 * @param {{puzzleNumber: number, guesses: object[], won: boolean, maxGuesses?: number, hintsUsed?: number}} opts
 */
export function shareText({ puzzleNumber, guesses, won, maxGuesses = MAX_GUESSES, hintsUsed = 0 }) {
  const score = won ? `${guesses.length}/${maxGuesses}` : `X/${maxGuesses}`;
  const hints = hintsUsed > 0 ? ` · ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'}` : '';
  return `Parsedle #${puzzleNumber} ${score}${hints}\n\n${shareGrid(guesses)}`;
}
