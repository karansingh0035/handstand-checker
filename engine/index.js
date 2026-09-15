// engine/index.js
import { LandmarkFilterManager } from './smoothing.js';
import { RepSegmenter } from './segmentation.js';
import { evaluateRules } from './rules.js';
import { CueArbitrator } from './arbitrator.js';
import { ProgressionManager } from './progression.js';
import { angle, torsoVertical, bodyLine, shoulderLean, verticalProgress } from './primitives.js';
import { HoldSegmenter, HOLD_STATE, HOLD_EVENT } from './hold-segmenter.js';
import { LsitEvaluator, HandstandEvaluator } from './hold-evaluators.js';
import {
  SKILLS,
  SegmentManager,
  SessionEventLog,
  SessionReportBuilder,
  LiveSessionController,
  resolveLiveSkill,
  getSupportedLiveSkills,
  isSupportedLiveSkill,
  formatDuration,
  formatFaultLabel
} from './session-manager.js';

export {
  HoldSegmenter,
  HOLD_STATE,
  HOLD_EVENT,
  LsitEvaluator,
  HandstandEvaluator,
  SKILLS,
  SegmentManager,
  SessionEventLog,
  SessionReportBuilder,
  LiveSessionController,
  resolveLiveSkill,
  getSupportedLiveSkills,
  isSupportedLiveSkill,
  formatDuration,
  formatFaultLabel
};

<<<<<<< Updated upstream
export function speakCue(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  window.speechSynthesis.speak(utterance);
=======
// engine/index.js (Top level)
let cachedVoice = null;
let currentUtterance = null;
let pendingSpeakTimeout = null;
let isAudioMuted = false;

export function setAudioMuted(muted) {
  isAudioMuted = Boolean(muted);
  if (isAudioMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function getAudioMuted() {
  return isAudioMuted;
}

function loadBestVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  // 1. Prioritize a local (offline) English voice to eliminate network latency
  const localEnglish = voices.find((v) => v.lang && v.lang.startsWith('en') && v.localService === true);
  if (localEnglish) {
    cachedVoice = localEnglish;
    return cachedVoice;
  }

  // 2. Any local (offline) voice
  const anyLocal = voices.find((v) => v.localService === true);
  if (anyLocal) {
    cachedVoice = anyLocal;
    return cachedVoice;
  }

  // 3. Fallback to default or any English voice
  const defaultEnglish = voices.find((v) => v.lang && v.lang.startsWith('en') && v.default);
  const english = voices.find((v) => v.lang && v.lang.startsWith('en'));
  cachedVoice = defaultEnglish || english || voices[0] || null;
  return cachedVoice;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    loadBestVoice();
  };
  loadBestVoice();
}

/**
 * Primes the browser's SpeechSynthesis engine and audio subsystem on user gesture.
 * Call this inside user-driven click handlers (e.g. "Go Live" or "Upload").
 */
export function warmUpSpeech() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  loadBestVoice();
  try {
    // Silent micro-utterance to wake up audio hardware without sound
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0.01;
    silent.rate = 2.0;
    if (cachedVoice) silent.voice = cachedVoice;
    window.speechSynthesis.speak(silent);
  } catch (e) {}
}

export function speakCue(text) {
  if (isAudioMuted || typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;

  // Clear any scheduled delayed speak
  if (pendingSpeakTimeout) {
    clearTimeout(pendingSpeakTimeout);
    pendingSpeakTimeout = null;
  }

  // Sanitize text: replace em-dashes with comma to remove TTS grammatical pause
  const cleanText = text.replace(/—/g, ', ').replace(/\s+/g, ' ').trim();

  // Cancel any ongoing or pending speech to give instant feedback
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }

  // Resume in case Chromium put the synthesizer in a paused state
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 1.3; // Snappy delivery
  utterance.pitch = 1.0;

  const voice = cachedVoice || loadBestVoice();
  if (voice) {
    utterance.voice = voice;
  }

  // Retain strong reference to prevent V8 garbage-collecting the utterance mid-speech
  currentUtterance = utterance;

  utterance.onend = () => {
    if (currentUtterance === utterance) currentUtterance = null;
  };
  utterance.onerror = () => {
    if (currentUtterance === utterance) currentUtterance = null;
  };

  // 10ms micro-delay prevents Chromium race condition where immediate speak after cancel stalls
  pendingSpeakTimeout = setTimeout(() => {
    window.speechSynthesis.speak(utterance);
    pendingSpeakTimeout = null;
  }, 10);
>>>>>>> Stashed changes
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

// 🆕 Per-movement rep plausibility checks — evaluated once per completed
// rep, using metrics the segmenter already tracks (no new tracking added).
// Confidence genuinely varies by movement, stated honestly rather than
// applying a uniform check everywhere:
//
// - Push-family: STRONG. A real rep must get the torso reasonably
//   horizontal at its most-tilted moment — standing upright and swinging
//   your arms cannot fake this regardless of how the elbow angle moves.
// - Squat: WEAK/backstop only. A loose ceiling that mainly rules out
//   extreme forward-fold-style motion, not a strong positive signal —
//   squat's knee-angle swing is already a fairly reliable discriminator
//   on its own.
// - Pull-family (pullup, muscleup): STRONG, different physical signature
//   than the push-family check. A real hang-based rep means the WRIST
//   stays roughly fixed (gripping a static bar) while the SHOULDER moves
//   substantially relative to it. Someone standing and swinging their
//   arms produces the opposite signature — wrist moves a lot, shoulder
//   barely does. Both sides are measured the same way (running min/max
//   range across the whole rep), so this is a clean, symmetric comparison
//   — not the mismatched-snapshot approach originally ruled out.
const PLAUSIBILITY_CHECKS = {
  pushup: (rep) => rep.torsoVertical >= 40,
  handstandpushup: (rep) => rep.torsoVertical >= 40,
  ninetydegreehspu: (rep) => rep.torsoVertical >= 40,
  planchepushup: (rep) => rep.torsoVertical >= 40,
  pikepushup: (rep) => rep.torsoVertical >= 30, // pike position is naturally more upright than a flat pushup — lower bar
  squat: (rep) => rep.torsoVertical <= 70,
  pullup: (rep) => {
    const wristRange = rep.maxWristY - rep.minWristY;
    const shoulderRange = rep.maxShoulderY - rep.minShoulderY;
    return (shoulderRange - wristRange) > 0.06;
  },
  muscleup: (rep) => {
    const wristRange = rep.maxWristY - rep.minWristY;
    const shoulderRange = rep.maxShoulderY - rep.minShoulderY;
    return (shoulderRange - wristRange) > 0.06;
  },
};

const HOLD_CUES = {
  lsit: {
    knee_bend: "Straighten your legs — point your toes.",
    bent_arms: "Press through your palms — lock out your arms.",
    torso_lean: "Keep your chest tall.",
    hips_dropping: "Lift your hips off the floor."
  },
  handstand: {
    bent_arms: "Push the floor away — lock your elbows.",
    shoulder_misalignment: "Stack your shoulders over your hands.",
    hip_arch: "Squeeze your glutes — avoid arching your back.",
    hip_pike: "Open your hips into a straight line.",
    bent_legs: "Keep your legs straight and together."
  }
};

export class TrueFormEngine {
  constructor(movementKey = 'pushup') {
    this.filter = new LandmarkFilterManager();
    this.segmenter = new RepSegmenter();
    this.arbitrator = new CueArbitrator();
    this.progression = new ProgressionManager();

    // Static-Hold pipeline (independent from RepSegmenter)
    this.holdSegmenter = new HoldSegmenter();
    this.holdEvaluators = {
      lsit: new LsitEvaluator(),
      handstand: new HandstandEvaluator(),
    };
    this.isHoldMovement = false;
    this.activeHoldEvaluator = null;

    this.setMovement(movementKey);
  }

  setMovement(movementKey) {
    this.movementKey = movementKey;
    this.isHoldMovement = Boolean(this.holdEvaluators[movementKey]);

    // Reset only evaluator/segmenter counters — never session identity or timer.
    this.holdSegmenter.reset();
    Object.values(this.holdEvaluators).forEach((evaluator) => evaluator.reset());
    this.segmenter.reset();
    this.arbitrator.reset();
    this.filter.reset();

    if (this.isHoldMovement) {
      this.activeHoldEvaluator = this.holdEvaluators[movementKey];
      // Crucial: Static holds DO NOT configure or route through RepSegmenter!
    } else {
      this.activeHoldEvaluator = null;
      this.segmenter.configure({
        ...(SIGNAL_HYSTERESIS[movementKey] || SIGNAL_HYSTERESIS.default),
        plausibilityCheck: PLAUSIBILITY_CHECKS[movementKey] || null,
      });
    }
  }

  reset() {
    this.filter.reset();
    this.arbitrator.reset();
    if (this.isHoldMovement) {
      this.holdSegmenter.reset();
      if (this.activeHoldEvaluator) {
        this.activeHoldEvaluator.reset();
      }
    } else {
      this.segmenter.reset();
    }
  }

  processFrame(rawLandmarks, timestamp = performance.now()) {
    if (!rawLandmarks || rawLandmarks.length === 0) {
      if (this.isHoldMovement) {
        const holdResult = this.holdSegmenter.update(null, timestamp);
        return {
          skill: this.movementKey,
          type: 'hold',
          status: 'uncertain',
          poseConfidence: 0,
          skillLikelihood: null,
          formQuality: null,
          reps: 0,
          holdTimeMs: holdResult.holdTimeMs,
          bestHoldMs: holdResult.bestHoldMs,
          faults: [],
          activeCue: null,
          cue: null,
          landmarks: null,
          metrics: null,
          holdResult,
          state: holdResult.state
        };
      }
      return {
        skill: this.movementKey,
        type: 'rep',
        status: 'uncertain',
        poseConfidence: 0,
        skillLikelihood: null,
        formQuality: null,
        reps: this.segmenter.completedReps.length,
        repCount: this.segmenter.completedReps.length,
        holdTimeMs: 0,
        bestHoldMs: 0,
        faults: [],
        activeCue: null,
        cue: null,
        landmarks: null,
        metrics: null,
        completedReps: this.segmenter.completedReps
      };
    }

    const landmarks = this.filter.filterLandmarks(rawLandmarks, timestamp);

    if (this.isHoldMovement) {
      // 🤸 STATIC-HOLD PIPELINE: Frame -> filter -> static evaluator -> HoldSegmenter
      const evaluation = this.activeHoldEvaluator.evaluate(landmarks, timestamp);
      const holdResult = this.holdSegmenter.update(evaluation, timestamp);

      let activeCue = null;
      // Safety rule: Do not give form advice when pose confidence is too low
      const isConfidenceAdequate = holdResult.poseConfidence >= 0.60;

      if (holdResult.event === HOLD_EVENT.HOLD_CONFIRMED) {
        activeCue = { cue: "Locked in — hold that." };
        speakCue(activeCue.cue);
      } else if (holdResult.event === HOLD_EVENT.HOLD_DEGRADING && isConfidenceAdequate) {
        const cueText = (this.movementKey && HOLD_CUES[this.movementKey] && holdResult.dominantFault && HOLD_CUES[this.movementKey][holdResult.dominantFault])
          ? HOLD_CUES[this.movementKey][holdResult.dominantFault]
          : "Tighten your form — hold steady.";
        activeCue = { cue: cueText, fault: holdResult.dominantFault };
        speakCue(activeCue.cue);
      } else if (holdResult.event === HOLD_EVENT.HOLD_ENDED && holdResult.bestHoldMs >= 600) {
        activeCue = { cue: "Hold complete." };
        speakCue(activeCue.cue);
      }

      const conf = holdResult.poseConfidence;
      const status = holdResult.state === 'tracking_uncertain' ? 'uncertain' : (holdResult.state === 'ended' ? 'ended' : 'active');

      return {
        skill: this.movementKey,
        type: 'hold',
        status,
        poseConfidence: conf,
        skillLikelihood: holdResult.skillLikelihood,
        formQuality: holdResult.formQuality,
        reps: 0,
        holdTimeMs: holdResult.holdTimeMs,
        bestHoldMs: holdResult.bestHoldMs,
        faults: holdResult.faults || [],
        activeCue,
        cue: activeCue ? { text: activeCue.cue, fault: activeCue.fault } : null,
        landmarks,
        metrics: holdResult.metrics,
        holdResult,
        state: holdResult.state
      };
    }

    // 💪 DYNAMIC REP PIPELINE: Frame -> filter -> metrics -> RepSegmenter
    const metrics = this.extractMetrics(landmarks);
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

    const conf = metrics.meanVisibility || 0.85;
    const reps = this.segmenter.completedReps.length;
    const lastRep = this.segmenter.completedReps[this.segmenter.completedReps.length - 1];
    const formQuality = lastRep ? Math.max(0, 1 - (lastRep.bodyLineDeviation || 0) / 45) : (metrics.bodyLineDeviation ? Math.max(0, 1 - metrics.bodyLineDeviation / 45) : 0.85);
    const faults = [];
    if (metrics.isSag) faults.push("hips_sagging");
    if (metrics.isPike) faults.push("hips_piking");

    return {
      skill: this.movementKey,
      type: 'rep',
      status: conf < 0.45 ? 'uncertain' : 'active',
      poseConfidence: Math.round(conf * 100) / 100,
      skillLikelihood: Math.round(conf * 100) / 100,
      formQuality: Math.round(formQuality * 100) / 100,
      reps,
      repCount: reps,
      holdTimeMs: 0,
      bestHoldMs: 0,
      faults,
      activeCue,
      cue: activeCue ? { text: activeCue.cue } : null,
      landmarks,
      metrics,
      segResult,
      completedReps: this.segmenter.completedReps
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
      shoulderY: shoulder.y,
      kneeY: lm[25] ? lm[25].y : 0,
      noseY: lm[0] ? lm[0].y : 0,
      wristY: lm[15] ? lm[15].y : 0
    };
  }
}