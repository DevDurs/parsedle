/**
 * The little bit of file handling every store here repeats.
 *
 * Read a JSON file, treating "not there yet" as empty; write it through a temp
 * file and a rename, so a crash mid-write cannot leave a truncated list behind.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** @template T @param {string} file @param {T} fallback @returns {Promise<T>} */
export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    // A missing file is a new install. Anything else — bad JSON, no
    // permission — is a real problem and should not read as "empty".
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJson(file, data, { name = 'store' } = {}) {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${name}.${process.pid}.tmp`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
  return data;
}
