// 🤸 FRONT LEVER FORM SCORING
// Scope (v1): standard horizontal front lever hold. Scored via one representative 
// median pose across the clip. Best captured from a complete side-on angle.
const scoreFrontLever = (function () {
  const FRONT_LEVER_MIN_CONFIDENT_FRAMES = 15;

  const isFrontLeverFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scoreFrontLever(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrontLeverFrameConfident);

    if (confidentFrames.length < FRONT_LEVER_MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't gather enough side-on tracking frames. Make sure your hands, hips, and feet are visible simultaneously.",
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
        message: "Some key tracking joints were obscured during the hold.",
      };
    }

    const faults = [];

    // 1️⃣ Elbow Lockout: Arms must stay straight under the bar
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 15) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 30 ? "major" : "moderate",
        detail: `Knees/arms are slightly compromised with an elbow bend of ${elbowDeviation.toFixed(0)}°. Keep elbows locked out.`,
      });
    }

    // 2️⃣ Hip Sag/Pike: Body alignment from shoulder through hip to ankle
    const bodyLineAngle = angleBetween(shoulderMid, hipMid, ankleMid);
    const bodyLineDeviation = signedBodyLineDeviation(shoulderMid, hipMid, ankleMid);
    if (Math.abs(bodyLineDeviation) > 12) {
      faults.push({
        id: "hip_sag_or_pike",
        severity: Math.abs(bodyLineDeviation) > 25 ? "major" : "moderate",
        detail: `Your hips are ${bodyLineDeviation > 0 ? "piking up" : "sagging downward"} by ${Math.abs(bodyLineDeviation).toFixed(0)}°. Retract your scapula and squeeze your glutes.`,
      });
    }

    // 3️⃣ Horizontal Ground Alignment
    // 🆕 Same fix as backlever.js/pushup.js: fold dz into the horizontal
    // component for yaw-invariance; hypot() being non-negative also lets
    // us drop the old fold-down trick.
    const dx = ankleMid.x - shoulderMid.x;
    const dy = ankleMid.y - shoulderMid.y;
    const dz = (ankleMid.z || 0) - (shoulderMid.z || 0);
    const horizontalDist = Math.hypot(dx, dz);
    const tiltFromHorizontal = Math.abs((Math.atan2(dy, horizontalDist) * 180) / Math.PI);
    if (tiltFromHorizontal > 15) {
      faults.push({
        id: "lever_not_parallel",
        severity: tiltFromHorizontal > 25 ? "major" : "moderate",
        detail: `Your lever is resting at a ${tiltFromHorizontal.toFixed(0)}° tilt off horizontal. Pull the bar down to your hips to elevate your lower body.`,
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
        elbowAngle: round1(elbowAngle),
        bodyLineAngle: round1(bodyLineAngle),
        tiltFromHorizontal: round1(tiltFromHorizontal),
      },
    };
  };
})();
window.scoreFrontLever = scoreFrontLever;

// 🆕 FRONT LEVER SKILL-VERIFICATION CHECK
const validateFrontLeverVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 15;
  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  function isPlausibleFrontLeverFrame(joints) {
    if (!joints || !joints.wristMid || !joints.elbowMid || !joints.shoulderMid || !joints.hipMid || !joints.ankleMid) {
      return false;
    }

    const elbowAngle = angleBetween(joints.wristMid, joints.elbowMid, joints.shoulderMid);
    const armsStraight = elbowAngle !== null && elbowAngle > 150;

    // 🆕 Same fix as backlever.js/pushup.js
    const dx = Math.abs(joints.ankleMid.x - joints.shoulderMid.x);
    const dy = Math.abs(joints.ankleMid.y - joints.shoulderMid.y);
    const dz = Math.abs((joints.ankleMid.z || 0) - (joints.shoulderMid.z || 0));
    const isHorizontal = Math.hypot(dx, dz) > dy;

    // Body hangs suspended below hands/grip
    const bodyBelowGrip = joints.shoulderMid.y > joints.wristMid.y;

    return armsStraight && isHorizontal && bodyBelowGrip;
  }

  return function validateFrontLeverVideo(history, videoWidth, videoHeight) {
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
      if (isPlausibleFrontLeverFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We could not verify a front lever in this video. Make sure your body is horizontal below the bar with straight arms, filmed from the side.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "A front lever hold may be present, but the camera angle or framing is unclear. Please re-record from the side with your full body visible.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validateFrontLeverVideo = validateFrontLeverVideo;