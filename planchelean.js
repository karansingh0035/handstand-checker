// 🤸 PLANCHE LEAN FORM SCORING
const scorePlancheLean = (function () {
  const MIN_CONFIDENT_FRAMES = 15;

  return function scorePlancheLean(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(f => isSideVisible(f, LEFT_SIDE_LANDMARKS) || isSideVisible(f, RIGHT_SIDE_LANDMARKS));

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Ensure your entire body from hands to toes is visible in the frame.",
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