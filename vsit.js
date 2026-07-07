// 🪑 V-SIT FORM SCORING
// Scope (v1): Standard floor or parallette V-sit. Torso leaning back slightly, 
// with legs compressed tightly upward into an acute V-shape. Scored via median pose.
const scoreVSit = (function () {
  const VSIT_MIN_CONFIDENT_FRAMES = 15;

  const isVSitFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scoreVSit(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isVSitFrameConfident);

    if (confidentFrames.length < VSIT_MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Could not track your side profile clearly. Ensure your hands, hips, and toes remain visible.",
      };
    }

    const shoulderMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "shoulderMid");
    const hipMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "hipMid");
    const kneeMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "kneeMid");
    const ankleMid = medianJointPoint(confidentFrames, videoWidth, videoHeight, "ankleMid");

    if (!shoulderMid || !hipMid || !kneeMid || !ankleMid) {
      return {
        status: "low_confidence",
        message: "Some key leg or hip tracking landmarks were blocked during the hold.",
      };
    }

    const faults = [];

    // 1️⃣ Compression Depth: A V-sit requires an acute hip angle (ideally under 65 degrees)
    const hipAngle = angleBetween(shoulderMid, hipMid, ankleMid);
    // If the angle is too wide, they are doing a standard L-sit instead of a V-sit
    if (hipAngle !== null && hipAngle > 65) {
      const excessAngle = hipAngle - 65;
      faults.push({
        id: "insufficient_compression",
        severity: excessAngle > 20 ? "major" : "moderate",
        detail: `Your hip compression angle is ${hipAngle.toFixed(0)}°. A true V-sit requires compressing your legs much closer to your chest (under 65°).`,
      });
    }

    // 2️⃣ Leg Straightness: Knees must be locked completely out
    const legAngle = angleBetween(hipMid, kneeMid, ankleMid);
    const legDeviation = legAngle === null ? 0 : 180 - legAngle;
    if (legDeviation > 12) {
      faults.push({
        id: "bent_legs",
        severity: legDeviation > 25 ? "major" : "moderate",
        detail: `Your knees are bent by roughly ${legDeviation.toFixed(0)}°. Keep your quads squeezed to lock your legs perfectly straight.`,
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
        hipAngle: round1(hipAngle),
        legAngle: round1(legAngle),
      },
    };
  };
})();