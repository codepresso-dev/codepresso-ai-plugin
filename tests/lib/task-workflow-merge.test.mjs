/**
 * Integration tests: PR merge -> Notion task auto-complete is gated by the
 * opt-in `notion.taskWorkflow.enabled` switch (default false).
 *
 * The hook scripts are spawned as subprocesses with an isolated HOME and a
 * temp cwd. A preload module replaces global fetch so any Notion call is
 * recorded to a file instead of reaching the network.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS = join(__filename, '..', '..', '..', 'scripts');
const WATCHER = join(SCRIPTS, 'post-tool-git-watcher.mjs');
const MERGE_HANDLER = join(SCRIPTS, 'handle-merge-transition.mjs');

let dir;
let fetchLog;
let preload;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'codepresso-merge-'));
  mkdirSync(join(dir, '.codepresso', 'state'), { recursive: true });
  fetchLog = join(dir, 'fetch-calls.log');
  preload = join(dir, 'stub-fetch.mjs');
  writeFileSync(preload, [
    "import { appendFileSync } from 'node:fs';",
    `globalThis.fetch = async (url) => { appendFileSync(${JSON.stringify(fetchLog)}, String(url) + '\\n');`,
    "  return new Response(JSON.stringify({ properties: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); };",
  ].join('\n'));
});
afterEach(() => {
  // the detached merge handler may still hold the dir on Windows (EBUSY): retry
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});

function run(script, args, stdin) {
  return spawnSync('node', ['--import', pathToFileURL(preload).href, script, ...args], {
    cwd: dir,
    input: stdin === undefined ? '' : JSON.stringify(stdin),
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, HOME: dir, USERPROFILE: dir },
  });
}

function writeConfig(taskWorkflowEnabled) {
  const notion = { apiKey: 'ntn_test', databases: { task: 'db-task-id' } };
  if (taskWorkflowEnabled !== undefined) notion.taskWorkflow = { enabled: taskWorkflowEnabled };
  writeFileSync(join(dir, '.codepresso.json'), JSON.stringify({ notion }));
}

function writeSession(extra = {}) {
  writeFileSync(join(dir, '.codepresso', 'state', 'codepresso-session.json'),
    JSON.stringify({ prNumber: 12, branch: 'feature/x', notionContextShown: true, ...extra }));
}

function writeSelectedTask() {
  writeFileSync(join(dir, '.codepresso', 'state', 'codepresso-selected-task.json'),
    JSON.stringify({ id: 'page-1', title: 'Fix auth', uniqueId: 'TSK-100' }));
}

const mergeInput = { toolInput: { command: 'gh pr merge 12 --squash' }, toolOutput: '' };

describe('post-tool-git-watcher.mjs — merge transition gate', () => {
  it('does nothing on gh pr merge when the task workflow is off by default', () => {
    writeConfig(undefined);
    writeSession();

    const r = run(WATCHER, [], mergeInput);

    assert.deepStrictEqual(JSON.parse(r.stdout), { continue: true });
    assert.strictEqual(existsSync(join(dir, '.codepresso', 'state', 'codepresso-merge-12.json')), false);
  });

  it('does nothing when enabled is explicitly false', () => {
    writeConfig(false);
    writeSession();

    const r = run(WATCHER, [], mergeInput);

    assert.deepStrictEqual(JSON.parse(r.stdout), { continue: true });
  });

  it('triggers the transition when the task workflow is enabled', (t) => {
    writeConfig(true);
    // The detached merge handler runs in session.gitRoot; keep it out of `dir`
    // so its working directory does not lock the temp dir on Windows.
    const handlerCwd = mkdtempSync(join(tmpdir(), 'codepresso-merge-cwd-'));
    t.after(() => { try { rmSync(handlerCwd, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }); } catch { /* best effort */ } });
    writeSession({ gitRoot: handlerCwd });

    const r = run(WATCHER, [], mergeInput);

    assert.match(JSON.parse(r.stdout).additionalContext, /PR #12 merge detected — task status transition triggered/);
  });
});

describe('handle-merge-transition.mjs — second guard', () => {
  function writePayload() {
    const p = join(dir, '.codepresso', 'state', 'codepresso-merge-12.json');
    writeFileSync(p, JSON.stringify({ prNumber: 12, branch: 'feature/x' }));
    return p;
  }

  it('never calls Notion when the task workflow is off, even with a selected task', () => {
    writeConfig(false);
    writeSelectedTask();
    const payload = writePayload();

    const r = run(MERGE_HANDLER, [payload]);

    assert.strictEqual(r.status, 0);
    assert.strictEqual(existsSync(fetchLog), false, 'Notion was called while the task workflow is off');
    assert.strictEqual(existsSync(payload), false, 'payload file should be cleaned up');
  });

  it('calls Notion when the task workflow is enabled (proves the stub observes calls)', () => {
    writeConfig(true);
    writeSelectedTask();
    const payload = writePayload();

    run(MERGE_HANDLER, [payload]);

    assert.ok(existsSync(fetchLog), 'expected a Notion call with the workflow on');
    assert.match(readFileSync(fetchLog, 'utf-8'), /api\.notion\.com/);
  });
});
