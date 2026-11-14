// 🤸 90-DEGREE HOLD FORM SCORING
const score90DegreeHold = (function () {
  const MIN_CONFIDENT_FRAMES = 15;

  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function score90DegreeHold(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Couldn't gather enough side-on tracking frames. Ensure your entire body stays visible in the frame.",
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
        message: "Key body tracking joints were obscured during the hold.",
      };
    }

    const faults = [];

    // 1️⃣ Elbow Angle Check
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    if (elbowAngle !== null) {
      const elbowDeviation = elbowAngle - 90;
      if (Math.abs(elbowDeviation) > 15) {
        faults.push({
          id: "incorrect_elbow_angle",
          severity: Math.abs(elbowDeviation) > 30 ? "major" : "moderate",
          detail: elbowDeviation > 0 
            ? `Your arms are too straight with an elbow angle of ${elbowAngle.toFixed(0)}°. Keep your elbows bent at a sharp 90° angle.`
            : `Your arms are over-bent with an elbow angle of ${elbowAngle.toFixed(0)}°, dropping your upper body too close to the ground.`
        });
      }
    }

    // 2️⃣ Body Line Alignment
    const bodyLineDeviation = signedBodyLineDeviation(shoulderMid, hipMid, ankleMid);
    if (bodyLineDeviation !== null && Math.abs(bodyLineDeviation) > 12) {
      faults.push({
        id: "hip_misalignment",
        severity: Math.abs(bodyLineDeviation) > 28 ? "major" : "moderate",
        detail: `Your lower body is ${bodyLineDeviation > 0 ? "sagging below horizontal" : "piking upward"} by about ${Math.abs(bodyLineDeviation).toFixed(0)}°. Maintain a straight line from shoulders to toes.`,
      });
    }

    // 3️⃣ Horizontal Ground Alignment
    // 🆕 Same fix as backlever.js/frontlever.js/pushup.js
    const dx = ankleMid.x - shoulderMid.x;
    const dy = ankleMid.y - shoulderMid.y;
    const dz = (ankleMid.z || 0) - (shoulderMid.z || 0);
    const horizontalDist = Math.hypot(dx, dz);
    const tiltFromHorizontal = Math.abs((Math.atan2(dy, horizontalDist) * 180) / Math.PI);
    if (tiltFromHorizontal > 15) {
      faults.push({
        id: "body_not_level",
        severity: tiltFromHorizontal > 25 ? "major" : "moderate",
        detail: `Your body line is tilted ${tiltFromHorizontal.toFixed(0)}° away from horizontal. Lean your weight slightly forward or lift your legs to remain completely level.`,
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
window.score90DegreeHold = score90DegreeHold;

const validate90DegreeHoldVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 15;
  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  function isPlausible90DegreeHoldFrame(joints) {
    if (!joints || !joints.wristMid || !joints.elbowMid || !joints.shoulderMid || !joints.hipMid || !joints.ankleMid) {
      return false;
    }

    const elbowAngle = angleBetween(joints.wristMid, joints.elbowMid, joints.shoulderMid);
    if (elbowAngle === null || elbowAngle < 50 || elbowAngle > 130) return false;

    // 🆕 Same fix as backlever.js/frontlever.js/pushup.js
    const dx = Math.abs(joints.ankleMid.x - joints.shoulderMid.x);
    const dy = Math.abs(joints.ankleMid.y - joints.shoulderMid.y);
    const dz = Math.abs((joints.ankleMid.z || 0) - (joints.shoulderMid.z || 0));
    return Math.hypot(dx, dz) > dy;
  }

  return function validate90DegreeHoldVideo(history, videoWidth, videoHeight) {
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
      if (isPlausible90DegreeHoldFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We could not verify a 90-degree hold in this video. Make sure your full body is visible from the side with elbows bent, suspended horizontally.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "A 90-degree hold may be present, but the camera angle or framing is unclear. Please re-record from the side with your full body visible.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validate90DegreeHoldVideo = validate90DegreeHoldVideo;