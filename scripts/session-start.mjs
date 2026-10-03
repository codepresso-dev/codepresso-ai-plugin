#!/usr/bin/env node

/**
 * Codepresso SessionStart hook.
 * Detects current branch and associated PR, caches state for the session.
 */

import { readStdin } from './lib/stdin.mjs';
import { loadConfig, ensureSetup, getStateDir } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';
import { localDateStr } from './lib/dates.mjs';
import { getCurrentBranch, findPrForBranch, isMainBranch, getHeadCommit, getGitRoot, listSubmodules } from './lib/git-utils.mjs';
import { fetchNotionTasksStructured } from './lib/notion-tasks.mjs';
import { fetchSprintWithEpics } from './lib/sprint-context.mjs';
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { shouldRunInboxScan } from './lib/inbox-state.mjs';

const STATE_DIR = getStateDir();
const SESSION_FILE = join(STATE_DIR, 'codepresso-session.json');
const GREETING_STATE_FILE = join(homedir(), '.codepresso', 'daily-greeting.json');
const KOREAN_RULES_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'korean-output.md');

// One-time migration: move legacy .omc/state/codepresso-* files to .codepresso/state/
const legacyStateDir = join(process.cwd(), '.omc', 'state');
if (existsSync(legacyStateDir) && !existsSync(STATE_DIR)) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    for (const file of readdirSync(legacyStateDir)) {
      if (file.startsWith('codepresso-')) {
        renameSync(join(legacyStateDir, file), join(STATE_DIR, file));
      }
    }
  } catch { /* migration is best-effort */ }
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const log = createLogger('session-start');

/**
 * Check if today is the first session of the day.
 */
function isFirstSessionOfDay() {
  try {
    const state = JSON.parse(readFileSync(GREETING_STATE_FILE, 'utf-8'));
    const today = localDateStr();
    return state.lastDate !== today;
  } catch {
    // File doesn't exist or is corrupted — treat as first session
    return true;
  }
}

function isWeekday() {
  const dow = new Date().getDay();
  return dow >= 1 && dow <= 5;
}

const INBOX_LAST_RUN_FILE = join(homedir(), '.codepresso', 'inbox-last-run.json');

function readInboxLastRunDate() {
  try {
    const raw = readFileSync(INBOX_LAST_RUN_FILE, 'utf-8');
    return JSON.parse(raw).lastDate || null;
  } catch {
    return null;
  }
}

function markInboxScanScheduled(todayDate) {
  try {
    mkdirSync(dirname(INBOX_LAST_RUN_FILE), { recursive: true });
    writeFileSync(INBOX_LAST_RUN_FILE, JSON.stringify({ lastDate: todayDate }, null, 2), 'utf-8');
  } catch (err) {
    log.error(`Failed to update inbox-last-run: ${err.message}`);
  }
}

// Uses local-time getters intentionally — the inbox daily flag must agree with
// `new Date().getDay()` used to detect weekday vs weekend. (Distinct from the
// greeting's `toISOString().slice(0,10)` which uses UTC.)
function todayLocalDate(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Spawn the daily Google Chat greeting as a detached process.
 */
function spawnDailyGreeting(tasks, config, gitRoot) {
  try {
    const spaceId = config.googleChat?.spaceId;
    if (!spaceId) return;

    const payload = {
      tasks,
      spaceId,
      displayName: config.notion?.displayName || null,
      gitRoot: gitRoot || null,
      githubUsername: config.github?.username || null,
    };

    const payloadPath = join(STATE_DIR, `codepresso-greeting-${Date.now()}.json`);
    writeFileSync(payloadPath, JSON.stringify(payload), 'utf-8');

    const child = spawn(
      process.execPath,
      [join(__dirname, 'daily-chat-greeting.mjs'), payloadPath],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();

    log.info('Daily greeting process spawned');
  } catch (err) {
    log.error(`Failed to spawn daily greeting: ${err.message}`);
  }
}

/**
 * Spawn a detached git fetch for the LLM Wiki vault.
 * Mirrors spawnDailyGreeting — zero added latency to the hook.
 */
function spawnWikiFetch(config) {
  try {
    if (config.wiki?.enabled !== true) return;
    if (config.wiki?.autoFetch === false) return;
    const child = spawn(
      process.execPath,
      [join(__dirname, 'wiki-cli.mjs'), 'fetch'],
      { detached: true, stdio: 'ignore', cwd: process.cwd() }
    );
    child.unref();
    log.info('Wiki fetch process spawned');
  } catch (err) {
    log.error(`Failed to spawn wiki fetch: ${err.message}`);
  }
}

function ensureStateDir() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

async function main() {
  // Consume stdin (required by hook protocol)
  await readStdin(1000);

  // Auto-create global config with defaults if missing (no more repeated setup prompts)
  ensureSetup();

  try {
    const config = loadConfig();
    let gitRoot = getGitRoot();
    let branch = getCurrentBranch(gitRoot);
    const onMainBranch = !branch || isMainBranch(branch);
    const sessionId = randomUUID();
    let pr = null;

    if (!onMainBranch) {
      pr = findPrForBranch(branch, gitRoot);
    }

    // If no PR at top level, scan submodules for active branches with PRs
    let activeSubmodule = null;
    if (!pr) {
      const submodules = listSubmodules(gitRoot);
      for (const sub of submodules) {
        const subBranch = getCurrentBranch(sub.absPath);
        if (subBranch && !isMainBranch(subBranch)) {
          const subPr = findPrForBranch(subBranch, sub.absPath);
          if (subPr) {
            activeSubmodule = sub.path;
            gitRoot = sub.absPath;
            branch = subBranch;
            pr = subPr;
            break;
          }
        }
      }
    }

    log.info(`Branch: ${branch || '(none)'}, PR: ${pr?.number || 'none'}`);

    // Build context parts
    const contextParts = [];

    // Team-wide Korean writing rules (always on; see rules/korean-output.md)
    try {
      contextParts.push(readFileSync(KOREAN_RULES_FILE, 'utf-8').trim());
    } catch (err) {
      log.error(`Korean rules not loaded: ${err.message}`);
    }

    if (pr) {
      contextParts.push(`[Codepresso] PR #${pr.number} detected on branch \`${branch}\`.`);
    }

    // Fetch Notion tasks + sprint context in parallel (non-blocking, timeout-protected)
    let notionContext = null;
    let notionTasks = null;
    let sprintContext = null;

    const sprintEnabled = config.notion?.sprintWorkflow?.enabled
      && config.notion?.databases?.sprint;

    try {
      const fetches = [fetchNotionTasksStructured()];
      if (sprintEnabled) {
        fetches.push(fetchSprintWithEpics(null, 4000));
      }

      const results = await Promise.allSettled(fetches);

      // Task fetch result
      const taskResult = results[0];
      if (taskResult.status === 'fulfilled' && taskResult.value) {
        notionContext = taskResult.value.formatted;
        notionTasks = taskResult.value.tasks;
        contextParts.push(taskResult.value.formatted);
      }

      // Sprint fetch result (only if enabled)
      if (sprintEnabled && results[1]?.status === 'fulfilled' && results[1].value) {
        sprintContext = results[1].value;

        // Cross-reference in-memory: enrich epics with task details from flat list
        if (notionTasks && sprintContext.epics) {
          const taskMap = new Map();
          for (const task of notionTasks) {
            taskMap.set(task.id, task);
          }
          for (const epic of sprintContext.epics) {
            epic.tasks = (epic.taskIds || [])
              .map(id => taskMap.get(id))
              .filter(Boolean);
          }
        }

        // Add sprint info to context
        const sprint = sprintContext.sprint;
        if (sprint) {
          const dateStr = sprint.dateRange
            ? ` (${sprint.dateRange.start} - ${sprint.dateRange.end})`
            : '';
          const epicCount = sprintContext.epics?.length || 0;
          contextParts.push(`[Codepresso] Sprint: "${sprint.name}"${dateStr} | ${epicCount} epics`);
        }
      }
    } catch {
      // Notion/Sprint fetch failed — skip silently
    }

    // Daily Google Chat greeting (first weekday session of the day)
    if (
      config.googleChat?.enabled
      && config.googleChat?.dailyGreeting
      && notionTasks
      && isWeekday()
      && isFirstSessionOfDay()
    ) {
      const inProgressTasks = notionTasks.filter(t => {
        const s = (t.status || '').toLowerCase().trim();
        return s === '진행 중' || s === 'in progress' || s === 'in_progress';
      });
      spawnDailyGreeting(inProgressTasks, config, gitRoot);
    }

    // Inbox scan instruction (first weekday session of the day, when enabled)
    const now = new Date();
    const today = todayLocalDate(now);
    const dayOfWeek = now.getDay();
    const inboxLastRun = readInboxLastRunDate();
    if (shouldRunInboxScan(config, today, inboxLastRun, dayOfWeek)) {
      contextParts.push(
        '[Codepresso] Morning inbox routine: invoke the codepresso:scan-inbox skill to triage Gmail + Chat for action-item messages.'
      );
      markInboxScanScheduled(today);
      log.info(`Inbox scan instruction injected (today=${today})`);
    }

    // Spawn detached wiki fetch (fetch-only, never blocks or auto-merges)
    spawnWikiFetch(config);

    const sessionState = {
      gitRoot,
      activeSubmodule,
      branch,
      prNumber: pr?.number || null,
      prUrl: pr?.url || null,
      sessionId,
      startedAt: new Date().toISOString(),
      headCommit: getHeadCommit(gitRoot),
      notionContext,
      notionTasks,
      notionContextShown: false,
      sprintContext,
      sprintDatabases: config.notion?.databases || null,
      prTitleFormat: config.notion?.sprintWorkflow?.prTitleFormat || 'task',
    };

    ensureStateDir();
    writeFileSync(SESSION_FILE, JSON.stringify(sessionState, null, 2), 'utf-8');

    if (contextParts.length === 0) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    process.stdout.write(JSON.stringify({
      continue: true,
      additionalContext: contextParts.join('\n\n'),
    }));
  } catch (err) {
    // Silent failure — don't break the session
    log.error(`SessionStart error: ${err.message}`);
    process.stdout.write(JSON.stringify({ continue: true }));
  }
}

main();
