import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isExcluded, isSetupComplete, ensureSetup, loadConfig, getStateDir, validateConfig } from '../../scripts/lib/config.mjs';
import { existsSync, unlinkSync, rmdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

describe('config.mjs', () => {
  describe('isExcluded', () => {
    it('returns false for empty patterns array', () => {
      assert.strictEqual(isExcluded('/some-command', []), false);
    });

    it('returns false when prompt does not match any pattern', () => {
      const patterns = ['^/oh-my-claudecode:', '^(cancelomc|stopomc)$'];
      assert.strictEqual(isExcluded('/regular-command', patterns), false);
      assert.strictEqual(isExcluded('some text', patterns), false);
    });

    it('returns true when prompt matches a pattern', () => {
      const patterns = ['^/oh-my-claudecode:', '^(cancelomc|stopomc)$'];
      assert.strictEqual(isExcluded('/oh-my-claudecode:help', patterns), true);
      assert.strictEqual(isExcluded('/oh-my-claudecode:executor', patterns), true);
      assert.strictEqual(isExcluded('cancelomc', patterns), true);
      assert.strictEqual(isExcluded('stopomc', patterns), true);
    });

    it('handles invalid regex gracefully', () => {
      const patterns = ['[invalid(regex'];
      assert.strictEqual(isExcluded('test', patterns), false);
    });

    it('returns false for null/undefined patterns', () => {
      assert.strictEqual(isExcluded('test', null), false);
      assert.strictEqual(isExcluded('test', undefined), false);
    });

    it('supports complex regex patterns', () => {
      const patterns = ['^/skill:', '\\btest\\b'];
      assert.strictEqual(isExcluded('/skill:commit', patterns), true);
      assert.strictEqual(isExcluded('run test suite', patterns), true);
      assert.strictEqual(isExcluded('testing', patterns), false);
    });
  });

  describe('isSetupComplete', () => {
    it('returns false when global config does not exist', () => {
      assert.strictEqual(isSetupComplete('/tmp/nonexistent-codepresso-config.json'), false);
    });

    it('returns true when global config exists', () => {
      // package.json always exists in the project root — use it as a stand-in
      assert.strictEqual(isSetupComplete(fileURLToPath(new URL('../../package.json', import.meta.url))), true);
    });
  });

  describe('ensureSetup', () => {
    it('creates config file when it does not exist', () => {
      const dir = join(tmpdir(), `codepresso-test-${Date.now()}`);
      const configPath = join(dir, 'config.json');

      assert.strictEqual(existsSync(configPath), false);
      const result = ensureSetup(configPath);
      assert.strictEqual(result, true);
      assert.strictEqual(existsSync(configPath), true);

      // Cleanup
      unlinkSync(configPath);
      rmdirSync(dir);
    });

    it('returns true when config already exists', () => {
      // package.json always exists — use as stand-in
      const existing = fileURLToPath(new URL('../../package.json', import.meta.url));
      assert.strictEqual(ensureSetup(existing), true);
    });
  });

  describe('loadConfig', () => {
    it('returns default config structure when no files exist', () => {
      // Use a non-existent directory to ensure no config files are found
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(typeof config, 'object');
      assert.strictEqual(config.github.token, null);
      assert.strictEqual(config.deploy.enabled, false);
      assert(Array.isArray(config.excludePatterns));
      assert.strictEqual(config.excludePatterns.length, 2);
    });

    it('returns Notion config defaults including user identity fields', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(config.notion.apiKey, null);
      assert.strictEqual(config.notion.defaultDatabaseId, null);
      assert.strictEqual(config.notion.userId, null);
      assert.strictEqual(config.notion.displayName, null);
      assert.strictEqual(config.notion.assigneeProperty, 'Assignee');
    });

    it('returns sprint workflow config defaults', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(config.notion.databases.sprint, null);
      assert.strictEqual(config.notion.databases.epic, null);
      assert.strictEqual(config.notion.databases.task, null);
      assert.strictEqual(config.notion.sprintWorkflow.enabled, false);
      assert.strictEqual(config.notion.sprintWorkflow.autoTransition, true);
      assert.strictEqual(config.notion.sprintWorkflow.epicAutoComplete, true);
    });

    it('returns epicDocs config defaults', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      assert.strictEqual(config.epicDocs.enabled, true);
      assert.strictEqual(config.epicDocs.outputDir, 'docs/prd');
      assert.strictEqual(config.epicDocs.includeTaskDetails, true);
      assert(Array.isArray(config.epicDocs.customSections));
      assert.strictEqual(config.epicDocs.customSections.length, 0);
    });

    it('merges nested sections correctly', () => {
      // Test with current directory (may or may not have config)
      const config = loadConfig();

      // Verify structure integrity after merge
      assert(config.deploy);
      assert(typeof config.deploy.enabled === 'boolean');

      assert(config.notion);
      assert(typeof config.notion === 'object');
    });

    it('preserves all default sections', () => {
      const config = loadConfig('/tmp/nonexistent-codepresso-test-dir-12345', { globalConfigPath: '/tmp/nonexistent-global-codepresso-config.json' });

      const expectedSections = ['github', 'notion', 'deploy', 'epicDocs', 'excludePatterns'];
      for (const section of expectedSections) {
        assert(config.hasOwnProperty(section), `Missing section: ${section}`);
      }
    });

  });

  describe('getStateDir', () => {
    it('returns .codepresso/state relative to cwd by default', () => {
      const expected = join(process.cwd(), '.codepresso', 'state');
      assert.strictEqual(getStateDir(), expected);
    });

    it('accepts an explicit cwd', () => {
      const expected = join('/tmp/myproject', '.codepresso', 'state');
      assert.strictEqual(getStateDir('/tmp/myproject'), expected);
    });
  });

});

describe('inbox config defaults', () => {
  it('exposes inbox section with disabled-by-default master switch', () => {
    const cfg = loadConfig(mkdtempSync(join(tmpdir(), 'cp-cfg-')), {
      globalConfigPath: join(tmpdir(), 'nonexistent-global.json'),
    });
    assert.equal(cfg.inbox.enabled, false);
    assert.equal(cfg.inbox.sources.gmail.enabled, true);
    assert.equal(cfg.inbox.sources.gmail.lookbackHours, 24);
    assert.equal(cfg.inbox.sources.chat.enabled, true);
    assert.deepEqual(cfg.inbox.sources.chat.spaceIds, []);
    assert.ok(Array.isArray(cfg.inbox.ignoreSenders));
    assert.equal(cfg.inbox.classifier.maxCandidatesPerScan, 10);
    assert.equal(cfg.inbox.notion.dueDateProperty, '마감일');
    assert.equal(cfg.inbox.notion.defaultDueOption, 'Tomorrow');
    assert.equal(cfg.inbox.reminder.showOverdue, true);
    assert.equal(cfg.inbox.reminder.showDueToday, true);
    assert.equal(cfg.inbox.reminder.maxPerSection, 5);
  });

  it('merges project-level inbox overrides without dropping defaults', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cp-cfg-'));
    writeFileSync(
      join(cwd, '.codepresso.json'),
      JSON.stringify({ inbox: { enabled: true, classifier: { maxCandidatesPerScan: 5 } } }),
    );
    const cfg = loadConfig(cwd, { globalConfigPath: join(tmpdir(), 'nonexistent-global.json') });
    assert.equal(cfg.inbox.enabled, true);
    assert.equal(cfg.inbox.classifier.maxCandidatesPerScan, 5);
    assert.equal(cfg.inbox.notion.dueDateProperty, '마감일');
    rmSync(cwd, { recursive: true, force: true });
  });

  it('does not flag inbox as an unknown config key', () => {
    const warnings = validateConfig({ inbox: { enabled: true } });
    assert.equal(warnings.filter((w) => w.includes('Unknown config key: "inbox"')).length, 0);
  });

  it('flags inbox.enabled type error', () => {
    const warnings = validateConfig({ inbox: { enabled: 'yes' } });
    assert.ok(warnings.some((w) => w.includes('inbox.enabled') && w.includes('boolean')));
  });

  describe('googleChat.calendar', () => {
    it('defaults calendar to enabled with auto-detect and maxEvents 8', () => {
      const cfg = loadConfig(process.cwd(), { globalConfigPath: '/no/such/codepresso-config.json' });
      assert.equal(cfg.googleChat.calendar.enabled, true);
      assert.equal(cfg.googleChat.calendar.calendarId, null);
      assert.equal(cfg.googleChat.calendar.maxEvents, 8);
    });

    it('flags googleChat.calendar.maxEvents non-positive', () => {
      const warnings = validateConfig({ googleChat: { calendar: { maxEvents: 0 } } });
      assert.ok(warnings.some((w) => w.includes('googleChat.calendar.maxEvents')));
    });
  });
});

describe('wiki OMP auto-capture config', () => {
  it('defaults auto-capture off and remote sync on', () => {
    const cfg = loadConfig(process.cwd(), { globalConfigPath: '/no/such/codepresso-config.json' });
    assert.equal(cfg.wiki.autoCapture, false);
    assert.equal(cfg.wiki.autoSync, true);
    assert.equal(cfg.wiki.workHistoryPath, 'pages/process/omp-work-history.md');
  });

  it('merges a project work-history override without dropping sync defaults', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cp-wiki-cfg-'));
    writeFileSync(
      join(cwd, '.codepresso.json'),
      JSON.stringify({ wiki: { enabled: true, autoCapture: true, workHistoryPath: 'people/self/work-history.md' } }),
    );
    const cfg = loadConfig(cwd, { globalConfigPath: join(tmpdir(), 'nonexistent-global.json') });
    assert.equal(cfg.wiki.enabled, true);
    assert.equal(cfg.wiki.autoCapture, true);
    assert.equal(cfg.wiki.autoSync, true);
    assert.equal(cfg.wiki.workHistoryPath, 'people/self/work-history.md');
    rmSync(cwd, { recursive: true, force: true });
  });

  it('validates auto-capture, sync, and work-history path types', () => {
    const warnings = validateConfig({
      wiki: { autoCapture: 'yes', autoSync: 1, workHistoryPath: false },
    });
    assert.ok(warnings.some((warning) => warning.includes('wiki.autoCapture') && warning.includes('boolean')));
    assert.ok(warnings.some((warning) => warning.includes('wiki.autoSync') && warning.includes('boolean')));
    assert.ok(warnings.some((warning) => warning.includes('wiki.workHistoryPath') && warning.includes('string')));
  });
});
