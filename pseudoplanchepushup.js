// 💪 PSEUDO-PLANCHE PUSH-UP FORM SCORING
const scorePseudoPlanchePushup = (function () {
  const MIN_CONFIDENT_FRAMES = 25;
  const TOP_ELBOW_THRESHOLD = 155;
  const BOTTOM_ELBOW_THRESHOLD = 100;

  return function scorePseudoPlanchePushup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(f => isSideVisible(f, LEFT_SIDE_LANDMARKS) || isSideVisible(f, RIGHT_SIDE_LANDMARKS));

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Set up the camera directly to your side to monitor your forward lean and push-up depth.",
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
      const rightElbow = angleBetween(joints.rightWrist, joints.rightElbow, joints.rightShoulder);
      const currentElbow = averageValid([leftElbow, rightElbow]);

      // Calculate forward lean displacement (Shoulder X vs Wrist X)
      const forwardLean = Math.abs(joints.shoulderMid.x - joints.wristMid.x);

      if (currentElbow === null) continue;

      if (phase === "top" && currentElbow < BOTTOM_ELBOW_THRESHOLD) {
        phase = "bottom";
        minElbowThisRep = currentElbow;
        minLeanThisRep = forwardLean;
      } else if (phase === "bottom") {
        minElbowThisRep = Math.min(minElbowThisRep, currentElbow);
        minLeanThisRep = Math.min(minLeanThisRep, forwardLean);

        if (currentElbow > TOP_ELBOW_THRESHOLD) {
          reps.push({
            minElbow: minElbowThisRep,
            minLean: minLeanThisRep
          });
          phase = "top";
          minElbowThisRep = Infinity;
          minLeanThisRep = Infinity;
        }
      }
    }

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message: "No push-up repetitions detected. Lower your chest completely to the floor and lock out at the top.",
      };
    }

    const faults = [];

    // 1️⃣ Check for Loss of Forward Lean (Pushing your hips back instead of straight up)
    const lostLeanReps = reps.filter(r => r.minLean < 25);
    if (lostLeanReps.length > 0) {
      faults.push({
        id: "lost_planche_lean",
        severity: "major",
        detail: `${lostLeanReps.length} rep(s) lacked a sufficient forward lean. Do not let your body shift backward as you push up from the floor.`,
      });
    }

    // 2️⃣ Check for Shallow Depth
    const shallowReps = reps.filter(r => r.minElbow > 95);
    if (shallowReps.length > 0) {
      faults.push({
        id: "shallow_depth",
        severity: "moderate",
        detail: `${shallowReps.length} rep(s) lacked full depth. Lower your chest until your elbows match or pass a 90° angle.`,
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
      repCount: reps.length,
      reps: reps.map(r => ({
        minElbow: round1(r.minElbow),
        minLean: round1(r.minLean)
      }))
    };
  };
})();