import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseKst,
  analyzeSession,
  pickFocusSession,
  classifyLogEvents,
  completionSource,
} from '../../scripts/lib/candidate-session.mjs';

function row(overrides) {
  return {
    umca_id: 1,
    assessment_id: 16699,
    title: 'T',
    status: 'COMPLETED',
    duration: 3600,
    extension_count: 0,
    extension_total_seconds: 0,
    window_start: '2026-10-21 00:00:00',
    window_end: '2026-10-22 23:59:00',
    started_at: '2026-10-22 20:00:00',
    ended_at: '2026-10-22 21:00:00',
    cohort_ended_at_window_close: 0,
    ...overrides,
  };
}

test('parseKst reads DB timestamps as KST and keeps millisecond precision', () => {
  assert.strictEqual(parseKst('2026-10-22 23:59:02.30473'), Date.parse('2026-10-22T14:59:02.304Z'));
  assert.strictEqual(parseKst('2026-10-22 23:51:18.005'), Date.parse('2026-10-22T14:51:18.005Z'));
  assert.strictEqual(parseKst('2026-10-22 23:59:00'), Date.parse('2026-10-22T14:59:00Z'));
  assert.strictEqual(parseKst(null), null);
  assert.throws(() => parseKst('22/10/2026'), /Unrecognized/);
});

test('started 8 minutes before window close and ended there → WINDOW_CLOSE with capped available time', () => {
  const s = analyzeSession(row({ started_at: '2026-10-22 23:51:18.005', ended_at: '2026-10-22 23:59:02.30473' }));
  assert.strictEqual(s.verdict, 'WINDOW_CLOSE');
  assert.strictEqual(s.windowCapped, true);
  assert.strictEqual(Math.round(s.availableSec), 462);
  assert.strictEqual(Math.round(s.elapsedSec), 464);
});

test('full duration used inside the window → TIME_LIMIT', () => {
  assert.strictEqual(analyzeSession(row({ ended_at: '2026-10-22 21:00:01' })).verdict, 'TIME_LIMIT');
  assert.strictEqual(analyzeSession(row({ ended_at: '2026-10-22 20:59:31' })).verdict, 'TIME_LIMIT');
});

test('extension moves the deadline: ending at start+duration+extension is TIME_LIMIT, not late', () => {
  const s = analyzeSession(row({ extension_count: 1, extension_total_seconds: 600, ended_at: '2026-10-22 21:10:00' }));
  assert.strictEqual(s.verdict, 'TIME_LIMIT');
  assert.strictEqual(s.availableSec, 4200);
  // Without the extension that same end time is past the deadline.
  assert.strictEqual(analyzeSession(row({ ended_at: '2026-10-22 21:10:00' })).verdict, 'ENDED_AFTER_DEADLINE');
});

test('ending well before the effective deadline → EARLY_SUBMIT; tolerance boundary is 60s', () => {
  assert.strictEqual(analyzeSession(row({ ended_at: '2026-10-22 20:30:00' })).verdict, 'EARLY_SUBMIT');
  assert.strictEqual(analyzeSession(row({ ended_at: '2026-10-22 20:59:00' })).verdict, 'TIME_LIMIT');
  assert.strictEqual(analyzeSession(row({ ended_at: '2026-10-22 20:58:59' })).verdict, 'EARLY_SUBMIT');
  // Window-capped session submitted early is still EARLY_SUBMIT.
  assert.strictEqual(analyzeSession(row({ started_at: '2026-10-22 23:30:00', ended_at: '2026-10-22 23:40:00' })).verdict, 'EARLY_SUBMIT');
});

test('non-completed sessions are NOT_COMPLETED regardless of timestamps', () => {
  assert.strictEqual(analyzeSession(row({ status: 'IN_PROGRESS', ended_at: null })).verdict, 'NOT_COMPLETED');
  const ready = analyzeSession(row({ status: 'READY', started_at: null, ended_at: null }));
  assert.strictEqual(ready.verdict, 'NOT_COMPLETED');
  assert.strictEqual(ready.availableSec, null);
});

test('pickFocusSession prefers the explicit assessment, else the most recently started', () => {
  const a = analyzeSession(row({ assessment_id: 1, started_at: '2026-10-22 18:00:00', ended_at: '2026-10-22 18:30:00' }));
  const b = analyzeSession(row({ assessment_id: 2, started_at: '2026-10-22 23:00:00', ended_at: '2026-10-22 23:30:00' }));
  const c = analyzeSession(row({ assessment_id: 3, status: 'INVITED', started_at: null, ended_at: null }));
  assert.strictEqual(pickFocusSession([c, a, b]).assessmentId, 2);
  assert.strictEqual(pickFocusSession([c, a, b], '1').assessmentId, 1);
  assert.strictEqual(pickFocusSession([a, b], 99), null);
});

const T = Date.parse('2026-10-22T14:59:02Z');
const line = (thread, msg, uid = '') => `2026-10-22 23:59:02 [${thread}] WARN  i.c.global.grading.TaskGraderService - [cid: uid:${uid} traceID= spanID=] ${msg}`;

test('classifyLogEvents keeps only lines for this user+assessment', () => {
  const events = [
    { timestamp: T - 500000, message: '2026-10-22 23:50:08 [http-nio-8450-exec-7] INFO  i.c.g.c.service.ProvisionService - [cid:x uid:u] [provision] assessment=16699 READY' },
    { timestamp: T - 400000, message: '2026-10-22 23:51:08 [http-nio-8450-exec-7] INFO  i.c.g.c.service.ProvisionService - [cid:x uid:u] [provision] assessment=1669 READY' },
    { timestamp: T, message: line('http-nio-8450-exec-10', 'TaskGraderService.grade called. domain: CUSTOM_ASSESSMENT, domainId: 16699, userId: 22219, taskIds: [1]') },
    { timestamp: T, message: line('schedulerFactoryBean_Worker-5', 'TaskGraderService.grade called. domain: CUSTOM_ASSESSMENT, domainId: 16699, userId: 21846, taskIds: [1]') },
    { timestamp: T, message: '2026-10-22 23:59:00 [schedulerFactoryBean_Worker-1] INFO  x.CompleteAssessmentJob - [cid: uid:] Completing assessment 166990' },
    { timestamp: T, message: '[ACCESS] method=PUT uri=/v2/assessments/16699/status status=200' },
  ];
  const tl = classifyLogEvents(events, { userId: 22219, assessmentId: 16699 });
  assert.deepStrictEqual(tl.map((e) => e.kind), ['PAGE_ENTRY', 'COMPLETION']);
  assert.strictEqual(tl[1].thread, 'http-nio-8450-exec-10');
});

test('completionSource distinguishes browser submit from server jobs', () => {
  const grade = (thread) => ({ timestamp: T, message: line(thread, 'TaskGraderService.grade called. domain: CUSTOM_ASSESSMENT, domainId: 16699, userId: 22219, taskIds: [1]') });
  const windowJob = { timestamp: T - 1000, message: '2026-10-22 23:59:00 [schedulerFactoryBean_Worker-5] INFO  x.CompleteAssessmentJob - [cid: uid:] Completing assessment 16699' };
  const deadlineJob = { timestamp: T - 1000, message: '2026-10-22 23:59:00 [schedulerFactoryBean_Worker-2] INFO  x.CompleteUserAssessmentJob - [cid: uid:] User 22219 completed assessment 16699' };
  const ctx = { userId: 22219, assessmentId: 16699 };

  assert.strictEqual(completionSource(classifyLogEvents([windowJob, grade('http-nio-8450-exec-10')], ctx)), 'CLIENT_SUBMIT');
  assert.strictEqual(completionSource(classifyLogEvents([windowJob, grade('schedulerFactoryBean_Worker-5')], ctx)), 'WINDOW_CLOSE_JOB');
  assert.strictEqual(completionSource(classifyLogEvents([deadlineJob, grade('schedulerFactoryBean_Worker-2')], ctx)), 'DEADLINE_JOB');
  assert.strictEqual(completionSource(classifyLogEvents([windowJob], ctx)), 'UNKNOWN');
});
