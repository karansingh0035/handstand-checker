// 🧰 SHARED POSE UTILITIES
// Common geometry + landmark helpers used by every skill's scoring function
// (scoreHandstand, scorePushup, and whatever comes next). Keeping this in
// one place means every skill benefits from the same fixes — e.g. if we
// improve the aspect-ratio correction later, every skill gets it at once
// instead of needing the same fix copy-pasted into N files.

// MediaPipe Pose landmark indices used across skills
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

const MIN_VISIBILITY = 0.5; // Below this, a landmark is too unreliable to trust

// Per-side landmark groupings. Needed because a video filmed side-on (the
// natural angle for push-ups, since it's the only angle that actually shows
// elbow bend depth and hip sag/pike) will have the far side of the body
// partially hidden behind the torso for the whole clip — MediaPipe still
// emits a low-confidence guess for those hidden points rather than nothing,
// so code has to explicitly check visibility per side instead of assuming
// both sides are equally trustworthy every frame.
const LEFT_SIDE_LANDMARKS = [
  POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_ELBOW, POSE_LANDMARKS.LEFT_WRIST,
  POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.LEFT_KNEE, POSE_LANDMARKS.LEFT_ANKLE,
];
const RIGHT_SIDE_LANDMARKS = [
  POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_ELBOW, POSE_LANDMARKS.RIGHT_WRIST,
  POSE_LANDMARKS.RIGHT_HIP, POSE_LANDMARKS.RIGHT_KNEE, POSE_LANDMARKS.RIGHT_ANKLE,
];

function isSideVisible(landmarks, sideIndices) {
  return sideIndices.every((i) => landmarks[i] && landmarks[i].visibility >= MIN_VISIBILITY);
}

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

// Straight-line distance between two pixel-space points. Needed by skills
// that care about proximity between two joints rather than the angle at a
// vertex — e.g. elbow lever's "is the elbow actually tucked against the
// hip" check, which none of the angle-based checks so far needed.
function distance(a, b) {
  if (!a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Straight-line distance between two pixel-space points. Useful for
// proximity checks (e.g. "are the knees actually resting near the elbows")
// where an angle doesn't capture what needs measuring.
function distanceBetween(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function averageValid(values) {
  const valid = values.filter((v) => v !== null && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// MediaPipe normalizes x as a fraction of video WIDTH and y as a fraction
// of video HEIGHT, independently. For a portrait 9:16 phone video, a 0.1
// x-distance and a 0.1 y-distance represent very different real-world
// distances — converting to pixel space first keeps angle math correct
// regardless of the video's aspect ratio.
function toPixelSpace(point, videoWidth, videoHeight) {
  if (!point) return null;
  return { x: point.x * videoWidth, y: point.y * videoHeight };
}

// Finds a single representative position for a landmark across a set of
// frames, using the median rather than the mean. This matters most when
// scoring a whole clip that includes walk-up/entry or dismount/exit motion
// that isn't part of the actual skill — a mean gets dragged toward those
// transition frames, a median mostly ignores them.
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

// Like medianLandmark, but built on getEffectiveJoints instead of a single
// raw landmark index — so it inherits the side-aware selection (real
// visible-side point instead of a hidden-side guess) for any static-hold
// skill (handstand, L-sit, ...) that scores one representative pose across
// the whole clip. jointKey is one of getEffectiveJoints' resolved keys, e.g.
// "hipMid", "shoulderMid", "elbowMid".
function medianJointPoint(frames, videoWidth, videoHeight, jointKey) {
  const points = frames
    .map((frame) => getEffectiveJoints(frame, videoWidth, videoHeight))
    .filter((joints) => joints && joints[jointKey])
    .map((joints) => joints[jointKey]);

  if (points.length === 0) return null;

  return {
    x: median(points.map((p) => p.x)),
    y: median(points.map((p) => p.y)),
  };
}

// Builds a confidence-check function for a specific set of required
// landmark indices. Different skills care about different joints (e.g. a
// push-up cares about the same joints as a handstand), so this is
// parameterized rather than hardcoded to one skill's needs.
function makeConfidenceChecker(requiredIndices) {
  return function isFrameConfident(landmarks) {
    return requiredIndices.every(
      (index) => landmarks[index] && landmarks[index].visibility >= MIN_VISIBILITY
    );
  };
}

// Like getPixelJoints, but side-aware: if only one side of the body is
// confidently visible this frame (the normal case for a side-on push-up
// video), that side's own points are returned directly instead of being
// midpointed with a low-confidence guess from the hidden side. Falls back
// to the full bilateral midpoint when both sides are visible (e.g. a
// front-on video). Returns null if NEITHER side is confidently visible.
function getEffectiveJoints(landmarks, videoWidth, videoHeight) {
  const leftVisible = isSideVisible(landmarks, LEFT_SIDE_LANDMARKS);
  const rightVisible = isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);
  if (!leftVisible && !rightVisible) return null;

  if (leftVisible && rightVisible) {
    return getPixelJoints(landmarks, videoWidth, videoHeight);
  }

  const side = leftVisible ? "LEFT" : "RIGHT";
  const px = (index) => toPixelSpace(landmarks[index], videoWidth, videoHeight);
  const shoulder = px(POSE_LANDMARKS[`${side}_SHOULDER`]);
  const elbow = px(POSE_LANDMARKS[`${side}_ELBOW`]);
  const wrist = px(POSE_LANDMARKS[`${side}_WRIST`]);
  const hip = px(POSE_LANDMARKS[`${side}_HIP`]);
  const knee = px(POSE_LANDMARKS[`${side}_KNEE`]);
  const ankle = px(POSE_LANDMARKS[`${side}_ANKLE`]);

  return {
    leftShoulder: side === "LEFT" ? shoulder : null,
    rightShoulder: side === "RIGHT" ? shoulder : null,
    leftElbow: side === "LEFT" ? elbow : null,
    rightElbow: side === "RIGHT" ? elbow : null,
    leftWrist: side === "LEFT" ? wrist : null,
    rightWrist: side === "RIGHT" ? wrist : null,
    leftHip: side === "LEFT" ? hip : null,
    rightHip: side === "RIGHT" ? hip : null,
    leftKnee: side === "LEFT" ? knee : null,
    rightKnee: side === "RIGHT" ? knee : null,
    leftAnkle: side === "LEFT" ? ankle : null,
    rightAnkle: side === "RIGHT" ? ankle : null,
    // Single-side "mid" points are just that side's real point — more
    // accurate than blending with a hidden-side guess.
    shoulderMid: shoulder,
    elbowMid: elbow,
    hipMid: hip,
    kneeMid: knee,
    ankleMid: ankle,
    wristMid: wrist,
    visibleSide: side,
  };
}

// Converts one frame's raw landmarks into pixel-space midpoints for the
// joints every skill tends to need (shoulder/hip/knee/ankle midpoints,
// individual wrist/elbow points). Returns null if any required landmark is
// missing entirely (confidence checking happens separately).
function getPixelJoints(landmarks, videoWidth, videoHeight) {
  const px = (index) => toPixelSpace(landmarks[index], videoWidth, videoHeight);

  const leftShoulder = px(POSE_LANDMARKS.LEFT_SHOULDER);
  const rightShoulder = px(POSE_LANDMARKS.RIGHT_SHOULDER);
  const leftElbow = px(POSE_LANDMARKS.LEFT_ELBOW);
  const rightElbow = px(POSE_LANDMARKS.RIGHT_ELBOW);
  const leftWrist = px(POSE_LANDMARKS.LEFT_WRIST);
  const rightWrist = px(POSE_LANDMARKS.RIGHT_WRIST);
  const leftHip = px(POSE_LANDMARKS.LEFT_HIP);
  const rightHip = px(POSE_LANDMARKS.RIGHT_HIP);
  const leftKnee = px(POSE_LANDMARKS.LEFT_KNEE);
  const rightKnee = px(POSE_LANDMARKS.RIGHT_KNEE);
  const leftAnkle = px(POSE_LANDMARKS.LEFT_ANKLE);
  const rightAnkle = px(POSE_LANDMARKS.RIGHT_ANKLE);

  return {
    leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist,
    leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle,
    shoulderMid: midpoint(leftShoulder, rightShoulder),
    elbowMid: midpoint(leftElbow, rightElbow),
    hipMid: midpoint(leftHip, rightHip),
    kneeMid: midpoint(leftKnee, rightKnee),
    ankleMid: midpoint(leftAnkle, rightAnkle),
    wristMid: midpoint(leftWrist, rightWrist),
  };
}