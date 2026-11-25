#!/usr/bin/env node

/**
 * Codepresso PostToolUse:Bash hook.
 * Posts a comment to the associated PR on git commits, and triggers
 * Notion status transitions on `gh pr merge`.
 */

import { readStdin } from './lib/stdin.mjs';
import { getStateDir, loadConfig, isTaskWorkflowEnabled } from './lib/config.mjs';
import { getSessionFile, readCache, isSessionValid, shouldPromptMfa } from './lib/aws-session.mjs';
import { createLogger } from './lib/logger.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const SESSION_FILE = join(getStateDir(), 'codepresso-session.json');
const log = createLogger('git-watcher');

function readSession() {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function extractCommitInfo(command, output) {
  if (!command) return null;
  if (!/\bgit\s+commit\b/.test(command)) return null;

  const match = output?.match(/\[[\w/.-]+\s+([a-f0-9]{7,})\]\s+(.+)/);
  if (match) {
    return { hash: match[1], message: match[2].trim() };
  }
  const msgMatch = command.match(/-m\s+["']([^"']+)["']/);
  if (msgMatch) {
    return { hash: 'unknown', message: msgMatch[1] };
  }
  return null;
}

function isGitPush(command) {
  return /\bgit\s+push\b/.test(command);
}

function isGitMerge(command) {
  return /\bgh\s+pr\s+merge\b/.test(command);
}

function extractMergedPr(command, session) {
  const match = command.match(/\bgh\s+pr\s+merge\s+(\d+)/);
  if (match) return parseInt(match[1], 10);
  return session?.prNumber || null;
}

function postCommitComment(prNumber, commit, cwd) {
  const body = [
    '### :robot: Git Activity',
    '',
    `**Commit:** \`${commit.hash}\` — ${commit.message}`,
    `**Time:** ${commit.timestamp}`,
    '',
    '---',
    '<sub>Logged by Codepresso</sub>',
  ].join('\n');

  const child = spawn('gh', ['pr', 'comment', String(prNumber), '--body', body], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function spawnMergeHandler(prNumber, session) {
  try {
    const payloadFile = join(getStateDir(), `codepresso-merge-${prNumber}.json`);
    const payload = {
      prNumber,
      branch: session.branch,
      sessionId: session.sessionId,
      gitRoot: session.gitRoot,
      sprintDatabases: session.sprintDatabases || null,
    };
    writeFileSync(payloadFile, JSON.stringify(payload, null, 2), 'utf-8');

    const child = spawn('node', [
      join(dirname(fileURLToPath(import.meta.url)), 'handle-merge-transition.mjs'),
      payloadFile,
    ], {
      detached: true,
      stdio: 'ignore',
      cwd: session.gitRoot || process.cwd(),
    });
    child.unref();
  } catch {
    log.debug('Failed to spawn merge handler');
  }
}

async function main() {
  const raw = await readStdin(2000);

  try {
    const input = JSON.parse(raw);
    const toolInput = input?.hookInput?.toolInput || input?.toolInput || {};
    const toolOutput = input?.hookInput?.toolOutput || input?.toolOutput || '';
    const command = toolInput?.command || '';
    const output = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput);

    // AWS MFA reactive trigger — runs regardless of PR/session state.
    const cfg = loadConfig();
    if (cfg.aws?.enabled && /(^|\s)aws\s/.test(command)) {
      const cacheValid = isSessionValid(readCache(getSessionFile(cfg)));
      if (shouldPromptMfa(output, { cacheValid })) {
        process.stdout.write(JSON.stringify({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: '[Codepresso] An `aws` command was blocked because the MFA session is missing/expired. Run /codepresso:aws-login to refresh, then retry the command.',
          },
        }));
        return;
      }
    }

    const session = readSession();
    if (!session) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    if (!session.prNumber) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const commitInfo = extractCommitInfo(command, output);
    if (commitInfo) {
      log.info(`Commit detected: ${commitInfo.hash}`);
      postCommitComment(session.prNumber, {
        hash: commitInfo.hash,
        message: commitInfo.message,
        timestamp: new Date().toISOString(),
      }, session.gitRoot);

      process.stdout.write(JSON.stringify({
        continue: true,
        additionalContext: `[Codepresso] Commit \`${commitInfo.hash}\` logged to PR #${session.prNumber}`,
      }));
      return;
    }

    if (isGitPush(command)) {
      process.stdout.write(JSON.stringify({
        continue: true,
        additionalContext: `[Codepresso] Push detected on branch \`${session.branch}\` (PR #${session.prNumber})`,
      }));
      return;
    }

    // PR merge -> Notion task auto-complete is part of the opt-in task workflow.
    if (isTaskWorkflowEnabled(cfg) && isGitMerge(command)) {
      const mergedPr = extractMergedPr(command, session);
      if (mergedPr) {
        log.info(`PR merge detected: #${mergedPr}`);
        spawnMergeHandler(mergedPr, session);

        process.stdout.write(JSON.stringify({
          continue: true,
          additionalContext: `[Codepresso] PR #${mergedPr} merge detected — task status transition triggered.`,
        }));
        return;
      }
    }
  } catch {
    // Silent failure
  }

  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
