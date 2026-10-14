import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const GLOBAL_CONFIG_PATH = join(homedir(), '.codepresso', 'config.json');
const PROJECT_CONFIG_NAME = '.codepresso.json';

export function getStateDir(cwd = process.cwd()) {
  return join(cwd, '.codepresso', 'state');
}

const DEFAULT_CONFIG = {
  github: { token: null },
  notion: {
    apiKey: null,
    defaultDatabaseId: null,
    databases: {                  // Per-type database IDs. notion.databases.task takes precedence over defaultDatabaseId when present.
      sprint: null,
      epic: null,
      task: null,
    },
    userId: null,               // Notion user ID (for filtering tasks by assignee)
    displayName: null,          // Display name (for auto-assigning created tasks)
    assigneeProperty: 'Assignee', // Name of the assignee property in the Notion DB
    syncWindowDays: 14,          // Default query window for Notion sync (0 = no limit)
    sprintWorkflow: {
      enabled: false,
      autoTransition: true,
      epicAutoComplete: true,
      prTitleFormat: 'task',    // "task" | "epic+task" | "epic"
    },
  },
  deploy: {
    enabled: false,
    method: null,
    awsRegion: null,
    ecsCluster: null,
    ecsService: null,
    pipelineName: null,
  },
  epicDocs: {
    enabled: true,
    outputDir: 'docs/prd',
    includeTaskDetails: true,
    customSections: [],
  },
  cloudDev: {
    enabled: true,
    region: 'ap-northeast-2',
    tagKey: 'Email',
    purposeTag: 'cloud-dev-env',
  },
  googleChat: {
    enabled: false,
    dailyGreeting: true,
    spaceId: null,                // Google Chat space ID (e.g., 'AAAAxxxxxxx')
    calendar: {
      enabled: true,              // show calendar sections (still requires googleChat.enabled)
      calendarId: null,           // null = auto-detect primary; or explicit calendar id/summary
      maxEvents: 8,               // cap lines per calendar section
    },
  },
  inbox: {
    enabled: false,
    sources: {
      gmail: {
        enabled: true,
        lookbackHours: 24,
        query: 'in:inbox is:unread -category:promotions -category:social',
        maxResults: 30,
      },
      chat: {
        enabled: true,
        lookbackHours: 24,
        spaceIds: [],
        maxPerSpace: 20,
      },
    },
    ignoreSenders: ['noreply@', 'notifications@github\\.com', 'no-reply@'],
    classifier: { maxCandidatesPerScan: 10 },
    notion: {
      taskDatabaseId: null,
      dueDateProperty: '마감일',
      defaultDueOption: 'Tomorrow',
    },
    reminder: { showOverdue: true, showDueToday: true, maxPerSection: 5 },
  },
  wiki: {
    enabled: false,                              // Set true after `node scripts/wiki-cli.mjs init`
    vaultPath: '~/Documents/Obsidian/llm-wiki',  // ~ expanded at use; each user keeps their OWN vault
    remote: null,                                // Optional git remote (e.g. private GitHub repo) for multi-machine sync
    autoFetch: true,                             // Claude hook: detached fetch on session start
    autoCapture: false,                          // OMP extension: capture completed, evidenced work at session stop
    autoSync: true,                              // OMP extension: fast-forward before capture, push after commit
    workHistoryPath: 'pages/process/omp-work-history.md',
  },
  aws: {
    enabled: false,                                 // flipped true by `aws-cli setup`
    sourceProfile: 'codepresso-source',
    mfaSerial: null,                                // detected at setup, e.g. arn:aws:iam::ACCT:mfa/<name>
    sessionTtlSeconds: 14400,
    sessionFile: '~/.codepresso/aws-session.json',
    region: 'ap-northeast-2',
  },
  excludePatterns: [
    '^/',                              // All slash commands (/help, /status, /commit, etc.)
    '(executed|registered)',           // System execution messages
  ],
  debug: false,
};

/**
 * Read and parse a JSON file, returning null on any error.
 */
function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Two-level deep merge per-section: project values override global values within
 * each top-level key, but do not replace the entire section. For nested objects
 * within a section (e.g. notion.databases, notion.sprintWorkflow), a second level
 * of merging is applied so partial overrides preserve sibling defaults.
 */
function mergeSections(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key]) &&
      typeof override[key] === 'object' &&
      override[key] !== null &&
      !Array.isArray(override[key])
    ) {
      // Shallow merge at section level
      const merged = { ...base[key], ...override[key] };
      // Deep merge for nested objects within section (databases, sprintWorkflow, etc.)
      for (const subKey of Object.keys(override[key])) {
        if (
          typeof base[key][subKey] === 'object' &&
          base[key][subKey] !== null &&
          !Array.isArray(base[key][subKey]) &&
          typeof override[key][subKey] === 'object' &&
          override[key][subKey] !== null &&
          !Array.isArray(override[key][subKey])
        ) {
          merged[subKey] = { ...base[key][subKey], ...override[key][subKey] };
        }
      }
      result[key] = merged;
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/**
 * Load merged config: defaults <- global <- per-project.
 * @param {string} [cwd] - Project directory (defaults to process.cwd())
 * @param {object} [options] - Options object
 * @param {string} [options.globalConfigPath] - Path to global config (defaults to ~/.codepresso/config.json)
 * @returns {object} Merged configuration
 */
export function loadConfig(cwd = process.cwd(), { globalConfigPath } = {}) {
  const global = readJson(globalConfigPath ?? GLOBAL_CONFIG_PATH) || {};
  const project = readJson(join(cwd, PROJECT_CONFIG_NAME)) || {};

  let merged = mergeSections(DEFAULT_CONFIG, global);
  merged = mergeSections(merged, project);

  // Attach validation warnings (non-enumerable so they don't serialize)
  const warnings = validateConfig(merged);
  Object.defineProperty(merged, '_warnings', {
    value: warnings,
    enumerable: false,
    writable: false,
  });

  return merged;
}

/**
 * Ensure the global config file exists, creating it with defaults if missing.
 * Returns true if config now exists (always true unless write fails).
 * @param {string} [globalConfigPath] - Path to global config (defaults to ~/.codepresso/config.json)
 * @returns {boolean}
 */
export function ensureSetup(globalConfigPath) {
  const configPath = globalConfigPath ?? GLOBAL_CONFIG_PATH;
  if (existsSync(configPath)) return true;
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if initial setup has been completed by verifying the global config file exists.
 * @param {string} [globalConfigPath] - Path to global config (defaults to ~/.codepresso/config.json)
 * @returns {boolean}
 */
export function isSetupComplete(globalConfigPath) {
  return existsSync(globalConfigPath ?? GLOBAL_CONFIG_PATH);
}

/**
 * Check if a prompt matches any exclude pattern.
 * @param {string} prompt
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isExcluded(prompt, patterns) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((p) => {
    try {
      return new RegExp(p).test(prompt);
    } catch {
      return false;
    }
  });
}

/**
 * Validate a merged config and return warnings for issues.
 * @param {object} config - The merged config object
 * @returns {string[]} Array of warning messages (empty if valid)
 */
export function validateConfig(config) {
  const warnings = [];

  const KNOWN_KEYS = ['github', 'notion', 'deploy', 'epicDocs', 'cloudDev', 'googleChat', 'inbox', 'wiki', 'aws', 'excludePatterns', 'debug'];
  for (const key of Object.keys(config)) {
    if (!KNOWN_KEYS.includes(key)) {
      warnings.push(`Unknown config key: "${key}"`);
    }
  }

  if (config.deploy) {
    const validMethods = [null, 'ecs', 'codepipeline', 'workflow', 'custom'];
    if (config.deploy.method && !validMethods.includes(config.deploy.method)) {
      warnings.push(`deploy.method "${config.deploy.method}" is not valid. Use: ${validMethods.filter(Boolean).join(', ')}`);
    }
  }

  // Sprint workflow validation
  if (config.notion) {
    const sw = config.notion.sprintWorkflow;
    if (sw) {
      if (typeof sw.enabled !== 'undefined' && typeof sw.enabled !== 'boolean') {
        warnings.push(`notion.sprintWorkflow.enabled should be boolean, got ${typeof sw.enabled}`);
      }
      if (typeof sw.autoTransition !== 'undefined' && typeof sw.autoTransition !== 'boolean') {
        warnings.push(`notion.sprintWorkflow.autoTransition should be boolean, got ${typeof sw.autoTransition}`);
      }
      if (typeof sw.epicAutoComplete !== 'undefined' && typeof sw.epicAutoComplete !== 'boolean') {
        warnings.push(`notion.sprintWorkflow.epicAutoComplete should be boolean, got ${typeof sw.epicAutoComplete}`);
      }
      const validFormats = ['task', 'epic+task', 'epic'];
      if (sw.prTitleFormat && !validFormats.includes(sw.prTitleFormat)) {
        warnings.push(`notion.sprintWorkflow.prTitleFormat "${sw.prTitleFormat}" is not valid. Use: ${validFormats.join(', ')}`);
      }
    }
    const dbs = config.notion.databases;
    if (dbs) {
      for (const dbKey of ['sprint', 'epic', 'task']) {
        if (dbs[dbKey] !== null && dbs[dbKey] !== undefined && typeof dbs[dbKey] !== 'string') {
          warnings.push(`notion.databases.${dbKey} should be a string, got ${typeof dbs[dbKey]}`);
        }
      }
    }
  }

  if (config.epicDocs) {
    if (typeof config.epicDocs.enabled !== 'undefined' && typeof config.epicDocs.enabled !== 'boolean') {
      warnings.push(`epicDocs.enabled should be boolean, got ${typeof config.epicDocs.enabled}`);
    }
    if (typeof config.epicDocs.includeTaskDetails !== 'undefined' && typeof config.epicDocs.includeTaskDetails !== 'boolean') {
      warnings.push(`epicDocs.includeTaskDetails should be boolean, got ${typeof config.epicDocs.includeTaskDetails}`);
    }
    if (typeof config.epicDocs.outputDir !== 'undefined' && typeof config.epicDocs.outputDir !== 'string') {
      warnings.push(`epicDocs.outputDir should be a string, got ${typeof config.epicDocs.outputDir}`);
    }
    if (config.epicDocs.customSections && !Array.isArray(config.epicDocs.customSections)) {
      warnings.push(`epicDocs.customSections should be an array, got ${typeof config.epicDocs.customSections}`);
    }
  }

  if (config.googleChat) {
    if (typeof config.googleChat.enabled !== 'undefined' && typeof config.googleChat.enabled !== 'boolean') {
      warnings.push(`googleChat.enabled should be boolean, got ${typeof config.googleChat.enabled}`);
    }
    if (typeof config.googleChat.dailyGreeting !== 'undefined' && typeof config.googleChat.dailyGreeting !== 'boolean') {
      warnings.push(`googleChat.dailyGreeting should be boolean, got ${typeof config.googleChat.dailyGreeting}`);
    }
    if (config.googleChat.spaceId !== null && config.googleChat.spaceId !== undefined && typeof config.googleChat.spaceId !== 'string') {
      warnings.push(`googleChat.spaceId should be a string, got ${typeof config.googleChat.spaceId}`);
    }
    const cal = config.googleChat.calendar;
    if (cal) {
      if (typeof cal.enabled !== 'undefined' && typeof cal.enabled !== 'boolean') {
        warnings.push(`googleChat.calendar.enabled should be boolean, got ${typeof cal.enabled}`);
      }
      if (cal.calendarId !== null && cal.calendarId !== undefined && typeof cal.calendarId !== 'string') {
        warnings.push(`googleChat.calendar.calendarId should be a string, got ${typeof cal.calendarId}`);
      }
      if (typeof cal.maxEvents !== 'undefined' && (typeof cal.maxEvents !== 'number' || cal.maxEvents <= 0)) {
        warnings.push(`googleChat.calendar.maxEvents should be a positive number, got ${cal.maxEvents}`);
      }
    }
  }

  if (config.inbox) {
    if (typeof config.inbox.enabled !== 'undefined' && typeof config.inbox.enabled !== 'boolean') {
      warnings.push(`inbox.enabled should be boolean, got ${typeof config.inbox.enabled}`);
    }
    if (config.inbox.classifier && typeof config.inbox.classifier.maxCandidatesPerScan === 'number'
        && config.inbox.classifier.maxCandidatesPerScan <= 0) {
      warnings.push(`inbox.classifier.maxCandidatesPerScan must be > 0, got ${config.inbox.classifier.maxCandidatesPerScan}`);
    }
    if (config.inbox.ignoreSenders && !Array.isArray(config.inbox.ignoreSenders)) {
      warnings.push(`inbox.ignoreSenders should be an array, got ${typeof config.inbox.ignoreSenders}`);
    }
  }

  if (config.wiki) {
    if (typeof config.wiki.enabled !== 'undefined' && typeof config.wiki.enabled !== 'boolean') {
      warnings.push(`wiki.enabled should be boolean, got ${typeof config.wiki.enabled}`);
    }
    if (typeof config.wiki.vaultPath !== 'undefined' && typeof config.wiki.vaultPath !== 'string') {
      warnings.push(`wiki.vaultPath should be a string, got ${typeof config.wiki.vaultPath}`);
    }
    for (const key of ['autoFetch', 'autoCapture', 'autoSync']) {
      if (typeof config.wiki[key] !== 'undefined' && typeof config.wiki[key] !== 'boolean') {
        warnings.push(`wiki.${key} should be boolean, got ${typeof config.wiki[key]}`);
      }
    }
    if (typeof config.wiki.workHistoryPath !== 'undefined' && typeof config.wiki.workHistoryPath !== 'string') {
      warnings.push(`wiki.workHistoryPath should be a string, got ${typeof config.wiki.workHistoryPath}`);
    }
  }

  if (config.excludePatterns && !Array.isArray(config.excludePatterns)) {
    warnings.push(`excludePatterns should be an array, got ${typeof config.excludePatterns}`);
  }

  if (typeof config.debug !== 'undefined' && typeof config.debug !== 'boolean') {
    warnings.push(`debug should be boolean, got ${typeof config.debug}`);
  }

  return warnings;
}
