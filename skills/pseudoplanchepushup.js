// 💪 PSEUDO-PLANCHE PUSH-UP FORM SCORING (PATCHED)
const scorePseudoPlanchePushup = (function () {
  const MIN_CONFIDENT_FRAMES = 25;
  const TOP_ELBOW_THRESHOLD = 155;
  const BOTTOM_ELBOW_THRESHOLD = 100;

  return function scorePseudoPlanchePushup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(f => isSideVisible(f, LEFT_SIDE_LANDMARKS) || isSideVisible(f, RIGHT_SIDE_LANDMARKS));

    // 🐛 FIX: was status:"ok"/score:0 with a fabricated fault — same bug
    // as planchelean.js/crowpose.js's pre-fix behavior. Fixed to match
    // the low_confidence convention used everywhere else.
    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Set up the camera directly to your side. Your full body profile needs to be visible to track your forward lean.",
      };
    }

    let reps = [];
    let phase = "top";
    let minElbowThisRep = Infinity;
    let minLeanThisRep = Infinity;

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue;

      const leftElbow = angleBetween(joints.leftWrist, joints.leftElbow, joints.leftShoulder);
      const rightElbow = averageValid([leftElbow, angleBetween(joints.rightWrist, joints.rightElbow, joints.rightShoulder)]);
      // 🆕 Same fix as pushup.js/planchepushup.js: dx alone only captures
      // forward lean when filmed side-on. dz folded in via hypot makes
      // this yaw-invariant. Left as a raw pixel magnitude (not normalized
      // by torso length) same as before — that's a separate,
      // pre-existing scale-invariance issue (this value depends on
      // filming distance), not fixed here to keep this change scoped to
      // the camera-angle bug.
      const dx = joints.shoulderMid.x - joints.wristMid.x;
      const dz = (joints.shoulderMid.z || 0) - (joints.wristMid.z || 0);
      const forwardLean = Math.hypot(dx, dz);

      if (rightElbow === null) continue;

      if (phase === "top" && rightElbow < BOTTOM_ELBOW_THRESHOLD) {
        phase = "bottom";
        minElbowThisRep = rightElbow;
        minLeanThisRep = forwardLean;
      } else if (phase === "bottom") {
        minElbowThisRep = Math.min(minElbowThisRep, rightElbow);
        minLeanThisRep = Math.min(minLeanThisRep, forwardLean);

        if (rightElbow > TOP_ELBOW_THRESHOLD) {
          reps.push({ minElbow: minElbowThisRep, minLean: minLeanThisRep });
          phase = "top";
          minElbowThisRep = Infinity;
          minLeanThisRep = Infinity;
        }
      }
    }

    // 🐛 FIX: was status:"ok"/score:0 with a fabricated fault — same bug
    // as above. Every other file's zero-reps path uses
    // status:"no_reps_detected" (see pushup.js/pikepushup.js/squat.js
    // etc.) — matched here for the same reason.
    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message: "No complete push-up repetitions detected. Make sure you lower your chest fully near the ground and lock your arms out completely at the top of each rep.",
      };
    }

    const faults = [];
    const lostLeanReps = reps.filter(r => r.minLean < 25);
    if (lostLeanReps.length > 0) {
      faults.push({
        id: "lost_planche_lean",
        severity: "major",
        detail: `${lostLeanReps.length} rep(s) lacked a forward lean. Keep your shoulders pushed past your hands throughout the entire set.`
      });
    }

    const shallowReps = reps.filter(r => r.minElbow > 95);
    if (shallowReps.length > 0) {
      faults.push({
        id: "shallow_depth",
        severity: "moderate",
        detail: `${shallowReps.length} rep(s) lacked clean depth. Break parallel with your elbows at the bottom.`
      });
    }

    let score = 100;
    const severityPenalty = { moderate: 10, major: 20 };
    faults.forEach((f) => { score -= severityPenalty[f.severity] || 0; });
    score = Math.max(0, Math.round(score));

    return {
      status: "ok",
      score,
      faults,
      repCount: reps.length,
      reps: reps.map(r => ({ minElbow: round1(r.minElbow), minLean: round1(r.minLean) }))
    };
  };
})();
const validatePseudoPlanchePushupVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 20;
  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  function isPlausiblePPPUFrame(joints) {
    if (!joints || !joints.shoulderMid || !joints.wristMid || !joints.hipMid) {
      return false;
    }

    // Plank base where shoulders are near wrist level with a slight horizontal displacement
    const isHorizontalPlank = joints.shoulderMid.y < joints.wristMid.y + 120;
    return isHorizontalPlank;
  }

  return function validatePseudoPlanchePushupVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < VALIDATION_MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "Set up the camera directly to your side. Your full body profile needs to be visible to track your forward lean.",
      };
    }

    let plausibleCount = 0;
    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (isPlausiblePPPUFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We couldn't detect pseudo-planche push-ups in this video. Perform push-ups from a plank position with forward shoulder lean.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "Push-up movement was detected, but tracking was unstable. Ensure a steady side-on perspective with good lighting.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validatePseudoPlanchePushupVideo = validatePseudoPlanchePushupVideo;
window.scorePseudoPlanchePushup = scorePseudoPlanchePushup;