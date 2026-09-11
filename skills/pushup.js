// 💪 PUSH-UP FORM SCORING
const { scorePushup, validatePushupVideo } = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 30;
  const TOP_THRESHOLD = 155;
  const BOTTOM_THRESHOLD = 110;
  const SHALLOW_DEPTH_ANGLE = 100;
  const LOCKOUT_ANGLE = 160;

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

    let phase = "top";
    let currentRepMinElbowAngle = Infinity;
    let currentRepBodyDeviations = [];

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue;

      const elbowAngle = computeElbowAngle(joints);
      const bodyDev = signedBodyLineDeviation(joints.shoulderMid, joints.hipMid, joints.ankleMid);

      if (elbowAngle === null) continue;

      if (phase === "top" && elbowAngle < BOTTOM_THRESHOLD) {
        phase = "bottom";
        currentRepMinElbowAngle = elbowAngle;
        currentRepBodyDeviations = bodyDev !== null ? [bodyDev] : [];
      } else if (phase === "bottom") {
        currentRepMinElbowAngle = Math.min(currentRepMinElbowAngle, elbowAngle);
        if (bodyDev !== null) currentRepBodyDeviations.push(bodyDev);

        if (elbowAngle > TOP_THRESHOLD) {
          let lockoutAngle = elbowAngle;
          for (let lookahead = i + 1; lookahead < Math.min(i + 6, confidentFrames.length); lookahead++) {
            const laJoints = getEffectiveJoints(confidentFrames[lookahead], videoWidth, videoHeight);
            const laAngle = computeElbowAngle(laJoints);
            if (laAngle !== null) lockoutAngle = Math.max(lockoutAngle, laAngle);
          }

          const worstDeviation =
            currentRepBodyDeviations.length > 0
              ? currentRepBodyDeviations.reduce((worst, d) =>
                  Math.abs(d) > Math.abs(worst) ? d : worst
                )
              : null;

          reps.push({
            bottomAngle: currentRepMinElbowAngle,
            lockoutAngle,
            bodyLineDeviation: worstDeviation,
          });

          phase = "top";
          currentRepMinElbowAngle = Infinity;
          currentRepBodyDeviations = [];
        }
      }
    }

    return reps;
  }

  function scorePushup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your arms and body for enough of the video to score these push-ups. Try better lighting, a side-on camera angle, or make sure your whole body stays in frame.",
      };
    }

    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message:
          "Couldn't detect any completed push-up reps in this video. Make sure your full range of motion (top to bottom to top) is visible on camera.",
      };
    }

    const faults = [];

    const shallowReps = reps.filter((r) => r.bottomAngle > SHALLOW_DEPTH_ANGLE);
    if (shallowReps.length > 0) {
      const ratio = shallowReps.length / reps.length;
      faults.push({
        id: "shallow_depth",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${shallowReps.length} of ${reps.length} reps didn't reach full depth — elbows should bend to about 90° or lower.`,
      });
    }

    const incompleteLockoutReps = reps.filter((r) => r.lockoutAngle < LOCKOUT_ANGLE);
    if (incompleteLockoutReps.length > 0) {
      const ratio = incompleteLockoutReps.length / reps.length;
      faults.push({
        id: "incomplete_lockout",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${incompleteLockoutReps.length} of ${reps.length} reps didn't fully lock out the arms at the top.`,
      });
    }

    const misalignedReps = reps.filter(
      (r) => r.bodyLineDeviation !== null && Math.abs(r.bodyLineDeviation) > 12
    );
    if (misalignedReps.length > 0) {
      const ratio = misalignedReps.length / reps.length;
      const avgDeviation = averageValid(misalignedReps.map((r) => r.bodyLineDeviation));
      const sagging = avgDeviation !== null && avgDeviation > 0;

      faults.push({
        id: sagging ? "hip_sag" : "hip_pike",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${misalignedReps.length} of ${reps.length} reps showed hips ${
          sagging ? "sagging downward" : "piking upward"
        } by about ${Math.abs(avgDeviation).toFixed(0)}° instead of maintaining a straight body line.`,
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
        bodyLineDeviation: round1(r.bodyLineDeviation),
      })),
    };
  }

  function computeHorizontalRatio(confidentFrames, videoWidth, videoHeight) {
    let horizontalCount = 0;
    let counted = 0;

    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (!joints || !joints.shoulderMid || !joints.hipMid) continue;
      counted++;

      // 🆕 Same fix as engine/primitives.js's torsoVertical: dx alone only
      // captures "horizontal" when filmed side-on. Front-on/head-on framing
      // (e.g. a laptop webcam facing the person) puts most of a real
      // horizontal torso's extension into z, not x — folding dz into the
      // horizontal component via hypot makes this yaw-invariant instead of
      // side-on-only, same underlying camera-angle blind spot.
      const dx = Math.abs(joints.shoulderMid.x - joints.hipMid.x);
      const dy = Math.abs(joints.shoulderMid.y - joints.hipMid.y);
      const dz = Math.abs((joints.shoulderMid.z || 0) - (joints.hipMid.z || 0));
      const horizontalDist = Math.hypot(dx, dz);
      if (horizontalDist > dy) horizontalCount++;
    }

    return counted > 0 ? horizontalCount / counted : 0;
  }

  const HORIZONTAL_NOT_DETECTED_RATIO = 0.35;
  const HORIZONTAL_UNCLEAR_RATIO = 0.6;

  function validatePushupVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "We could not confidently analyze this video. Keep your full body in frame, use good lighting, and record the movement for at least 3–5 seconds.",
      };
    }

    const horizontalRatio = computeHorizontalRatio(confidentFrames, videoWidth, videoHeight);
    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        valid: false,
        status: "not_detected",
        confidence: horizontalRatio,
        message:
          "We could not verify a push-up motion in this video. Make sure your full range of motion (top to bottom to top) is visible on camera from a side angle.",
      };
    }

    if (horizontalRatio < HORIZONTAL_NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: horizontalRatio,
        message:
          "We could not verify a push-up in this video — your body doesn't look horizontal enough for a push-up. Film from a side angle with your full body visible.",
      };
    }

    if (horizontalRatio < HORIZONTAL_UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: horizontalRatio,
        message:
          "A push-up may be present, but the camera angle or framing is unclear. Please re-record from a side angle with your full body visible.",
      };
    }

    return { valid: true, confidence: horizontalRatio };
  }

  return { scorePushup, validatePushupVideo };
})();

window.scorePushup = scorePushup;
window.validatePushupVideo = validatePushupVideo;