// 🏋️ SQUAT FORM SCORING
// Scope (v1): bodyweight squat — standing, descending to depth, and back to
// a fully upright lockout. Assumes a side-on filming angle (same reasoning
// as pushup.js/handstandpushup.js: the only angle that shows depth, torso
// lean, AND hip/knee position clearly at once).
//
// Architecturally this reuses the same rep-detection *shape* as
// handstandpushup.js/planchepushup.js (hysteresis state machine, "worst
// value seen this rep" tracking) — just walking KNEE angle over time
// instead of elbow angle, since a squat's primary signal is knee bend, not
// arm bend. Two checks are new to this file:
//   - depth: hip position relative to knee, captured at the exact BOTTOM
//     frame of the rep (mirrors the live engine's bottomHipY/bottomKneeY
//     pattern) — not a running min/max, since depth is a single moment,
//     not something that accumulates across the rep.
//   - torso lean: pose-utils.js has no vertical-tilt helper, so this file
//     computes it manually using the exact same formula as
//     engine/primitives.js's torsoVertical(), so the live in-set cues and
//     this post-video score agree on what "leaning too far forward" means.
//
// Deliberately excludes any tempo/bounce check, matching the scope
// established in handstandpushup.js and planchepushup.js — this file
// family sticks to per-rep geometry, not timing, for now.
//
// Shared geometry/landmark helpers live in pose-utils.js, loaded before this file.

const scoreSquat = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const MIN_CONFIDENT_FRAMES = 30; // Need a reasonable stretch of clearly-tracked frames to find real reps

  // Rep-detection thresholds (knee angle in degrees) — same hysteresis
  // pattern as the push-family files, with a wide gap since a squat's knee
  // ROM (near-straight standing to a deep bend) is much larger than an
  // elbow's working range.
  const TOP_THRESHOLD = 165;    // Legs considered "standing" / near-lockout above this
  const BOTTOM_THRESHOLD = 110; // Legs considered "descending into the squat" below this

  // Form standards used to flag faults on each detected rep
  const HIP_LOCKOUT_ANGLE = 165;        // Hip should extend to about this or more at the top — matches engine/rules.js's no_lockout_squat threshold
  const TORSO_COLLAPSE_DEGREES = 50;    // Forward torso lean beyond this is flagged — matches engine/rules.js's torso_collapse threshold

  // Computes knee angle from whichever side(s) getEffectiveJoints actually
  // gave us real points for this frame — same logic as the push-family files.
  function computeKneeAngle(joints) {
    if (!joints) return null;
    if (joints.leftKnee && joints.rightKnee) {
      const left = angleBetween(joints.leftHip, joints.leftKnee, joints.leftAnkle);
      const right = angleBetween(joints.rightHip, joints.rightKnee, joints.rightAnkle);
      return averageValid([left, right]);
    }
    const knee = joints.leftKnee || joints.rightKnee;
    const hip = joints.leftHip || joints.rightHip;
    const ankle = joints.leftAnkle || joints.rightAnkle;
    return angleBetween(hip, knee, ankle);
  }

  // Torso tilt from vertical, in degrees — 0° = perfectly upright.
  // Identical formula to engine/primitives.js's torsoVertical(), just
  // working in this file's pixel-space joints instead of MediaPipe's raw
  // normalized coordinates.
  function computeTorsoVertical(shoulderMid, hipMid) {
    if (!shoulderMid || !hipMid) return null;
    const dy = Math.abs(hipMid.y - shoulderMid.y);
    const dx = Math.abs(hipMid.x - shoulderMid.x);
    const rad = Math.atan2(dx, dy);
    return (rad * 180.0) / Math.PI;
  }

  // --- Rep detection --------------------------------------------------------

  // Same hysteresis state machine as the push-family files, but tracking
  // the worst (max) torso-lean angle seen during the rep, plus hip/knee
  // Y-position AND hip-lockout angle captured at specific moments (bottom
  // and top respectively) rather than accumulated across the whole rep.
  function detectReps(confidentFrames, videoWidth, videoHeight) {
    const reps = [];

    let phase = "top"; // Assume the clip starts near standing
    let currentRepMinKneeAngle = Infinity;
    let currentRepTorsoAngles = [];
    let currentRepBottomHipY = null;
    let currentRepBottomKneeY = null;

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue; // Neither side was confidently visible this frame

      const kneeAngle = computeKneeAngle(joints);
      const torsoAngle = computeTorsoVertical(joints.shoulderMid, joints.hipMid);

      if (kneeAngle === null) continue; // Skip frames where we couldn't compute an angle at all

      if (phase === "top" && kneeAngle < BOTTOM_THRESHOLD) {
        // Started descending into a new rep
        phase = "bottom";
        currentRepMinKneeAngle = kneeAngle;
        currentRepTorsoAngles = torsoAngle !== null ? [torsoAngle] : [];
        currentRepBottomHipY = joints.hipMid ? joints.hipMid.y : null;
        currentRepBottomKneeY = joints.kneeMid ? joints.kneeMid.y : null;
      } else if (phase === "bottom") {
        if (torsoAngle !== null) currentRepTorsoAngles.push(torsoAngle);

        // Track hip/knee Y AT the deepest point of the rep (not
        // max-anywhere) — mirrors the live engine's bottomHipY/bottomKneeY
        // pattern. Y increases downward, so a new minimum knee angle
        // (deeper bend) is when we re-capture position.
        if (kneeAngle < currentRepMinKneeAngle) {
          currentRepMinKneeAngle = kneeAngle;
          if (joints.hipMid) currentRepBottomHipY = joints.hipMid.y;
          if (joints.kneeMid) currentRepBottomKneeY = joints.kneeMid.y;
        }

        if (kneeAngle > TOP_THRESHOLD) {
          // Came back up past the top threshold — rep complete. Look ahead
          // a few frames to find the true peak hip-lockout angle, rather
          // than just using the exact crossing frame's angle.
          let hipLockoutAngle = joints.hipMid
            ? angleBetween(joints.shoulderMid, joints.hipMid, joints.kneeMid)
            : null;
          for (let lookahead = i + 1; lookahead < Math.min(i + 6, confidentFrames.length); lookahead++) {
            const laJoints = getEffectiveJoints(confidentFrames[lookahead], videoWidth, videoHeight);
            if (!laJoints || !laJoints.hipMid) continue;
            const laHipAngle = angleBetween(laJoints.shoulderMid, laJoints.hipMid, laJoints.kneeMid);
            if (laHipAngle !== null) {
              hipLockoutAngle = hipLockoutAngle === null ? laHipAngle : Math.max(hipLockoutAngle, laHipAngle);
            }
          }

          // Worst (max) torso-lean angle seen during this rep
          const worstTorsoAngle =
            currentRepTorsoAngles.length > 0 ? Math.max(...currentRepTorsoAngles) : null;

          reps.push({
            bottomKneeAngle: currentRepMinKneeAngle,
            hipLockoutAngle,
            torsoAngle: worstTorsoAngle,
            bottomHipY: currentRepBottomHipY,
            bottomKneeY: currentRepBottomKneeY,
          });

          phase = "top";
          currentRepMinKneeAngle = Infinity;
          currentRepTorsoAngles = [];
          currentRepBottomHipY = null;
          currentRepBottomKneeY = null;
        }
      }
    }

    return reps;
  }

  // --- Main scoring function -------------------------------------------------

  // history: array of frames collected across the ENTIRE video. videoWidth/
  // videoHeight: source video's native pixel dimensions, needed for
  // aspect-ratio-correct angle math.
  return function scoreSquat(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your hips, knees, and torso for enough of the video to score these squats. Try filming from the side with your whole body in frame.",
      };
    }

    const reps = detectReps(confidentFrames, videoWidth, videoHeight);

    if (reps.length === 0) {
      return {
        status: "no_reps_detected",
        message:
          "Couldn't detect any completed squat reps in this video. Make sure your full range of motion (standing to depth to standing) is visible on camera.",
      };
    }

    // --- Aggregate faults across all reps ---
    const faults = [];

    // Depth: hip must be at or below knee level (in pixel-y, "below" means
    // a LARGER y value, since y increases downward) at the bottom of the rep.
    const shallowReps = reps.filter(
      (r) => r.bottomHipY === null || r.bottomKneeY === null || r.bottomHipY <= r.bottomKneeY
    );
    if (shallowReps.length > 0) {
      const ratio = shallowReps.length / reps.length;
      faults.push({
        id: "shallow_squat",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${shallowReps.length} of ${reps.length} reps didn't reach depth — work toward getting your hips below your knees.`,
      });
    }

    const collapsedTorsoReps = reps.filter(
      (r) => r.torsoAngle !== null && r.torsoAngle > TORSO_COLLAPSE_DEGREES
    );
    if (collapsedTorsoReps.length > 0) {
      const ratio = collapsedTorsoReps.length / reps.length;
      faults.push({
        id: "torso_collapse",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${collapsedTorsoReps.length} of ${reps.length} reps had your chest dropping too far forward — keep it more upright.`,
      });
    }

    const incompleteLockoutReps = reps.filter(
      (r) => r.hipLockoutAngle === null || r.hipLockoutAngle < HIP_LOCKOUT_ANGLE
    );
    if (incompleteLockoutReps.length > 0) {
      const ratio = incompleteLockoutReps.length / reps.length;
      faults.push({
        id: "no_lockout_squat",
        severity: ratio > 0.5 ? "major" : "moderate",
        detail: `${incompleteLockoutReps.length} of ${reps.length} reps didn't stand all the way up at the top.`,
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
        bottomKneeAngle: round1(r.bottomKneeAngle),
        hipLockoutAngle: round1(r.hipLockoutAngle),
        torsoAngle: round1(r.torsoAngle),
      })),
    };
  };
})();
window.scoreSquat = scoreSquat;