// engine/index.js
import { LandmarkFilterManager } from './smoothing.js';
import { RepSegmenter } from './segmentation.js';
import { evaluateRules } from './rules.js';
import { CueArbitrator } from './arbitrator.js';
import { ProgressionManager } from './progression.js';
import { angle, torsoVertical, bodyLine, shoulderLean, verticalProgress } from './primitives.js';

export function speakCue(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  window.speechSynthesis.speak(utterance);
}

// 🆕 RepSegmenter's hysteresis/ROM thresholds are tuned for degree-based
// angle signals (0-180° range) by default. muscleup's primarySignal is a
// normalized ratio (roughly -1.5 to +1.5) — a completely different scale —
// so it needs its own configuration or the segmenter would essentially
// never trigger, and every rep would fail the ROM validity check. These
// muscleup numbers are a rough estimate, NOT validated against real
// footage — this needs real-clip testing more than any other threshold in
// this engine so far, since there's no easy real-world reference point
// (like "a degree") to sanity-check them against.
const SIGNAL_HYSTERESIS = {
  default: { troughExitDelta: 12.0, topReturnDelta: 8.0, bottomOvershootDelta: 35.0, expectedRom: 80.0 },
  muscleup: { troughExitDelta: 0.25, topReturnDelta: 0.15, bottomOvershootDelta: 0.6, expectedRom: 1.0 }
};

export class TrueFormEngine {
  constructor(movementKey = 'pushup') {
    this.movementKey = movementKey;
    this.filter = new LandmarkFilterManager();
    this.segmenter = new RepSegmenter();
    this.arbitrator = new CueArbitrator();
    this.progression = new ProgressionManager();
  }

  setMovement(movementKey) {
    this.movementKey = movementKey;
    this.segmenter.configure(SIGNAL_HYSTERESIS[movementKey] || SIGNAL_HYSTERESIS.default);
    this.reset();
  }

  reset() {
    this.filter.reset();
    this.segmenter.reset();
    this.arbitrator.reset();
  }

  processFrame(rawLandmarks, timestamp = performance.now()) {
    if (!rawLandmarks || rawLandmarks.length === 0) {
      return { repCount: this.segmenter.completedReps.length, activeCue: null };
    }

    const landmarks = this.filter.filterLandmarks(rawLandmarks, timestamp);
    const metrics = this.extractMetrics(landmarks);

    // Pass metrics to segmenter for full-rep aggregation
    const segResult = this.segmenter.processFrame(metrics, timestamp);

    let activeCue = null;

    if (segResult.event === 'REP_COMPLETE') {
      const completedRep = segResult.rep;
      const violations = evaluateRules(this.movementKey, completedRep);
      activeCue = this.arbitrator.arbitrate(completedRep.repNumber, violations);

      if (activeCue) {
        speakCue(activeCue.cue);
      }
    }

    return {
      landmarks,
      metrics,
      segResult,
      completedReps: this.segmenter.completedReps,
      repCount: this.segmenter.completedReps.length,
      activeCue
    };
  }

  extractMetrics(lm) {
    const leftElbow = lm[13] && lm[11] && lm[15] ? angle(lm[11], lm[13], lm[15]) : 180;
    const rightElbow = lm[14] && lm[12] && lm[16] ? angle(lm[12], lm[14], lm[16]) : 180;
    const meanElbow = (leftElbow + rightElbow) / 2;

    const leftKnee = lm[25] && lm[23] && lm[27] ? angle(lm[23], lm[25], lm[27]) : 180;
    const rightKnee = lm[26] && lm[24] && lm[28] ? angle(lm[24], lm[26], lm[28]) : 180;
    const meanKnee = (leftKnee + rightKnee) / 2;

    const shoulder = lm[11] || { x: 0, y: 0 };
    const hip = lm[23] || { x: 0, y: 0 };
    const ankle = lm[27] || { x: 0, y: 0 };
    const wrist = lm[15] || { x: 0, y: 0 };

    const bodyLineData = bodyLine(shoulder, hip, ankle);
    const torsoVert = torsoVertical(shoulder, hip);

    // 🆕 Forward shoulder protraction past the wrist, for planche pushup
    const leanRatio = shoulderLean(shoulder, wrist, hip);

    // 🆕 Shoulder height relative to wrist, for muscle-up rep segmentation
    const vertProgress = verticalProgress(shoulder, wrist, hip);

    const meanVis = lm.reduce((acc, curr) => acc + (curr.visibility || 1.0), 0) / lm.length;

    let primarySignal = meanElbow;
    if (this.movementKey === 'squat') primarySignal = meanKnee;
    // Negated: RepSegmenter's shared state machine expects "high at rep
    // start, low at the trough, high again to complete" (matches every
    // angle-based movement: extended=high, bent=low). Muscle-up's real
    // motion is the opposite shape — low (hang) to high (support) back to
    // low (hang) — so we flip the sign to fit the existing state machine
    // without changing its core logic. This means the segmenter's internal
    // "bottomVal"/trough actually corresponds to the real-world TOP of the
    // movement (support/lockout), not a literal low point — see the
    // bottomElbowAngle comment in segmentation.js for where this matters.
    if (this.movementKey === 'muscleup') primarySignal = -vertProgress;

    return {
      primarySignal,
      meanVisibility: meanVis,
      minElbowAngle: meanElbow,
      maxElbowAngle: meanElbow,
      maxHipAngle: angle(shoulder, hip, lm[25] || { x: 0, y: 0 }),
      bodyLineDeviation: bodyLineData.deviation,
      isSag: bodyLineData.isSag,
      isPike: bodyLineData.isPike,
      torsoVertical: torsoVert,
      shoulderLean: leanRatio,
      hipLineAngle: bodyLineData.angle,
      verticalProgress: vertProgress,
      hipY: hip.y,
      kneeY: lm[25] ? lm[25].y : 0,
      noseY: lm[0] ? lm[0].y : 0,
      wristY: lm[15] ? lm[15].y : 0
    };
  }
}