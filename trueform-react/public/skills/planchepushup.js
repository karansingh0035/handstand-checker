// 🤸‍♂️ PLANCHE PUSH-UP FORM SCORING
// Scope (v1): floor-based push-up performed with the shoulders protracted
// forward past the hands (the defining planche-lean feature), pressing
// through a bend and back to lockout. Full/straddle/tuck planche push-up
// variants are not distinguished — this scores the lean + straight-body +
// depth/lockout fundamentals common to all of them.
//
// Architecturally this mirrors handstandpushup.js: rep detection reuses
// pushup.js's hysteresis state machine shape, but adds one check that's
// unique to planche work — forward shoulder lean past the wrist — tracked
// per-rep the same way handstandpushup.js tracks body-line/leg deviation
// per-rep instead of once per clip.
//
// The lean check uses the same normalized-ratio design as
// engine/primitives.js's shoulderLean() in the live-cue engine (torso-length
// normalized, orientation-agnostic via a facing-direction sign check) and
// the same 0.15 threshold as engine/rules.js's planchepushup rule set, so
// the live in-set cues and this post-video score agree on what "enough
// lean" means. That threshold has not been validated against real footage
// in either system yet — treat it as a first draft, not a settled number.
//
// Filmed from the side, same as push-ups and handstand push-ups (the only
// angle that shows elbow bend depth, body-line straightness, AND how far
// forward the shoulders travel past the hands).
//
// Shared geometry/landmark helpers live in pose-utils.js, loaded before this file.

const scorePlanchePushup = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 30; // Need a reasonable stretch of clearly-tracked frames to find real reps

  // Rep-detection thresholds (elbow angle in degrees) — same hysteresis
  // pattern as pushup.js/handstandpushup.js: two thresholds with a gap so
  // jitter near a single cutoff doesn't register as extra fake reps.
  const TOP_THRESHOLD = 155;    // Arms considered "at the top" / locked out above this
  const BOTTOM_THRESHOLD = 100; // Arms considered "at the bottom" below this — same working depth as a floor push-up, since this is a floor movement, not inverted like HSPU

  // Form standards used to flag faults on each detected rep
  const SHALLOW_DEPTH_ANGLE = 100;  // Same working-depth standard as pushup.js — this is a floor movement
  const LOCKOUT_ANGLE = 160;        // Elbow should extend to about this or more at the top
  const BODY_ALIGN_DEVIATION_THRESHOLD = 12; // Degrees of shoulder-hip-ankle deviation from straight before flagging — matches engine/rules.js's bodyLineDeviation > 12 threshold for the same check
  const LEAN_RATIO_THRESHOLD = 0.15; // Normalized shoulder-past-wrist ratio a rep must reach at some point — matches engine/rules.js's planchepushup.planche_insufficient_lean threshold

  // Computes elbow angle from whichever side(s) getEffectiveJoints actually
  // gave us real points for this frame — same logic as pushup.js/handstandpushup.js.
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

  // Forward shoulder protraction past the wrist, normalized by torso length
  // (shoulder-to-hip distance) so the ratio stays comparable regardless of
  // filming distance.
  //
  // 🆕 Was x-only (raw x-subtraction + a Math.sign facingDirection trick),
  // same category of camera-angle blind spot as torsoVertical/
  // computeHorizontalRatio: for a horizontal-body skill like this one, the
  // shoulder-hip-wrist line IS the ambiguous axis, and "forward" can live
  // in z as much as x depending on camera yaw. The old sign trick also got
  // numerically unstable right when it mattered most — front-on framing is
  // exactly when hip.x - wrist.x shrinks toward zero even with real
  // separation in z.
  //
  // Now: treated as a proper horizontal-plane (x,z) vector projection.
  // hips and shoulders move forward together in a real lean (same
  // assumption as before), so the wrist->hip vector in the horizontal
  // plane defines "forward" as a direction rather than a sign; the
  // wrist->shoulder vector is projected onto it via dot product. This is
  // yaw-invariant instead of just flipping which side of a 1D line you're on.
  // torsoLength is folded into z too, for the same reason — the
  // shoulder-hip line is on the same ambiguous horizontal axis here, not
  // gravity-vertical, so it needs the same treatment torsoVertical got.
  //   0    = shoulders directly above wrists
  //   >0   = shoulders leaning forward past the wrists (toward planche)
  //   <0   = shoulders leaning back behind the wrists
  function computeShoulderLean(joints) {
    if (!joints || !joints.shoulderMid || !joints.wristMid || !joints.hipMid) return null;

    const dirX = joints.hipMid.x - joints.wristMid.x;
    const dirZ = (joints.hipMid.z || 0) - (joints.wristMid.z || 0);
    const dirMag = Math.hypot(dirX, dirZ) || 1e-6;

    const shoulderX = joints.shoulderMid.x - joints.wristMid.x;
    const shoulderZ = (joints.shoulderMid.z || 0) - (joints.wristMid.z || 0);
    const rawLean = (shoulderX * dirX + shoulderZ * dirZ) / dirMag;

    const torsoLength = Math.hypot(
      joints.hipMid.x - joints.shoulderMid.x,
      joints.hipMid.y - joints.shoulderMid.y,
      (joints.hipMid.z || 0) - (joints.shoulderMid.z || 0)
    ) || 1e-6;
    return rawLean / torsoLength;
  }

  // --- Rep detection --------------------------------------------------------

  // Same hysteresis state machine as handstandpushup.js, but tracking the
  // worst (most-deviated) body-line angle AND the best (max) shoulder-lean
  // ratio seen at any point during each rep.
  function detectReps(confidentFrames, videoWidth, videoHeight) {
    const reps = [];

    let phase = "top"; // Assume the clip starts near the top of a rep
    let currentRepMinElbowAngle = Infinity;
    let currentRepBodyAlignAngles = [];
    let currentRepLeanRatios = [];

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue; // Neither side was confidently visible this frame

      const elbowAngle = computeElbowAngle(joints);
      const bodyAlignAngle = angleBetween(joints.shoulderMid, joints.hipMid, joints.ankleMid);
      const leanRatio = computeShoulderLean(joints);

      if (elbowAngle === null) continue; // Skip frames where we couldn't compute an angle at all

      if (phase === "top" && elbowAngle < BOTTOM_THRESHOLD) {
        // Started descending into a new rep
        phase = "bottom";
        currentRepMinElbowAngle = elbowAngle;
        currentRepBodyAlignAngles = bodyAlignAngle !== null ? [bodyAlignAngle] : [];
        currentRepLeanRatios = leanRatio !== null ? [leanRatio] : [];
      } else if (phase === "bottom") {
        currentRepMinElbowAngle = Math.min(currentRepMinElbowAngle, elbowAngle);
        if (bodyAlignAngle !== null) currentRepBodyAlignAngles.push(bodyAlignAngle);
        if (leanRatio !== null) currentRepLeanRatios.push(leanRatio);

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

          // Worst (most deviated from 180°) body-line angle seen during this rep
          const worstBodyAlign =
            currentRepBodyAlignAngles.length > 0
              ? currentRepBodyAlignAngles.reduce((worst, a) =>
                  Math.abs(180 - a) > Math.abs(180 - worst) ? a : worst
                )
              : null;

          // Best (max) shoulder-lean ratio seen during this rep — a planche
          // rep is judged by whether it reached sufficient lean at all, not
          // whether it held that lean the whole rep.
          const bestLeanRatio =
            currentRepLeanRatios.length > 0 ? Math.max(...currentRepLeanRatios) : null;

          reps.push({
            bottomAngle: currentRepMinElbowAngle,
            lockoutAngle,
            bodyAlignAngle: worstBodyAlign,
            leanRatio: bestLeanRatio,
          });

          phase = "top";
          currentRepMinElbowAngle = Infinity;
          currentRepBodyAlignAngles = [];
          currentRepLeanRatios = [];
        }
      }
    }

    return reps;
  }

  // --- Main scoring function -------------------------------------------------

  // history: array of frames collected across the ENTIRE video. videoWidth/
  // videoHeight: source video's native pixel dimensions, needed for
  // aspect-ratio-correct angle math.
  return function scorePlanchePushup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your arms and body line for enough of the video to score these planche push-ups. Try filming from the side with your whole body — hands to feet — in frame.",
      };
    }

    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message:
          "Couldn't detect any completed planche push-up reps in this video. Make sure your full range of motion (lockout to bend to lockout) is visible on camera.",
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
        detail: `${shallowReps.length} of ${reps.length} reps didn't bend deep enough — work toward a fuller range of motion.`,
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
        // Direction (sag vs. pike) isn't asserted here for the same reason
        // as handstandpushup.js — it depends on which way the athlete faces
        // in a side-on shot, which this angle-only check can't reliably tell.
        detail: `${misalignedReps.length} of ${reps.length} reps broke the straight line from shoulders to ankles instead of staying stacked.`,
      });
    }

    const insufficientLeanReps = reps.filter(
      (r) => r.leanRatio === null || r.leanRatio < LEAN_RATIO_THRESHOLD
    );
    if (insufficientLeanReps.length > 0) {
      const ratio = insufficientLeanReps.length / reps.length;
      faults.push({
        id: "insufficient_lean",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${insufficientLeanReps.length} of ${reps.length} reps didn't lean your shoulders far enough past your hands — that forward lean is what makes it a planche push-up.`,
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
        leanRatio: round1(r.leanRatio),
      })),
    };
  };
})();
const validatePlanchePushupVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 25;
  const NOT_DETECTED_RATIO = 0.35;
  const UNCLEAR_RATIO = 0.6;

  function isPlausiblePlanchePushupFrame(joints) {
    if (!joints || !joints.shoulderMid || !joints.wristMid || !joints.hipMid) {
      return false;
    }

    // Horizontal body support with shoulders near or leaning past wrists
    const isSupported = joints.wristMid.y >= joints.shoulderMid.y - 20;
    return isSupported;
  }

  return function validatePlanchePushupVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < VALIDATION_MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "Couldn't get a clear enough view. Ensure your entire body from hands to feet is in frame from a side view.",
      };
    }

    let plausibleCount = 0;
    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (isPlausiblePlanchePushupFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We couldn't detect planche push-ups. Ensure you perform push-up reps while maintaining forward shoulder lean.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "Movement detected, but joint visibility was partially obscured. Record from a clear, unobstructed side perspective.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validatePlanchePushupVideo = validatePlanchePushupVideo;
window.scorePlanchePushup = scorePlanchePushup;