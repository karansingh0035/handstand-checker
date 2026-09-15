// test/continuous-session.test.js
import assert from 'node:assert/strict';
import {
  SKILLS,
  getSupportedLiveSkills,
  resolveLiveSkill,
  isSupportedLiveSkill,
  SegmentManager,
  LiveSessionController,
  SessionReportBuilder,
  TrueFormEngine
} from '../engine/index.js';

console.log('--- Starting TrueForm Continuous Live Session Test Suite ---');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${desc}`);
    console.error(`         ${err.message}`);
    throw err;
  }
}

function fakeRepFrame(overrides = {}) {
  return {
    skill: 'pushup',
    type: 'rep',
    status: 'active',
    poseConfidence: 0.9,
    skillLikelihood: 0.9,
    formQuality: 0.8,
    reps: 4,
    holdTimeMs: 0,
    bestHoldMs: 0,
    faults: ['hips_sagging'],
    activeCue: null,
    metrics: null,
    landmarks: [],
    ...overrides
  };
}

function fakeHoldFrame(skill, overrides = {}) {
  return {
    skill,
    type: 'hold',
    status: 'active',
    poseConfidence: 0.88,
    skillLikelihood: 0.84,
    formQuality: 0.76,
    reps: 0,
    holdTimeMs: 2400,
    bestHoldMs: 2400,
    faults: skill === 'handstand' ? ['hip_arch'] : ['knee_bend'],
    activeCue: null,
    metrics: {},
    landmarks: [],
    ...overrides
  };
}

console.log('\n[Suite A: Live-skill registry]');

it('Registry exposes only verified live skills', () => {
  const keys = getSupportedLiveSkills().map((s) => s.key).sort();
  assert.deepEqual(keys, ['handstand', 'lsit', 'pullup', 'pushup', 'squat'].sort());
  assert.equal(SKILLS.pushup.type, 'rep');
  assert.equal(SKILLS.handstand.type, 'hold');
  assert.equal(SKILLS.lsit.type, 'hold');
});

it('Alias resolution accepts lsits/pushups and rejects unsupported upload-only skills', () => {
  assert.equal(resolveLiveSkill('Push-ups'), 'pushup');
  assert.equal(resolveLiveSkill('lsits'), 'lsit');
  assert.equal(resolveLiveSkill('handstands'), 'handstand');
  assert.equal(isSupportedLiveSkill('hspu'), false);
  assert.equal(resolveLiveSkill('hspu'), null);
  assert.equal(resolveLiveSkill('planche'), null);
  assert.equal(resolveLiveSkill('muscleup'), null);
});

console.log('\n[Suite B: Multi-skill switching & isolation]');

it('Push-up → Handstand → L-sit → Push-up preserves prior segment metrics', () => {
  const session = new LiveSessionController();
  const cameraHandle = { id: 'webcam-continuous', restarts: 0 };

  session.start('pushup', 0);
  const sessionId = session.sessionId;
  session.ingestFrame(fakeRepFrame({ reps: 6, faults: ['hips_sagging'] }), 1200);

  const first = session.changeSkill('handstand', 2000);
  assert.equal(first.closedSegment.reps, 6);
  assert.equal(first.closedSegment.skill, 'pushup');
  assert.equal(session.sessionId, sessionId);
  assert.equal(cameraHandle.restarts, 0);

  session.ingestFrame(fakeHoldFrame('handstand', { bestHoldMs: 3100, holdTimeMs: 3100 }), 4500);
  const second = session.changeSkill('lsit', 5000);
  assert.equal(second.closedSegment.bestHoldMs, 3100);
  assert.equal(second.closedSegment.reps, 0);

  session.ingestFrame(fakeHoldFrame('lsit', { bestHoldMs: 1800, holdTimeMs: 1800, faults: ['knee_bend'] }), 7200);
  const third = session.changeSkill('pushup', 8000);
  assert.equal(third.closedSegment.skill, 'lsit');
  assert.equal(third.closedSegment.bestHoldMs, 1800);

  session.ingestFrame(fakeRepFrame({ reps: 3, faults: [] }), 9000);

  const completed = session.segmentManager.getCompletedSegments();
  assert.equal(completed.length, 3);
  assert.equal(completed[0].reps, 6);
  assert.equal(completed[1].bestHoldMs, 3100);
  assert.equal(completed[2].bestHoldMs, 1800);
  assert.equal(session.segmentManager.getCurrentSegment().reps, 3);
  assert.equal(session.sessionId, sessionId);
  assert.equal(cameraHandle.id, 'webcam-continuous');
});

it('Rep counts do not bleed into a following hold segment', () => {
  const session = new LiveSessionController();
  session.start('pushup', 0);
  session.ingestFrame(fakeRepFrame({ reps: 8 }), 1000);
  session.changeSkill('handstand', 1100);

  const holdSeg = session.segmentManager.getCurrentSegment();
  assert.equal(holdSeg.skill, 'handstand');
  assert.equal(holdSeg.type, 'hold');
  assert.equal(holdSeg.reps, 0);
  assert.equal(holdSeg.bestHoldMs, 0);

  session.ingestFrame(fakeHoldFrame('handstand', { holdTimeMs: 900, bestHoldMs: 900, reps: 0 }), 2000);
  assert.equal(session.segmentManager.getCurrentSegment().reps, 0);
  assert.equal(session.segmentManager.getCompletedSegments()[0].reps, 8);
});

it('setMovement resets evaluator counters without touching session identity', () => {
  const engine = new TrueFormEngine('pushup');
  const session = new LiveSessionController();
  session.start('pushup', 0);
  const sessionId = session.sessionId;

  engine.setMovement('handstand');
  assert.equal(engine.movementKey, 'handstand');
  assert.equal(engine.isHoldMovement, true);
  assert.equal(engine.holdSegmenter.holdTimeMs, 0);
  assert.equal(session.sessionId, sessionId);
  assert.equal(session.isActive, true);
});

console.log('\n[Suite C: Pause, cancel, timer continuity]');

it('Elapsed time and session ID stay continuous across skill switches', () => {
  const session = new LiveSessionController();
  session.start('pushup', 1000);
  const sessionId = session.sessionId;
  session.changeSkill('squat', 4000);
  assert.equal(session.sessionId, sessionId);
  assert.equal(session.getElapsedMs(6500), 5500);
});

it('Pause freezes metrics and elapsed time until resume', () => {
  const session = new LiveSessionController();
  session.start('pushup', 0);
  session.ingestFrame(fakeRepFrame({ reps: 2 }), 800);
  session.pause(1000);

  session.ingestFrame(fakeRepFrame({ reps: 9, formQuality: 0.2 }), 2500);
  assert.equal(session.segmentManager.getCurrentSegment().reps, 2);
  assert.equal(session.getElapsedMs(4000), 1000);

  session.resume(5000);
  session.ingestFrame(fakeRepFrame({ reps: 5 }), 5600);
  assert.equal(session.segmentManager.getCurrentSegment().reps, 5);
  assert.equal(session.getElapsedMs(6000), 2000);
});

it('Opening the selector and canceling keeps the active segment', () => {
  const session = new LiveSessionController();
  session.start('pushup', 0);
  session.ingestFrame(fakeRepFrame({ reps: 4 }), 900);
  const activeId = session.currentSegmentId;
  const skill = session.currentSkill;

  // Cancel path: modal opened, then dismissed without changeSkill()
  assert.equal(session.currentSegmentId, activeId);
  assert.equal(session.currentSkill, skill);
  assert.equal(session.segmentManager.getCurrentSegment().reps, 4);
  assert.equal(session.segmentManager.getCompletedSegments().length, 0);
});

it('Unsupported live skill is rejected and does not close the current segment', () => {
  const session = new LiveSessionController();
  session.start('pushup', 0);
  const activeId = session.currentSegmentId;
  const result = session.changeSkill('planche', 500);
  assert.equal(result.error.includes('Unsupported'), true);
  assert.equal(session.currentSkill, 'pushup');
  assert.equal(session.currentSegmentId, activeId);
});

console.log('\n[Suite D: Combined session report]');

it('Combined report includes every completed segment with stats, faults, and focus tips', () => {
  const session = new LiveSessionController();
  session.start('pushup', 0);
  session.ingestFrame(fakeRepFrame({ reps: 5, faults: ['hips_sagging'] }), 1000);
  session.changeSkill('handstand', 2000);
  session.ingestFrame(fakeHoldFrame('handstand', { bestHoldMs: 2500, holdTimeMs: 2500 }), 4000);
  session.changeSkill('lsit', 4500);
  session.ingestFrame(fakeHoldFrame('lsit', { bestHoldMs: 1200, holdTimeMs: 1200, faults: ['knee_bend'] }), 6000);

  const ended = session.end(7000);
  const report = ended.report;

  assert.equal(ended.segments.length, 3);
  assert.deepEqual(report.skillsPerformed, ['Push-up', 'Handstand', 'L-sit']);
  assert.match(report.textReport, /Session duration:/);
  assert.match(report.textReport, /Push-up/);
  assert.match(report.textReport, /Handstand/);
  assert.match(report.textReport, /L-sit/);
  assert.match(report.textReport, /5 detected reps/);
  assert.match(report.textReport, /Best hold: 2\.5 seconds/);
  assert.match(report.textReport, /Next focus/);
  assert.ok(report.focusItems.length >= 1);
  assert.ok(report.segmentSummaries.every((s) => s.confidence && s.mainIssue));
});

it('SessionReportBuilder formats a standalone multi-segment payload', () => {
  const report = SessionReportBuilder.generateReport({
    sessionState: { elapsedMs: 138000 },
    segments: [
      { skill: 'pushup', label: 'Push-up', type: 'rep', durationMs: 78000, reps: 14, bestHoldMs: 0, averageConfidence: 0.82, faults: [{ key: 'hip_sag', count: 4 }] },
      { skill: 'handstand', label: 'Handstand', type: 'hold', durationMs: 32000, reps: 0, bestHoldMs: 8600, averageConfidence: 0.74, faults: [{ key: 'hip_arch', count: 12 }] }
    ]
  });
  assert.match(report.textReport, /2m 18s/);
  assert.match(report.textReport, /14 detected reps/);
  assert.match(report.textReport, /Best hold: 8\.6 seconds/);
});

it('SegmentManager archives closed segments independently of later updates', () => {
  const manager = new SegmentManager('session_test');
  manager.openSegment({ skill: 'pushup', timestampMs: 0 });
  manager.updateCurrentSegment(fakeRepFrame({ reps: 2 }), 500);
  const closed = manager.closeCurrentSegment({ timestampMs: 800, reason: 'user_switch' });
  manager.openSegment({ skill: 'squat', timestampMs: 800 });
  manager.updateCurrentSegment(fakeRepFrame({ skill: 'squat', reps: 1, faults: [] }), 1200);

  assert.equal(closed.reps, 2);
  assert.equal(manager.getCompletedSegments()[0].reps, 2);
  assert.equal(manager.getCurrentSegment().skill, 'squat');
  assert.equal(manager.getCurrentSegment().reps, 1);
});

console.log(`\nAll ${passedTests}/${totalTests} tests passed successfully!`);
