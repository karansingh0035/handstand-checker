// engine/index.js
import { LandmarkFilterManager } from './smoothing.js';
import { RepSegmenter } from './segmentation.js';
import { evaluateRules } from './rules.js';
import { CueArbitrator } from './arbitrator.js';
import { ProgressionManager } from './progression.js';
import { angle, torsoVertical, bodyLine, shoulderLean, verticalProgress } from './primitives.js';
import { HoldSegmenter, HOLD_STATE, HOLD_EVENT } from './hold-segmenter.js';
import {
  LsitEvaluator,
  HandstandEvaluator,
  VsitEvaluator,
  PlancheEvaluator,
  StraddlePlancheEvaluator,
  PlancheLeanEvaluator,
  FrontLeverEvaluator,
  BackLeverEvaluator,
  CrowPoseEvaluator,
  FrogStandEvaluator,
  ElbowLeverEvaluator,
  NinetyDegreeHoldEvaluator
} from './hold-evaluators.js';
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
  VsitEvaluator,
  PlancheEvaluator,
  StraddlePlancheEvaluator,
  PlancheLeanEvaluator,
  FrontLeverEvaluator,
  BackLeverEvaluator,
  CrowPoseEvaluator,
  FrogStandEvaluator,
  ElbowLeverEvaluator,
  NinetyDegreeHoldEvaluator,
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

  const localEnglish = voices.find((v) => v.lang && v.lang.startsWith('en') && v.localService === true);
  if (localEnglish) {
    cachedVoice = localEnglish;
    return cachedVoice;
  }

  const anyLocal = voices.find((v) => v.localService === true);
  if (anyLocal) {
    cachedVoice = anyLocal;
    return cachedVoice;
  }

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

export function warmUpSpeech() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  loadBestVoice();
  try {
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0.01;
    silent.rate = 2.0;
    if (cachedVoice) silent.voice = cachedVoice;
    window.speechSynthesis.speak(silent);
  } catch (e) {}
}

export function speakCue(text) {
  if (isAudioMuted || typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;

  if (pendingSpeakTimeout) {
    clearTimeout(pendingSpeakTimeout);
    pendingSpeakTimeout = null;
  }

  const cleanText = text.replace(/—/g, ', ').replace(/\s+/g, ' ').trim();

  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }

  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 1.3;
  utterance.pitch = 1.0;

  const voice = cachedVoice || loadBestVoice();
  if (voice) {
    utterance.voice = voice;
  }

  currentUtterance = utterance;

  utterance.onend = () => {
    if (currentUtterance === utterance) currentUtterance = null;
  };
  utterance.onerror = () => {
    if (currentUtterance === utterance) currentUtterance = null;
  };

  // FIX Bug #7: Increase debounce from 10ms to 200ms to prevent audio cue loss
  // This ensures rapid-fire violations don't cancel the first cue mid-speech
  pendingSpeakTimeout = setTimeout(() => {
    window.speechSynthesis.speak(utterance);
    pendingSpeakTimeout = null;
  }, 200);
}

const SIGNAL_HYSTERESIS = {
  default: { troughExitDelta: 12.0, topReturnDelta: 8.0, bottomOvershootDelta: 35.0, expectedRom: 80.0 },
  muscleup: { troughExitDelta: 0.25, topReturnDelta: 0.15, bottomOvershootDelta: 0.6, expectedRom: 1.0 }
};

// FIX Bug #8: Add plausibility checks for hold-based skills
// Prevents invalid poses (e.g., standing still) from registering as holds in upload mode
const PLAUSIBILITY_CHECKS = {
  pushup: (rep) => rep.torsoVertical >= 40,
  handstandpushup: (rep) => rep.torsoVertical >= 40,
  ninetydegreehspu: (rep) => rep.torsoVertical >= 40,
  planchepushup: (rep) => rep.torsoVertical >= 40,
  pikepushup: (rep) => rep.torsoVertical >= 30,
  pseudoplanchepushup: (rep) => rep.torsoVertical >= 35,
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
  // 🆕 Hold skill plausibility checks for video upload mode
  handstand: (rep) => rep.torsoVertical >= 70,      // Body must be nearly vertical
  lsit: (rep) => rep.maxElbowAngle >= 160,          // Arms must be locked
  vsit: (rep) => rep.torsoVertical <= 45,           // Torso must be nearly vertical (V position)
  planche: (rep) => rep.shoulderLean > 0.1,         // Shoulders must be forward
  straddleplanche: (rep) => rep.shoulderLean > 0.08, // Lighter shoulder forward requirement
  planchelean: (rep) => rep.shoulderLean > 0.12,    // More aggressive shoulder forward
  frontlever: (rep) => rep.torsoVertical <= 45,     // Body must be horizontal
  backlever: (rep) => rep.torsoVertical >= 65,      // Body extension visible
  crowpose: (rep) => rep.bodyLineDeviation < 20,    // Reasonable form deviation
  frogstand: (rep) => rep.bodyLineDeviation < 25,   // More lenient than crow pose
  elbowlever: (rep) => rep.torsoVertical <= 50,     // Horizontal body extension
  ninetydegreehold: (rep) => rep.bodyLineDeviation < 15 // Tight body line
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
  },
  vsit: {
    knee_bend: "Lock your knees — compression tight.",
    bent_arms: "Lock out your arms.",
    insufficient_compression: "Pull your toes closer to your face."
  },
  planche: {
    bent_arms: "Protracted shoulders, lock out elbows.",
    hip_sag: "Lift your hips level with shoulders.",
    insufficient_lean: "Lean forward over your wrists."
  },
  straddleplanche: {
    bent_arms: "Lock your elbows straight.",
    hip_sag: "Keep hips level in horizontal line.",
    insufficient_lean: "Shift weight forward into lean."
  },
  planchelean: {
    bent_arms: "Push hard through your palms — lock elbows.",
    insufficient_lean: "Lean shoulders further past your wrists."
  },
  frontlever: {
    hip_sag: "Squeeze glutes and core — keep body parallel.",
    bent_arms: "Pull down with straight arms."
  },
  backlever: {
    hip_sag: "Engage posterior chain — line straight.",
    bent_arms: "Lock out your elbows completely."
  },
  crowpose: {
    collapsed: "Engage your core — lift off knees.",
    unstable: "Focus eyes ahead — balance over hands."
  },
  frogstand: {
    collapsed: "Press firm through fingers.",
    unstable: "Squeeze core to maintain balance."
  },
  elbowlever: {
    hip_sag: "Lift legs parallel to the ground.",
    bent_legs: "Extend legs fully back."
  },
  ninetydegreehold: {
    bent_elbows: "Maintain ninety degree elbow angle.",
    hip_sag: "Hold body straight parallel to floor."
  }
};

export class TrueFormEngine {
  constructor(movementKey = 'pushup') {
    this.filter = new LandmarkFilterManager();
    this.segmenter = new RepSegmenter();
    this.arbitrator = new CueArbitrator();
    this.progression = new ProgressionManager();

    this.holdSegmenter = new HoldSegmenter();
    this.holdEvaluators = {
      lsit: new LsitEvaluator(),
      handstand: new HandstandEvaluator(),
      vsit: new VsitEvaluator(),
      planche: new PlancheEvaluator(),
      straddleplanche: new StraddlePlancheEvaluator(),
      planchelean: new PlancheLeanEvaluator(),
      frontlever: new FrontLeverEvaluator(),
      backlever: new BackLeverEvaluator(),
      crowpose: new CrowPoseEvaluator(),
      frogstand: new FrogStandEvaluator(),
      elbowlever: new ElbowLeverEvaluator(),
      ninetydegreehold: new NinetyDegreeHoldEvaluator(),
    };
    this.isHoldMovement = false;
    this.activeHoldEvaluator = null;

    this.setMovement(movementKey);
  }

  setMovement(movementKey) {
    this.movementKey = movementKey;
    this.isHoldMovement = Boolean(this.holdEvaluators[movementKey]);

    this.holdSegmenter.reset();
    Object.values(this.holdEvaluators).forEach((evaluator) => evaluator.reset());
    this.segmenter.reset();
    this.arbitrator.reset();
    this.filter.reset();

    if (this.isHoldMovement) {
      this.activeHoldEvaluator = this.holdEvaluators[movementKey];
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
      const evaluation = this.activeHoldEvaluator.evaluate(landmarks, timestamp);
      const holdResult = this.holdSegmenter.update(evaluation, timestamp);

      let activeCue = null;
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

    const leanRatio = shoulderLean(shoulder, wrist, hip);
    const vertProgress = verticalProgress(shoulder, wrist, hip);

    const meanVis = lm.reduce((acc, curr) => acc + (curr.visibility || 1.0), 0) / lm.length;

    let primarySignal = meanElbow;
    if (this.movementKey === 'squat') primarySignal = meanKnee;
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
