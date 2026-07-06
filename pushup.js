// 💪 PUSH-UP FORM SCORING
// First rep-based skill (as opposed to handstand's static-hold scoring).
// Architecture: walk the video frame-by-frame tracking elbow angle over
// time, segment it into individual reps using a state machine with
// hysteresis (two thresholds, not one — prevents noise near a single
// cutoff from registering as multiple fake reps), then score each rep's
// depth, lockout, and body alignment (reusing the same shoulder-hip-ankle
// straightness check from handstand scoring — the same "banana back" issue
// shows up here as hip sagging/piking).
//
// Shared geometry/landmark helpers live in pose-utils.js, loaded before this file.

// 🔒 Wrapped in an IIFE so internal names (REQUIRED_LANDMARKS,
// isFrameConfident, MIN_CONFIDENT_FRAMES, thresholds, detectReps, etc.) stay
// private to this file and can never collide with another skill file's
// same-named internals — only scorePushup itself is exposed globally.
const scorePushup = (function () {
  // 🎯 FIX: push-ups are almost always filmed side-on (the only angle that
  // actually shows elbow depth and hip sag/pike), which means the far side
  // of the body is partially hidden behind the torso for the WHOLE clip.
  // Requiring both sides to be visible in every frame (the old behavior)
  // meant nearly every frame got rejected regardless of video quality or
  // angle. A frame is confident if EITHER side is fully, clearly tracked.
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 30; // Need a reasonable stretch of clearly-tracked frames to find real reps

  // Rep-detection thresholds (elbow angle in degrees). Two thresholds with a
  // gap between them (hysteresis) instead of one — this stops small jitter
  // right around a single cutoff from being read as several fake reps.
  const TOP_THRESHOLD = 155;    // Arms considered "at the top" / locked out above this
  const BOTTOM_THRESHOLD = 110; // Arms considered "at the bottom" below this

  // Form standards used to flag faults on each detected rep
  const SHALLOW_DEPTH_ANGLE = 100; // Elbow should bend to about this or lower for full depth
  const LOCKOUT_ANGLE = 160;       // Elbow should extend to about this or more at the top
  const BODY_ALIGN_DEVIATION_THRESHOLD = 15; // Degrees of hip sag/pike from straight before flagging

  // Computes elbow angle from whichever side(s) getEffectiveJoints actually
  // gave us real points for this frame — averages left+right when both are
  // confidently visible (front-on video), otherwise uses the single visible
  // side directly rather than pretending the hidden side's guess counts too.
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

  // Walks the confident frames in order, tracking elbow angle and body
  // alignment, and segments them into completed reps using a hysteresis
  // state machine. Returns an array of rep objects.
  function detectReps(confidentFrames, videoWidth, videoHeight) {
    const reps = [];

    let phase = "top"; // Assume the clip starts near the top of a rep
    let currentRepMinElbowAngle = Infinity;
    let currentRepBodyAlignAngles = [];

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue; // Neither side was confidently visible this frame

      const elbowAngle = computeElbowAngle(joints);
      const bodyAlignAngle = angleBetween(joints.shoulderMid, joints.hipMid, joints.ankleMid);

      if (elbowAngle === null) continue; // Skip frames where we couldn't compute an angle at all

      if (phase === "top" && elbowAngle < BOTTOM_THRESHOLD) {
        // Started descending into a new rep
        phase = "bottom";
        currentRepMinElbowAngle = elbowAngle;
        currentRepBodyAlignAngles = bodyAlignAngle !== null ? [bodyAlignAngle] : [];
      } else if (phase === "bottom") {
        currentRepMinElbowAngle = Math.min(currentRepMinElbowAngle, elbowAngle);
        if (bodyAlignAngle !== null) currentRepBodyAlignAngles.push(bodyAlignAngle);

        if (elbowAngle > TOP_THRESHOLD) {
          // Came back up past the top threshold — rep complete.
          // Look ahead a few frames to find the true peak lockout angle,
          // rather than just using the exact crossing frame's angle.
          let lockoutAngle = elbowAngle;
          for (let lookahead = i + 1; lookahead < Math.min(i + 6, confidentFrames.length); lookahead++) {
            const laJoints = getEffectiveJoints(confidentFrames[lookahead], videoWidth, videoHeight);
            const laAngle = computeElbowAngle(laJoints);
            if (laAngle !== null) lockoutAngle = Math.max(lockoutAngle, laAngle);
          }

          // Worst (most deviated from 180°) body alignment angle seen during this rep
          const worstBodyAlign =
            currentRepBodyAlignAngles.length > 0
              ? currentRepBodyAlignAngles.reduce((worst, a) =>
                  Math.abs(180 - a) > Math.abs(180 - worst) ? a : worst
                )
              : null;

          reps.push({
            bottomAngle: currentRepMinElbowAngle,
            lockoutAngle,
            bodyAlignAngle: worstBodyAlign,
          });

          phase = "top";
          currentRepMinElbowAngle = Infinity;
          currentRepBodyAlignAngles = [];
        }
      }
    }

    return reps;
  }

  // --- Main scoring function -------------------------------------------------

  // history: array of frames collected across the ENTIRE video (same shape as
  // scoreHandstand expects). videoWidth/videoHeight: source video's native
  // pixel dimensions, needed for aspect-ratio-correct angle math.
  return function scorePushup(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your arms and body for enough of the video to score these push-ups. Try better lighting, a side-on camera angle, or make sure your whole body stays in frame.",
      };
    }

    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message:
          "Couldn't detect any completed push-up reps in this video. Make sure your full range of motion (top to bottom to top) is visible on camera.",
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
        detail: `${shallowReps.length} of ${reps.length} reps didn't reach full depth — elbows should bend to about 90° or lower.`,
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
      // Determine whether the majority trend is sagging (hips dropping below
      // straight) or piking (hips lifting above straight), for clearer feedback.
      const avgDeviationDirection = averageValid(
        misalignedReps.map((r) => 180 - r.bodyAlignAngle)
      );
      const sagging = avgDeviationDirection !== null && avgDeviationDirection > 0;
      faults.push({
        id: sagging ? "hip_sag" : "hip_pike",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${misalignedReps.length} of ${reps.length} reps showed hips ${
          sagging ? "sagging toward the floor" : "piking upward"
        } instead of a straight line from shoulders to ankles.`,
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
      })),
    };
  };
})();