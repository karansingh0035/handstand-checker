// 🤸 CROW POSE FORM SCORING
const scoreCrowPose = (function () {
  const MIN_CONFIDENT_FRAMES = 15;

  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scoreCrowPose(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);
// Replace the old error return blocks at the top of your function with this:
    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "ok",
        score: 0,
        faults: [{
          id: "tracking_failed",
          severity: "major",
          detail: "Couldn't gather enough clean profile frames. Keep your entire body in the camera's view during the hold."
        }],
        angles: { elbowAngle: 0, hipHeightDiff: 0 }
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