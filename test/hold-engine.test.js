// test/hold-engine.test.js
import assert from 'node:assert/strict';
import { HoldSegmenter, HOLD_STATE, HOLD_EVENT } from '../engine/hold-segmenter.js';
import { LsitEvaluator, HandstandEvaluator } from '../engine/hold-evaluators.js';
import { TrueFormEngine } from '../engine/index.js';

// ============================================================================
// 1. SYNTHETIC LANDMARK GENERATORS
// ============================================================================

function createEmptyLandmarks(count = 33, defaultVis = 0.95) {
  const lm = [];
  for (let i = 0; i < count; i++) {
    lm.push({ x: 0.5, y: 0.5, z: 0, visibility: defaultVis });
  }
  return lm;
}

/**
 * Generates landmarks for an L-sit posture (facing right in side profile)
 */
function createLsitLandmarks(options = {}) {
  const {
    visibility = 0.95,
    kneeAngle = 180,       // 180 = straight legs, < 150 = knee bend
    elbowAngle = 180,      // 180 = locked arms
    hipY = 0.65,           // <= 0.70 = elevated above wrists (wrists at 0.70)
    torsoAngle = 0,        // 0 = vertical
  } = options;

  const vis = visibility;
  const occludedVis = Math.min(vis, 0.1);
  const lm = createEmptyLandmarks(33, occludedVis);

  // Left side joints (indices 11, 13, 15, 23, 25, 27)
  const shoulderY = 0.40;
  const shoulderX = 0.45;
  lm[11] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis };

  // Elbow & Wrist
  const elbowY = 0.55;
  const elbowX = elbowAngle < 160 ? shoulderX - 0.05 : shoulderX;
  lm[13] = { x: elbowX, y: elbowY, z: 0, visibility: vis };

  const wristY = 0.70;
  lm[15] = { x: shoulderX, y: wristY, z: 0, visibility: vis };

  // Hip
  const hipX = shoulderX + (torsoAngle * 0.002);
  lm[23] = { x: hipX, y: hipY, z: 0, visibility: vis };

  // Knee
  const kneeX = hipX + 0.20;
  const kneeY = hipY;
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };

  // Ankle (reflecting knee angle)
  const legRad = ((180 - kneeAngle) * Math.PI) / 180;
  const ankleX = kneeX + 0.20 * Math.cos(legRad);
  const ankleY = kneeY + 0.20 * Math.sin(legRad);
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };

  return lm;
}

/**
 * Generates landmarks for a Handstand posture (inverted, facing profile)
 */
function createHandstandLandmarks(options = {}) {
  const {
    visibility = 0.95,
    inversion = true,
    armAngle = 180,
    stackOffsetX = 0,
    bodyLineDev = 0,
    legAngle = 180
  } = options;

  const lm = createEmptyLandmarks();
  const vis = visibility;

  if (!inversion) {
    // Normal standing upright human
    lm[11] = { x: 0.5, y: 0.35, z: 0, visibility: vis }; // shoulders top
    lm[13] = { x: 0.5, y: 0.50, z: 0, visibility: vis };
    lm[15] = { x: 0.5, y: 0.65, z: 0, visibility: vis }; // wrists mid
    lm[23] = { x: 0.5, y: 0.60, z: 0, visibility: vis }; // hips
    lm[25] = { x: 0.5, y: 0.75, z: 0, visibility: vis }; // knees
    lm[27] = { x: 0.5, y: 0.90, z: 0, visibility: vis }; // ankles bottom
    return lm;
  }

  // Inverted: Wrists down near bottom of image (y=0.85), feet at top (y=0.10)
  const wristX = 0.50;
  const wristY = 0.85;
  lm[15] = { x: wristX, y: wristY, z: 0, visibility: vis };

  const elbowX = armAngle < 165 ? wristX + 0.05 : wristX;
  const elbowY = 0.70;
  lm[13] = { x: elbowX, y: elbowY, z: 0, visibility: vis };

  const shoulderX = wristX + stackOffsetX;
  const shoulderY = 0.55;
  lm[11] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis };

  const hipX = shoulderX + (bodyLineDev * 0.003);
  const hipY = 0.35;
  lm[23] = { x: hipX, y: hipY, z: 0, visibility: vis };

  const kneeX = hipX;
  const kneeY = 0.22;
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };

  const ankleX = kneeX;
  const ankleY = 0.10;
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };

  return lm;
}

// ============================================================================
// 2. REPLAY HARNESS
// ============================================================================

function runReplay(evaluator, segmenter, frames) {
  const timeline = [];
  const events = [];

  for (const f of frames) {
    const evaluation = evaluator ? evaluator.evaluate(f.landmarks, f.timestampMs) : f.evaluation;
    const result = segmenter.update(evaluation, f.timestampMs);
    timeline.push({
      ...result,
      timestampMs: f.timestampMs,
    });
    if (result.event) {
      events.push({ timestampMs: f.timestampMs, event: result.event, state: result.state });
    }
  }

  const finalResult = timeline[timeline.length - 1];
  return { timeline, events, finalResult };
}

// ============================================================================
// 3. TEST SUITES
// ============================================================================

console.log('--- Starting TrueForm Static-Hold Prerequisite Test Suite ---');

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

// ----------------------------------------------------------------------------
// Suite A: HoldSegmenter State Machine & Dwell Logic
// ----------------------------------------------------------------------------
console.log('\n[Suite A: HoldSegmenter State Machine & Dwell Logic]');

it('Candidate never reaches dwell time: brief 250ms pose does not count as a hold', () => {
  const segmenter = new HoldSegmenter({ minCandidateDwellMs: 300, minConfirmedHoldMs: 600 });
  const frames = [
    { timestampMs: 0, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.8, faults: [] } },
    { timestampMs: 100, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.8, faults: [] } },
    { timestampMs: 250, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.8, faults: [] } },
    { timestampMs: 350, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.20, formQuality: 0.1, faults: [] } }, // dropped
    { timestampMs: 500, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.10, formQuality: 0.1, faults: [] } }
  ];

  const { timeline, events, finalResult } = runReplay(null, segmenter, frames);

  // Started candidate
  assert.equal(events[0].event, HOLD_EVENT.HOLD_CANDIDATE_STARTED);
  // Never confirmed
  assert.ok(!events.some(e => e.event === HOLD_EVENT.HOLD_CONFIRMED));
  // Zero hold time
  assert.equal(finalResult.holdTimeMs, 0);
  assert.equal(finalResult.state, HOLD_STATE.NO_HOLD);
});

it('Valid sustained hold: passes dwell time, confirms ACTIVE, and accumulates duration', () => {
  const segmenter = new HoldSegmenter({ minCandidateDwellMs: 300, minConfirmedHoldMs: 600 });
  const frames = [];
  // 3000ms duration at 50ms intervals
  for (let t = 0; t <= 3000; t += 50) {
    frames.push({
      timestampMs: t,
      evaluation: { skill: 'lsit', poseConfidence: 0.92, skillLikelihood: 0.88, formQuality: 0.82, faults: [] }
    });
  }

  const { events, finalResult } = runReplay(null, segmenter, frames);

  assert.ok(events.some(e => e.event === HOLD_EVENT.HOLD_CANDIDATE_STARTED));
  const confirmedEv = events.find(e => e.event === HOLD_EVENT.HOLD_CONFIRMED);
  assert.ok(confirmedEv, 'Must emit HOLD_CONFIRMED event');
  assert.ok(confirmedEv.timestampMs >= 600, 'Confirmation must wait for dwell time');

  // Active state reached
  assert.equal(finalResult.state, HOLD_STATE.ACTIVE);
  assert.ok(finalResult.holdTimeMs >= 2400, `Expected holdTimeMs >= 2400, got ${finalResult.holdTimeMs}`);
  assert.equal(finalResult.bestHoldMs, finalResult.holdTimeMs);
});

it('Degradation and recovery: formQuality drop triggers DEGRADING, recovery restores ACTIVE', () => {
  const segmenter = new HoldSegmenter({
    minCandidateDwellMs: 300,
    minConfirmedHoldMs: 600,
    degradationThreshold: 0.45,
    degradationStreakFrames: 8,
    recoveryStreakFrames: 4
  });

  const frames = [];
  // 0 - 1000ms: Good hold (active)
  for (let t = 0; t <= 1000; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.80, faults: [] } });
  }
  // 1050 - 1600ms: 12 frames of degraded form (knee bend)
  for (let t = 1050; t <= 1600; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.80, formQuality: 0.35, faults: ['knee_bend'] } });
  }
  // 1650 - 2500ms: Good form restored
  for (let t = 1650; t <= 2500; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.80, faults: [] } });
  }

  const { events, finalResult } = runReplay(null, segmenter, frames);

  assert.ok(events.some(e => e.event === HOLD_EVENT.HOLD_DEGRADING), 'Must detect HOLD_DEGRADING');
  assert.ok(events.some(e => e.event === HOLD_EVENT.HOLD_RECOVERED), 'Must detect HOLD_RECOVERED');
  assert.equal(finalResult.state, HOLD_STATE.ACTIVE);
  assert.ok(finalResult.holdTimeMs >= 2000);
});

it('Collapse into rest: complete skill loss transitions directly to ENDED', () => {
  const segmenter = new HoldSegmenter({ minConfirmedHoldMs: 600, exitLikelihoodThreshold: 0.40 });
  const frames = [];
  // Hold for 1500ms
  for (let t = 0; t <= 1500; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.80, faults: [] } });
  }
  // Collapse
  frames.push({ timestampMs: 1550, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.15, formQuality: 0.1, faults: [] } });
  frames.push({ timestampMs: 1600, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.10, formQuality: 0.1, faults: [] } });

  const { events, finalResult } = runReplay(null, segmenter, frames);

  assert.ok(events.some(e => e.event === HOLD_EVENT.HOLD_ENDED));
  assert.equal(finalResult.state, HOLD_STATE.ENDED);
  assert.ok(finalResult.holdTimeMs >= 1000);
});

it('Tracking loss grace period: < 150ms tracking loss preserves state without inflating duration', () => {
  const segmenter = new HoldSegmenter({ minConfirmedHoldMs: 600, trackingUncertainAfterMs: 150 });
  const frames = [];
  // 0 - 1000ms: Good hold
  for (let t = 0; t <= 1000; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.80, faults: [] } });
  }
  // 1050 - 1150ms: Brief 100ms tracking interruption (< 150ms grace)
  for (let t = 1050; t <= 1150; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.1, skillLikelihood: null, formQuality: null, faults: [] } });
  }
  // 1200 - 1600ms: Tracking returns
  for (let t = 1200; t <= 1600; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.80, faults: [] } });
  }

  const { events, finalResult } = runReplay(null, segmenter, frames);

  // State should not have dropped out to TRACKING_UNCERTAIN or ENDED during the brief 100ms gap
  assert.ok(!events.some(e => e.event === HOLD_EVENT.HOLD_ENDED));
  assert.equal(finalResult.state, HOLD_STATE.ACTIVE);
});

it('Tracking loss exceeded: > 500ms tracking loss safely transitions to ENDED', () => {
  const segmenter = new HoldSegmenter({ minConfirmedHoldMs: 600, trackingUncertainAfterMs: 150, endAfterTrackingLostMs: 500 });
  const frames = [];
  // 0 - 1000ms: Good hold
  for (let t = 0; t <= 1000; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.80, faults: [] } });
  }
  // 1050 - 1700ms: 650ms tracking loss (> 500ms end threshold)
  for (let t = 1050; t <= 1700; t += 50) {
    frames.push({ timestampMs: t, evaluation: { skill: 'lsit', poseConfidence: 0.1, skillLikelihood: null, formQuality: null, faults: [] } });
  }

  const { events, finalResult } = runReplay(null, segmenter, frames);

  assert.ok(events.some(e => e.event === HOLD_EVENT.TRACKING_LOST), 'Must enter TRACKING_LOST');
  assert.ok(events.some(e => e.event === HOLD_EVENT.HOLD_ENDED), 'Must end hold after tracking loss threshold');
  assert.equal(finalResult.state, HOLD_STATE.ENDED);
});

// ----------------------------------------------------------------------------
// Suite B: Live LsitEvaluator
// ----------------------------------------------------------------------------
console.log('\n[Suite B: Live LsitEvaluator]');

it('L-sit Evaluator: Recognizes valid L-sit posture with high likelihood and quality', () => {
  const evaluator = new LsitEvaluator();
  const lm = createLsitLandmarks({ kneeAngle: 180, elbowAngle: 180, hipY: 0.65 });
  const res = evaluator.evaluate(lm, 1000);

  assert.equal(res.skill, 'lsit');
  assert.equal(res.type, 'hold');
  assert.ok(res.poseConfidence >= 0.80);
  assert.ok(res.skillLikelihood >= 0.75, `Expected skillLikelihood >= 0.75, got ${res.skillLikelihood}`);
  assert.ok(res.formQuality >= 0.70, `Expected formQuality >= 0.70, got ${res.formQuality}`);
  assert.deepEqual(res.faults, []);
});

it('L-sit Evaluator: Distinguishes knee bend (high skill likelihood, lower quality, knee_bend fault)', () => {
  const evaluator = new LsitEvaluator();
  const lm = createLsitLandmarks({ kneeAngle: 120, elbowAngle: 180 }); // bent knees
  const res = evaluator.evaluate(lm, 1000);

  // Still looks like an L-sit attempt (high likelihood)
  assert.ok(res.skillLikelihood >= 0.65, `Expected skillLikelihood >= 0.65, got ${res.skillLikelihood}`);
  // But quality is penalized
  assert.ok(res.formQuality < 0.65, `Expected formQuality < 0.65, got ${res.formQuality}`);
  assert.ok(res.faults.includes('knee_bend'), 'Must flag knee_bend fault');
});

it('L-sit Evaluator: Low-visibility frame returns explicit tracking_uncertain shape with null metrics', () => {
  const evaluator = new LsitEvaluator();
  const lm = createLsitLandmarks({ visibility: 0.2 }); // poor lighting / occluded
  const res = evaluator.evaluate(lm, 1000);

  assert.equal(res.skill, 'lsit');
  assert.ok(res.poseConfidence < 0.45);
  assert.equal(res.skillLikelihood, null);
  assert.equal(res.formQuality, null);
  assert.equal(res.metrics, null);
  assert.deepEqual(res.faults, []);
});

// ----------------------------------------------------------------------------
// Suite C: Live HandstandEvaluator
// ----------------------------------------------------------------------------
console.log('\n[Suite C: Live HandstandEvaluator]');

it('Handstand Evaluator: Recognizes clean inverted handstand with high likelihood', () => {
  const evaluator = new HandstandEvaluator();
  const lm = createHandstandLandmarks({ inversion: true, armAngle: 180, stackOffsetX: 0 });
  const res = evaluator.evaluate(lm, 1000);

  assert.equal(res.skill, 'handstand');
  assert.equal(res.type, 'hold');
  assert.ok(res.poseConfidence >= 0.80);
  assert.ok(res.skillLikelihood >= 0.80, `Expected skillLikelihood >= 0.80, got ${res.skillLikelihood}`);
  assert.ok(res.formQuality >= 0.70, `Expected formQuality >= 0.70, got ${res.formQuality}`);
  assert.ok(res.metrics.inversion >= 0.90);
  assert.deepEqual(res.faults, []);
});

it('Handstand Evaluator: Normal upright human has zero inversion and zero skill likelihood', () => {
  const evaluator = new HandstandEvaluator();
  const lm = createHandstandLandmarks({ inversion: false }); // standing upright
  const res = evaluator.evaluate(lm, 1000);

  assert.equal(res.metrics.inversion, 0);
  assert.equal(res.skillLikelihood, 0);
  assert.ok(res.formQuality < 0.30);
});

it('Handstand Evaluator: Kick-up frame without dwell time does not confirm active hold in segmenter', () => {
  const evaluator = new HandstandEvaluator();
  const segmenter = new HoldSegmenter({ minCandidateDwellMs: 300, minConfirmedHoldMs: 600 });

  // 200ms momentary kick-up
  const frames = [];
  for (let t = 0; t <= 200; t += 50) {
    frames.push({ timestampMs: t, landmarks: createHandstandLandmarks({ inversion: true }) });
  }
  // Drops back to feet
  for (let t = 250; t <= 600; t += 50) {
    frames.push({ timestampMs: t, landmarks: createHandstandLandmarks({ inversion: false }) });
  }

  const { events, finalResult } = runReplay(evaluator, segmenter, frames);

  assert.ok(!events.some(e => e.event === HOLD_EVENT.HOLD_CONFIRMED), 'Kick-up must not confirm active hold');
  assert.equal(finalResult.holdTimeMs, 0);
});

// ----------------------------------------------------------------------------
// Suite D: TrueFormEngine Integration & Pipeline Separation
// ----------------------------------------------------------------------------
console.log('\n[Suite D: TrueFormEngine Pipeline Separation]');

it('TrueFormEngine: Static hold movement routes through HoldSegmenter and bypasses RepSegmenter', () => {
  const engine = new TrueFormEngine('lsit');
  assert.equal(engine.isHoldMovement, true);

  // Feed 1500ms of L-sit frames
  let lastResult = null;
  for (let t = 0; t <= 1500; t += 50) {
    const lm = createLsitLandmarks({ kneeAngle: 180 });
    lastResult = engine.processFrame(lm, t);
  }

  assert.ok(lastResult.holdResult, 'Must return holdResult payload');
  assert.equal(lastResult.holdResult.skill, 'lsit');
  assert.equal(lastResult.state, HOLD_STATE.ACTIVE);
  assert.ok(lastResult.holdTimeMs >= 900);

  // Verify RepSegmenter was never touched
  assert.equal(engine.segmenter.completedReps.length, 0);
  assert.equal(lastResult.repCount, undefined);
});

it('TrueFormEngine: Rep-based exercise (pushup) routes through RepSegmenter as before', () => {
  const engine = new TrueFormEngine('pushup');
  assert.equal(engine.isHoldMovement, false);

  const res = engine.processFrame(createEmptyLandmarks(), 1000);
  assert.equal(res.holdResult, undefined);
  assert.equal(typeof res.repCount, 'number');
});

it('TrueFormEngine: Evaluator reset clears only active skill state when switching', () => {
  const engine = new TrueFormEngine('lsit');
  for (let t = 0; t <= 1000; t += 50) {
    engine.processFrame(createLsitLandmarks(), t);
  }
  assert.ok(engine.holdSegmenter.holdTimeMs > 0);

  // Switch movement
  engine.setMovement('handstand');
  assert.equal(engine.movementKey, 'handstand');
  assert.equal(engine.holdSegmenter.holdTimeMs, 0);
  assert.equal(engine.holdSegmenter.state, HOLD_STATE.NO_HOLD);
});

// ----------------------------------------------------------------------------
// Suite E: Edge Cases & Specification Acceptance Verification
// ----------------------------------------------------------------------------
console.log('\n[Suite E: Edge Cases & Specification Acceptance Verification]');

it('L-sit Evaluator: Hips dropping below wrist level flags hips_dropping fault', () => {
  const evaluator = new LsitEvaluator();
  // hipY = 0.78 is below wristY (0.70)
  const lm = createLsitLandmarks({ hipY: 0.78, kneeAngle: 180 });
  const res = evaluator.evaluate(lm, 1000);

  assert.ok(res.faults.includes('hips_dropping'), 'Must flag hips_dropping');
  assert.ok(res.formQuality < 0.70);
});

it('Handstand Evaluator: Hips not stacked (banana arch) flags hip_arch fault', () => {
  const evaluator = new HandstandEvaluator();
  const lm = createHandstandLandmarks({ inversion: true, bodyLineDev: 25 });
  const res = evaluator.evaluate(lm, 1000);

  assert.ok(res.faults.includes('hip_arch') || res.faults.includes('hip_pike'), 'Must flag body line fault');
  assert.ok(res.metrics.bodyLineDeviation > 15);
});

it('Handstand: Failed kick-up (100ms flash) never enters ACTIVE hold', () => {
  const evaluator = new HandstandEvaluator();
  const segmenter = new HoldSegmenter({ minConfirmedHoldMs: 600 });

  const frames = [
    { timestampMs: 0, landmarks: createHandstandLandmarks({ inversion: false }) },
    { timestampMs: 50, landmarks: createHandstandLandmarks({ inversion: true }) },
    { timestampMs: 100, landmarks: createHandstandLandmarks({ inversion: true }) },
    { timestampMs: 150, landmarks: createHandstandLandmarks({ inversion: false }) },
    { timestampMs: 250, landmarks: createHandstandLandmarks({ inversion: false }) },
  ];

  const { events, finalResult } = runReplay(evaluator, segmenter, frames);
  assert.ok(!events.some(e => e.event === HOLD_EVENT.HOLD_CONFIRMED));
  assert.equal(finalResult.state, HOLD_STATE.NO_HOLD);
  assert.equal(finalResult.holdTimeMs, 0);
});

it('HoldSegmenter: Irregular frame timestamps and repeated reset calls', () => {
  const segmenter = new HoldSegmenter();
  segmenter.reset();
  segmenter.reset(); // repeated reset

  assert.equal(segmenter.state, HOLD_STATE.NO_HOLD);
  assert.equal(segmenter.holdTimeMs, 0);
  assert.equal(segmenter.bestHoldMs, 0);

  // Irregular timestamps: 0ms, 12ms, 150ms, 25ms, 400ms gap
  const evalGood = { skill: 'lsit', poseConfidence: 0.9, skillLikelihood: 0.85, formQuality: 0.85, faults: [] };
  segmenter.update(evalGood, 0);
  segmenter.update(evalGood, 12);
  segmenter.update(evalGood, 162);
  segmenter.update(evalGood, 187);
  segmenter.update(evalGood, 600); // 413ms jump (clamped to maxFrameGapMs)

  assert.ok(segmenter.candidateTimeMs >= 300);
});

it('Common Result Schema: L-sit and Handstand return identical top-level properties', () => {
  const lsitEval = new LsitEvaluator();
  const hsEval = new HandstandEvaluator();

  const lsitRes = lsitEval.evaluate(createLsitLandmarks(), 1000);
  const hsRes = hsEval.evaluate(createHandstandLandmarks(), 1000);

  const expectedKeys = ['skill', 'type', 'poseConfidence', 'skillLikelihood', 'formQuality', 'metrics', 'faults'];
  for (const k of expectedKeys) {
    assert.ok(k in lsitRes, `L-sit missing key ${k}`);
    assert.ok(k in hsRes, `Handstand missing key ${k}`);
  }

  assert.equal(lsitRes.type, 'hold');
  assert.equal(hsRes.type, 'hold');
  assert.ok(Array.isArray(lsitRes.faults));
  assert.ok(Array.isArray(hsRes.faults));
});

console.log(`\nAll ${passedTests}/${totalTests} tests passed successfully!`);

