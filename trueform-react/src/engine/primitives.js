// engine/primitives.js

export function angle(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let deg = Math.abs((radians * 180.0) / Math.PI);
  if (deg > 180.0) deg = 360.0 - deg;
  return deg;
}

/**
 * 🆕 Torso angle from vertical, made camera-yaw-invariant by folding in
 * MediaPipe's z (rough depth, same scale as x, hip-relative).
 *
 * The original version only used the image-plane x/y — that's fine when
 * filmed side-on, but breaks for front-on / head-on framing (e.g. a phone
 * propped up facing the person doing a pushup): a real horizontal torso's
 * extension shows up mostly as a z difference in that framing, which the
 * old 2D-only math was blind to, so it read as much closer to vertical
 * than the person actually was and incorrectly failed plausibility checks
 * (see PLAUSIBILITY_CHECKS.pushup in index.js).
 *
 * Folding dz into the horizontal component alongside dx makes the angle
 * invariant to which way the subject faces the camera (yaw rotation about
 * their vertical axis), while dy still carries verticality — this assumes
 * the camera itself isn't rolled/tilted sideways, which holds for normal
 * phone-propped-up filming.
 *
 * Caveat: MediaPipe's z is noisier and less validated than x/y, so this
 * needs real-clip testing across filming angles, same as the muscleup
 * hysteresis numbers in index.js.
 */
export function torsoVertical(shoulder, hip) {
  const dy = Math.abs(hip.y - shoulder.y);
  const dx = Math.abs(hip.x - shoulder.x);
  const dz = Math.abs((hip.z || 0) - (shoulder.z || 0));
  const horizontal = Math.hypot(dx, dz);
  const rad = Math.atan2(horizontal, dy);
  return (rad * 180.0) / Math.PI;
}

export function bodyLine(shoulder, hip, ankle) {
  const lineAngle = angle(shoulder, hip, ankle);
  const deviation = Math.abs(180 - lineAngle);

  // 2D cross-product signed distance
  const crossProduct = (ankle.x - shoulder.x) * (hip.y - shoulder.y) - 
                       (ankle.y - shoulder.y) * (hip.x - shoulder.x);

  // Normalize cross product by horizontal orientation (facing left vs right)
  const facingDirection = Math.sign(ankle.x - shoulder.x) || 1;
  const normalizedCross = crossProduct * facingDirection;

  return {
    angle: lineAngle,
    deviation,
    isSag: normalizedCross > 0 && deviation > 8.0,
    isPike: normalizedCross < 0 && deviation > 8.0
  };
}

/**
 * 🆕 Measures forward shoulder protraction past the wrist — the defining
 * feature of planche work. Returns a scale-invariant ratio:
 *   0    = shoulders directly above wrists
 *   >0   = shoulders leaning forward past the wrists (toward planche)
 *   <0   = shoulders leaning back behind the wrists
 *
 * Normalized by torso length (shoulder-to-hip distance) so the ratio stays
 * comparable regardless of how close the camera is to the subject — a raw
 * pixel distance would shrink/grow with filming distance and be useless
 * as a fixed threshold.
 *
 * Orientation-agnostic via the same facingDirection sign trick bodyLine()
 * uses: we don't know if the person faces left or right in frame, so we
 * infer "forward" from which side the hip sits relative to the wrist
 * (hips and shoulders move forward together in a real planche lean).
 */
export function shoulderLean(shoulder, wrist, hip) {
  const facingDirection = Math.sign(hip.x - wrist.x) || 1;
  const rawLean = (shoulder.x - wrist.x) * facingDirection;

  const torsoLength = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y) || 1e-6;
  return rawLean / torsoLength;
}

/**
 * 🆕 Measures vertical progress of the shoulder relative to the wrist —
 * used to segment muscle-up reps. Elbow angle alone isn't a reliable
 * segmentation signal here: it can transiently straighten mid-transition
 * during the pivot over the bar, which would falsely trigger rep
 * completion right at the transition instead of at the actual dip lockout.
 *
 * Returns a scale-invariant ratio, normalized by torso length:
 *   very negative = dead hang (shoulder well below the wrist/bar)
 *   ~0            = shoulder near wrist height (mid-pull)
 *   positive      = shoulder above the wrist (transition into support/dip)
 *
 * y increases downward in image space, so (wrist.y - shoulder.y) is
 * negative while hanging (shoulder below the wrist) and positive once the
 * shoulder rises above it into support.
 */
export function verticalProgress(shoulder, wrist, hip) {
  const torsoLength = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y) || 1e-6;
  return (wrist.y - shoulder.y) / torsoLength;
}