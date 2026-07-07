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
    const bodyLineDeviation = bodyLineAngle === null ? 0 : 180 - bodyLineAngle;
    if (Math.abs(bodyLineDeviation) > 12) {
      faults.push({
        id: "hip_sag_or_pike",
        severity: Math.abs(bodyLineDeviation) > 25 ? "major" : "moderate",
        detail: `Your hips are ${bodyLineDeviation > 0 ? "piking up" : "sagging downward"} by ${Math.abs(bodyLineDeviation).toFixed(0)}°. Retract your scapula and squeeze your glutes.`,
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