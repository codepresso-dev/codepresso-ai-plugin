#!/usr/bin/env node
// LLM Wiki helper. Deterministic bits only (path resolution + scaffolding); the actual
// ingest/query/lint reasoning lives in skills/llm-wiki/SKILL.md and the vault's CLAUDE.md.
import { existsSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { localDateStr } from './lib/dates.mjs';
import { WIKI_STATUS_FILE } from './lib/wiki-state.mjs';

const cwd = process.cwd();
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(SCRIPT_DIR, '..', 'templates', 'llm-wiki-vault');
const GLOBAL_CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function loadConfigOrExit() {
  try {
    return loadConfig(cwd);
  } catch (err) {
    process.stderr.write(`wiki-cli: failed to load config: ${err.message}\n`);
    process.exit(2);
  }
}

function resolveVaultPath(config, override) {
  const raw = override || config.wiki?.vaultPath || '~/Documents/Obsidian/llm-wiki';
  return { raw, resolved: expandHome(raw) };
}

function readGlobalConfig() {
  try {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

// Persist vault location to ~/.codepresso/config.json, preserving all other keys.
function setWikiConfig(vaultPath) {
  const cfg = readGlobalConfig();
  cfg.wiki = { ...(cfg.wiki || {}), enabled: true, vaultPath };
  mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

// template filename -> path inside the vault; `subst` files get {{DATE}} replaced.
const FILE_MAP = [
  { src: 'CLAUDE.md', dest: 'CLAUDE.md' },
  { src: 'README.md', dest: 'README.md' },
  { src: 'index.md', dest: 'index.md' },
  { src: 'log.md', dest: 'log.md', subst: true },
  { src: 'gitignore', dest: '.gitignore' },
  { src: 'obsidian-app.json', dest: '.obsidian/app.json' },
];

function scaffold(vault) {
  const today = localDateStr();
  for (const dir of ['sources', 'pages', '.obsidian']) {
    mkdirSync(join(vault, dir), { recursive: true });
  }
  for (const f of FILE_MAP) {
    const destPath = join(vault, f.dest);
    mkdirSync(dirname(destPath), { recursive: true });
    let content = readFileSync(join(TEMPLATE_DIR, f.src), 'utf-8');
    if (f.subst) content = content.replaceAll('{{DATE}}', today);
    writeFileSync(destPath, content, 'utf-8');
  }
  // Best-effort: let Codex/other tools share the schema via AGENTS.md.
  try {
    symlinkSync('CLAUDE.md', join(vault, 'AGENTS.md'));
  } catch {
    /* symlink unsupported or already exists — non-fatal */
  }
}

function gitInit(vault) {
  try {
    if (!existsSync(join(vault, '.git'))) {
      execFileSync('git', ['init', '-b', 'main'], { cwd: vault, stdio: 'ignore' });
    }
    execFileSync('git', ['add', '-A'], { cwd: vault, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'feat: bootstrap LLM Wiki'], { cwd: vault, stdio: 'ignore' });
    return 'committed';
  } catch (err) {
    return `init-only (commit skipped: ${err.message.split('\n')[0]})`;
  }
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

const cmd = process.argv[2];
const arg = process.argv[3];
const arg2 = process.argv[4];

switch (cmd) {
  case 'path': {
    const config = loadConfigOrExit();
    const { raw, resolved } = resolveVaultPath(config, arg);
    out({
      enabled: config.wiki?.enabled ?? false,
      vaultPath: resolved,
      raw,
      exists: existsSync(resolved),
      hasSchema: existsSync(join(resolved, 'CLAUDE.md')),
      remote: config.wiki?.remote ?? null,
      autoCapture: config.wiki?.autoCapture ?? false,
      autoSync: config.wiki?.autoSync ?? true,
      workHistoryPath: config.wiki?.workHistoryPath ?? 'pages/process/omp-work-history.md',
    });
    break;
  }
  case 'init': {
    const config = loadConfigOrExit();
    const { resolved } = resolveVaultPath(config, arg);
    if (existsSync(join(resolved, 'CLAUDE.md'))) {
      setWikiConfig(resolved);
      out({
        initialized: false,
        alreadyInitialized: true,
        vaultPath: resolved,
        configUpdated: true,
        note: 'CLAUDE.md already present — left untouched.',
      });
      break;
    }
    scaffold(resolved);
    const git = gitInit(resolved);
    setWikiConfig(resolved);
    out({ initialized: true, vaultPath: resolved, git, configUpdated: true });
    break;
  }
  case 'auto-capture': {
    if (arg !== 'on' && arg !== 'off') {
      process.stderr.write('usage: node scripts/wiki-cli.mjs auto-capture <on|off> [work-history-path]\n');
      process.exit(2);
    }
    const config = loadConfigOrExit();
    const { resolved: vaultPath } = resolveVaultPath(config);
    const cfg = readGlobalConfig();
    cfg.wiki = {
      ...(cfg.wiki || {}),
      enabled: true,
      vaultPath,
      autoCapture: arg === 'on',
      autoSync: cfg.wiki?.autoSync ?? true,
      workHistoryPath: arg2 || cfg.wiki?.workHistoryPath || 'pages/process/omp-work-history.md',
    };
    mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
    writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    out({
      enabled: true,
      autoCapture: cfg.wiki.autoCapture,
      autoSync: cfg.wiki.autoSync,
      vaultPath,
      workHistoryPath: cfg.wiki.workHistoryPath,
    });
    break;
  }
  case 'fetch': {
    // Fully defensive — runs detached; must never crash loudly.
    const checkedAt = new Date().toISOString();

    let config;
    try {
      config = loadConfig(cwd);
    } catch {
      // Can't load config — write a safe status and exit cleanly.
      const statusDir = dirname(WIKI_STATUS_FILE);
      try { mkdirSync(statusDir, { recursive: true }); } catch { /* ignore */ }
      try {
        writeFileSync(WIKI_STATUS_FILE, JSON.stringify({ behind: 0, error: 'config-load-failed', checkedAt }, null, 2) + '\n', 'utf-8');
      } catch { /* ignore */ }
      process.exit(0);
    }

    const { resolved: vault } = resolveVaultPath(config, arg);
    const statusDir = dirname(WIKI_STATUS_FILE);
    try { mkdirSync(statusDir, { recursive: true }); } catch { /* ignore */ }

    function writeStatus(obj) {
      try {
        writeFileSync(WIKI_STATUS_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
      } catch { /* ignore */ }
      out(obj);
    }

    // Vault directory or .git must exist
    if (!existsSync(vault) || !existsSync(join(vault, '.git'))) {
      writeStatus({ behind: 0, error: 'not-a-git-repo', checkedAt, vaultPath: vault });
      process.exit(0);
    }

    // git fetch
    try {
      execFileSync('git', ['-C', vault, 'fetch'], { cwd: vault, stdio: 'ignore', timeout: 15000 });
    } catch {
      writeStatus({ behind: 0, error: 'fetch-failed', checkedAt, vaultPath: vault });
      process.exit(0);
    }

    // Determine upstream branch
    let upstream;
    try {
      upstream = execFileSync('git', ['-C', vault, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: vault, encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
      writeStatus({ behind: 0, error: 'no-upstream', checkedAt, vaultPath: vault });
      process.exit(0);
    }

    // Count commits behind
    let behind = 0;
    try {
      const raw = execFileSync('git', ['-C', vault, 'rev-list', '--count', `HEAD..${upstream}`], { cwd: vault, encoding: 'utf-8', timeout: 5000 }).trim();
      behind = parseInt(raw, 10);
      if (!Number.isFinite(behind) || behind < 0) behind = 0;
    } catch {
      writeStatus({ behind: 0, error: 'rev-list-failed', checkedAt, vaultPath: vault });
      process.exit(0);
    }

    // Current branch name
    let branch = null;
    try {
      branch = execFileSync('git', ['-C', vault, 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: vault, encoding: 'utf-8', timeout: 5000 }).trim();
    } catch { /* non-fatal */ }

    writeStatus({ behind, branch, upstream, vaultPath: vault, checkedAt, error: null });
    process.exit(0);
  }
  default: {
    process.stderr.write(
      'wiki-cli: unknown command\n' +
      'usage:\n' +
      '  node scripts/wiki-cli.mjs path [override-path]   # resolve configured vault path\n' +
      '  node scripts/wiki-cli.mjs init [path]            # scaffold vault + git + write config\n' +
      '  node scripts/wiki-cli.mjs auto-capture <on|off> [work-history-path]\n' +
      '  node scripts/wiki-cli.mjs fetch                  # git fetch + write ~/.codepresso/wiki-status.json\n'
    );
    process.exit(2);
  }
}
