// 🤸 FROG STAND FORM SCORING
const scoreFrogStand = (function () {
  const MIN_CONFIDENT_FRAMES = 15;

  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scoreFrogStand(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

   // Replace the old error return blocks at the top of your function with this:
    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "ok",
        score: 0,
        faults: [{
          id: "tracking_failed",
          severity: "major",
          detail: "Tracking lost on balance points. Position the camera clear of obstacles and avoid loose clothing."
        }],
        angles: { elbowAngle: 0, torsoAngle: 0 }
      };
    }

    const shoulderMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "shoulderMid");
    const hipMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "hipMid");
    const wristMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "wristMid");
    const elbowMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "elbowMid");

    if (!shoulderMid || !hipMid || !wristMid || !elbowMid) {
      return {
        status: "low_confidence",
        message: "Tracking lost on critical arm or torso joints.",
      };
    }

    const faults = [];

    // 1️⃣ Deep Elbow Bend: Frog stand relies on a lower shelf (ideal angle is 85° - 115°)
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    if (elbowAngle !== null && (elbowAngle < 75 || elbowAngle > 125)) {
      faults.push({
        id: "suboptimal_elbow_bend",
        severity: "moderate",
        detail: `Your elbow bend is ${elbowAngle.toFixed(0)}°. Aim for roughly a 90° to 110° bend to establish a solid lateral support base.`,
      });
    }

    // 2️⃣ Torso Pitch: Torso should be angled forward but stabilized
    const dx = hipMid.x - shoulderMid.x;
    const dy = hipMid.y - shoulderMid.y;
    const torsoAngle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    if (torsoAngle < 5 || torsoAngle > 45) {
      faults.push({
        id: "poor_balance_pitch",
        severity: "moderate",
        detail: "Your body is tilting too far forward or sitting too vertical. Find the sweet spot to balance your weight evenly over your palms.",
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
        torsoAngle: round1(torsoAngle)
      },
    };
  };
})();