---
name: aws-login
description: Refresh the short-lived AWS MFA session for the Codepresso plugin. Use when an AWS call (cloud-dev MCP, `aws` CLI, or another AWS MCP) is blocked with MFA_REQUIRED / explicit-deny / ExpiredToken, or when the user asks to "aws login" / "refresh aws session" / "MFA 세션 갱신".
---

# aws-login

Mint a 4-hour MFA-backed AWS session and cache it so every AWS channel works.

## When to invoke
- A tool returned `MFA_REQUIRED`, or a `aws` command failed with `explicit deny` / `ExpiredToken` / `CredentialsProviderError`.
- The user explicitly asks to refresh / log in.

## Procedure

1. Check status:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/aws-cli.mjs" status
   ```
   - If `enabled` is false → tell the user to run `/codepresso:setup` first (AWS MFA not configured). Stop.
   - If `sessionValid` is true → no refresh needed; tell the user and retry their original action. A non-null `credProcessRepaired` means `~/.aws/config` pointed at a deleted plugin version and was just repointed — that was the cause of the failure.
   - If `mfaSerial` is null → tell the user to register a virtual TOTP device, then run setup again. Stop.

2. Ask the user for their **6-digit MFA code** (use AskUserQuestion or a direct prompt). Do not store it.

3. Refresh:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/aws-cli.mjs" refresh --token-code <CODE>
   ```
   - `ok:true` → session refreshed (report only the expiration, never secret values). Retry the user's original AWS action.
   - `error:BAD_OR_DENIED_CODE` → ask for a fresh code and retry (max 2 attempts).
   - `error:TEMP_SESSION` → tell the user to run from a normal shell (not inside temporary credentials).
   - `error:NO_MFA_SERIAL` → register a virtual TOTP, then `/codepresso:setup`.

## Never
- Never echo `SecretAccessKey` / `SessionToken` / the MFA code.
- Never run `setup` automatically — it edits `~/.aws`. Only `/codepresso:setup` does that with user intent.
