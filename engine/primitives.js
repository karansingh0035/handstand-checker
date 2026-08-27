// engine/primitives.js

/**
 * Calculates interior angle at landmark 'b' in degrees (0° - 180°).
 */
export function angle(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };

  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.hypot(ba.x, ba.y);
  const magBC = Math.hypot(bc.x, bc.y);

  const cos = dot / (magBA * magBC + 1e-9);
  const clampedCos = Math.max(-1.0, Math.min(1.0, cos));

  return (Math.acos(clampedCos) * 180) / Math.PI;
}

/**
 * Calculates torso tilt relative to vertical (0° = upright)[cite: 3].
 */
export function torsoVertical(shoulder, hip) {
  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y; // Y axis points down in browser space[cite: 3]
  return Math.abs((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/**
 * Measures shoulder-hip-ankle line and distinguishes sag vs pike[cite: 3].
 */
export function bodyLine(shoulder, hip, ankle) {
  const jointAngle = angle(shoulder, hip, ankle);
  
  // Cross product determines if hip sags below the shoulder-ankle line[cite: 3]
  const crossProduct = (ankle.x - shoulder.x) * (hip.y - shoulder.y) - 
                       (ankle.y - shoulder.y) * (hip.x - shoulder.x);
  
  const isSag = crossProduct > 0; 

  return {
    angle: jointAngle,
    deviation: Math.abs(180 - jointAngle),
    isSag: isSag,
    isPike: !isSag
  };
}