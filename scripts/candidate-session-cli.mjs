#!/usr/bin/env node
// Codepresso candidate-session CLI: why did a candidate's assessment end when it did?
// Usage: node candidate-session-cli.mjs investigate --email <email> [--assessment <id>] [--no-logs] [--format json|chat]
// Read-only: fixed SELECTs via the RDS Data API as `readonly_viewer`, plus CloudWatch filter-log-events.
import { execFileSync } from 'node:child_process';
import { MFA_SIGNATURES } from './lib/aws-session.mjs';
import {
  analyzeSession,
  pickFocusSession,
  buildLogFilterPattern,
  classifyLogEvents,
  completionSource,
  buildChatReport,
} from './lib/candidate-session.mjs';

// Live (opt) — Seoul Aurora primary (Data API enabled: infra/opt/main.tf `enable_http_endpoint = true`).
const ENV = {
  label: 'Live',
  region: 'ap-northeast-2',
  clusterArn: 'arn:aws:rds:ap-northeast-2:204573508773:cluster:codepresso-global',
  secretArn: 'arn:aws:secretsmanager:ap-northeast-2:204573508773:secret:opt/rds-proxy-C5vVYH',
  database: 'global_seoul',
  logGroup: '/aws/ecs/main-backend-opt',
};

const LOG_LEAD_MS = 15 * 60 * 1000;
const LOG_TAIL_MS = 5 * 60 * 1000;

const SESSIONS_SQL = `
select u.id as user_id, u.uuid::text as user_uuid, u.email,
       umca.id as umca_id, umca.custom_assessment_id as assessment_id, umca.status,
       umca.started_at::text as started_at, umca.ended_at::text as ended_at,
       umca.extension_count, umca.extension_total_seconds,
       ca.title, ca.duration, ca.started_at::text as window_start, ca.ended_at::text as window_end,
       ca.owner_organization_id,
       (select count(*) from main.user_map_custom_assessment o
         where o.custom_assessment_id = ca.id and o.id <> umca.id
           and o.ended_at between ca.ended_at - interval '60 seconds' and ca.ended_at + interval '60 seconds'
       ) as cohort_ended_at_window_close
from main."user" u
join main.user_map_custom_assessment umca on umca.user_id = u.id
join main.custom_assessment ca on ca.id = umca.custom_assessment_id
where lower(u.email) = lower(:email)
order by umca.started_at desc nulls last, umca.created_at desc`;

class AwsAuthError extends Error {}

function aws(args) {
  try {
    return JSON.parse(execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }));
  } catch (e) {
    const stderr = String(e.stderr || e.message || '');
    if (MFA_SIGNATURES.test(stderr) || /no valid AWS MFA session|ExpiredToken/i.test(stderr)) throw new AwsAuthError(stderr.trim());
    throw new Error(stderr.trim() || String(e));
  }
}

function querySessions(email) {
  const res = aws([
    'rds-data', 'execute-statement',
    '--region', ENV.region,
    '--resource-arn', ENV.clusterArn,
    '--secret-arn', ENV.secretArn,
    '--database', ENV.database,
    '--sql', SESSIONS_SQL,
    '--parameters', JSON.stringify([{ name: 'email', value: { stringValue: email } }]),
    '--format-records-as', 'JSON',
  ]);
  return JSON.parse(res.formattedRecords || '[]');
}

function queryLogs({ userUuid, userId, session }) {
  const end = session.endedAt ?? Date.now();
  const res = aws([
    'logs', 'filter-log-events',
    '--region', ENV.region,
    '--log-group-name', ENV.logGroup,
    '--start-time', String(session.startedAt - LOG_LEAD_MS),
    '--end-time', String(end + LOG_TAIL_MS),
    '--filter-pattern', buildLogFilterPattern({ userUuid, userId, assessmentId: session.assessmentId }),
    '--max-items', '2000',
  ]);
  return { events: res.events || [], truncated: Boolean(res.NextToken) };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function cmdInvestigate() {
  const email = arg('--email');
  if (!email || !email.includes('@')) {
    console.log(JSON.stringify({ ok: false, error: 'BAD_ARGS', message: '--email <address> is required' }));
    process.exit(2);
  }
  const assessmentArg = arg('--assessment');
  if (assessmentArg !== undefined && !/^\d+$/.test(assessmentArg)) {
    console.log(JSON.stringify({ ok: false, error: 'BAD_ARGS', message: '--assessment must be a numeric custom_assessment id' }));
    process.exit(2);
  }
  const withLogs = !process.argv.includes('--no-logs');
  const format = arg('--format') || 'json';

  const rows = querySessions(email);
  const sessions = rows.map((r) => analyzeSession(r));
  const user = rows[0] ? { id: Number(rows[0].user_id), uuid: rows[0].user_uuid, email: rows[0].email } : null;
  const focus = pickFocusSession(sessions, assessmentArg);

  let timeline = [];
  let logsTruncated = false;
  const logsChecked = Boolean(withLogs && user && focus && focus.startedAt != null);
  if (logsChecked) {
    const { events, truncated } = queryLogs({ userUuid: user.uuid, userId: user.id, session: focus });
    timeline = classifyLogEvents(events, { userId: user.id, assessmentId: focus.assessmentId });
    logsTruncated = truncated;
  }

  if (format === 'chat') {
    console.log(buildChatReport({ envLabel: ENV.label, email, userId: user?.id, sessions, focus, timeline, logsChecked }));
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    env: ENV.label,
    user,
    focusAssessmentId: focus?.assessmentId ?? null,
    assessmentNotFound: assessmentArg !== undefined && !focus,
    sessions,
    completionSource: logsChecked ? completionSource(timeline) : null,
    timeline,
    logsChecked,
    logsTruncated,
  }, null, 2));
}

const handlers = { investigate: cmdInvestigate };
const cmd = process.argv[2];
if (!handlers[cmd]) {
  console.error(`Unknown command: ${cmd}. Usage: investigate --email <email> [--assessment <id>] [--no-logs] [--format json|chat]`);
  process.exit(2);
}
try {
  handlers[cmd]();
} catch (e) {
  if (e instanceof AwsAuthError) {
    console.log(JSON.stringify({ ok: false, error: 'AWS_AUTH', message: 'AWS MFA session missing or expired — run /codepresso:aws-login, then retry.' }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: false, error: 'FAILED', message: String(e.message || e).slice(0, 2000) }));
  process.exit(1);
}
