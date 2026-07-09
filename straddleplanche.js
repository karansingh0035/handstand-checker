// 🤸 STRADDLE PLANCHE FORM SCORING
const scoreStraddlePlanche = (function () {
  const MIN_CONFIDENT_FRAMES = 15;

  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  return function scoreStraddlePlanche(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Position your camera at a clean side profile to accurately measure your planche lean.",
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
        message: "Could not map out your joints. Make sure loose clothes aren't hiding your hip line.",
      };
    }

    const faults = [];

    // 1️⃣ Elbow Lockout: Arms must be absolutely straight
    const elbowAngle = angleBetween(wristMid, elbowMid, shoulderMid);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 12) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 25 ? "major" : "moderate",
        detail: `Your elbows are bent by ${elbowDeviation.toFixed(0)}°. A valid straddle planche requires completely locked-out arms.`,
      });
    }

    // 2️⃣ Shoulder Lean Depth: Shoulders must be significantly forward of the wrists
    const horizontalLean = Math.abs(shoulderMid.x - wristMid.x);
    if (horizontalLean < 35) {
      faults.push({
        id: "insufficient_lean",
        severity: "major",
        detail: "Your shoulders aren't leaning far enough forward. You must lean further over your wrists to counterbalance the weight of your legs.",
      });
    }

    // 3️⃣ Hip and Ground Parallel Alignment
    const dx = hipMid.x - shoulderMid.x;
    const dy = hipMid.y - shoulderMid.y;
    const lineTilt = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    const tiltFromHorizontal = Math.min(lineTilt, Math.abs(180 - lineTilt));
    if (tiltFromHorizontal > 15) {
      faults.push({
        id: "hip_sag_or_pike",
        severity: tiltFromHorizontal > 25 ? "major" : "moderate",
        detail: `Your hip line is unlevel by ${tiltFromHorizontal.toFixed(0)}°. Keep your glutes squeezed to hold your hips level with your shoulders.`,
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
        tiltFromHorizontal: round1(tiltFromHorizontal),
        leanPixels: round1(horizontalLean)
      },
    };
  };
})();