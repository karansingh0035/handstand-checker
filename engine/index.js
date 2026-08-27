// engine/index.js
import { LandmarkFilterManager } from './smoothing.js';
import { RepSegmenter } from './segmentation.js';
import { evaluateRules } from './rules.js';
import { CueArbitrator } from './arbitrator.js';
import { ProgressionManager } from './progression.js';
import { angle, torsoVertical, bodyLine } from './primitives.js';

/**
 * Triggers browser Web Speech API for real-time audio coaching.
 */
export function speakCue(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel(); // Stop previous utterance immediately
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1; // Slightly faster for workout timing
  window.speechSynthesis.speak(utterance);
}

/**
 * Unified TrueForm Processing Engine
 */
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

  /**
   * Main per-frame pipeline call.
   */
  processFrame(rawLandmarks, timestamp = performance.now()) {
    if (!rawLandmarks || rawLandmarks.length === 0) {
      return { repCount: this.segmenter.completedReps.length, activeCue: null };
    }

    // 1. One-Euro smoothing
    const landmarks = this.filter.filterLandmarks(rawLandmarks, timestamp);

    // 2. Derive frame geometry metrics
    const metrics = this.extractMetrics(landmarks);

    // 3. Peak/trough rep segmentation
    const segResult = this.segmenter.processFrame(metrics.primarySignal, metrics.meanVisibility, timestamp);

    let activeCue = null;

    // 4. On completed rep: evaluate rule set & arbitrate audio cues
    if (segResult.event === 'REP_COMPLETE') {
      const completedRep = segResult.rep;
      const repMetrics = { ...metrics, ...completedRep };
      
      const violations = evaluateRules(this.movementKey, repMetrics);
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
    // Primary MediaPipe keypoints:
    // 11/12: shoulders, 13/14: elbows, 15/16: wrists
    // 23/24: hips, 25/26: knees, 27/28: ankles
    const leftElbow = lm[13] && lm[11] && lm[15] ? angle(lm[11], lm[13], lm[15]) : 180;
    const rightElbow = lm[14] && lm[12] && lm[16] ? angle(lm[12], lm[14], lm[16]) : 180;
    const meanElbow = (leftElbow + rightElbow) / 2;

    const leftKnee = lm[25] && lm[23] && lm[27] ? angle(lm[23], lm[25], lm[27]) : 180;
    const rightKnee = lm[26] && lm[24] && lm[28] ? angle(lm[24], lm[26], lm[28]) : 180;
    const meanKnee = (leftKnee + rightKnee) / 2;

    const shoulder = lm[11] || { x: 0, y: 0 };
    const hip = lm[23] || { x: 0, y: 0 };
    const ankle = lm[27] || { x: 0, y: 0 };

    const bodyLineData = bodyLine(shoulder, hip, ankle);
    const torsoVert = torsoVertical(shoulder, hip);

    const meanVis = lm.reduce((acc, curr) => acc + (curr.visibility || 1.0), 0) / lm.length;

    // Route primary signal per exercise type
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
      hipY: hip.y,
      kneeY: lm[25] ? lm[25].y : 0,
      noseY: lm[0] ? lm[0].y : 0,
      wristY: lm[15] ? lm[15].y : 0
    };
  }
}