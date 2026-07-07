// 🤸 90-DEGREE HOLD FORM SCORING
// Scope (v1): Standard two-arm 90-degree hold (bent-arm planche). Body suspended horizontally
// parallel to the ground, with elbows bent at roughly a 90-degree angle. Scored via one
// representative median pose across the clip. Best captured from a complete side-on angle.
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

    // 1️⃣ Elbow Angle Check: Must hold roughly a 90-degree bend
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    if (elbowAngle !== null) {
      const elbowDeviation = elbowAngle - 90; // Positive means too straight, negative means too bent
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

    // 2️⃣ Body Line Alignment: Straight line from shoulders through hips to ankles
    const bodyLineAngle = angleBetween(shoulderMid, hipMid, ankleMid);
    const bodyLineDeviation = bodyLineAngle === null ? 0 : 180 - bodyLineAngle;
    if (Math.abs(bodyLineDeviation) > 15) {
      faults.push({
        id: "hip_misalignment",
        severity: Math.abs(bodyLineDeviation) > 28 ? "major" : "moderate",
        detail: `Your hips are ${bodyLineDeviation > 0 ? "sagging down" : "piking upward"} by about ${Math.abs(bodyLineDeviation).toFixed(0)}° from a straight line.`,
      });
    }

    // 3️⃣ Horizontal Ground Alignment: The entire body axis must stay level with the floor
    const dx = ankleMid.x - shoulderMid.x;
    const dy = ankleMid.y - shoulderMid.y;
    const rawTilt = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    const tiltFromHorizontal = Math.min(rawTilt, Math.abs(180 - rawTilt));
    if (tiltFromHorizontal > 15) {
      faults.push({
        id: "body_not_level",
        severity: tiltFromHorizontal > 25 ? "major" : "moderate",
        detail: `Your body line is tilted ${tiltFromHorizontal.toFixed(0)}° away from horizontal. Lean your weight slightly forward or lift your legs to remain completely level.`,
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