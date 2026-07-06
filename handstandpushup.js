// 🤸‍♂️ HANDSTAND PUSH-UP FORM SCORING
// Scope (v1): wall-supported (or freestanding) handstand push-up — inverted
// support, legs together, straight body line, pressing through a bend and
// back to full lockout. Deficit HSPU, one-arm HSPU, and press-to-handstand
// entries are intentionally out of scope for now.
//
// Architecturally this is a hybrid: rep detection is identical in spirit to
// pushup.js (walk elbow angle over time, segment into reps with a
// hysteresis state machine), but the body-line requirement during each rep
// is handstand.js's requirement (one straight vertical line from wrist to
// ankle), not push-up's horizontal plank line. So this file reuses the
// rep-detection *shape* from pushup.js and the alignment *checks* from
// handstand.js, tracking them per-rep instead of once per clip.
//
// Filmed from the side, same as push-ups (the only angle that shows both
// elbow bend and whether the body line stays straight) — so, like
// pushup.js, this is side-aware rather than requiring both sides visible
// every frame. See pose-utils.js's getEffectiveJoints/isSideVisible.
//
// Shared geometry/landmark helpers live in pose-utils.js, loaded before this file.

// 🔒 Wrapped in an IIFE so internal names stay private to this file and
// can't collide with another skill file's same-named internals — only
// scoreHandstandPushup itself is exposed globally.
const scoreHandstandPushup = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 30; // Need a reasonable stretch of clearly-tracked frames to find real reps

  // Rep-detection thresholds (elbow angle in degrees) — same hysteresis
  // pattern as pushup.js: two thresholds with a gap between them so jitter
  // near a single cutoff doesn't register as extra fake reps.
  const TOP_THRESHOLD = 155;    // Arms considered "at the top" / locked out above this
  const BOTTOM_THRESHOLD = 110; // Arms considered "at the bottom" below this

  // Form standards used to flag faults on each detected rep
  const SHALLOW_DEPTH_ANGLE = 110; // HSPU working range is usually shorter than a floor push-up (many stop well short of head-to-floor) — 110° is a reasonable minimum bend for a working rep here, vs. 100° for a floor push-up
  const LOCKOUT_ANGLE = 160;       // Elbow should extend to about this or more at the top
  const BODY_ALIGN_DEVIATION_THRESHOLD = 15; // Degrees of shoulder-hip-ankle deviation from straight before flagging
  const LEG_BEND_DEVIATION_THRESHOLD = 10;   // Degrees of hip-knee-ankle deviation from straight before flagging
  const LATERAL_LEAN_RATIO_THRESHOLD = 0.05; // Fraction of video width the hips/ankles can drift sideways from the wrist line before flagging (same idea as handstand.js's lateral_lean check)

  // Computes elbow angle from whichever side(s) getEffectiveJoints actually
  // gave us real points for this frame — same logic as pushup.js.
  function computeElbowAngle(joints) {
    if (!joints) return null;
    if (joints.leftElbow && joints.rightElbow) {
      const left = angleBetween(joints.leftWrist, joints.leftElbow, joints.leftShoulder);
      const right = angleBetween(joints.rightWrist, joints.rightElbow, joints.rightShoulder);
      return averageValid([left, right]);
    }
    const elbow = joints.leftElbow || joints.rightElbow;
    const wrist = joints.leftWrist || joints.rightWrist;
    const shoulder = joints.leftShoulder || joints.rightShoulder;
    return angleBetween(wrist, elbow, shoulder);
  }

  // --- Rep detection --------------------------------------------------------

  // Same hysteresis state machine as pushup.js, but each rep also tracks the
  // worst (most-deviated) body-line and leg-straightness angles, and the
  // worst lateral drift ratio, seen at any point during that rep — mirroring
  // handstand.js's checks, just measured continuously through the rep
  // instead of once on a static hold.
  function detectReps(confidentFrames, videoWidth, videoHeight) {
    const reps = [];

    let phase = "top"; // Assume the clip starts near the top of a rep
    let currentRepMinElbowAngle = Infinity;
    let currentRepBodyAlignAngles = [];
    let currentRepLegAngles = [];
    let currentRepLateralRatios = [];

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue; // Neither side was confidently visible this frame

      const elbowAngle = computeElbowAngle(joints);
      const bodyAlignAngle = angleBetween(joints.shoulderMid, joints.hipMid, joints.ankleMid);
      const legAngle = angleBetween(joints.hipMid, joints.kneeMid, joints.ankleMid);

      let lateralRatio = null;
      if (joints.wristMid && joints.hipMid && joints.ankleMid) {
        const referenceX = joints.wristMid.x;
        const offsets = [joints.hipMid.x, joints.ankleMid.x].map((x) => Math.abs(x - referenceX));
        lateralRatio = Math.max(...offsets) / videoWidth;
      }

      if (elbowAngle === null) continue; // Skip frames where we couldn't compute an angle at all

      if (phase === "top" && elbowAngle < BOTTOM_THRESHOLD) {
        // Started descending into a new rep
        phase = "bottom";
        currentRepMinElbowAngle = elbowAngle;
        currentRepBodyAlignAngles = bodyAlignAngle !== null ? [bodyAlignAngle] : [];
        currentRepLegAngles = legAngle !== null ? [legAngle] : [];
        currentRepLateralRatios = lateralRatio !== null ? [lateralRatio] : [];
      } else if (phase === "bottom") {
        currentRepMinElbowAngle = Math.min(currentRepMinElbowAngle, elbowAngle);
        if (bodyAlignAngle !== null) currentRepBodyAlignAngles.push(bodyAlignAngle);
        if (legAngle !== null) currentRepLegAngles.push(legAngle);
        if (lateralRatio !== null) currentRepLateralRatios.push(lateralRatio);

        if (elbowAngle > TOP_THRESHOLD) {
          // Came back up past the top threshold — rep complete. Look ahead
          // a few frames to find the true peak lockout angle, rather than
          // just using the exact crossing frame's angle.
          let lockoutAngle = elbowAngle;
          for (let lookahead = i + 1; lookahead < Math.min(i + 6, confidentFrames.length); lookahead++) {
            const laJoints = getEffectiveJoints(confidentFrames[lookahead], videoWidth, videoHeight);
            const laAngle = computeElbowAngle(laJoints);
            if (laAngle !== null) lockoutAngle = Math.max(lockoutAngle, laAngle);
          }

          // Worst (most deviated from 180°) body-line and leg angles seen during this rep
          const worstBodyAlign =
            currentRepBodyAlignAngles.length > 0
              ? currentRepBodyAlignAngles.reduce((worst, a) =>
                  Math.abs(180 - a) > Math.abs(180 - worst) ? a : worst
                )
              : null;
          const worstLegAngle =
            currentRepLegAngles.length > 0
              ? currentRepLegAngles.reduce((worst, a) =>
                  Math.abs(180 - a) > Math.abs(180 - worst) ? a : worst
                )
              : null;
          const worstLateralRatio =
            currentRepLateralRatios.length > 0 ? Math.max(...currentRepLateralRatios) : null;

          reps.push({
            bottomAngle: currentRepMinElbowAngle,
            lockoutAngle,
            bodyAlignAngle: worstBodyAlign,
            legAngle: worstLegAngle,
            lateralRatio: worstLateralRatio,
          });

          phase = "top";
          currentRepMinElbowAngle = Infinity;
          currentRepBodyAlignAngles = [];
          currentRepLegAngles = [];
          currentRepLateralRatios = [];
        }
      }
    }

    return reps;
  }

  // --- Main scoring function -------------------------------------------------

  // history: array of frames collected across the ENTIRE video. videoWidth/
  // videoHeight: source video's native pixel dimensions, needed for
  // aspect-ratio-correct angle math.
  return function scoreHandstandPushup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your arms and body line for enough of the video to score these handstand push-ups. Try filming from the side with your whole body — hands to feet — in frame.",
      };
    }

    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message:
          "Couldn't detect any completed handstand push-up reps in this video. Make sure your full range of motion (lockout to bend to lockout) is visible on camera.",
      };
    }

    // --- Aggregate faults across all reps ---
    const faults = [];

    const shallowReps = reps.filter((r) => r.bottomAngle > SHALLOW_DEPTH_ANGLE);
    if (shallowReps.length > 0) {
      const ratio = shallowReps.length / reps.length;
      faults.push({
        id: "shallow_depth",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${shallowReps.length} of ${reps.length} reps didn't bend deep enough — work toward getting your head closer to the ground.`,
      });
    }

    const incompleteLockoutReps = reps.filter((r) => r.lockoutAngle < LOCKOUT_ANGLE);
    if (incompleteLockoutReps.length > 0) {
      const ratio = incompleteLockoutReps.length / reps.length;
      faults.push({
        id: "incomplete_lockout",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${incompleteLockoutReps.length} of ${reps.length} reps didn't fully lock out the arms at the top.`,
      });
    }

    const misalignedReps = reps.filter(
      (r) => r.bodyAlignAngle !== null && Math.abs(180 - r.bodyAlignAngle) > BODY_ALIGN_DEVIATION_THRESHOLD
    );
    if (misalignedReps.length > 0) {
      const ratio = misalignedReps.length / reps.length;
      faults.push({
        id: "body_line_break",
        severity: ratio > 0.5 ? "major" : "moderate",
        // Direction (piking at the hips vs. arching) isn't asserted — like
        // L-sit's torso check, that depends on which way the athlete faces
        // in a side-on shot, which pose data alone can't reliably tell us.
        detail: `${misalignedReps.length} of ${reps.length} reps broke the straight line from shoulders to ankles instead of staying stacked.`,
      });
    }

    const bentLegReps = reps.filter(
      (r) => r.legAngle !== null && 180 - r.legAngle > LEG_BEND_DEVIATION_THRESHOLD
    );
    if (bentLegReps.length > 0) {
      const ratio = bentLegReps.length / reps.length;
      faults.push({
        id: "bent_legs",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${bentLegReps.length} of ${reps.length} reps had bent knees instead of straight legs.`,
      });
    }

    const leaningReps = reps.filter(
      (r) => r.lateralRatio !== null && r.lateralRatio > LATERAL_LEAN_RATIO_THRESHOLD
    );
    if (leaningReps.length > 0) {
      const ratio = leaningReps.length / reps.length;
      faults.push({
        id: "lateral_lean",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${leaningReps.length} of ${reps.length} reps drifted to one side instead of staying stacked vertically over your hands.`,
      });
    }

    // --- Final score: start at 100, subtract per fault by severity ---
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
      reps: reps.map((r) => ({
        bottomAngle: round1(r.bottomAngle),
        lockoutAngle: round1(r.lockoutAngle),
        bodyAlignAngle: round1(r.bodyAlignAngle),
        legAngle: round1(r.legAngle),
      })),
    };
  };
})();