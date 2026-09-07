// 💪 MUSCLE-UP FORM SCORING
// Scope (v1): Bar muscle-up analysis tracking transitions across pull-to-dip phases.
//
// 🆕 CHANGED: this IIFE now returns an OBJECT of { scoreMuscleUp,
// validateMuscleUpVideo } instead of a single function directly — needed so
// validateMuscleUpVideo can reuse the same detectReps()/isFrameConfident()
// defined in this closure instead of duplicating the phase state machine in
// a second copy. scoreMuscleUp's own scoring behavior is unchanged except
// for one real bug fix inside detectReps — see the 🐛 comment below.
const { scoreMuscleUp, validateMuscleUpVideo } = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 25;
  const DIP_LOCKOUT_ANGLE = 160; // Complete extension at the absolute top peak of the dip

  function detectReps(confidentFrames, videoWidth, videoHeight) {
    const reps = [];
    let phase = "hang"; // Phase sequencing: hang -> transition (pull + dip)
    let maxKippingDeviation = 0;
    // 🐛 FIX: renamed from "minDipAngleAtTop" (it tracks a MAX — the old
    // name was backwards) and now actually USED below. Previously this was
    // computed every frame via Math.max and then discarded entirely — the
    // pushed rep used the exact completion-frame's instantaneous elbowAngle
    // instead of the true peak seen during the transition, which could
    // undercount lockout quality if the real peak extension landed a frame
    // or two before/after the threshold-crossing frame. Matches the
    // "find the true peak, not the crossing frame" pattern already used in
    // pushup.js/handstandpushup.js's lockout detection.
    let peakDipAngle = -Infinity;

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
          peakDipAngle = elbowAngle !== null ? elbowAngle : -Infinity;
        }
      } else if (phase === "transition") {
        if (elbowAngle !== null) {
          peakDipAngle = Math.max(peakDipAngle, elbowAngle); // Track the best lockout extension seen so far above the bar
        }

        // Rep completes when athlete successfully extends and pushes to absolute lockout over the bar
        if (shouldersAboveBar && elbowAngle !== null && elbowAngle > DIP_LOCKOUT_ANGLE - 15) {
          reps.push({
            kippingDeviation: maxKippingDeviation,
            // 🐛 FIX: use the tracked peak (peakDipAngle), not just this
            // single completion frame's raw elbowAngle.
            finalDipLockout: peakDipAngle === -Infinity ? elbowAngle : peakDipAngle,
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

  function scoreMuscleUp(history, videoWidth, videoHeight) {
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
  }

  // --- 🆕 Skill-verification check ------------------------------------------
  // Runs BEFORE scoreMuscleUp, reusing the same detectReps()/isFrameConfident()
  // from this closure. A real muscle-up needs a mostly-VERTICAL body
  // orientation throughout (the opposite of push-up's horizontal check) AND
  // at least one detected hang -> transition -> lockout cycle — the second
  // condition is the real discriminator, since a walking or squatting clip
  // will essentially never produce a genuine "shoulders cross from below to
  // above the bar, then lock out" event.
  function computeVerticalRatio(confidentFrames, videoWidth, videoHeight) {
    let verticalCount = 0;
    let counted = 0;

    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (!joints || !joints.shoulderMid || !joints.hipMid) continue;
      counted++;

      const dx = Math.abs(joints.shoulderMid.x - joints.hipMid.x);
      const dy = Math.abs(joints.shoulderMid.y - joints.hipMid.y);
      if (dy > dx) verticalCount++; // body spans more vertically than horizontally this frame
    }

    return counted > 0 ? verticalCount / counted : 0;
  }

  // Thresholds are a first pass, not validated against real footage — same
  // caveat as every threshold introduced elsewhere in this codebase.
  const VERTICAL_NOT_DETECTED_RATIO = 0.35;
  const VERTICAL_UNCLEAR_RATIO = 0.6;

  function validateMuscleUpVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "We could not confidently analyze this video. Keep your full body in frame, use good lighting, and record the movement for at least 3–5 seconds.",
      };
    }

    const verticalRatio = computeVerticalRatio(confidentFrames, videoWidth, videoHeight);
    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        valid: false,
        status: "not_detected",
        confidence: verticalRatio,
        message:
          "We could not verify a muscle-up in this video. Make sure your transition from below the bar to a full lockout above it is visible on camera.",
      };
    }

    if (verticalRatio < VERTICAL_NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: verticalRatio,
        message:
          "We could not verify a muscle-up in this video — your body doesn't look vertical enough for a bar movement. Film from the side with your full body and the bar visible.",
      };
    }

    if (verticalRatio < VERTICAL_UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: verticalRatio,
        message:
          "A muscle-up may be present, but the camera angle or framing is unclear. Please re-record from the side with your full body and the bar visible.",
      };
    }

    return { valid: true, confidence: verticalRatio };
  }

  return { scoreMuscleUp, validateMuscleUpVideo };
})();

window.scoreMuscleUp = scoreMuscleUp;
window.validateMuscleUpVideo = validateMuscleUpVideo;
