// 🤸 STRADDLE PLANCHE FORM SCORING
const scoreStraddlePlanche = (function () {
  const MIN_CONFIDENT_FRAMES = 15;

  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scoreStraddlePlanche(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);
    // 🐛 FIX: was status:"ok"/score:0 with a fabricated fault — same bug
    // as planchelean.js/pseudoplanchepushup.js/ninetydegreehspu.js.
    // Fixed to match the low_confidence convention used everywhere else.
    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Biomechanical landmarks missing. Make sure your camera is perfectly side-on to evaluate your straddle line.",
      };
    }

    const shoulderMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "shoulderMid");
    const hipMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "hipMid");
    const ankleMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "ankleMid");
    const wristMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "wristMid");
    const elbowMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "elbowMid");

    if (!shoulderMid || !hipMid || !ankleMid || !wristMid || !elbowMid) {
      return {
        status: "low_confidence",
        message: "Could not map out your joints. Make sure loose clothes aren't hiding your hip line.",
      };
    }

    const faults = [];

    // 1️⃣ Elbow Lockout: Arms must be absolutely straight
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 12) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 25 ? "major" : "moderate",
        detail: `Your elbows are bent by ${elbowDeviation.toFixed(0)}°. A valid straddle planche requires completely locked-out arms.`,
      });
    }

    // 2️⃣ Shoulder Lean Depth: Shoulders must be significantly forward of the wrists
    // 🆕 Same fix as pseudoplanchepushup.js's forwardLean: dx alone only
    // captures forward lean when filmed side-on. dz folded in via hypot
    // makes this yaw-invariant. Left as a raw pixel magnitude (not
    // normalized by torso length), same pre-existing scale-invariance
    // caveat as pseudoplanchepushup.js — not fixed here, out of scope for
    // this pass.
    const leanDx = shoulderMid.x - wristMid.x;
    const leanDz = (shoulderMid.z || 0) - (wristMid.z || 0);
    const horizontalLean = Math.hypot(leanDx, leanDz);
    if (horizontalLean < 35) {
      faults.push({
        id: "insufficient_lean",
        severity: "major",
        detail: "Your shoulders aren't leaning far enough forward. You must lean further over your wrists to counterbalance the weight of your legs.",
      });
    }

    // 3️⃣ Hip and Ground Parallel Alignment
    // 🆕 Same fix as planche.js/backlever.js/frontlever.js/90degreehold.js
    const dx = hipMid.x - shoulderMid.x;
    const dy = hipMid.y - shoulderMid.y;
    const dz = (hipMid.z || 0) - (shoulderMid.z || 0);
    const horizontalDist = Math.hypot(dx, dz);
    const tiltFromHorizontal = Math.abs((Math.atan2(dy, horizontalDist) * 180) / Math.PI);
    if (tiltFromHorizontal > 15) {
      faults.push({
        id: "hip_sag_or_pike",
        severity: tiltFromHorizontal > 25 ? "major" : "moderate",
        detail: `Your hip line is unlevel by ${tiltFromHorizontal.toFixed(0)}°. Keep your glutes squeezed to hold your hips level with your shoulders.`,
      });
    }

    let score = 100;
    const severityPenalty = { moderate: 8, major: 18 };
    faults.forEach((f) => { score -= severityPenalty[f.severity] || 0; });
    score = Math.max(0, Math.round(score));

    return {
      status: "ok",
      score,
      faults,
      angles: {
        elbowAngle: round1(elbowAngle),
        tiltFromHorizontal: round1(tiltFromHorizontal),
        leanPixels: round1(horizontalLean)
      },
    };
  };
})();
const validateStraddlePlancheVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 15;
  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  function isPlausibleStraddlePlancheFrame(joints) {
    if (!joints || !joints.shoulderMid || !joints.wristMid || !joints.hipMid) {
      return false;
    }

    // Horizontal torso alignment with hands below shoulders
    const isBodyHorizontal = Math.abs(joints.shoulderMid.y - joints.hipMid.y) < 150;
    const isHandsBelowShoulders = joints.wristMid.y >= joints.shoulderMid.y - 20;

    return isBodyHorizontal && isHandsBelowShoulders;
  }

  return function validateStraddlePlancheVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < VALIDATION_MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "Biomechanical landmarks missing. Make sure your camera is perfectly side-on to evaluate your straddle line.",
      };
    }

    let plausibleCount = 0;
    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (isPlausibleStraddlePlancheFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We couldn't detect a straddle planche hold. Ensure your body is horizontal and supported by your arms.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "Straddle planche detected, but landmark tracking was poor. Ensure high contrast against your background.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validateStraddlePlancheVideo = validateStraddlePlancheVideo;
window.scoreStraddlePlanche = scoreStraddlePlanche;