// 💪 PULL-UP FORM SCORING
// Rep-based skill tracking tracking the cycle from extended arm hang -> full pull -> lockout.
const scorePullup = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 30;

  // Hysteresis configuration for pull-up cycle movement thresholds
  const BOTTOM_THRESHOLD = 145; // Deemed "at the bottom" when arms straighten out past this
  const TOP_THRESHOLD = 80;     // Deemed "at the top" when arms bend past this

  // Form standards
  const EXCELLENT_DEPTH_ANGLE = 65;  // Elite chin-over-bar pull depth
  const LOCKOUT_ANGLE = 155;         // Full elbow extension hanging at bottom

  function computeElbowAngle(joints) {
    if (!joints) return null;
    if (joints.leftElbow && joints.rightElbow) {
      const left = angleBetween(joints.leftWrist, joints.leftElbow, joints.leftShoulder);
      const right = angleBetween(joints.rightWrist, joints.rightElbow, joints.rightShoulder);
      return averageValid([left, right]);
    }
    const elbow = joints.leftElbow || joints.rightElbow;
    const wrist = joints.leftWrist || joints.rightWrist;
    const shoulder = joints.leftShoulder || joints.rightShoulder;
    return angleBetween(wrist, elbow, shoulder);
  }

  function detectReps(confidentFrames, videoWidth, videoHeight) {
    const reps = [];
    let phase = "bottom"; // Pull-ups natively initialize hanging from the bottom
    let currentRepMinElbowAngle = Infinity;
    let currentRepBodyAlignAngles = [];

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue;

      const elbowAngle = computeElbowAngle(joints);
      const bodyAlignAngle = angleBetween(joints.shoulderMid, joints.hipMid, joints.ankleMid);

      if (elbowAngle === null) continue;

      if (phase === "bottom" && elbowAngle < TOP_THRESHOLD) {
        // Ascending into a pull-up rep
        phase = "top";
        currentRepMinElbowAngle = elbowAngle;
        currentRepBodyAlignAngles = bodyAlignAngle !== null ? [bodyAlignAngle] : [];
      } else if (phase === "top") {
        currentRepMinElbowAngle = Math.min(currentRepMinElbowAngle, elbowAngle);
        if (bodyAlignAngle !== null) currentRepBodyAlignAngles.push(bodyAlignAngle);

        if (elbowAngle > BOTTOM_THRESHOLD) {
          // Completed down phase and returned safely to the dead-hang bottom zone
          let lockoutAngle = elbowAngle;
          for (let lookahead = i + 1; lookahead < Math.min(i + 6, confidentFrames.length); lookahead++) {
            const laJoints = getEffectiveJoints(confidentFrames[lookahead], videoWidth, videoHeight);
            const laAngle = computeElbowAngle(laJoints);
            if (laAngle !== null) lockoutAngle = Math.max(lockoutAngle, laAngle);
          }

          const worstBodyAlign =
            currentRepBodyAlignAngles.length > 0
              ? currentRepBodyAlignAngles.reduce((worst, a) =>
                  Math.abs(180 - a) > Math.abs(180 - worst) ? a : worst
                )
              : null;

          reps.push({
            topAngle: currentRepMinElbowAngle,
            lockoutAngle,
            bodyAlignAngle: worstBodyAlign,
          });

          phase = "bottom";
          currentRepMinElbowAngle = Infinity;
          currentRepBodyAlignAngles = [];
        }
      }
    }
    return reps;
  }

  return function scorePullup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Could not track your pull-up cleanly. Ensure a clear side view from your hands down to your ankles.",
      };
    }

    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message: "No completed pull-up reps detected. Ensure you cross through full arm extension up to chin clearing the bar.",
      };
    }

    const faults = [];

    // 1️⃣ Shallow Reps (No chin over bar)
    const shallowReps = reps.filter((r) => r.topAngle > EXCELLENT_DEPTH_ANGLE);
    if (shallowReps.length > 0) {
      const ratio = shallowReps.length / reps.length;
      faults.push({
        id: "shallow_pull",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${shallowReps.length} of ${reps.length} reps lacked full height. Pull all the way until your chest/chin clears the bar line.`,
      });
    }

    // 2️⃣ Incomplete Extension at Bottom (No dead hang / cutting reps short)
    const incompleteLockout = reps.filter((r) => r.lockoutAngle < LOCKOUT_ANGLE);
    if (incompleteLockout.length > 0) {
      const ratio = incompleteLockout.length / reps.length;
      faults.push({
        id: "half_reps_bottom",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${incompleteLockout.length} of ${reps.length} reps did not achieve full extension at the bottom. Lock out your arms for full range.`,
      });
    }

    // 3️⃣ Kipping / Body Alignment (Excessive leg swing or piking)
    const misalignedReps = reps.filter(
      (r) => r.bodyAlignAngle !== null && Math.abs(180 - r.bodyAlignAngle) > 20
    );
    if (misalignedReps.length > 0) {
      const ratio = misalignedReps.length / reps.length;
      faults.push({
        id: "kipping_pullup",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${misalignedReps.length} of ${reps.length} reps showed significant leg swinging or piking. Keep your core tight and movement strict.`,
      });
    }

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
      repCount: reps.length,
      reps: reps.map((r) => ({
        topAngle: round1(r.topAngle),
        lockoutAngle: round1(r.lockoutAngle),
        bodyAlignAngle: round1(r.bodyAlignAngle),
      })),
    };
  };
})();