#!/usr/bin/env node

/**
 * Codepresso PreToolUse hook — Notion task picker + PR link enforcement.
 *
 * Everything below is the opt-in Notion task workflow and runs only when
 * `notion.taskWorkflow.enabled` is true (default false since 2026-11-23,
 * when the team moved task tracking to GitHub issues/PRs). When it is off
 * the hook passes every tool through and only surfaces the wiki notice.
 *
 * Three responsibilities (task workflow on):
 * 1. On the first tool use of a session, injects cached Notion tasks as
 *    additionalContext with instructions for Claude to present an interactive
 *    AskUserQuestion picker.
 * 2. On `gh pr create` commands with a selected task, enforces PR title
 *    format "[NOTION-ID] title" so Notion's GitHub integration can auto-link.
 * 3. On `gh pr create` commands with NO selected task, blocks the command
 *    and prompts the user to pick an existing active task or create a new
 *    one from the PR title (only when Notion is configured; otherwise
 *    falls through for graceful degradation).
 *
 * Why PreToolUse? Claude Code silently drops additionalContext from
 * SessionStart and UserPromptSubmit hooks. Only PreToolUse / PostToolUse
 * hooks propagate additionalContext into the conversation.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getStateDir, loadConfig, isTaskWorkflowEnabled } from './lib/config.mjs';
import { readWikiStatus, formatWikiNotice } from './lib/wiki-state.mjs';

const STATE_DIR = getStateDir();
const SESSION_FILE = join(STATE_DIR, 'codepresso-session.json');
const SELECTED_TASK_FILE = join(STATE_DIR, 'codepresso-selected-task.json');

// Notion task DB property names (mirrors sprint-context.mjs PROPERTY_TYPES.task)
const TASK_PROP_TITLE = '작업명';
const TASK_PROP_STATUS = '상태';
const TASK_PROP_ASSIGNEE = '담당자';

// Fast stdin capture with timeout — never block more than 500ms
let stdinData = '';
await new Promise((resolve) => {
  const timeout = setTimeout(() => {
    process.stdin.removeAllListeners();
    process.stdin.destroy();
    resolve();
  }, 500);

  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    clearTimeout(timeout);
    stdinData = Buffer.concat(chunks).toString();
    resolve();
  });
  process.stdin.on('error', () => { clearTimeout(timeout); resolve(); });

  if (process.stdin.readableEnded) {
    clearTimeout(timeout);
    resolve();
  }
});

// Parse tool info from stdin
let toolName = '';
let toolInput = {};
try {
  const parsed = JSON.parse(stdinData);
  const hookInput = parsed.hookInput || parsed;
  toolName = hookInput.toolName || '';
  toolInput = hookInput.toolInput || {};
} catch {
  // stdin parse failed — proceed without tool info
}

/**
 * Check if a task status represents a completed state.
 */
function isCompletedStatus(status) {
  if (!status) return false;
  const normalized = status.toLowerCase().trim();
  return normalized === '완료' || normalized === 'done' || normalized === 'completed';
}

/**
 * Read the selected task (flat object).
 * @returns {{ id: string, title: string, uniqueId?: string, epicId?: string, epicUniqueId?: string }|null}
 */
function readSelectedTask() {
  try {
    if (!existsSync(SELECTED_TASK_FILE)) return null;
    const data = JSON.parse(readFileSync(SELECTED_TASK_FILE, 'utf-8'));
    if (data.id && data.title) return data;
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the picker instruction context from structured task data.
 */
function buildPickerContext(notionContext, notionTasks) {
  const activeTasks = notionTasks.filter((t) => !isCompletedStatus(t.status));

  if (activeTasks.length === 0) {
    return `Your Notion tasks are all completed! Great job — no pending tasks to pick from.\n\n${notionContext}`;
  }

  // Group by status for display order: 할 일 (To Do) → 진행 중 (In Progress) → others
  const statusOrder = ['할 일', '진행 중'];
  const sorted = [...activeTasks].sort((a, b) => {
    const aIdx = statusOrder.indexOf(a.status);
    const bIdx = statusOrder.indexOf(b.status);
    const aOrder = aIdx >= 0 ? aIdx : statusOrder.length;
    const bOrder = bIdx >= 0 ? bIdx : statusOrder.length;
    return aOrder - bOrder;
  });

  // Check if any tasks have unique IDs
  const hasUniqueIds = sorted.some((t) => t.uniqueId);

  const tasksJson = JSON.stringify(sorted, null, 2);

  const instructions = [
    'IMPORTANT: Present an interactive task picker to the user using AskUserQuestion.',
    '',
    notionContext,
    '',
    `Active tasks available to work on (${sorted.length}):`,
    tasksJson,
    '',
    'INSTRUCTIONS:',
    '1. Use AskUserQuestion to present the active tasks as selectable options.',
    '   - question: "Which task would you like to work on?"',
    '   - header: "Notion Task"',
    '   - Each option: label = task title (with unique ID prefix if available), description = current status',
    '   - Group by status: "할 일" (To Do) first, then "진행 중" (In Progress), then others (e.g., Holding)',
    '   - If there are more than 4 active tasks, pick the top 3 most relevant (prioritize "할 일" over "진행 중") and let the 4th option or "Other" handle the rest.',
    '2. When the user picks a task:',
    '   a. If the task status is NOT already "진행 중", use the mcp__notion__notion_update_page or mcp__plugin_codepresso_notion__notion_update_page MCP tool to update the page status property to "진행 중".',
    '      Use: { page_id: "<task-id>", properties: { "상태": { "status": { "name": "진행 중" } } } }',
    '   b. IMPORTANT: Save the selected task by writing a JSON file:',
    `      Write a JSON file to ${SELECTED_TASK_FILE}:`,
    `      node -e "require('fs').writeFileSync(${JSON.stringify(SELECTED_TASK_FILE)}, JSON.stringify({id:'<task-id>',title:'<task-title>',uniqueId:'<unique-id-or-null>',epicId:null,epicUniqueId:null}, null, 2))"`,
    '   c. Ask the user if they want to create a feature branch for this task.',
    '   d. If yes, suggest a branch name like "feature/<slugified-task-title>" and create it with `git checkout -b <branch-name>`.',
    '3. If user selects "Other" or types a custom response, just acknowledge and proceed normally without updating Notion.',
  ];

  if (hasUniqueIds) {
    instructions.push(
      '',
      'PR TITLE FORMAT (for Notion auto-linking):',
      'When creating a PR for the selected task, ALWAYS prefix the title with the Notion unique ID.',
      'Format: gh pr create --title "[UNIQUE-ID] description" ...',
      'Example: gh pr create --title "[ENG-123] Add user authentication" ...',
      'This enables Notion\'s GitHub integration to automatically link the PR to the task.',
    );
  }

  return instructions.join('\n');
}

/**
 * Build the picker instruction context with tasks grouped by epic.
 * Used when session.sprintContext is available.
 *
 * @param {object} session - Full session object with sprintContext and notionTasks
 */
function buildHierarchicalPickerContext(session) {
  const { sprintContext, notionTasks } = session;
  const { sprint, epics = [] } = sprintContext;

  // Build a lookup of all active tasks by ID
  const activeTasksById = {};
  for (const t of notionTasks) {
    if (!isCompletedStatus(t.status)) {
      activeTasksById[t.id] = t;
    }
  }

  // Status sort order: 할 일 first, 진행 중 second, then others
  const statusOrder = ['할 일', '진행 중'];
  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
      const aIdx = statusOrder.indexOf(a.status);
      const bIdx = statusOrder.indexOf(b.status);
      const aOrder = aIdx >= 0 ? aIdx : statusOrder.length;
      const bOrder = bIdx >= 0 ? bIdx : statusOrder.length;
      return aOrder - bOrder;
    });
  }

  // Track which task IDs are claimed by an epic
  const claimedTaskIds = new Set();

  // Build epic groups — only include epics that have active tasks
  const epicGroups = [];
  for (const epic of epics) {
    if (isCompletedStatus(epic.status)) continue;

    const epicTasks = [];
    for (const taskId of (epic.taskIds || [])) {
      if (activeTasksById[taskId]) {
        epicTasks.push(activeTasksById[taskId]);
        claimedTaskIds.add(taskId);
      }
    }
    // Also check tasks array populated by session-start (may overlap with taskIds)
    for (const t of (epic.tasks || [])) {
      if (activeTasksById[t.id] && !claimedTaskIds.has(t.id)) {
        epicTasks.push(activeTasksById[t.id]);
        claimedTaskIds.add(t.id);
      }
    }

    if (epicTasks.length > 0) {
      epicGroups.push({
        id: epic.id,
        title: epic.title,
        uniqueId: epic.uniqueId || null,
        tasks: sortTasks(epicTasks),
      });
    }
  }

  // Tasks not belonging to any epic
  const unassignedTasks = sortTasks(
    Object.values(activeTasksById).filter((t) => !claimedTaskIds.has(t.id)),
  );

  // Build display lines for the context block
  const lines = [];

  if (sprint) {
    const sprintLabel = sprint.name || 'Current Sprint';
    const dateRange = sprint.dateRange ? ` (${sprint.dateRange.start} - ${sprint.dateRange.end})` : '';
    lines.push(`Sprint: "${sprintLabel}"${dateRange}`);
    lines.push('');
  }

  // Collect all active tasks across groups for the AskUserQuestion options
  const allActiveTasks = [];

  for (const group of epicGroups) {
    const epicPrefix = group.uniqueId ? `[${group.uniqueId}] ` : '';
    lines.push(`Epic: ${epicPrefix}${group.title} (${group.tasks.length} task${group.tasks.length !== 1 ? 's' : ''})`);
    for (const t of group.tasks) {
      const taskPrefix = t.uniqueId ? `[${t.uniqueId}] ` : '';
      lines.push(`  - ${taskPrefix}${t.title} (${t.status})`);
      allActiveTasks.push({ ...t, epicId: group.id, epicUniqueId: group.uniqueId });
    }
    lines.push('');
  }

  if (unassignedTasks.length > 0) {
    lines.push(`Unassigned (${unassignedTasks.length} task${unassignedTasks.length !== 1 ? 's' : ''})`);
    for (const t of unassignedTasks) {
      const taskPrefix = t.uniqueId ? `[${t.uniqueId}] ` : '';
      lines.push(`  - ${taskPrefix}${t.title} (${t.status})`);
      allActiveTasks.push({ ...t, epicId: null, epicUniqueId: null });
    }
    lines.push('');
  }

  if (allActiveTasks.length === 0) {
    return 'Your Notion tasks are all completed! Great job — no pending tasks to pick from.';
  }

  const hasUniqueIds = allActiveTasks.some((t) => t.uniqueId);

  // Serialize all tasks for Claude to pick top 3 for AskUserQuestion options (max 4 total with "Other")
  const tasksJson = JSON.stringify(allActiveTasks, null, 2);

  const instructions = [
    'IMPORTANT: Present an interactive task picker to the user using AskUserQuestion.',
    '',
    lines.join('\n'),
    `All active tasks (${allActiveTasks.length}):`,
    tasksJson,
    '',
    'INSTRUCTIONS:',
    '1. Use AskUserQuestion to present the active tasks as selectable options.',
    '   - question: "Which task would you like to work on?"',
    '   - header: "Notion Task"',
    '   - Each option: label = task title (with unique ID prefix if available), description = "<epic title> · <status>"',
    '   - Use the top 3 most relevant tasks as options (prioritize "할 일" then "진행 중").',
    '   - The 4th option should be "Other" for anything not listed.',
    '2. When the user picks a task:',
    '   a. If the task status is NOT already "진행 중", use the mcp__notion__notion_update_page or mcp__plugin_codepresso_notion__notion_update_page MCP tool to update the page status property to "진행 중".',
    '      Use: { page_id: "<task-id>", properties: { "상태": { "status": { "name": "진행 중" } } } }',
    '   b. IMPORTANT: Save the selected task by writing a JSON file:',
    `      Write a JSON file to ${SELECTED_TASK_FILE}:`,
    `      node -e "require('fs').writeFileSync(${JSON.stringify(SELECTED_TASK_FILE)}, JSON.stringify({id:'<task-id>',title:'<task-title>',uniqueId:'<unique-id-or-null>',epicId:'<epic-id-or-null>',epicUniqueId:'<epic-unique-id-or-null>'}, null, 2))"`,
    `      Replace <epic-id-or-null> and <epic-unique-id-or-null> with the epicId and epicUniqueId from the task data above (use null if not present).`,
    '   c. Ask the user if they want to create a feature branch for this task.',
    '   d. If yes, suggest a branch name like "feature/<slugified-task-title>" and create it with `git checkout -b <branch-name>`.',
    '3. If user selects "Other" or types a custom response, just acknowledge and proceed normally without updating Notion.',
  ];

  if (hasUniqueIds) {
    instructions.push(
      '',
      'PR TITLE FORMAT (for Notion auto-linking):',
      'When creating a PR for the selected task, ALWAYS prefix the title with the Notion unique ID.',
      'Format: gh pr create --title "[UNIQUE-ID] description" ...',
      'Example: gh pr create --title "[ENG-123] Add user authentication" ...',
      'This enables Notion\'s GitHub integration to automatically link the PR to the task.',
    );
  }

  return instructions.join('\n');
}

/**
 * Emit additionalContext and mark the picker (and optionally wiki notice) as shown.
 * @param {object} session
 * @param {string} context
 * @param {string|null} [wikiNotice]
 */
function emitAndMark(session, context, wikiNotice) {
  const fullContext = wikiNotice ? `${context}\n\n${wikiNotice}` : context;
  const output = JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: fullContext,
    },
  });
  process.stdout.write(output);

  session.notionContextShown = true;
  if (wikiNotice) session.wikiNoticeShown = true;
  writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
}

/**
 * Emit ONLY the wiki staleness notice (no Notion context) and mark it shown.
 * Used when there's no Notion context to surface but the wiki notice is pending.
 */
function emitWikiOnly(session, notice) {
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: notice,
    },
  }));
  session.wikiNoticeShown = true;
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

/**
 * Extract --title "..." value from a gh command. Handles single/double quotes.
 */
function extractPrTitle(command) {
  const m = command.match(/--title\s+["']([^"']*?)["']/);
  return m ? m[1] : '';
}

/**
 * Block `gh pr create` when no Notion task is linked. Emits AskUserQuestion
 * instructions: pick from top active tasks, or create a new task from PR title.
 * Falls through (returns false) when Notion is unconfigured.
 */
function handlePrCreateNoTask(command, session) {
  const config = loadConfig();
  const notion = config?.notion || {};
  if (!notion.apiKey || !notion.databases?.task) {
    return false; // graceful degradation — Notion not configured
  }

  const prTitle = extractPrTitle(command);
  if (!prTitle) return false; // let gh fail naturally on missing --title

  const activeTasks = (session.notionTasks || []).filter(
    (t) => !isCompletedStatus(t.status),
  );
  const statusOrder = ['할 일', '진행 중'];
  const sorted = [...activeTasks].sort((a, b) => {
    const aIdx = statusOrder.indexOf(a.status);
    const bIdx = statusOrder.indexOf(b.status);
    const aOrder = aIdx >= 0 ? aIdx : statusOrder.length;
    const bOrder = bIdx >= 0 ? bIdx : statusOrder.length;
    return aOrder - bOrder;
  });
  const top = sorted.slice(0, 3);

  const assigneeLine = notion.userId
    ? `      "${TASK_PROP_ASSIGNEE}": { "people": [{ "id": "${notion.userId}" }] },\n`
    : '';

  const lines = [
    `[Codepresso] PR creation blocked — no Notion task linked.`,
    ``,
    `Attempted PR title: "${prTitle}"`,
    `Task database: ${notion.databases.task}`,
    ``,
    `Top ${top.length} active task(s):`,
    JSON.stringify(top, null, 2),
    ``,
    `INSTRUCTIONS:`,
    `1. Present AskUserQuestion with up to 4 options:`,
    `   - For each active task above: label = "[UNIQUE-ID] title" (or just title if no uniqueId), description = status`,
    `   - Final option: label = "Create new task: '${prTitle}'", description = "Create in Notion and link this PR"`,
    ``,
    `2. If user picks an existing task:`,
    `   a. If status != "진행 중", call mcp__plugin_codepresso_notion__notion_update_page`,
    `      with { page_id: "<task-id>", properties: { "${TASK_PROP_STATUS}": { "status": { "name": "진행 중" } } } }`,
    `   b. Write to ${SELECTED_TASK_FILE}:`,
    `      { "id": "<task-id>", "title": "<task-title>", "uniqueId": "<unique-id>", "epicId": null, "epicUniqueId": null }`,
    `   c. Re-run the original gh pr create with the title prefixed: --title "[UNIQUE-ID] ${prTitle}"`,
    ``,
    `3. If user picks "Create new task":`,
    `   a. Call mcp__plugin_codepresso_notion__notion_create_page with:`,
    `      {`,
    `        "database_id": "${notion.databases.task}",`,
    `        "properties": {`,
    `          "${TASK_PROP_TITLE}": { "title": [{ "text": { "content": "${prTitle.replace(/"/g, '\\"')}" } }] },`,
    assigneeLine +
      `          "${TASK_PROP_STATUS}": { "status": { "name": "할 일" } }`,
    `        }`,
    `      }`,
    `   b. From the response, read response.properties to find the property with type "unique_id".`,
    `      Build uniqueId as "<prefix>-<number>" (e.g. "TSK-12345").`,
    `   c. Write to ${SELECTED_TASK_FILE}:`,
    `      { "id": "<new-page-id>", "title": "${prTitle.replace(/"/g, '\\"')}", "uniqueId": "<unique-id>", "epicId": null, "epicUniqueId": null }`,
    `   d. Re-run the original gh pr create with --title "[<unique-id>] ${prTitle}"`,
    ``,
    `IMPORTANT: Do not bypass this enforcement. The user must either pick or create.`,
    `If the Notion API call fails, surface the error to the user and stop — do not silently retry the PR command.`,
  ];

  process.stdout.write(JSON.stringify({
    continue: false,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: lines.join('\n'),
    },
  }));
  return true;
}

/**
 * Handle `gh pr create` interception — enforce Notion task ID in title.
 * Now branch-aware: looks up selected task for the current branch.
 * Returns true if handled, false to fall through.
 */
function handlePrCreate(command, session) {
  const selectedTask = readSelectedTask();
  if (!selectedTask?.uniqueId) {
    return handlePrCreateNoTask(command, session);
  }

  // Extract --title value from the command
  const currentTitle = extractPrTitle(command);

  // Build the ID prefix based on prTitleFormat config
  const format = session?.prTitleFormat || 'task';
  let epicPrefix = '';
  if (format !== 'task' && selectedTask.epicUniqueId) {
    epicPrefix = `[${selectedTask.epicUniqueId}]`;
  }
  const taskPrefix = format !== 'epic' ? `[${selectedTask.uniqueId}]` : '';
  const fullPrefix = (epicPrefix + taskPrefix) || `[${selectedTask.uniqueId}]`;

  // Check if the title already contains the task unique ID (sufficient for Notion linking)
  if (currentTitle && currentTitle.includes(selectedTask.uniqueId)) {
    return false; // Already formatted correctly — let it through
  }

  // Block and suggest correct format with epic prefix
  const suggestedTitle = currentTitle
    ? `${fullPrefix} ${currentTitle}`
    : `${fullPrefix} ${selectedTask.title}`;

  const epicInfo = selectedTask.epicUniqueId
    ? `\nParent epic: ${selectedTask.epicUniqueId}`
    : '';

  process.stdout.write(JSON.stringify({
    continue: false,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: [
        `[Codepresso] PR title must include Notion task ID for auto-linking.`,
        `Selected task: ${selectedTask.uniqueId} — ${selectedTask.title}${epicInfo}`,
        ``,
        `Please re-run with the Notion ID prefixed in the title:`,
        `  --title "${suggestedTitle}"`,
      ].join('\n'),
    },
  }));
  return true;
}

// --- Main logic ---

try {
  const session = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));

  // Compute wiki notice once — only if not already shown this session
  const wikiNotice = session.wikiNoticeShown ? null : formatWikiNotice(readWikiStatus());

  // Notion task workflow is opt-in (notion.taskWorkflow.enabled, default off).
  // When off: no task picker, no `[TSK-…]` PR title enforcement, no fallback
  // Notion fetch, and the selected-task file is never read. Only the
  // non-Notion wiki notice is still surfaced.
  if (!isTaskWorkflowEnabled(loadConfig())) {
    if (wikiNotice) {
      emitWikiOnly(session, wikiNotice);
    } else {
      process.stdout.write(JSON.stringify({ continue: true }));
    }
  }
  // Already shown Notion context — check for gh pr create interception, then wiki notice
  else if (session.notionContextShown) {
    if (
      toolName === 'Bash' &&
      /\bgh\s+pr\s+create\b/.test(toolInput.command || '')
    ) {
      // Keep gh pr create handlers focused — don't attach wiki notice here
      if (!handlePrCreate(toolInput.command, session)) {
        process.stdout.write(JSON.stringify({ continue: true }));
      }
    } else if (wikiNotice) {
      // Notion context already shown; surface the wiki notice now
      emitWikiOnly(session, wikiNotice);
    } else {
      process.stdout.write(JSON.stringify({ continue: true }));
    }
  }
  // Sprint context available — build hierarchical epic-grouped picker
  else if (session.sprintContext && session.notionTasks && session.notionTasks.length > 0) {
    const context = buildHierarchicalPickerContext(session);
    emitAndMark(session, context, wikiNotice);
  }
  // Structured tasks available — build flat picker context (fallback)
  else if (session.notionTasks && session.notionTasks.length > 0) {
    const context = buildPickerContext(session.notionContext, session.notionTasks);
    emitAndMark(session, context, wikiNotice);
  }
  // Only formatted text (legacy/fallback) — display as before
  else if (session.notionContext) {
    const context = `IMPORTANT: Display the following Notion tasks to the user immediately. Print them in a readable format so the user can see their current task status.\n\n${session.notionContext}`;
    emitAndMark(session, context, wikiNotice);
  }
  // SessionStart fetch failed — retry as fallback (2s budget)
  else {
    try {
      const { fetchNotionTasksStructured } = await import('./lib/notion-tasks.mjs');
      const result = await fetchNotionTasksStructured(2000);
      if (result) {
        session.notionContext = result.formatted;
        session.notionTasks = result.tasks;
        if (result.tasks.length > 0) {
          const context = buildPickerContext(result.formatted, result.tasks);
          emitAndMark(session, context, wikiNotice);
        } else {
          const context = `IMPORTANT: Display the following Notion tasks to the user immediately.\n\n${result.formatted}`;
          emitAndMark(session, context, wikiNotice);
        }
      } else if (wikiNotice) {
        emitWikiOnly(session, wikiNotice);
      } else {
        process.stdout.write(JSON.stringify({ continue: true }));
      }
    } catch {
      if (wikiNotice) {
        emitWikiOnly(session, wikiNotice);
      } else {
        process.stdout.write(JSON.stringify({ continue: true }));
      }
    }
  }
} catch {
  process.stdout.write(JSON.stringify({ continue: true }));
}
