// 🤸 HANDSTAND FORM SCORING
// Scope (v1): standard vertical handstand, legs together, both hands down,
// decent even lighting. Straddle/split variations are intentionally out of
// scope for now — see roadmap notes.

// MediaPipe Pose landmark indices we care about for this skill
const POSE_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

const MIN_VISIBILITY = 0.5;      // Below this, a landmark is too unreliable to trust
const MIN_CONFIDENT_FRAMES = 20; // Need at least ~20 clearly-tracked frames somewhere in the clip (~0.6-1s of an actual hold)

// --- Geometry helpers ---------------------------------------------------

// Angle at point b, formed by rays b->a and b->c, in degrees.
// 180° means a-b-c are in a straight line.
function angleBetween(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return null;

  let cos = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
  cos = Math.max(-1, Math.min(1, cos)); // guard against floating-point drift past [-1, 1]
  return (Math.acos(cos) * 180) / Math.PI;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function averageValid(values) {
  const valid = values.filter((v) => v !== null && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function round1(n) {
  return n === null ? null : Math.round(n * 10) / 10;
}

// MediaPipe normalizes x as a fraction of video WIDTH and y as a fraction
// of video HEIGHT, independently. For a square video that's harmless, but
// for a portrait 9:16 phone video, a 0.1 x-distance and a 0.1 y-distance
// represent very different real-world distances. angleBetween() assumes x
// and y are on the same scale, so we convert to real pixel space first —
// this is what actually keeps angle math correct regardless of the video's
// aspect ratio (independent of any canvas display sizing).
function toPixelSpace(point, videoWidth, videoHeight) {
  if (!point) return null;
  return { x: point.x * videoWidth, y: point.y * videoHeight };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Finds a single representative position for a landmark across the WHOLE
// video, using the median of every confident frame rather than a mean.
// This matters now that we're analyzing the entire clip in one pass instead
// of a short rolling window: a full clip includes walk-up/entry and
// dismount/exit motion that isn't part of the actual held position. A mean
// would get dragged toward those transition frames; a median mostly ignores
// them as long as the genuine hold makes up the majority of tracked frames.
function medianLandmark(frames, index) {
  const points = frames
    .map((frame) => frame[index])
    .filter((p) => p && p.visibility >= MIN_VISIBILITY);

  if (points.length === 0) return null;

  return {
    x: median(points.map((p) => p.x)),
    y: median(points.map((p) => p.y)),
  };
}

// A frame only counts as "confident" if every joint we need is visible
// enough to trust. This is the gate that stops a low-visibility frame
// (e.g. hands lost against a similar-colored floor) from polluting the average.
function isFrameConfident(landmarks) {
  return Object.values(POSE_LANDMARKS).every(
    (index) => landmarks[index] && landmarks[index].visibility >= MIN_VISIBILITY
  );
}

// --- Main scoring function ----------------------------------------------

// history: array of frames collected across the ENTIRE video, each frame
// being the raw `results.poseLandmarks` array MediaPipe gives you (33
// landmarks with x, y, z, visibility). Call this once, after the video has
// finished playing — not per-frame — so the result is one final, stable
// rating rather than a live number that shifts during playback.
// videoWidth/videoHeight: the source video's native pixel dimensions —
// required to correct for non-square aspect ratios before computing angles.
function scoreHandstand(history, videoWidth, videoHeight) {
  const confidentFrames = history.filter(isFrameConfident);

  if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
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