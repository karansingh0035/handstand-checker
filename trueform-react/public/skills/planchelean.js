// 🤸 PLANCHE LEAN FORM SCORING
const scorePlancheLean = (function () {
  const MIN_CONFIDENT_FRAMES = 15;

  // 🐛 FIX: this used to return status:"ok" with a fabricated score:0 and
  // a fake fault — meaning an untrackable video showed up as "you scored
  // 0/100" instead of "we couldn't analyze this." Every other scoreFn in
  // this codebase uses status:"low_confidence" here (see crowpose.js's
  // own comment describing this exact fix), which is what tells
  // runFinalFormScoring() to show a re-record message instead of a real
  // score. Fixed to match that convention.
  return function scorePlancheLean(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(f => isSideVisible(f, LEFT_SIDE_LANDMARKS) || isSideVisible(f, RIGHT_SIDE_LANDMARKS));

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Skeletal data incomplete. Ensure your position from toes to head remains visible in the frame.",
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
        message: "Tracking lost on critical reference joints.",
      };
    }

    const faults = [];

    // 1️⃣ Verify Elbow Lockout
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 12) {
      faults.push({
        id: "bent_elbows",
        severity: "moderate",
        detail: `Your elbows are bent by ${elbowDeviation.toFixed(0)}°. Keep your arms fully locked out to build straight-arm scapular strength.`,
      });
    }

    // 2️⃣ Verify Body Line (No piking at the hips)
    const bodyLineAngle = angleBetween(shoulderMid, hipMid, ankleMid);
    const bodyLineDeviation = bodyLineAngle === null ? 0 : 180 - bodyLineAngle;
    if (Math.abs(bodyLineDeviation) > 12) {
      faults.push({
        id: "hip_break",
        severity: Math.abs(bodyLineDeviation) > 24 ? "major" : "moderate",
        detail: `Your hips are broken by ${Math.abs(bodyLineDeviation).toFixed(0)}°. Keep your core hollowed and glutes locked to form a straight line.`,
      });
    }

    // 3️⃣ Measure Lean Angle (Angle of the arm relative to the ground)
    const armLeanAngle = angleBetween(hipMid, shoulderMid, wristMid);

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
        bodyLineAngle: round1(bodyLineAngle),
        armLeanAngle: round1(armLeanAngle)
      },
    };
  };
})();
const validatePlancheLeanVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 15;
  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  function isPlausiblePlancheLeanFrame(joints) {
    if (!joints || !joints.shoulderMid || !joints.wristMid || !joints.ankleMid) {
      return false;
    }

    // Straight-arm plank base position where feet are on ground and shoulders are near wrist height
    const isPlankBase = joints.shoulderMid.y < joints.wristMid.y + 100;
    return isPlankBase;
  }

  return function validatePlancheLeanVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < VALIDATION_MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "Tracking failed. Keep your full body from toes to head clearly visible in the camera frame.",
      };
    }

    let plausibleCount = 0;
    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (isPlausiblePlancheLeanFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We couldn't detect a planche lean position. Ensure you are in a plank position with shoulders leaning forward past your wrists.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "Position detected, but tracking was inconsistent. Maintain high visual contrast against your background.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validatePlancheLeanVideo = validatePlancheLeanVideo;
window.scorePlancheLean = scorePlancheLean;