---
name: setup
description: Interactive setup wizard for Codepresso
---

<Purpose>
Guide the user through configuring Codepresso: verify prerequisites (gh CLI, Notion API key),
configure Notion/sprint workflow integration, and write config files.
</Purpose>

<Use_When>
- User says "setup codepresso" or "codepresso setup"
- User wants to configure Notion integration or sprint workflow
- First time using Codepresso in a project
</Use_When>

<Do_Not_Use_When>
- User wants to sync Notion tasks (use `codepresso:notion-sync`)
</Do_Not_Use_When>

<Steps>
1. **Check prerequisites**
   - Verify `gh` CLI is installed and authenticated: `gh auth status`
   - Verify Node.js >= 20

2. **GitHub configuration**
   - Confirm `gh` auth works for the current repo
   - Test PR access: `gh pr list --limit 1`

3. **Notion configuration** (optional)
   - Ask if user wants Notion integration
   - If yes, prompt for Notion API key (Internal Integration Token)
   - Prompt for default database ID
   - Test connection via MCP notion tools
   - Use `notion_get_users` MCP tool to list workspace members
   - Ask the user to select themselves from the list (sets `notion.userId` and `notion.displayName`)
   - Ask for the name of the assignee property in their database (default: "Assignee")

4. **Sprint workflow configuration** (optional — requires Notion from step 3)
   - Ask if user wants sprint workflow automation
   - If yes, prompt for three database IDs with pre-filled defaults:
     - **Sprint database ID** (default: `171c7154878d8013ab18f159929ba3b8`) — tracks sprints with 상태/Status select, 기간/Date, epic relation
     - **Epic database ID** (default: `6e60ce8862704ef295e3a3f796ee6302`) — tracks epics with 상태/Status select, unique ID prefix "GP"
     - **Task database ID** (default: same as `defaultDatabaseId` from step 3, i.e. `77bb2292512e472d8b049ec5b21b1554`) — tracks tasks
   - Present defaults using AskUserQuestion: "Use default Codepresso database IDs?" with options "Yes, use defaults" / "No, enter custom IDs"
   - If custom: prompt each ID individually. Tip: Database ID is in the Notion URL: `notion.so/workspace/<DATABASE_ID>?v=...`
   - Test connection: use `mcp__plugin_codepresso_notion__notion_query_db` or `mcp__notion__notion_query_db` to query each database with `page_size: 1` to verify access
   - Ask: "Enable the Notion task workflow (task picker on tool use, `[TSK-XXX]` PR title enforcement that blocks `gh pr create`, auto-complete on PR merge)?" using AskUserQuestion. **Default: No** — since 2026-11-23 the team tracks work in GitHub issues/PRs/design docs, so leave `notion.taskWorkflow.enabled` false unless the user explicitly wants it.
   - Only if the user enables the task workflow, ask for its preferences using AskUserQuestion:
     - Auto-transition tasks to "진행 중" when selected? (default: true)
     - Auto-complete epics when all tasks are done? (default: true)
     - PR title format: "task" for `[TSK-XXX]` only, or "epic+task" for `[GP-XXX][TSK-XXX]`? (default: "task")
   - Write `notion.databases`, `notion.sprintWorkflow` and `notion.taskWorkflow` (`{ "enabled": <answer> }`) to config

4.5. **Epic PRD configuration** (optional — requires Notion from step 3)
   - Ask: "Enable PRD document generation for epics?" using AskUserQuestion
   - If yes:
     - Ask output directory (default: `docs/prd`)
     - Ask: include task details table in PRD? (default: true)
     - Ask: any custom section headings? (comma-separated, optional — e.g., "Rollback Plan, Monitoring")
   - Write `epicDocs` section to config:
     ```json
     {
       "epicDocs": {
         "enabled": true,
         "outputDir": "docs/prd",
         "includeTaskDetails": true,
         "customSections": []
       }
     }
     ```

5. **Google Chat daily greeting** (optional)
   - Ask: "Enable daily Google Chat greeting?" using AskUserQuestion
   - If yes:
     - Explain: sends a summary of in-progress Notion tasks to a Google Chat space on the first Claude session each day, as the user's profile (not a bot)
     - Requires `gws` CLI installed and authenticated with `chat.messages.create` scope
     - Check `gws` CLI: `which gws` and `gws auth status`
     - If not authenticated, guide user: `gws auth login --scopes "https://www.googleapis.com/auth/chat.messages.create,https://www.googleapis.com/auth/chat.messages,https://www.googleapis.com/auth/chat.spaces.readonly"`
     - Ask for Google Chat space ID (default: `AAAAxQcYA-o` — found in the space URL: `https://chat.google.com/room/SPACE_ID`)
   - Write `googleChat` section to config:
     ```json
     {
       "googleChat": {
         "enabled": true,
         "dailyGreeting": true,
         "spaceId": "AAAAxQcYA-o"
       }
     }
     ```

6. **Write configuration**
   - Write global config to `~/.codepresso/config.json`
   - Optionally write per-project `.codepresso.json`
   - Add `.codepresso.json` pattern to `.gitignore` if it contains secrets

7. **Configure MCP tool permissions**
   - Create `.claude/settings.local.json` (if not exists) to auto-allow Notion MCP tools:
     ```json
     {
       "permissions": {
         "allow": [
           "mcp__notion__*",
           "mcp__plugin_codepresso_notion__*"
         ]
       }
     }
     ```
   - If the file already exists, merge the `permissions.allow` entries without overwriting existing ones
   - This prevents permission prompts when running sprint-dashboard, sprint-retro, and notion-sync skills

8. **Verify setup**
   - Start a test by detecting current branch and PR
   - If sprint workflow enabled, test sprint fetch: query sprint DB for current sprint
   - Confirm everything works
   - Print summary of configuration

10. **Inbox scan setup** (optional)
   - Ask using AskUserQuestion: "Enable inbox task tracker (scans Gmail + Chat for action items)? [y/N]". If no, skip this step.

   **10.1 Gmail connector**
   - Verify `mcp__claude_ai_Gmail` is authenticated:
     1. Call `mcp__claude_ai_Gmail__authenticate`. If already authenticated, continue. Otherwise complete OAuth via `mcp__claude_ai_Gmail__complete_authentication`.
     2. Confirm by listing 1 message from inbox.
   - If unable to authenticate, emit `⚠️ Gmail not authed — inbox will use Chat only until you re-run setup.` and continue to 10.4.

   **10.2 Notion task database schema**
   - Ask the user for the task database ID (default to existing `notion.databases.task`). Save to `inbox.notion.taskDatabaseId` if different.
   - Fetch the database schema via `mcp__claude_ai_Notion__notion-fetch`:
     - If a property with type `date` and name matching `inbox.notion.dueDateProperty` (default `마감일`) exists, continue to 10.3.
     - If absent, prompt using AskUserQuestion: "Add date property '마감일' to your task DB? [Y/n]".
       - If yes: call `mcp__claude_ai_Notion__notion-update-data-source` with:
         ```json
         { "data_source_id": "<dbid>", "properties": { "마감일": { "date": {} } } }
         ```
       - If no: prompt for the existing property name and save to `inbox.notion.dueDateProperty`.

   **10.3 Reminder configuration (one-time manual step)**
   - Emit this instruction verbatim:
     ```
     📅 One-time Notion setup needed for native reminders:
        1. Open your task database in Notion.
        2. Click the "마감일" property header.
        3. Click "Edit property".
        4. Toggle on "Remind me".
        5. Set "On day at 9am" (or your preferred reminder offset).

        You can skip this — the plugin's morning Chat ping will still surface
        overdue + due-today tasks regardless.
     ```

   **10.4 Chat space IDs**
   - Ask using AskUserQuestion: "Which Chat space IDs should the scan watch? (comma-separated, or Enter for DMs only)". Save to `inbox.sources.chat.spaceIds`.

   **10.5 Flip the master switch**
   - Update `~/.codepresso/config.json` to set `inbox.enabled: true`.
   - Emit `✅ Inbox scan enabled. Run /codepresso:scan-inbox to try it now, or wait for tomorrow morning.`
</Steps>

<Tool_Usage>
- Use `Bash` for running `gh auth status` and `gh pr list`
- Use `AskUserQuestion` for preference gathering
- Use `Write` for config files
</Tool_Usage>

<Examples>
<Good>
User: "setup codepresso"
Action: Run full interactive wizard
</Good>
<Good>
User: "configure codepresso for this project"
Action: Run wizard focused on per-project config
</Good>
</Examples>

## AWS MFA session (optional)

If the team enforces MFA on AWS access, offer to configure the credential_process bridge:

1. Confirm a virtual TOTP MFA device is registered for the user's IAM user (passkey alone is not enough for CLI).
2. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/aws-cli.mjs" setup`
   - This backs up `~/.aws/credentials` and `~/.aws/config` (`.codepresso.bak`), relocates the `[default]` long-term key to `[codepresso-source]`, writes a `[default]` `credential_process` profile, detects the MFA serial, and flips `aws.enabled`.
3. Report the result. If `mfaSerial` is null, tell the user to register a TOTP and re-run.

<Final_Checklist>
- [ ] `gh` CLI authenticated
- [ ] Global config written to `~/.codepresso/config.json`
- [ ] PR detection works for current branch
- [ ] Notion configured (if requested)
- [ ] Notion user identity set (userId and displayName in config)
- [ ] Sprint databases configured (if requested): sprint, epic, task IDs
- [ ] Notion task workflow decided (`notion.taskWorkflow.enabled`, default false); preferences set only if enabled (autoTransition, epicAutoComplete, prTitleFormat)
- [ ] MCP tool permissions configured in `.claude/settings.local.json`
- [ ] Epic PRD configuration set (if requested)
- [ ] Google Chat daily greeting configured (if requested): gws CLI authenticated, spaceId set
- [ ] Inbox scan configured (if requested): Gmail authenticated, Notion due-date property verified, Chat space IDs set, `inbox.enabled: true`
</Final_Checklist>
