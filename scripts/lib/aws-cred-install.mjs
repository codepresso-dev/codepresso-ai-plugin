/**
 * aws-cred-install.mjs — keeps the `credential_process` entry outside the plugin cache.
 *
 * Plugin updates install into a new versioned cache dir and delete the old one, so a
 * `credential_process` pointing into the cache breaks every AWS call after an update.
 * The entry and its import closure are copied to a stable dir and ~/.aws/config points there.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSectionValue, upsertSectionKV } from './aws-ini.mjs';

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
// aws-cred-process.mjs and everything it imports (beyond node built-ins), relative to scripts/.
const CRED_PROCESS_FILES = ['aws-cred-process.mjs', 'lib/config.mjs', 'lib/aws-session.mjs'];

export const STABLE_CRED_DIR = join(homedir(), '.codepresso', 'bin');
export const AWS_CONFIG_PATH = join(homedir(), '.aws', 'config');

/** Copy the credential_process entry into `destDir` (only files whose content changed). Returns the entry path. */
export function installCredProcess(destDir = STABLE_CRED_DIR) {
  for (const rel of CRED_PROCESS_FILES) {
    const body = readFileSync(join(SCRIPTS_DIR, rel), 'utf-8');
    const dst = join(destDir, rel);
    if (existsSync(dst) && readFileSync(dst, 'utf-8') === body) continue;
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, body);
  }
  return join(destDir, 'aws-cred-process.mjs');
}

export function credProcessCommand(entryPath) {
  return `node "${entryPath}"`;
}

/**
 * Refresh the stable copy and repoint `[default] credential_process` at it when it still
 * references a codepresso aws-cred-process.mjs elsewhere (e.g. a deleted cache version).
 * Leaves foreign credential_process values and configs without one untouched.
 */
export function repairCredProcess({ confPath = AWS_CONFIG_PATH, destDir = STABLE_CRED_DIR } = {}) {
  if (!existsSync(confPath)) return { rewired: false };
  const text = readFileSync(confPath, 'utf-8');
  const current = getSectionValue(text, 'default', 'credential_process');
  if (!current || !current.includes('aws-cred-process.mjs')) return { rewired: false };
  const command = credProcessCommand(installCredProcess(destDir));
  if (current === command) return { rewired: false };
  // Separate from setup's `.codepresso.bak`, which holds the pre-codepresso config.
  copyFileSync(confPath, `${confPath}.codepresso-repair.bak`);
  writeFileSync(confPath, upsertSectionKV(text, 'default', { credential_process: command }));
  return { rewired: true, from: current, to: command };
}
