#!/usr/bin/env node

/**
 * Detached handler for PR merge → Notion status transitions.
 * Spawned by post-tool-git-watcher.mjs when `gh pr merge` is detected and
 * `notion.taskWorkflow.enabled` is true (opt-in; off by default).
 *
 * Reads payload from temp JSON file, then:
 * 1. Resolves task for the merged PR's branch
 * 2. Marks task as "완료" (Done)
 * 3. Cascades: checks if epic is fully done → marks epic "배포 완료"
 * 4. Cleans up temp file
 */

import { readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const payloadPath = process.argv[2];
if (!payloadPath) process.exit(0);

try {
  const payload = JSON.parse(readFileSync(resolve(payloadPath), 'utf-8'));

  // Dynamic import to avoid loading heavy modules at parse time
  const { markTaskComplete, resolveTaskForPr } = await import('./lib/status-transitions.mjs');
  const { loadConfig, isTaskWorkflowEnabled } = await import('./lib/config.mjs');

  const config = loadConfig();
  // Second guard: never write to Notion unless the task workflow is opted in.
  if (!isTaskWorkflowEnabled(config)) {
    // Config here is read from the handler's cwd (session.gitRoot), which can differ
    // from where the watcher read it; log so a skipped transition is not silent.
    const { createLogger } = await import('./lib/logger.mjs');
    createLogger('merge-handler').info(`Skipped PR #${payload.prNumber}: notion.taskWorkflow.enabled is not true (cwd ${process.cwd()})`);
    cleanup(payloadPath);
    process.exit(0);
  }
  const notionConfig = {
    apiKey: config.notion?.apiKey,
    databases: config.notion?.databases || payload.sprintDatabases || {},
  };

  if (!notionConfig.apiKey) {
    cleanup(payloadPath);
    process.exit(0);
  }

  // Resolve task for this branch
  const taskInfo = resolveTaskForPr(payload.branch);
  if (!taskInfo?.taskId) {
    cleanup(payloadPath);
    process.exit(0);
  }

  // Mark task complete with epic cascade
  const result = await markTaskComplete(notionConfig, taskInfo.taskId, { cascadeEpic: true });

  if (result.success) {
    const { createLogger } = await import('./lib/logger.mjs');
    const log = createLogger('merge-handler');
    log.info(`Task ${taskInfo.taskUniqueId || taskInfo.taskId} marked complete (PR #${payload.prNumber})`);
    if (result.epicCompleted) {
      log.info(`Epic auto-completed for task ${taskInfo.taskUniqueId || taskInfo.taskId}`);
    }
  }

  cleanup(payloadPath);
} catch {
  cleanup(payloadPath);
}

function cleanup(path) {
  try { unlinkSync(path); } catch { /* ignore */ }
}
