// 🧰 SHARED POSE UTILITIES
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

const MIN_VISIBILITY = 0.5;

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

function angleBetween(a, b, c) {
  if (!a || !b || !c || a.x === undefined || b.x === undefined || c.x === undefined) {
    return null;
  }

  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return null;

  let cos = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Distance between two pixel-space points (safe with undefined checks)
function distance(a, b) {
  if (!a || !b || a.x === undefined || b.x === undefined) return null;
  return Math.hypot(b.x - a.x, b.y - a.y);
}
const distanceBetween = distance; // Alias for backward compatibility

function midpoint(a, b) {
  if (!a || !b) return null;
  // 🆕 z averaged alongside x/y when present, so joints derived from
  // midpoint() (e.g. shoulderMid/hipMid) still carry depth through.
  // Falls back cleanly when z is absent (undefined + undefined = NaN is
  // avoided via the || 0 default) so existing 2D-only call sites are unaffected.
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
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

function toPixelSpace(point, videoWidth, videoHeight) {
  if (!point) return null;
  // 🆕 z carried through alongside x/y — MediaPipe's z is roughly the same
  // normalized scale as x (not per-axis like x vs y), so it's scaled by
  // videoWidth to land in the same pixel-space units as x/y here. Needed
  // for camera-angle-invariant checks downstream (e.g. pushup.js's
  // computeHorizontalRatio) the same way engine/primitives.js's
  // torsoVertical now uses z. Existing callers that only read x/y are
  // unaffected.
  return { x: point.x * videoWidth, y: point.y * videoHeight, z: (point.z || 0) * videoWidth };
}

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

function makeConfidenceChecker(requiredIndices) {
  return function isFrameConfident(landmarks) {
    return requiredIndices.every(
      (index) => landmarks[index] && landmarks[index].visibility >= MIN_VISIBILITY
    );
  };
}

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
    shoulderMid: shoulder,
    elbowMid: elbow,
    hipMid: hip,
    kneeMid: knee,
    ankleMid: ankle,
    wristMid: wrist,
    visibleSide: side,
  };
}

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

const MIN_TOTAL_FRAMES = 30;

function validateVideoQuality(frames) {
  const total = frames.length;

  if (total < MIN_TOTAL_FRAMES) {
    return {
      valid: false,
      confidence: 0,
      message:
        "This video is too short to analyze. Please record for at least a few seconds with your full body clearly in frame.",
    };
  }

  // 🆕 Was: averaging visibility across ALL ~33 landmarks (face, both
  // feet's toe/heel points included) and requiring that whole-body
  // average >= 0.5 for 70% of frames. That's stricter than what scoring
  // actually needs and fails legitimate footage where the camera simply
  // doesn't frame the face or exact toe tips (e.g. a laptop webcam with a
  // tight FOV cropping feet, or looking down/away from the lens) even
  // though every landmark that matters (shoulders/elbows/wrists/hips/
  // knees/ankles) is tracked fine.
  //
  // Now: reuses isSideVisible/LEFT_SIDE_LANDMARKS/RIGHT_SIDE_LANDMARKS —
  // the same "one full side visible" bar pushup.js's isFrameConfident
  // already applies — so this global gate stops being stricter than the
  // skill-specific checks that run after it.
  const usable = frames.filter((frame) => {
    if (!frame || frame.length === 0) return false;
    return isSideVisible(frame, LEFT_SIDE_LANDMARKS) || isSideVisible(frame, RIGHT_SIDE_LANDMARKS);
  });

  const ratio = usable.length / Math.max(total, 1);

  if (ratio < 0.7) {
    return {
      valid: false,
      confidence: ratio,
      message:
        "We could not detect a person clearly enough throughout this video. Use good lighting, keep at least one full side of your body (shoulder to ankle) in frame, and make sure only one person is visible.",
    };
  }

  return { valid: true, confidence: ratio };
}

// Computes signed body line angle deviation from 180° (straight).
// Positive values indicate piking/sagging in one direction, negative in the other,
// automatically normalized across left-facing or right-facing profile shots.
function signedBodyLineDeviation(shoulder, hip, ankle) {
  const lineAngle = angleBetween(shoulder, hip, ankle);
  if (lineAngle === null) return null;

  const deviation = 180 - lineAngle;
  if (Math.abs(deviation) < 0.001) return 0;

  const crossProduct =
    (ankle.x - shoulder.x) * (hip.y - shoulder.y) -
    (ankle.y - shoulder.y) * (hip.x - shoulder.x);

  const facingDirection = Math.sign(ankle.x - shoulder.x) || 1;
  const normalizedCross = crossProduct * facingDirection;

  return normalizedCross > 0 ? deviation : -deviation;
}