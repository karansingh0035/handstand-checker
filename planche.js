// 🤸 PLANCHE FORM SCORING
// Scope (v1): standard full planche or straddle/tuck variations (evaluated based 
// on a straight line from shoulder to hip). Scored via one representative median pose 
// across the clip. Typically filmed side-on, so it is side-aware.
const scorePlanche = (function () {
  const PLANCHE_MIN_CONFIDENT_FRAMES = 15;

  const isPlancheFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scorePlanche(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isPlancheFrameConfident);

    if (confidentFrames.length < PLANCHE_MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear side-on view of your body for enough frames to score this planche. Ensure your entire body stays in the frame.",
      };
    }

    // Extract a stable representative pose using the median position of joints
    const shoulderMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "shoulderMid");
    const hipMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "hipMid");
    const ankleMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "ankleMid");
    const wristMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "wristMid");
    const elbowMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "elbowMid");

    if (!shoulderMid || !hipMid || !ankleMid || !wristMid || !elbowMid) {
      return {
        status: "low_confidence",
        message: "Key tracking landmarks were blocked or obscured during the hold.",
      };
    }

    const faults = [];

    // 1️⃣ Elbow Lockout: Arms must be perfectly straight (~180°)
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 15) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 30 ? "major" : "moderate",
        detail: `Your arms are bent by roughly ${elbowDeviation.toFixed(0)}°. Focus on locking your elbows completely to support your weight.`,
      });
    }

    // 2️⃣ Body Line Alignment: Straight line from shoulders to hips to ankles
    const bodyLineAngle = angleBetween(shoulderMid, hipMid, ankleMid);
    const bodyLineDeviation = bodyLineAngle === null ? 0 : 180 - bodyLineAngle;
    if (Math.abs(bodyLineDeviation) > 15) {
      faults.push({
        id: "hip_misalignment",
        severity: Math.abs(bodyLineDeviation) > 28 ? "major" : "moderate",
        detail: `Your hips are ${bodyLineDeviation > 0 ? "sagging down" : "piking upward"} by about ${Math.abs(bodyLineDeviation).toFixed(0)}° from a straight line.`,
      });
    }

    // 3️⃣ Horizontal Ground Alignment: The body line should be parallel to the ground
    const dx = ankleMid.x - shoulderMid.x;
    const dy = ankleMid.y - shoulderMid.y;
    const rawTilt = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    const tiltFromHorizontal = Math.min(rawTilt, Math.abs(180 - rawTilt));
    if (tiltFromHorizontal > 15) {
      faults.push({
        id: "body_not_level",
        severity: tiltFromHorizontal > 25 ? "major" : "moderate",
        detail: `Your entire body is tilted ${tiltFromHorizontal.toFixed(0)}° away from horizontal. Push down hard to raise your hips and legs level with your shoulders.`,
      });
    }

    // --- Deduct score by fault severity ---
    const severityPenalty = { moderate: 8, major: 18 };
    let score = 100;
    faults.forEach((f) => {
      score -= severityPenalty[f.severity] || 0;
    });
    score = Math.max(0, Math.round(score));

    return {
      status: "ok",
      score,
      faults,
      angles: {
        elbowAngle: round1(elbowAngle),
        bodyLineAngle: round1(bodyLineAngle),
        tiltFromHorizontal: round1(tiltFromHorizontal),
      },
    };
  };
})();