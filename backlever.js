// 🤸 BACK LEVER FORM SCORING
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

    // 1️⃣ Elbow Lockout
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 15) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 30 ? "major" : "moderate",
        detail: `Your arms are bent by roughly ${elbowDeviation.toFixed(0)}°. Keep your elbows fully locked to protect your joints and maintain structural leverage.`,
      });
    }

    // 2️⃣ Hip Alignment
    const bodyLineDeviation = signedBodyLineDeviation(shoulderMid, hipMid, ankleMid);
    if (bodyLineDeviation !== null && Math.abs(bodyLineDeviation) > 12) {
      faults.push({
        id: "hip_misalignment",
        severity: Math.abs(bodyLineDeviation) > 28 ? "major" : "moderate",
        detail: `Your hips are ${bodyLineDeviation > 0 ? "sagging downward" : "piking upward"} by about ${Math.abs(bodyLineDeviation).toFixed(0)}°. Squeeze your glutes and core to keep your line straight.`,
      });
    }

    // 3️⃣ Horizontal Ground Alignment
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
        bodyLineAngle: round1(angleBetween(shoulderMid, hipMid, ankleMid)),
        tiltFromHorizontal: round1(tiltFromHorizontal),
      },
    };
  };
})();
window.scoreBackLever = scoreBackLever;

const validateBackLeverVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 15;
  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  function isPlausibleLeverFrame(joints) {
    if (!joints || !joints.wristMid || !joints.elbowMid || !joints.shoulderMid || !joints.hipMid || !joints.ankleMid) {
      return false;
    }

    const elbowAngle = angleBetween(joints.wristMid, joints.elbowMid, joints.shoulderMid);
    const armsStraight = elbowAngle !== null && elbowAngle > 155;

    const dx = Math.abs(joints.ankleMid.x - joints.shoulderMid.x);
    const dy = Math.abs(joints.ankleMid.y - joints.shoulderMid.y);
    const isHorizontal = dx > dy;
    const bodyBelowGrip = joints.shoulderMid.y > joints.wristMid.y;

    return armsStraight && isHorizontal && bodyBelowGrip;
  }

  return function validateBackLeverVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < VALIDATION_MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "We could not confidently analyze this video. Keep your full body in frame, use good lighting, and record the hold for at least 3–5 seconds.",
      };
    }

    let plausibleCount = 0;
    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (isPlausibleLeverFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We could not verify a back lever in this video. Make sure your body is horizontal below the bar with straight arms, filmed from the side.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "A lever hold may be present, but the camera angle or framing is unclear. Please re-record from the side with your full body visible.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validateBackLeverVideo = validateBackLeverVideo;