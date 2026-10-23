// Pure helpers for the candidate-session skill: KST time handling, session verdicts,
// CloudWatch log classification, and the Google Chat report. No I/O here.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DEFAULT_TOLERANCE_SEC = 60;

// backend/main stores LocalDateTime in KST (JVM default zone Asia/Seoul) as `timestamp without time zone`.
export function parseKst(text) {
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(String(text).trim());
  if (!m) throw new Error(`Unrecognized timestamp: ${text}`);
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms) - KST_OFFSET_MS;
}

export function formatKst(epochMs, { seconds = true, date = true } = {}) {
  if (epochMs == null) return '-';
  const iso = new Date(epochMs + KST_OFFSET_MS).toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  const md = `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
  const hm = seconds ? iso.slice(11, 19) : iso.slice(11, 16);
  return date ? `${md} ${hm}` : hm;
}

export function formatDuration(totalSec) {
  if (totalSec == null) return '-';
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h) parts.push(`${h}시간`);
  if (m) parts.push(`${m}분`);
  if (sec || parts.length === 0) parts.push(`${sec}초`);
  return parts.join(' ');
}

// Verdict codes:
//   WINDOW_CLOSE          ended at the assessment window close, which came before the time limit
//   TIME_LIMIT            ended when duration + extensions ran out
//   EARLY_SUBMIT          ended before the effective deadline (candidate submit or another cause)
//   ENDED_AFTER_DEADLINE  ended later than the effective deadline (anomaly)
//   NOT_COMPLETED         status is not COMPLETED
export function analyzeSession(row, { toleranceSec = DEFAULT_TOLERANCE_SEC } = {}) {
  const startedAt = parseKst(row.started_at);
  const endedAt = parseKst(row.ended_at);
  const windowStart = parseKst(row.window_start);
  const windowEnd = parseKst(row.window_end);
  const durationSec = Number(row.duration) || 0;
  const extensionSec = Number(row.extension_total_seconds) || 0;

  const limitEnd = startedAt != null && durationSec > 0 ? startedAt + (durationSec + extensionSec) * 1000 : null;
  const effectiveEnd = startedAt == null ? null : limitEnd == null ? windowEnd : Math.min(limitEnd, windowEnd);
  const windowCapped = startedAt != null && (limitEnd == null || windowEnd < limitEnd);
  const availableSec = effectiveEnd == null ? null : (effectiveEnd - startedAt) / 1000;
  const elapsedSec = startedAt != null && endedAt != null ? (endedAt - startedAt) / 1000 : null;

  let verdict;
  if (row.status !== 'COMPLETED' || startedAt == null || endedAt == null) {
    verdict = 'NOT_COMPLETED';
  } else {
    const deltaSec = (endedAt - effectiveEnd) / 1000;
    if (Math.abs(deltaSec) <= toleranceSec) verdict = windowCapped ? 'WINDOW_CLOSE' : 'TIME_LIMIT';
    else if (deltaSec < 0) verdict = 'EARLY_SUBMIT';
    else verdict = 'ENDED_AFTER_DEADLINE';
  }

  return {
    umcaId: Number(row.umca_id),
    assessmentId: Number(row.assessment_id),
    title: row.title,
    organizationId: row.owner_organization_id == null ? null : Number(row.owner_organization_id),
    status: row.status,
    durationSec,
    extensionCount: Number(row.extension_count) || 0,
    extensionSec,
    windowStart,
    windowEnd,
    startedAt,
    endedAt,
    limitEnd,
    effectiveEnd,
    windowCapped,
    availableSec,
    elapsedSec,
    cohortEndedAtWindowClose: Number(row.cohort_ended_at_window_close) || 0,
    verdict,
  };
}

// Pick the session the report focuses on: explicit assessment id, else the most recently started one.
export function pickFocusSession(sessions, assessmentId) {
  if (assessmentId != null) return sessions.find((s) => s.assessmentId === Number(assessmentId)) || null;
  const started = sessions.filter((s) => s.startedAt != null).sort((a, b) => b.startedAt - a.startedAt);
  return started[0] || sessions[0] || null;
}

// CloudWatch filter pattern covering every line that marks this candidate's progress in /aws/ecs/main-backend-opt.
// Quartz worker lines carry an empty MDC uid, so the numeric ids are matched too.
export function buildLogFilterPattern({ userUuid, userId, assessmentId }) {
  return [
    `?"${userUuid}"`,
    `?"domainId: ${assessmentId}, userId: ${userId},"`,
    `?"User ${userId} completed assessment ${assessmentId}"`,
    `?"Completing assessment ${assessmentId}"`,
  ].join(' ');
}

const LINE_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] (\w+)\s+(\S+) - (?:\[[^\]]*\] )?(.*)$/s;

// Classify raw CloudWatch events ({ timestamp, message }) into timeline entries for one session.
export function classifyLogEvents(events, { userId, assessmentId }) {
  const out = [];
  for (const ev of events || []) {
    const raw = String(ev.message || '').trim();
    const m = LINE_RE.exec(raw);
    const thread = m ? m[2] : null;
    const level = m ? m[3] : null;
    const text = m ? m[5] : raw;
    let kind = null;
    let mm;
    if ((mm = /\[provision\] assessment=(\d+)/.exec(text))) {
      if (Number(mm[1]) === assessmentId) kind = 'PAGE_ENTRY';
    } else if ((mm = /TaskGraderService\.grade called\. domain: CUSTOM_ASSESSMENT, domainId: (\d+), userId: (\d+)/.exec(text))) {
      if (Number(mm[1]) === assessmentId && Number(mm[2]) === userId) kind = 'COMPLETION';
    } else if ((mm = /^User (\d+) completed assessment (\d+)\b/.exec(text))) {
      if (Number(mm[1]) === userId && Number(mm[2]) === assessmentId) kind = 'DEADLINE_JOB';
    } else if ((mm = /^Completing assessment (\d+)\b/.exec(text))) {
      if (Number(mm[1]) === assessmentId) kind = 'WINDOW_JOB';
    } else if (level === 'ERROR') {
      kind = 'ERROR';
    }
    if (!kind) continue;
    out.push({ timestamp: ev.timestamp, kind, thread, level, message: text.length > 300 ? `${text.slice(0, 300)}…` : text });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

// Who issued the completion: the candidate's browser (HTTP PUT status=COMPLETED) or a server Quartz job.
export function completionSource(timeline) {
  const completion = (timeline || []).find((e) => e.kind === 'COMPLETION');
  if (!completion) return 'UNKNOWN';
  if (completion.thread && completion.thread.startsWith('http-nio')) return 'CLIENT_SUBMIT';
  if (timeline.some((e) => e.kind === 'WINDOW_JOB')) return 'WINDOW_CLOSE_JOB';
  if (timeline.some((e) => e.kind === 'DEADLINE_JOB')) return 'DEADLINE_JOB';
  return 'SERVER_JOB';
}

const VERDICT_TEXT = {
  WINDOW_CLOSE: '평가 기간 마감 시각에 자동 종료 (정상 동작)',
  TIME_LIMIT: '제한시간 소진으로 자동 종료 (정상 동작)',
  EARLY_SUBMIT: '제한시간 전에 종료 — 응시자 제출 또는 다른 원인. 로그 확인 필요',
  ENDED_AFTER_DEADLINE: '마감 시각 이후에 종료 — 비정상, 추가 조사 필요',
  NOT_COMPLETED: '아직 완료되지 않음',
};

const SOURCE_TEXT = {
  CLIENT_SUBMIT: '응시자 브라우저가 제출 (타이머 0 자동 제출 또는 종료 버튼)',
  WINDOW_CLOSE_JOB: '서버의 평가 기간 마감 job이 종료 처리',
  DEADLINE_JOB: '서버의 개인 제한시간 job이 종료 처리',
  SERVER_JOB: '서버 job이 종료 처리',
  UNKNOWN: '로그에서 종료 주체 확인 불가',
};

export function verdictText(code) {
  return VERDICT_TEXT[code] || code;
}

export function sourceText(code) {
  return SOURCE_TEXT[code] || code;
}

function conclusion(s) {
  const lead = `*${s.title}* (id ${s.assessmentId})`;
  switch (s.verdict) {
    case 'WINDOW_CLOSE':
      return `${lead}: 시스템 장애는 아닌 것으로 보입니다. 응시자가 평가 기간 마감(${formatKst(s.windowEnd, { seconds: false })}) ${formatDuration((s.windowEnd - s.startedAt) / 1000)} 전에 시작해서, 마감 시각에 정책대로 자동 종료됐습니다. 실제 응시 시간은 *${formatDuration(s.elapsedSec)}*입니다 (제한시간 ${formatDuration(s.durationSec)}).`;
    case 'TIME_LIMIT':
      return `${lead}: 시스템 장애는 아닌 것으로 보입니다. 제한시간 ${formatDuration(s.durationSec + s.extensionSec)}을 모두 사용해서 자동 종료됐습니다. 실제 응시 시간은 *${formatDuration(s.elapsedSec)}*입니다.`;
    case 'EARLY_SUBMIT':
      return `${lead}: 주어진 시간(${formatDuration(s.availableSec)})보다 이른 *${formatDuration(s.elapsedSec)}* 만에 종료됐습니다. 종료 주체를 로그로 확인해야 합니다.`;
    case 'ENDED_AFTER_DEADLINE':
      return `${lead}: 마감 예정 시각(${formatKst(s.effectiveEnd)})보다 늦은 ${formatKst(s.endedAt)}에 종료됐습니다. 비정상 동작이라 추가 조사가 필요합니다.`;
    default:
      return `${lead}: 아직 완료되지 않았습니다 (상태 ${s.status}).`;
  }
}

function sessionLines(s) {
  const lines = [`• *${s.title}* (id ${s.assessmentId})`];
  lines.push(`   - 제한시간 ${formatDuration(s.durationSec)} / 평가 기간 ${formatKst(s.windowStart, { seconds: false })} ~ *${formatKst(s.windowEnd, { seconds: false })}*`);
  if (s.startedAt != null) {
    const end = s.endedAt != null ? `${formatKst(s.endedAt)} (${formatDuration(s.elapsedSec)})` : '진행 중';
    lines.push(`   - 시작 *${formatKst(s.startedAt)}* → 종료 ${end}`);
  } else {
    lines.push(`   - 미시작 (상태 ${s.status})`);
  }
  lines.push(`   - 시간 연장 ${s.extensionCount}회 / 판정: ${verdictText(s.verdict)}`);
  return lines;
}

const TIMELINE_LABEL = {
  PAGE_ENTRY: '시작 페이지 진입',
  WINDOW_JOB: '서버 평가 기간 마감 job 실행',
  DEADLINE_JOB: '서버 개인 제한시간 job 실행',
  ERROR: '에러 로그',
};

function timelineLines(focus, timeline) {
  const rows = [];
  let pageEntrySeen = false;
  for (const e of timeline) {
    // Keep only the first start-page entry; the page polls provision status repeatedly.
    if (e.kind === 'PAGE_ENTRY') {
      if (pageEntrySeen || (focus.startedAt != null && e.timestamp > focus.startedAt)) continue;
      pageEntrySeen = true;
    }
    if (e.kind === 'COMPLETION') {
      rows.push({ t: e.timestamp, text: `제출 처리 → 채점 요청: ${sourceText(completionSource(timeline))}` });
    } else if (e.kind === 'ERROR') {
      rows.push({ t: e.timestamp, text: `${TIMELINE_LABEL.ERROR}: ${e.message.slice(0, 120)}` });
    } else {
      rows.push({ t: e.timestamp, text: TIMELINE_LABEL[e.kind] });
    }
  }
  if (focus.startedAt != null) rows.push({ t: focus.startedAt, text: '시험 시작 (DB started_at)' });
  if (focus.endedAt != null) rows.push({ t: focus.endedAt, text: '종료 기록 (DB ended_at)' });
  rows.sort((a, b) => a.t - b.t);
  const lines = rows.map((r) => `• ${formatKst(r.t)} ${r.text}`);
  if (focus.verdict === 'WINDOW_CLOSE' && focus.cohortEndedAtWindowClose > 0) {
    lines.push(`• 같은 평가의 다른 응시자 ${focus.cohortEndedAtWindowClose}명도 마감 시각 ±${DEFAULT_TOLERANCE_SEC}초 안에 함께 종료`);
  }
  return lines;
}

// Google Chat message (supports *bold*, `code`, plain bullets; no tables/headers).
export function buildChatReport({ envLabel = 'Live', email, userId, sessions, focus, timeline, logsChecked }) {
  const out = [`*[${envLabel}] ${email} 응시 내역 확인*`, ''];
  if (!sessions.length) {
    out.push('해당 이메일로 응시 기록을 찾지 못했습니다.');
    return out.join('\n');
  }
  if (focus) out.push('*결론*', conclusion(focus), '');
  out.push(`*응시 내역* (user_id ${userId})`);
  for (const s of sessions) out.push(...sessionLines(s));
  if (focus && focus.startedAt != null) {
    out.push('', `*타임라인* (${focus.title}, KST)`);
    out.push(...timelineLines(focus, logsChecked ? timeline : []));
    if (!logsChecked) out.push('• 서버 로그는 조회하지 않음 (--no-logs)');
  }
  return out.join('\n');
}
