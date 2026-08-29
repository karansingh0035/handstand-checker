// engine/index.js
import { LandmarkFilterManager } from './smoothing.js';
import { RepSegmenter } from './segmentation.js';
import { evaluateRules } from './rules.js';
import { CueArbitrator } from './arbitrator.js';
import { ProgressionManager } from './progression.js';
import { angle, torsoVertical, bodyLine, shoulderLean } from './primitives.js';

export function speakCue(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  window.speechSynthesis.speak(utterance);
}

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

    const meanVis = lm.reduce((acc, curr) => acc + (curr.visibility || 1.0), 0) / lm.length;

    let primarySignal = meanElbow;
    if (this.movementKey === 'squat') primarySignal = meanKnee;

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
      hipY: hip.y,
      kneeY: lm[25] ? lm[25].y : 0,
      noseY: lm[0] ? lm[0].y : 0,
      wristY: lm[15] ? lm[15].y : 0
    };
  }
}