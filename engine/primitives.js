// engine/primitives.js

export function angle(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let deg = Math.abs((radians * 180.0) / Math.PI);
  if (deg > 180.0) deg = 360.0 - deg;
  return deg;
}

export function torsoVertical(shoulder, hip) {
  const dy = Math.abs(hip.y - shoulder.y);
  const dx = Math.abs(hip.x - shoulder.x);
  const rad = Math.atan2(dx, dy);
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