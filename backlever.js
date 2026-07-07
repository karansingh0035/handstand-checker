// 🤸 BACK LEVER FORM SCORING
// Scope (v1): Standard horizontal back lever hold (face down). Scored via one 
// representative median pose across the clip. Best captured from a strict side-on angle.
const scoreBackLever = (function () {
  const BACK_LEVER_MIN_CONFIDENT_FRAMES = 15;

  const isBackLeverFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scoreBackLever(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isBackLeverFrameConfident);

    if (confidentFrames.length < BACK_LEVER_MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't gather enough side-on tracking frames. Make sure your entire body from shoulders to ankles is in frame.",
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
        message: "Key tracking landmarks were obscured or hidden during the hold.",
      };
    }

    const faults = [];

    // 1️⃣ Elbow Lockout: Arms must stay fully locked under tension
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 15) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 30 ? "major" : "moderate",
        detail: `Your arms are bent by roughly ${elbowDeviation.toFixed(0)}°. Keep your elbows fully locked to protect your joints and maintain structural leverage.`,
      });
    }

    // 2️⃣ Hip Alignment: Straight line from shoulders through hips to ankles
    const bodyLineAngle = angleBetween(shoulderMid, hipMid, ankleMid);
    const bodyLineDeviation = bodyLineAngle === null ? 0 : 180 - bodyLineAngle;
    if (Math.abs(bodyLineDeviation) > 15) {
      faults.push({
        id: "hip_misalignment",
        severity: Math.abs(bodyLineDeviation) > 28 ? "major" : "moderate",
        detail: `Your hips are ${bodyLineDeviation > 0 ? "sagging downward" : "piking upward"} by about ${Math.abs(bodyLineDeviation).toFixed(0)}°. Squeeze your glutes and core to keep your line straight.`,
      });
    }

    // 3️⃣ Horizontal Ground Alignment: The body axis must be level with the floor
    const dx = ankleMid.x - shoulderMid.x;
    const dy = ankleMid.y - shoulderMid.y;
    const rawTilt = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    const tiltFromHorizontal = Math.min(rawTilt, Math.abs(180 - rawTilt));
    if (tiltFromHorizontal > 15) {
      faults.push({
        id: "lever_not_parallel",
        severity: tiltFromHorizontal > 25 ? "major" : "moderate",
        detail: `Your body line is tilted ${tiltFromHorizontal.toFixed(0)}° away from horizontal. Pull down against the bar to raise your lower half level with your head.`,
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