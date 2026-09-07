// 🤸 CROW POSE FORM SCORING
const scoreCrowPose = (function () {
  const MIN_CONFIDENT_FRAMES = 15;

  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scoreCrowPose(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    // 🐛 FIX: this used to return status:"ok" with a fabricated score:0 and
    // a fake "tracking_failed" fault — meaning an untrackable video showed
    // up in the UI as "you scored 0/100," not as "we couldn't analyze this."
    // Every other scoreFn in this codebase uses status:"low_confidence" here,
    // which is what tells runFinalFormScoring() to show a re-record message
    // instead of a real score. Fixed to match that convention.
    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Couldn't gather enough clean profile frames. Keep your entire body in the camera's view during the hold.",
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
        message: "Key balance landmarks were hidden or blocked during the hold.",
      };
    }

    const faults = [];

    // 1️⃣ Elbow Flexion: Crow pose requires bent arms (typically between 90° and 135°)
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    if (elbowAngle !== null && elbowAngle > 140) {
      faults.push({
        id: "arms_too_straight",
        severity: elbowAngle > 165 ? "major" : "moderate",
        detail: `Your elbow angle is ${elbowAngle.toFixed(0)}°. For a classic Crow Pose, keep your elbows bent to create a stable shelf for your knees.`,
      });
    }

    // 2️⃣ Hip Elevation: Hips should be higher than (or level with) your shoulders
    // In screen coordinates, a smaller Y value means higher up on the screen
    if (hipMid.y > shoulderMid.y + 20) {
      faults.push({
        id: "low_hips",
        severity: "moderate",
        detail: "Your hips are dropping below your shoulder line. Engage your core and round your upper back to lift your hips higher.",
      });
    }

    // 3️⃣ Feet Clearance: Check if ankles are tucked up safely off the ground relative to wrists
    if (ankleMid.y >= wristMid.y - 30) {
      faults.push({
        id: "feet_too_low",
        severity: "major",
        detail: "Your feet are too close to the floor. Focus on pulling your heels tightly up toward your glutes.",
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
      angles: {
        elbowAngle: round1(elbowAngle),
        hipHeightDiff: round1(shoulderMid.y - hipMid.y)
      },
    };
  };
})();
window.scoreCrowPose = scoreCrowPose;

// 🆕 CROW POSE SKILL-VERIFICATION CHECK
// Runs BEFORE scoreCrowPose, checking per-frame plausibility. Crow pose is
// compact and tucked — bent elbows, hips elevated toward shoulder height,
// and (distinctively, unlike the extended-body-line holds like levers,
// planche, or 90° hold) the ANKLES stay close to the WRISTS rather than
// far from them, since the feet are lifted up near the hands rather than
// extended out in a straight line. This geometric compactness is the main
// thing distinguishing crow pose from the other static holds already
// validated, not just from "clearly wrong" footage like walking.
const validateCrowPoseVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 15;

  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  // Pixel-offset constants (20, 30) intentionally mirror scoreCrowPose's own
  // existing fault thresholds above, for consistency within this file — note
  // this inherits the same limitation scoreCrowPose already has: a fixed
  // pixel offset isn't scale-invariant across different filming distances,
  // unlike the ratio-based thresholds used elsewhere in this codebase (e.g.
  // handstand.js's lateral-lean check). Not a new problem introduced here.
  function isPlausibleCrowFrame(joints) {
    if (!joints || !joints.wristMid || !joints.elbowMid || !joints.shoulderMid || !joints.hipMid || !joints.ankleMid) {
      return false;
    }

    const elbowAngle = angleBetween(joints.wristMid, joints.elbowMid, joints.shoulderMid);
    const elbowBent = elbowAngle !== null && elbowAngle > 60 && elbowAngle < 150;

    const hipsElevated = joints.hipMid.y <= joints.shoulderMid.y + 20;

    const feetTucked = joints.ankleMid.y < joints.wristMid.y + 30;

    return elbowBent && hipsElevated && feetTucked;
  }

  return function validateCrowPoseVideo(history, videoWidth, videoHeight) {
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
      if (isPlausibleCrowFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We could not verify a crow pose in this video. Make sure your knees are tucked near your elbows with your feet lifted off the ground, filmed from the side.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "A crow pose may be present, but the camera angle or framing is unclear. Please re-record from the side with your full body visible.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validateCrowPoseVideo = validateCrowPoseVideo;