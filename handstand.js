// 🤸 HANDSTAND FORM SCORING
// Scope (v1): standard vertical handstand, legs together, both hands down,
// decent even lighting. Straddle/split variations are intentionally out of
// scope for now — see roadmap notes.
//
// Shared geometry/landmark helpers (angleBetween, midpoint, medianLandmark,
// POSE_LANDMARKS, etc.) live in pose-utils.js, loaded before this file.


// 🔒 Wrapped in an IIFE so internal names (HANDSTAND_MIN_CONFIDENT_FRAMES,
// isHandstandFrameConfident, etc.) stay private to this file and can never collide
// with another skill file's same-named internals — only scoreHandstand
// itself is exposed globally.
const scoreHandstand = (function () {
  const HANDSTAND_MIN_CONFIDENT_FRAMES = 20; // Need at least ~20 clearly-tracked frames somewhere in the clip (~0.6-1s of an actual hold)

  const isHandstandFrameConfident = makeConfidenceChecker(Object.values(POSE_LANDMARKS));

  // history: array of frames collected across the ENTIRE video, each frame
  // being the raw `results.poseLandmarks` array MediaPipe gives you (33
  // landmarks with x, y, z, visibility). Call this once, after the video has
  // finished playing — not per-frame — so the result is one final, stable
  // rating rather than a live number that shifts during playback.
  // videoWidth/videoHeight: the source video's native pixel dimensions —
  // required to correct for non-square aspect ratios before computing angles.
  return function scoreHandstand(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isHandstandFrameConfident);

    if (confidentFrames.length < HANDSTAND_MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your hands and feet for enough of the video to score this handstand. Try better lighting or make sure your whole body stays in frame during the hold.",
      };
    }

    // Find one representative position per joint across the whole clip (in
    // normalized space), then convert to pixel space so x and y are on the
    // same physical scale before any angle math.
    const representative = {};
    for (const name in POSE_LANDMARKS) {
      const normalized = medianLandmark(confidentFrames, POSE_LANDMARKS[name]);
      representative[name] = toPixelSpace(normalized, videoWidth, videoHeight);
    }

    if (Object.values(representative).some((p) => !p)) {
      return {
        status: "low_confidence",
        message: "Some key joints weren't visible clearly enough to analyze.",
      };
    }

    const wristMid = midpoint(representative.LEFT_WRIST, representative.RIGHT_WRIST);
    const shoulderMid = midpoint(representative.LEFT_SHOULDER, representative.RIGHT_SHOULDER);
    const hipMid = midpoint(representative.LEFT_HIP, representative.RIGHT_HIP);
    const kneeMid = midpoint(representative.LEFT_KNEE, representative.RIGHT_KNEE);
    const ankleMid = midpoint(representative.LEFT_ANKLE, representative.RIGHT_ANKLE);

    const faults = [];

    // 1️⃣ Elbow lockout — wrist-elbow-shoulder should be ~180° (straight arm)
    const leftElbowAngle = angleBetween(representative.LEFT_WRIST, representative.LEFT_ELBOW, representative.LEFT_SHOULDER);
    const rightElbowAngle = angleBetween(representative.RIGHT_WRIST, representative.RIGHT_ELBOW, representative.RIGHT_SHOULDER);
    const elbowAngle = averageValid([leftElbowAngle, rightElbowAngle]);
    const elbowDeviation = elbowAngle === null ? 0 : 180 - elbowAngle;
    if (elbowDeviation > 15) {
      faults.push({
        id: "bent_arms",
        severity: elbowDeviation > 30 ? "major" : "moderate",
        detail: `Arms are bent roughly ${elbowDeviation.toFixed(0)}° from a straight lockout.`,
      });
    }

    // 2️⃣ Shoulder alignment — wrist-shoulder-hip should be ~180° (no piking/hollowing at shoulders)
    const shoulderAlignAngle = angleBetween(wristMid, shoulderMid, hipMid);
    const shoulderDeviation = shoulderAlignAngle === null ? 0 : 180 - shoulderAlignAngle;
    if (Math.abs(shoulderDeviation) > 12) {
      faults.push({
        id: "shoulder_misalignment",
        severity: Math.abs(shoulderDeviation) > 25 ? "major" : "moderate",
        detail: `Shoulders aren't stacked directly over your hands (~${shoulderDeviation.toFixed(0)}° off).`,
      });
    }

    // 3️⃣ Hip alignment — shoulder-hip-ankle should be ~180° (catches banana-back arch or hip pike)
    const hipAlignAngle = angleBetween(shoulderMid, hipMid, ankleMid);
    const hipDeviation = hipAlignAngle === null ? 0 : 180 - hipAlignAngle;
    if (Math.abs(hipDeviation) > 10) {
      faults.push({
        id: "hip_pike_or_arch",
        severity: Math.abs(hipDeviation) > 25 ? "major" : "moderate",
        detail: `Your hips are ${hipDeviation > 0 ? "piked forward" : "arched back"} by about ${Math.abs(hipDeviation).toFixed(0)}°.`,
      });
    }

    // 4️⃣ Leg straightness — hip-knee-ankle should be ~180°
    const legAngle = angleBetween(hipMid, kneeMid, ankleMid);
    const legDeviation = legAngle === null ? 0 : 180 - legAngle;
    if (legDeviation > 10) {
      faults.push({
        id: "bent_legs",
        severity: legDeviation > 25 ? "major" : "moderate",
        detail: `Knees are bent roughly ${legDeviation.toFixed(0)}° instead of staying straight.`,
      });
    }

    // 5️⃣ Lateral lean — checks if shoulders/hips/ankles drift sideways from the wrist line.
    // Threshold is expressed as a fraction of video width (5%/10%) rather than a
    // fixed pixel count, so it scales correctly across different video resolutions.
    const referenceX = wristMid.x;
    const lateralOffsets = [shoulderMid.x, hipMid.x, ankleMid.x].map((x) => Math.abs(x - referenceX));
    const maxLateralOffset = Math.max(...lateralOffsets);
    const maxLateralOffsetRatio = maxLateralOffset / videoWidth;
    if (maxLateralOffsetRatio > 0.05) {
      faults.push({
        id: "lateral_lean",
        severity: maxLateralOffsetRatio > 0.1 ? "major" : "moderate",
        detail: "Your body is leaning to one side instead of stacking vertically over your hands.",
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
        shoulderAlignAngle: round1(shoulderAlignAngle),
        hipAlignAngle: round1(hipAlignAngle),
        legAngle: round1(legAngle),
      },
    };
  }

})();