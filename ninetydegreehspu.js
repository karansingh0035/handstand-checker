// 💪 90-DEGREE HANDSTAND PUSH-UP FORM SCORING
const score90DegreeHSPU = (function () {
  const MIN_CONFIDENT_FRAMES = 25;

  // Hysteresis config: Tracking the vertical-to-horizontal-to-vertical path
  const STATE_TOP_ELBOW = 150;    // Arms nearly straight at the vertical peak
  const STATE_BOTTOM_ELBOW = 110; // Arms bent at the horizontal bottom

  return function score90DegreeHSPU(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(f => isSideVisible(f, LEFT_SIDE_LANDMARKS) || isSideVisible(f, RIGHT_SIDE_LANDMARKS));

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "A strict side view is required to monitor your body tilt and elbow transitions.",
      };
    }

    let reps = [];
    let phase = "top"; // Start in a vertical handstand
    let minElbowAngleThisRep = Infinity;
    let bottomTiltThisRep = Infinity;

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue;

      // Calculate elbow bend
      const leftElbow = angleBetween(joints.leftWrist, joints.leftElbow, joints.leftShoulder);
      const rightElbow = angleBetween(joints.rightWrist, joints.rightElbow, joints.rightShoulder);
      const currentElbow = averageValid([leftElbow, rightElbow]);

      // Calculate body tilt relative to the horizon (0° = horizontal, 90° = vertical)
      const dx = joints.hipMid.x - joints.shoulderMid.x;
      const dy = joints.hipMid.y - joints.shoulderMid.y;
      const currentTilt = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
      const normalizedTilt = Math.min(currentTilt, Math.abs(180 - currentTilt));

      if (currentElbow === null) continue;

      if (phase === "top" && currentElbow < STATE_BOTTOM_ELBOW) {
        phase = "bottom";
        minElbowAngleThisRep = currentElbow;
        bottomTiltThisRep = normalizedTilt;
      } else if (phase === "bottom") {
        minElbowAngleThisRep = Math.min(minElbowAngleThisRep, currentElbow);
        bottomTiltThisRep = Math.min(bottomTiltThisRep, normalizedTilt);

        if (currentElbow > STATE_TOP_ELBOW && normalizedTilt > 65) {
          // Returned to a vertical handstand position
          reps.push({
            minElbow: minElbowAngleThisRep,
            bottomTilt: bottomTiltThisRep,
          });
          phase = "top";
          minElbowAngleThisRep = Infinity;
          bottomTiltThisRep = Infinity;
        }
      }
    }

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message: "No reps detected. Ensure you lower into a horizontal position before pressing back up to a handstand.",
      };
    }

    const faults = [];

    // 1️⃣ Check for Shallow Depth (Elbows must hit a clean 90-degree angle)
    const shallowReps = reps.filter(r => r.minElbow > 100);
    if (shallowReps.length > 0) {
      faults.push({
        id: "shallow_depth",
        severity: "moderate",
        detail: `${shallowReps.length} rep(s) lacked clean depth. Your elbows must hit a 90° angle at the bottom.`,
      });
    }

    // 2️⃣ Check for Poor Transition to Horizontal (Failing to tilt into a 90-degree hold structure)
    const badTiltReps = reps.filter(r => r.bottomTilt > 30);
    if (badTiltReps.length > 0) {
      faults.push({
        id: "failed_horizontal_transition",
        severity: "major",
        detail: `${badTiltReps.length} rep(s) didn't achieve a horizontal body line. Your body must tilt down parallel to the floor at the bottom of the movement.`,
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
        bottomTilt: round1(r.bottomTilt)
      }))
    };
  };
})();