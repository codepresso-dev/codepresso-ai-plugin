# Codepresso Installation Guide

Complete setup instructions for the Codepresso team workflow plugin.

## Prerequisites

Before installing Codepresso, ensure you have:

- **Node.js >= 20.0.0** — Check with `node --version`
- **GitHub CLI (`gh`)** — Install from https://cli.github.com/ or via your package manager
- **GitHub CLI authenticated** — Run `gh auth login` and complete the authentication flow
- **Notion Internal Integration Token** (optional) — Only needed if you plan to use Notion sync features

## Installation Methods

### OMP Plugin

OMP uses the `omp.extensions` entry in `package.json` and loads the Wiki auto-capture extension
without changing Claude Code hooks:

```bash
git clone https://github.com/code-presso/codepresso-ai-plugin.git ~/plugins/codepresso
npm --prefix ~/plugins/codepresso install
omp plugin link ~/plugins/codepresso --scope user
```

Restart OMP after linking. Enable personal work capture after the Wiki vault exists:

```bash
node ~/plugins/codepresso/scripts/wiki-cli.mjs auto-capture on
# Optional custom ledger:
node ~/plugins/codepresso/scripts/wiki-cli.mjs auto-capture on people/self/work-history.md
```

The extension is silent in the status line. With `wiki.autoSync: true`, it fast-forwards before
capture and pushes the path-limited capture commit. Diverged branches fail closed.


### Method 0: Codex Plugin

Codex reads `.codex-plugin/plugin.json`, `skills/`, `commands/`, and `.mcp.json` from this repo.

```bash
mkdir -p ~/plugins ~/.agents/plugins
git clone https://github.com/code-presso/codepresso-ai-plugin.git ~/plugins/codepresso
cd ~/plugins/codepresso
npm install
```

Add Codepresso to `~/.agents/plugins/marketplace.json`:

```json
{
  "name": "personal",
  "interface": {
    "displayName": "Personal"
  },
  "plugins": [
    {
      "name": "codepresso",
      "source": {
        "source": "local",
        "path": "./plugins/codepresso"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

Then install the plugin:

```bash
codex plugin add codepresso@personal
```

For auto-update, schedule the local clone to pull and reinstall:

```bash
git -C ~/plugins/codepresso pull --ff-only
npm --prefix ~/plugins/codepresso install
codex plugin add codepresso@personal
```

See `docs/plugin-auto-update.md` for a cron example and Claude Code auto-update settings.

Open a new Codex thread after installing so Codex loads the plugin's skills, commands, and MCP
servers. Slash commands include `/codepresso:setup`, `/codepresso:status`,
`/codepresso:notion-sync`, `/codepresso:sprint-dashboard`, `/codepresso:sprint-retro`,
`/codepresso:llm-wiki`, `/codepresso:cloud-dev`, and `/codepresso:deploy`.

Choose one of the three methods below to install Codepresso:

For Claude Code marketplace auto-update, use `docs/claude-settings.auto-update.example.json`
as the reference:

```json
{
  "extraKnownMarketplaces": {
    "codepresso": {
      "source": {
        "source": "github",
        "repo": "code-presso/codepresso-ai-plugin"
      },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "codepresso@codepresso": true
  }
}
```

### Method 1: Symlink (Recommended for Development)

The symlink method is ideal if you're developing Codepresso or want to keep a single source of truth:

```bash
# Create the plugins directory if it doesn't exist
mkdir -p ~/.claude/plugins

# Create a symlink from your Codepresso repository to the plugins directory
ln -s /absolute/path/to/codepresso-plugin ~/.claude/plugins/codepresso
```

Replace `/absolute/path/to/codepresso-plugin` with the actual absolute path to your cloned repository. You can find the absolute path by running `pwd` inside the codepresso-plugin directory.

### Method 2: Claude Plugin Add (Automatic)

If Claude Code supports `claude plugin add`:

```bash
cd /path/to/codepresso-plugin
claude plugin add .
```

This automatically copies Codepresso into your `~/.claude/plugins/` directory.

### Method 3: Manual Copy

Manually copy the plugin to your plugins directory:

```bash
mkdir -p ~/.claude/plugins
cp -r /absolute/path/to/codepresso-plugin ~/.claude/plugins/codepresso
```

## Install Dependencies

After choosing an installation method, install npm dependencies:

```bash
cd ~/.claude/plugins/codepresso
npm install
```

This installs the MCP SDK and other required packages listed in `package.json`.

## Configuration

Codepresso uses two-level configuration: global settings with per-project overrides.

### Global Configuration

Create `~/.codepresso/config.json` with your default settings:

```bash
mkdir -p ~/.codepresso
cat > ~/.codepresso/config.json << 'EOF'
{
  "github": {
    "token": null
  },
  "notion": {
    "apiKey": null,
    "defaultDatabaseId": null
  },
  "prLogging": {
    "enabled": true,
    "trackGitOps": true,
    "batchIntervalSeconds": 60,
    "maxBatchSize": 10,
    "truncatePromptLength": 500
  }
}
EOF
```

Configuration fields:

- `github.token` — (Optional) GitHub personal access token. If null, Codepresso uses `gh` CLI authentication.
- `notion.apiKey` — Notion Internal Integration Token (get from https://www.notion.so/my-integrations)
- `notion.defaultDatabaseId` — Default Notion database ID for sync operations
- `prLogging.enabled` — Enable/disable prompt logging to PRs (default: true)
- `prLogging.trackGitOps` — Log `git commit` and `git push` operations (default: true)
- `prLogging.batchIntervalSeconds` — Time (in seconds) to wait before flushing logs to PR (default: 60)
- `prLogging.maxBatchSize` — Maximum number of prompts per batch before flushing (default: 10)
- `prLogging.truncatePromptLength` — Character limit for each logged prompt (default: 500)

### Per-Project Configuration

Create `.codepresso.json` in your project root to override global settings for that project only:

```json
{
  "prLogging": {
    "enabled": true,
    "batchIntervalSeconds": 30,
    "trackGitOps": true
  },
  "notion": {
    "databaseId": "abc123def456..."
  },
  "excludePatterns": [
    "^/oh-my-claudecode:",
    "^(cancelomc|stopomc)$"
  ]
}
```

Configuration fields:

- `prLogging` — Override any PR logging settings (merged with global config)
- `notion.databaseId` — Use a different Notion database for this project
- `excludePatterns` — Array of regex patterns. Prompts matching these are NOT logged. Useful for filtering OMC commands.

Per-project settings override global settings on a per-section basis. For example, if you set only `prLogging.batchIntervalSeconds` in `.codepresso.json`, the project uses that value while inheriting other `prLogging` settings from global config.

### Interactive Setup (Optional)

Instead of manually editing config files, run the interactive setup wizard:

```bash
claude code  # Start Claude Code
# Then in Claude Code, run:
codepresso:setup
```

This wizard guides you through:
1. Setting GitHub authentication
2. Setting up Notion integration (optional)
3. Configuring PR logging defaults
4. Choosing batch and truncation settings

## Notion Setup (Optional)

Notion integration is optional. Skip this section if you don't need Notion sync.

### Step 1: Create a Notion Internal Integration

1. Go to https://www.notion.so/my-integrations
2. Click "Create new integration"
3. Name it "Codepresso" (or similar)
4. Select your workspace
5. Click "Submit"
6. Copy the "Internal Integration Token" (starts with `ntn_`)
7. Save it securely — you'll need it in the next step

### Step 2: Add API Key to Codepresso

Add your Notion API key to `~/.codepresso/config.json`:

```json
{
  "notion": {
    "apiKey": "ntn_YOUR_TOKEN_HERE",
    "defaultDatabaseId": null
  }
}
```

Replace `ntn_YOUR_TOKEN_HERE` with your actual token.

### Step 3: Find Your Database ID

To sync Notion tasks, you need your database ID:

1. Open your Notion database in a browser
2. Copy the URL: `https://www.notion.so/YOUR_WORKSPACE/YOUR_DATABASE_ID?v=...`
3. The `YOUR_DATABASE_ID` is the long alphanumeric string between the workspace name and `?v=`
4. Alternatively, run this in Claude Code:
   ```
   codepresso:notion-sync
   ```
   This opens an MCP session where you can query databases

### Step 4: Connect the Integration to Your Database

In Notion:

1. Open the database page
2. Click "+" (Add a connection) near the top
3. Search for and select your "Codepresso" integration
4. Click "Confirm"

The integration now has access to that database.

### Step 5: Update Codepresso Config

Update `~/.codepresso/config.json` with your database ID:

```json
{
  "notion": {
    "apiKey": "ntn_YOUR_TOKEN_HERE",
    "defaultDatabaseId": "YOUR_DATABASE_ID"
  }
}
```

Or in `.codepresso.json` for project-specific overrides:

```json
{
  "notion": {
    "databaseId": "YOUR_DATABASE_ID"
  }
}
```

## Verification Steps

After installation, verify that each feature works correctly:

### 1. Session Start Detection

Test that Codepresso detects your PR on session start:

1. Create a feature branch: `git checkout -b feature/test-codepresso`
2. Create and push a commit: `git commit --allow-empty -m "test" && git push -u origin feature/test-codepresso`
3. Create a PR: `gh pr create --fill`
4. Restart Claude Code
5. You should see in the console:
   ```
   [Codepresso] PR #N detected. Prompts will be logged.
   ```

If you don't see this message:
- Check that `gh pr list` returns your PR: `gh pr list --state open`
- Verify your GitHub CLI is authenticated: `gh auth status`

### 2. Prompt Logging

Test that prompts are logged to your PR:

1. In Claude Code (on your feature branch), send a few prompts:
   ```
   Fix the authentication bug
   Add unit tests
   ```
2. Wait for the batch interval (default: 60 seconds)
3. Check your PR comments on GitHub
4. You should see a comment titled "Claude Code Activity Log" with a table of prompts

If prompts aren't logged:
- Check `prLogging.enabled` is true in config
- Verify the batch interval has passed
- Check that you're on a branch with an open PR
- Look for `excludePatterns` that might be filtering your prompts

### 3. Git Operation Tracking

Test that git commits are logged:

1. In Claude Code, run a bash command that commits code:
   ```bash
   git commit --allow-empty -m "test commit"
   ```
2. Check your PR comments
3. You should see a new comment with the commit hash and timestamp

If git ops aren't logged:
- Ensure `prLogging.trackGitOps` is true in config
- Verify the bash command actually ran (check `git log`)
- Check that postToolUse hook is working (see Troubleshooting)

### 4. Exclude Patterns

Test that exclude patterns filter prompts:

1. In Claude Code, run a command that matches your exclude pattern:
   ```
   /oh-my-claudecode:help
   ```
2. Wait for the batch interval
3. Check your PR comments
4. The command should NOT appear in the activity log

If exclude patterns aren't working:
- Verify regex syntax in `excludePatterns`
- Check that per-project `.codepresso.json` is in your project root
- Restart Claude Code to reload config

### 5. Notion MCP Tools

Test Notion sync (only if you configured Notion):

1. In Claude Code, run:
   ```
   codepresso:notion-sync
   ```
2. This opens an MCP session with Notion tools available
3. Try the `notion_query_db` tool to query your database
4. Verify you can see your tasks

If Notion tools fail:
- Check `notion.apiKey` in config is set correctly
- Verify the integration is connected to your database in Notion
- Check database permissions (integration must have access)
- Look for API error messages in Claude Code output

## OMC Coexistence

Codepresso is designed to work seamlessly alongside oh-my-claudecode (OMC) with zero conflicts:

### Configuration Isolation

- **OMC Config**: `~/.claude/.omc-config.json`
- **Codepresso Config**: `~/.codepresso/config.json`

These are completely separate configuration files.

### State File Isolation

- **OMC State**: `.codepresso/state/` (various files)
- **Codepresso State**: `.codepresso/state/codepresso-*` (all prefixed with `codepresso-`)

State files are namespaced to prevent collisions.

### Hook Coordination

Both Codepresso and OMC register `UserPromptSubmit` hooks. They coexist by:
- Both return `{ continue: true }` (allow execution chain to continue)
- Codepresso is silent (does not add `additionalContext` to prompts)
- OMC can add context without interference

### Command Filtering

To prevent OMC commands from being logged to PRs, use `excludePatterns` in `.codepresso.json`:

```json
{
  "excludePatterns": [
    "^/oh-my-claudecode:",
    "^(cancelomc|stopomc)$",
    "^/(plan|review|analyze):"
  ]
}
```

This filters out OMC commands while logging user prompts normally.

## Troubleshooting

### "gh not found"

**Problem**: `gh` CLI is not installed or not in PATH

**Solution**:
```bash
# Check if gh is installed
which gh

# Install gh from https://cli.github.com/
# macOS:
brew install gh

# Ubuntu:
sudo apt install gh

# Windows:
choco install gh
```

Then verify authentication:
```bash
gh auth status
```

### "No PR detected"

**Problem**: Codepresso doesn't detect your PR on session start

**Diagnosis**:
```bash
# Check if gh can find your PR
gh pr list --state open

# Check current branch
git branch --show-current

# Check if branch is pushed
git push -u origin $(git branch --show-current)
```

**Solution**:
1. Ensure your branch is pushed to remote
2. Ensure an open PR exists for that branch
3. Restart Claude Code to trigger SessionStart hook
4. Check console for `[Codepresso] PR #N detected` message

### "Notion API error"

**Problem**: Notion queries fail with authentication or database error

**Diagnosis**:
```bash
# Check Notion config
cat ~/.codepresso/config.json | grep notion

# Verify token format (should start with ntn_)
# Verify database ID is correct
```

**Solution**:
1. Verify `notion.apiKey` is set and valid in `~/.codepresso/config.json`
2. Check that the integration is connected to the database in Notion (see Notion Setup Step 4)
3. Ensure the integration has permission to access the database
4. Verify `notion.defaultDatabaseId` or `.codepresso.json` `notion.databaseId` is correct

### "Hooks not running"

**Problem**: Prompts aren't logged, git ops aren't tracked, or PR detection doesn't show

**Diagnosis**:
```bash
# Check that Codepresso is installed
ls -la ~/.claude/plugins/codepresso

# Check that hooks are registered
cat ~/.claude/plugins/codepresso/hooks/hooks.json

# Restart Claude Code to reload hooks
# Check console output for any hook errors
```

**Solution**:
1. Verify Codepresso is installed at `~/.claude/plugins/codepresso`
2. Verify `npm install` was run in the Codepresso directory
3. Restart Claude Code (hooks are loaded at session start)
4. Check console for any error messages from hook execution
5. Check file permissions (hooks must be executable)

### "Batch not flushing"

**Problem**: Prompts accumulate in batch file but aren't posted to PR

**Diagnosis**:
```bash
# Check batch file
cat ~/.codepresso/state/codepresso-batch-*.jsonl | wc -l

# Check config for batch interval
cat ~/.codepresso/config.json | grep batchInterval
```

**Solution**:
1. Wait for `batchIntervalSeconds` to elapse (default: 60)
2. Verify `prLogging.enabled` is true
3. Check that PR was detected (see "No PR detected")
4. Manually flush with: `codepresso:log` skill
5. Lower `batchIntervalSeconds` to test (e.g., 10 seconds)

### "Config not loading"

**Problem**: Changes to `~/.codepresso/config.json` or `.codepresso.json` don't take effect

**Diagnosis**:
```bash
# Check global config
cat ~/.codepresso/config.json

# Check per-project config
cat .codepresso.json

# Verify JSON is valid
node -e "console.log(JSON.parse(require('fs').readFileSync('.codepresso.json')))"
```

**Solution**:
1. Verify JSON syntax is valid (use https://jsonlint.com/ if unsure)
2. Ensure file is in the correct location
3. Restart Claude Code to reload config
4. Check file permissions (readable by your user)

## Next Steps

After installation and verification:

1. **Set up PR logging** — Configure your preferred batch interval and truncation length
2. **Integrate Notion** (optional) — If using Notion, complete the Notion Setup section
3. **Configure exclude patterns** — Filter out commands you don't want logged
4. **Test with your team** — Start using Codepresso on a real feature branch to see activity logs in action

## Getting Help

If you encounter issues:

1. Check this Troubleshooting section
2. Review the README.md for architecture and design
3. Run `codepresso:setup` to reconfigure
4. Check console output in Claude Code for error messages
5. File an issue with details about your setup and error messages
