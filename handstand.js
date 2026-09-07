// 🤸 HANDSTAND FORM SCORING
const scoreHandstand = (function () {
  const HANDSTAND_MIN_CONFIDENT_FRAMES = 20;

  const isHandstandFrameConfident = makeConfidenceChecker(Object.values(POSE_LANDMARKS));

  return function scoreHandstand(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isHandstandFrameConfident);

    if (confidentFrames.length < HANDSTAND_MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your hands and feet for enough of the video to score this handstand. Try better lighting or make sure your whole body stays in frame during the hold.",
      };
    }

    const representative = {};
    for (const name in POSE_LANDMARKS) {
      const normalized = medianLandmark(confidentFrames, POSE_LANDMARKS[name]);
      representative[name] = toPixelSpace(normalized, videoWidth, videoHeight);
    }

    if (Object.values(representative).some((p) => !p)) {
      return {
        status: "low_confidence",
        message: "Some key joints weren't visible clearly enough to analyze.",
      };
    }

    const wristMid = midpoint(representative.LEFT_WRIST, representative.RIGHT_WRIST);
    const shoulderMid = midpoint(representative.LEFT_SHOULDER, representative.RIGHT_SHOULDER);
    const hipMid = midpoint(representative.LEFT_HIP, representative.RIGHT_HIP);
    const kneeMid = midpoint(representative.LEFT_KNEE, representative.RIGHT_KNEE);
    const ankleMid = midpoint(representative.LEFT_ANKLE, representative.RIGHT_ANKLE);

    const faults = [];

    // 1️⃣ Elbow Lockout
    const leftElbowAngle = angleBetween(representative.LEFT_WRIST, representative.LEFT_ELBOW, representative.LEFT_SHOULDER);
    const rightElbowAngle = angleBetween(representative.RIGHT_WRIST, representative.RIGHT_ELBOW, representative.RIGHT_SHOULDER);
    const elbowAngle = averageValid([leftElbowAngle, rightElbowAngle]);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 15) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 30 ? "major" : "moderate",
        detail: `Arms are bent roughly ${elbowDeviation.toFixed(0)}° from a straight lockout.`,
      });
    }

    // 2️⃣ Shoulder Alignment
    const shoulderAlignAngle = angleBetween(wristMid, shoulderMid, hipMid);
    const shoulderDeviation = shoulderAlignAngle === null ? 0 : 180 - shoulderAlignAngle;
    if (Math.abs(shoulderDeviation) > 12) {
      faults.push({
        id: "shoulder_misalignment",
        severity: Math.abs(shoulderDeviation) > 25 ? "major" : "moderate",
        detail: `Shoulders aren't stacked directly over your hands (~${shoulderDeviation.toFixed(0)}° off).`,
      });
    }

    // 3️⃣ Hip Alignment (Signed Deviation)
    const hipDeviation = signedBodyLineDeviation(shoulderMid, hipMid, ankleMid);
    if (hipDeviation !== null && Math.abs(hipDeviation) > 10) {
      faults.push({
        id: "hip_pike_or_arch",
        severity: Math.abs(hipDeviation) > 25 ? "major" : "moderate",
        detail: `Your hips are ${hipDeviation > 0 ? "piked forward" : "arched back"} by about ${Math.abs(hipDeviation).toFixed(0)}°.`,
      });
    }

    // 4️⃣ Leg Straightness
    const legAngle = angleBetween(hipMid, kneeMid, ankleMid);
    const legDeviation = legAngle === null ? 0 : 180 - legAngle;
    if (legDeviation > 10) {
      faults.push({
        id: "bent_legs",
        severity: legDeviation > 25 ? "major" : "moderate",
        detail: `Knees are bent roughly ${legDeviation.toFixed(0)}° instead of staying straight.`,
      });
    }

    // 5️⃣ Lateral Lean
    const referenceX = wristMid.x;
    const lateralOffsets = [shoulderMid.x, hipMid.x, ankleMid.x].map((x) => Math.abs(x - referenceX));
    const maxLateralOffset = Math.max(...lateralOffsets);
    const maxLateralOffsetRatio = maxLateralOffset / videoWidth;
    if (maxLateralOffsetRatio > 0.05) {
      faults.push({
        id: "lateral_lean",
        severity: maxLateralOffsetRatio > 0.1 ? "major" : "moderate",
        detail: "Your body is leaning to one side instead of stacking vertically over your hands.",
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
        shoulderAlignAngle: round1(shoulderAlignAngle),
        hipAlignAngle: round1(angleBetween(shoulderMid, hipMid, ankleMid)),
        legAngle: round1(legAngle),
      },
    };
  };
})();
window.scoreHandstand = scoreHandstand;

const validateHandstandVideo = (function () {
  const isHandstandFrameConfident = makeConfidenceChecker(Object.values(POSE_LANDMARKS));
  const VALIDATION_MIN_CONFIDENT_FRAMES = 20;
  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  function isPlausibleHandstandFrame(joints) {
    if (!joints || !joints.wristMid || !joints.shoulderMid || !joints.hipMid || !joints.ankleMid) {
      return false;
    }
    return (
      joints.wristMid.y < joints.shoulderMid.y &&
      joints.shoulderMid.y < joints.hipMid.y &&
      joints.hipMid.y < joints.ankleMid.y
    );
  }

  return function validateHandstandVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isHandstandFrameConfident);

    if (confidentFrames.length < VALIDATION_MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "We could not confidently analyze this video. Keep your full body in frame, use good lighting, and record the movement for at least 3–5 seconds.",
      };
    }

    let plausibleCount = 0;
    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (isPlausibleHandstandFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We could not verify a handstand in this video. Please upload a video where your full body is visible and you are inverted, preferably from the recommended angle.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "A handstand may be present, but the camera angle or framing is unclear. Please re-record with your full body visible and good lighting.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validateHandstandVideo = validateHandstandVideo;