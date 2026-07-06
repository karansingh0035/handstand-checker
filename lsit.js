// 🪑 L-SIT FORM SCORING
// Scope (v1): standard floor/parallette L-sit — hands down, legs extended
// together out in front, torso upright. Higher variations (V-sit, manna)
// and single-leg L-sits are intentionally out of scope for now.
//
// Static hold, scored once via one representative pose across the whole
// clip — same approach as handstand.js. L-sits are almost always filmed
// from the side (the only angle that actually shows leg height and the "L"
// shape), which means — just like push-ups — the far side of the body is
// often occluded for the entire clip. So, unlike handstand.js, this uses
// the side-aware helpers (getEffectiveJoints / medianJointPoint from
// pose-utils.js) instead of requiring both sides visible every frame.
//
// Shared geometry/landmark helpers live in pose-utils.js, loaded before this file.

// 🔒 Wrapped in an IIFE so internal names stay private to this file and
// can't collide with another skill file's same-named internals — only
// scoreLsit itself is exposed globally.
const scoreLsit = (function () {
  const LSIT_MIN_CONFIDENT_FRAMES = 15; // L-sit holds are often brief — ~0.5s of clearly tracked frames is enough for one stable reading

  // Side-aware: a frame counts if EITHER side is clearly tracked, not both
  // (see the note above on filming angle).
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  // history: array of frames collected across the ENTIRE video, each frame
  // being the raw `results.poseLandmarks` array MediaPipe gives you. Call
  // this once, after the video has finished playing — not per-frame — so
  // the result is one final, stable rating rather than a live number that
  // shifts during playback.
  // videoWidth/videoHeight: the source video's native pixel dimensions —
  // required to correct for non-square aspect ratios before computing angles.
  return function scoreLsit(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < LSIT_MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your shoulders, hips, and legs for enough of the video to score this L-sit. Try filming from the side with your whole body in frame.",
      };
    }

    // One representative position per joint across the whole clip, already
    // in pixel space and already side-aware (real visible-side point rather
    // than a hidden-side guess).
    const shoulder = medianJointPoint(confidentFrames, videoWidth, videoHeight, "shoulderMid");
    const elbow = medianJointPoint(confidentFrames, videoWidth, videoHeight, "elbowMid");
    const wrist = medianJointPoint(confidentFrames, videoWidth, videoHeight, "wristMid");
    const hip = medianJointPoint(confidentFrames, videoWidth, videoHeight, "hipMid");
    const knee = medianJointPoint(confidentFrames, videoWidth, videoHeight, "kneeMid");
    const ankle = medianJointPoint(confidentFrames, videoWidth, videoHeight, "ankleMid");

    if ([shoulder, elbow, wrist, hip, knee, ankle].some((p) => !p)) {
      return {
        status: "low_confidence",
        message: "Some key joints weren't visible clearly enough to analyze.",
      };
    }

    const faults = [];

    // 1️⃣ Arm lockout — wrist-elbow-shoulder should be ~180° (straight
    // support arms; a floor/parallette L-sit is held on locked-out arms,
    // not bent ones like a dip).
    const elbowAngle = angleBetween(wrist, elbow, shoulder);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 15) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 30 ? "major" : "moderate",
        detail: `Arms are bent roughly ${elbowDeviation.toFixed(0)}° instead of locked out straight.`,
      });
    }

    // 2️⃣ Torso vertical alignment — the shoulder-hip line should point
    // straight up/down, not lean forward or back. Measured against a
    // synthetic straight-up reference point above the shoulder, same
    // "deviation from 180°" pattern as the other straight-line checks.
    const verticalReference = { x: shoulder.x, y: shoulder.y - 100 };
    const torsoAngle = angleBetween(hip, shoulder, verticalReference);
    const torsoDeviation = torsoAngle === null ? 0 : 180 - torsoAngle;
    if (Math.abs(torsoDeviation) > 12) {
      faults.push({
        id: "torso_lean",
        severity: Math.abs(torsoDeviation) > 25 ? "major" : "moderate",
        // Direction (leaning forward vs. back) isn't reported: which way is
        // "forward" depends on which way the athlete faces in a side-on
        // shot, which isn't something we can reliably tell from pose data
        // alone — reporting a guessed direction risks just being wrong.
        detail: `Your torso is tilted about ${Math.abs(torsoDeviation).toFixed(0)}° off vertical instead of staying upright over your hands.`,
      });
    }

    // 3️⃣ Leg height — shoulder-hip-knee angle should be ~90° (torso
    // vertical, legs held level with the hips, forming the "L"). Only
    // penalized when legs droop BELOW parallel — legs raised above parallel
    // (e.g. into a V-sit) aren't a fault, just a harder variation.
    const hipAngle = angleBetween(shoulder, hip, knee);
    const legsBelowParallelBy = hipAngle === null ? 0 : hipAngle - 90;
    if (legsBelowParallelBy > 15) {
      faults.push({
        id: "legs_too_low",
        severity: legsBelowParallelBy > 30 ? "major" : "moderate",
        detail: `Legs are held roughly ${legsBelowParallelBy.toFixed(0)}° below parallel with the ground — work on lifting them level with your hips.`,
      });
    }

    // 4️⃣ Leg straightness — hip-knee-ankle should be ~180° (knees locked,
    // not bent/tucked)
    const legAngle = angleBetween(hip, knee, ankle);
    const legDeviation = legAngle === null ? 0 : 180 - legAngle;
    if (legDeviation > 10) {
      faults.push({
        id: "bent_legs",
        severity: legDeviation > 25 ? "major" : "moderate",
        detail: `Knees are bent roughly ${legDeviation.toFixed(0)}° instead of staying straight.`,
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
      angles: {
        elbowAngle: round1(elbowAngle),
        torsoAngle: round1(torsoAngle),
        hipAngle: round1(hipAngle),
        legAngle: round1(legAngle),
      },
    };
  };
})();