// 💪 MUSCLE-UP FORM SCORING
// Scope (v1): Bar muscle-up analysis tracking transitions across pull-to-dip phases.
const scoreMuscleUp = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 25;
  const DIP_LOCKOUT_ANGLE = 160; // Complete extension at the absolute top peak of the dip

  function detectReps(confidentFrames, videoWidth, videoHeight) {
    const reps = [];
    let phase = "hang"; // Phase sequencing: hang -> pull -> dip_lockout
    let maxKippingDeviation = 0;
    let minDipAngleAtTop = Infinity;

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue;

      // Calculate vertical spatial orientation to verify if shoulders are over or under the hands
      const shouldersAboveBar = joints.shoulderMid.y < joints.wristMid.y;
      
      // Calculate active structural joints
      const leftElbow = joints.leftWrist && joints.leftElbow && joints.leftShoulder
        ? angleBetween(joints.leftWrist, joints.leftElbow, joints.leftShoulder) : null;
      const rightElbow = joints.rightWrist && joints.rightElbow && joints.rightShoulder
        ? angleBetween(joints.rightWrist, joints.rightElbow, joints.rightShoulder) : null;
      const elbowAngle = averageValid([leftElbow, rightElbow]);

      const bodyAlignAngle = angleBetween(joints.shoulderMid, joints.hipMid, joints.ankleMid);
      const deviation = bodyAlignAngle !== null ? Math.abs(180 - bodyAlignAngle) : 0;

      if (phase === "hang") {
        if (!shouldersAboveBar && deviation > maxKippingDeviation) {
          maxKippingDeviation = deviation; // Log the severity of swing during execution initialization
        }
        if (shouldersAboveBar) {
          // Athlete has successfully pulled their body around and over the bar
          phase = "transition";
          minDipAngleAtTop = elbowAngle || Infinity;
        }
      } else if (phase === "transition") {
        if (elbowAngle !== null) {
          minDipAngleAtTop = Math.max(minDipAngleAtTop, elbowAngle); // Track lockout extensions achieved above bar
        }

        // Rep completes when athlete successfully extends and pushes to absolute lockout over the bar
        if (shouldersAboveBar && elbowAngle !== null && elbowAngle > DIP_LOCKOUT_ANGLE - 15) {
          reps.push({
            kippingDeviation: maxKippingDeviation,
            finalDipLockout: elbowAngle,
          });
          phase = "hang"; // Reset cycle state machine tracking loop
          maxKippingDeviation = 0;
        }
        
        // Safety fallback: if they drop back down under the bar without completing the lockout
        if (!shouldersAboveBar) {
          phase = "hang";
          maxKippingDeviation = 0;
        }
      }
    }
    return reps;
  }

  return function scoreMuscleUp(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message: "Ensure your entire range of motion above and below the bar stays visible on camera.",
      };
    }

    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message: "No completed muscle-ups detected. Make sure you press out to a full straight-arm lockout over the bar.",
      };
    }

    const faults = [];

    // 1️⃣ Strictness Check: Excessive Kipping/Leg-swing
    const heavyKipReps = reps.filter((r) => r.kippingDeviation > 35);
    if (heavyKipReps.length > 0) {
      const ratio = heavyKipReps.length / reps.length;
      faults.push({
        id: "heavy_kipping",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${heavyKipReps.length} of ${reps.length} reps used a massive leg kick/kip. Try to clean up the power transition.`,
      });
    }

    // 2️⃣ Incomplete Dip Extension at Top
    const softLockoutReps = reps.filter((r) => r.finalDipLockout < DIP_LOCKOUT_ANGLE);
    if (softLockoutReps.length > 0) {
      const ratio = softLockoutReps.length / reps.length;
      faults.push({
        id: "soft_dip_lockout",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${softLockoutReps.length} of ${reps.length} reps lacked full arm lockout at the peak of the dip. Squeeze your triceps at the top.`,
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
    };
  };
})();