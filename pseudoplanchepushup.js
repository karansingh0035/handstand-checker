// 💪 PSEUDO-PLANCHE PUSH-UP FORM SCORING (PATCHED)
const scorePseudoPlanchePushup = (function () {
  const MIN_CONFIDENT_FRAMES = 25;
  const TOP_ELBOW_THRESHOLD = 155;
  const BOTTOM_ELBOW_THRESHOLD = 100;

  return function scorePseudoPlanchePushup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(f => isSideVisible(f, LEFT_SIDE_LANDMARKS) || isSideVisible(f, RIGHT_SIDE_LANDMARKS));

    // 🛠️ FIX 1: Low visibility fallback
    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "ok",
        score: 0,
        faults: [{
          id: "low_visibility",
          severity: "major",
          detail: "Set up the camera directly to your side. Your full body profile needs to be visible to track your forward lean."
        }],
        repCount: 0,
        reps: []
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
      const forwardLean = Math.abs(joints.shoulderMid.x - joints.wristMid.x);

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

    // 🛠️ FIX 2: Zero reps fallback
    if (reps.length === 0) {
      return {
        status: "ok",
        score: 0,
        faults: [{
          id: "no_reps_completed",
          severity: "major",
          detail: "No complete push-up repetitions detected. Make sure you lower your chest fully near the ground and lock your arms out completely at the top of each rep."
        }],
        repCount: 0,
        reps: []
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