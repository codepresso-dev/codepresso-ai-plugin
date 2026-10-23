---
name: candidate-session
description: Investigate why a candidate's live assessment ended early or unexpectedly (응시자 평가 조기 종료/시간 문의) — reads live DB + server logs, judges the cause, and drafts a Google Chat report
---

<Purpose>
Answer "응시자 X가 시험이 N분 만에 끝났다는데?" type inbound in one pass. The script reads the candidate's sessions from the live (opt) Aurora DB via the RDS Data API (read-only `readonly_viewer`, fixed SELECTs), pulls their CloudWatch timeline from `/aws/ecs/main-backend-opt`, classifies the end cause, and emits a Google Chat–formatted report. No bastion, tunnel, or psql needed.
</Purpose>

<Use_When>
- Slash command `/codepresso:candidate-session <email> [assessmentId]`
- "응시자 a@b.com 평가가 10분 만에 종료됐대", "시험이 갑자기 끝났대", "응시 시간이 짧았대", "이 응시자 응시 기록 확인해줘"
- Any live candidate complaint about assessment start/end time, remaining time, or forced submission
</Use_When>

<Do_Not_Use_When>
- Stage/dev environments (the CLI targets live opt only)
- Platform-wide outage triage (use `codepresso:oncall-runbook`)
- Changing data (extending time, reopening a window) — this skill is read-only
</Do_Not_Use_When>

## How the platform ends a session (backend/main)
- Remaining time = min(time limit + extensions, assessment window close − now). A candidate who starts 8 minutes before the window closes gets 8 minutes, even with a 60-minute limit. The start page shows a deadline popup in that case (`leftTimeShorterThanDuration`).
- Every end path sets `user_map_custom_assessment.status='COMPLETED'` and `ended_at=now()`. Paths: candidate finish button, client timer reaching 0 (both browser `PUT /v2/assessments/{id}/status?status=COMPLETED`), per-user Quartz deadline job, window-close Quartz job, `resume()` after the window passed.
- Proctoring events (tab switch, multi-monitor, copy) never end a session. A 401 or device change sends the candidate back to the start page but leaves the session `IN_PROGRESS`.
- DB timestamps are KST (`timestamp without time zone`).

<Steps>
1. Run the investigation (add `--assessment <id>` if the user named one; otherwise the most recently started session is the focus):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/candidate-session-cli.mjs" investigate --email <EMAIL> [--assessment <ID>]
   ```
   - `error: AWS_AUTH` → follow `codepresso:aws-login`, then rerun.
   - `user: null` → no candidate with that email on live. Report that and stop.
   - `assessmentNotFound: true` → the candidate has no session for that assessment. List the sessions they do have.

2. Read the JSON:
   - `sessions[].verdict`:
     | verdict | meaning |
     |---|---|
     | `WINDOW_CLOSE` | Ended at window close, which came before the time limit. Normal behavior. |
     | `TIME_LIMIT` | Used the full limit (+ extensions). Normal behavior. |
     | `EARLY_SUBMIT` | Ended >60s before the effective deadline. Candidate submit or another cause. |
     | `ENDED_AFTER_DEADLINE` | Ended >60s after the deadline. Anomaly. |
     | `NOT_COMPLETED` | Not completed (`status` shows where they are). |
   - `availableSec` is the time the candidate actually had; `elapsedSec` is the time they used; `windowCapped` means the window close cut the limit short.
   - `completionSource` (focus session): `CLIENT_SUBMIT` = the browser submitted (timer hit 0 or finish button), `WINDOW_CLOSE_JOB` / `DEADLINE_JOB` = server Quartz job, `UNKNOWN` = no completion line in logs.
   - `timeline[]`: `PAGE_ENTRY` (start page provision check), `COMPLETION`, `WINDOW_JOB`, `DEADLINE_JOB`, `ERROR`.
   - `cohortEndedAtWindowClose`: other candidates of the same assessment who ended within ±60s of the window close.

3. If the verdict is `EARLY_SUBMIT`, `ENDED_AFTER_DEADLINE`, or `completionSource` is `UNKNOWN`, dig further before concluding:
   - `ERROR` entries in the timeline
   - `CLIENT_SUBMIT` + `EARLY_SUBMIT` with no errors → most likely the candidate pressed finish; say so as an inference, not a fact
   - For another session, rerun with `--assessment <id>`
   - Widen with `aws logs filter-log-events --log-group-name /aws/ecs/main-backend-opt --region ap-northeast-2` around `ended_at` if needed

4. Generate the Google Chat draft:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/candidate-session-cli.mjs" investigate --email <EMAIL> [--assessment <ID>] --format chat
   ```
   Present it inside a code block so the user can copy it verbatim. Append a `*응대 / 다음 단계*` section written from the verdict:
   - `WINDOW_CLOSE`: started X minutes before close → policy-correct. A retake needs the customer admin (org `organizationId`) to reopen/extend the window or re-invite.
   - `TIME_LIMIT`: full time used → normal.
   - `EARLY_SUBMIT` / `ENDED_AFTER_DEADLINE`: state what the logs prove and what is still open.
   Google Chat formatting only: `*bold*`, `_italic_`, `` `code` ``, `•` bullets. No tables or `#` headers.

5. Reply to the user in Korean: conclusion first, then the evidence (DB rows + log lines) and the chat block.
</Steps>

## Limits
- `readonly_viewer` cannot read `user_map_custom_assessment_history`, `custom_assessment_user_action`, or `assessment_time_extension_log`. Proctoring events and the extension audit trail are not available here.
- Whether the candidate saw the start-page deadline popup is not logged server-side. Never claim they did.
- The tool covers the Seoul live cluster and `/aws/ecs/main-backend-opt` only.

<Tool_Usage>
- `Bash` for the CLI (AWS CLI with the codepresso MFA session underneath)
- No writes, no DB tunnels
</Tool_Usage>
