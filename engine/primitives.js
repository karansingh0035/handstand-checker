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