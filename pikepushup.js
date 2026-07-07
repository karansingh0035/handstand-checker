// 💪 PIKE PUSH-UP FORM SCORING
// Rep-based skill tracking the movement cycle inside an inverted 'V' pike position.
const scorePikePushup = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 25;

  // Hysteresis configuration for vertical tracking thresholds
  const TOP_THRESHOLD = 145;    // Arms straight at the top setup
  const BOTTOM_THRESHOLD = 105; // Arms bent at the bottom depth

  // Form standards
  const EXCELLENT_DEPTH_ANGLE = 95; // Elbow angle at deep tripod depth
  const LOCKOUT_ANGLE = 155;        // Elbow angle at complete extension

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
    let phase = "top"; // Start at the top locked-out position
    let currentRepMinElbowAngle = Infinity;
    let currentRepHipAngles = [];

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue;

      const elbowAngle = computeElbowAngle(joints);
      const hipAngle = angleBetween(joints.shoulderMid, joints.hipMid, joints.ankleMid);

      if (elbowAngle === null) continue;

      if (phase === "top" && elbowAngle < BOTTOM_THRESHOLD) {
        // Entering the eccentric/descent phase
        phase = "bottom";
        currentRepMinElbowAngle = elbowAngle;
        currentRepHipAngles = hipAngle !== null ? [hipAngle] : [];
      } else if (phase === "bottom") {
        currentRepMinElbowAngle = Math.min(currentRepMinElbowAngle, elbowAngle);
        if (hipAngle !== null) currentRepHipAngles.push(hipAngle);

        if (elbowAngle > TOP_THRESHOLD) {
          // Completed the concentric push and safely returned to the top lockout
          let maxLockout = elbowAngle;
          for (let lookahead = i + 1; lookahead < Math.min(i + 6, confidentFrames.length); lookahead++) {
            const laJoints = getEffectiveJoints(confidentFrames[lookahead], videoWidth, videoHeight);
            const laAngle = computeElbowAngle(laJoints);
            if (laAngle !== null) maxLockout = Math.max(maxLockout, laAngle);
          }

          // Find the average hip angle during this rep to check if they lost the pike position
          const avgHipAngle = averageValid(currentRepHipAngles);

          reps.push({
            bottomAngle: currentRepMinElbowAngle,
            lockoutAngle: maxLockout,
            avgHipAngle: avgHipAngle,
          });

          phase = "top";
          currentRepMinElbowAngle = Infinity;
          currentRepHipAngles = [];
        }
      }
    }
    return reps;
  }

  return function scorePikePushup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Could not map out enough clean frames. Ensure a clear side view of your hands, hips, and feet.",
      };
    }

    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message: "No reps detected. Lower your head forward toward the floor and press completely back up to activate tracking.",
      };
    }

    const faults = [];

    // 1️⃣ Shallow Reps: Did not achieve a 90-degree elbow bend
    const shallowReps = reps.filter((r) => r.bottomAngle > EXCELLENT_DEPTH_ANGLE);
    if (shallowReps.length > 0) {
      const ratio = shallowReps.length / reps.length;
      faults.push({
        id: "shallow_depth",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${shallowReps.length} of ${reps.length} reps lacked full depth. Lower your body until your elbows form at least a 90° angle.`,
      });
    }

    // 2️⃣ Incomplete Lockout at Top
    const incompleteLockout = reps.filter((r) => r.lockoutAngle < LOCKOUT_ANGLE);
    if (incompleteLockout.length > 0) {
      const ratio = incompleteLockout.length / reps.length;
      faults.push({
        id: "incomplete_lockout",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${incompleteLockout.length} of ${reps.length} reps missed full extension at the top. Push your head back through your arms at the peak.`,
      });
    }

    // 3️⃣ Lost Pike Shape: Hip angle opened up too wide (flattened out into a standard push-up shape)
    const lostPikeReps = reps.filter((r) => r.avgHipAngle !== null && r.avgHipAngle > 115);
    if (lostPikeReps.length > 0) {
      const ratio = lostPikeReps.length / reps.length;
      faults.push({
        id: "lost_pike_alignment",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${lostPikeReps.length} of ${reps.length} reps showed your body flattening out (hip angle over 115°). Keep your hips high and walked-in.`,
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
        bottomAngle: round1(r.bottomAngle),
        lockoutAngle: round1(r.lockoutAngle),
        avgHipAngle: round1(r.avgHipAngle),
      })),
    };
  };
})();