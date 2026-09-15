// engine/hold-evaluators.js
import { angle, torsoVertical, bodyLine } from './primitives.js';

/**
 * Base class for streaming static hold evaluators.
 * Guarantees common result schema across all hold skills.
 */
export class BaseHoldEvaluator {
  constructor(skillName) {
    this.skillName = skillName;
    this.recentPositions = [];
    this.maxWindow = 10;
  }

  reset() {
    this.recentPositions = [];
  }

  /**
   * Evaluates landmark stability over a short sliding window.
   * Returns a score from 0.0 (high drift/jitter) to 1.0 (rock steady).
   */
  computeStability(currentPoint) {
    if (!currentPoint) return 0.5;
    this.recentPositions.push({ x: currentPoint.x, y: currentPoint.y });
    if (this.recentPositions.length > this.maxWindow) {
      this.recentPositions.shift();
    }
    if (this.recentPositions.length < 3) return 0.8;

    let totalMovement = 0;
    for (let i = 1; i < this.recentPositions.length; i++) {
      const prev = this.recentPositions[i - 1];
      const curr = this.recentPositions[i];
      totalMovement += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    }
    const avgMovement = totalMovement / (this.recentPositions.length - 1);
    // Typical steady hold movement is < 0.01 in normalized coords per frame
    return Math.max(0.0, Math.min(1.0, 1.0 - (avgMovement / 0.05)));
  }

  /**
   * Helper to format a tracking-loss / low-confidence result.
   */
  buildTrackingLossResult(poseConfidence) {
    return {
      skill: this.skillName,
      type: 'hold',
      poseConfidence: Math.max(0, Math.min(1, poseConfidence)),
      skillLikelihood: null,
      formQuality: null,
      metrics: null,
      faults: []
    };
  }

  /**
   * Helper to pick the best visible side (left vs right) from landmarks.
   */
  getVisibleSideJoints(landmarks) {
    if (!landmarks || landmarks.length < 29) return null;

    const leftIndices = [11, 13, 15, 23, 25, 27]; // shoulder, elbow, wrist, hip, knee, ankle
    const rightIndices = [12, 14, 16, 24, 26, 28];

    const getAvgVis = (indices) =>
      indices.reduce((acc, idx) => acc + (landmarks[idx] ? (landmarks[idx].visibility || 1.0) : 0), 0) / indices.length;

    const leftVis = getAvgVis(leftIndices);
    const rightVis = getAvgVis(rightIndices);

    const isLeft = leftVis >= rightVis;
    const indices = isLeft ? leftIndices : rightIndices;
    const confidence = Math.max(leftVis, rightVis);

    return {
      confidence,
      side: isLeft ? 'left' : 'right',
      shoulder: landmarks[indices[0]] || { x: 0, y: 0, z: 0 },
      elbow: landmarks[indices[1]] || { x: 0, y: 0, z: 0 },
      wrist: landmarks[indices[2]] || { x: 0, y: 0, z: 0 },
      hip: landmarks[indices[3]] || { x: 0, y: 0, z: 0 },
      knee: landmarks[indices[4]] || { x: 0, y: 0, z: 0 },
      ankle: landmarks[indices[5]] || { x: 0, y: 0, z: 0 },
    };
  }
}

/**
 * Live L-sit Evaluator
 * Evaluates streaming frames for L-sit hold geometry, separating resemblance
 * (skill likelihood) from execution correctness (form quality).
 */
export class LsitEvaluator extends BaseHoldEvaluator {
  constructor() {
    super('lsit');
  }

  evaluate(landmarks, timestampMs = performance.now()) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) {
      return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);
    }

    const { confidence, shoulder, elbow, wrist, hip, knee, ankle } = sideData;

    // 1. Joint angles
    const armLockoutAngle = angle(wrist, elbow, shoulder);
    const hipAngle = angle(shoulder, hip, knee);
    const legExtensionAngle = angle(hip, knee, ankle);
    const torsoVert = torsoVertical(shoulder, hip);
    const stability = this.computeStability(hip);

    // 2. Spatial indicators (image coords: y increases downward)
    // Hands must be lower than shoulders (arms extending downward)
    const isHandsSupporting = wrist.y > shoulder.y + 0.15;
    // Hips should be level with or above wrists (elevated off floor)
    const hipElevationDelta = wrist.y - hip.y; // Positive if hip is above wrist
    const isHipsElevated = hipElevationDelta > -0.04;
    // Legs extended forward: ankle.x should be significantly displaced from hip.x
    const legReach = Math.abs(ankle.x - hip.x);

    // 3. Skill Likelihood: Does the body resemble an L-sit posture?
    // High likelihood when hands support weight, hips are near wrist level, and legs reach forward in ~90° angle
    let likelihood = 0.0;
    if (isHandsSupporting && isHipsElevated) {
      // Base score for supported hold
      likelihood += 0.40;

      // Hip angle roughly in the L-sit pocket (60° to 125°)
      if (hipAngle >= 65 && hipAngle <= 120) {
        likelihood += 0.35;
      } else if (hipAngle >= 50 && hipAngle <= 140) {
        likelihood += 0.20;
      }

      // Legs extending horizontally
      if (legReach > 0.12) {
        likelihood += 0.25;
      }
    }
    const skillLikelihood = Math.max(0.0, Math.min(1.0, likelihood));

    // 4. Form Quality: How cleanly is the L-sit executed?
    const faults = [];

    // Quality Component A: Arm Lockout (ideal 170°-180°)
    const armScore = Math.max(0.0, Math.min(1.0, (armLockoutAngle - 130) / 45));
    if (armLockoutAngle < 160) {
      faults.push('bent_arms');
    }

    // Quality Component B: Hip Angle (ideal 85°-95° = 1.0)
    const hipDev = Math.abs(hipAngle - 90);
    const hipScore = Math.max(0.0, Math.min(1.0, 1.0 - (hipDev / 40)));
    if (hipAngle > 105 || hipElevationDelta < -0.02) {
      faults.push('hips_dropping');
    }

    // Quality Component C: Leg Extension (ideal 170°-180°)
    const legScore = Math.max(0.0, Math.min(1.0, (legExtensionAngle - 110) / 65));
    if (legExtensionAngle < 155) {
      faults.push('knee_bend');
    }

    // Quality Component D: Torso Verticality (ideal < 15°)
    const torsoScore = Math.max(0.0, Math.min(1.0, 1.0 - (torsoVert / 35)));
    if (torsoVert > 20) {
      faults.push('torso_lean');
    }

    // Quality Component E: Hand Support / Hip Elevation
    const supportScore = Math.max(0.0, Math.min(1.0, (hipElevationDelta + 0.05) / 0.15));

    let qualityPenalty = 1.0;
    if (legExtensionAngle < 150) {
      qualityPenalty *= Math.max(0.4, (legExtensionAngle - 90) / 60);
    }
    if (hipAngle > 105) {
      qualityPenalty *= Math.max(0.5, hipScore);
    }
    if (hipElevationDelta < -0.02) {
      qualityPenalty *= Math.max(0.3, supportScore);
    }
    if (armLockoutAngle < 155) {
      qualityPenalty *= Math.max(0.6, armScore);
    }

    const baseQuality = (
      armScore * 0.20 +
      hipScore * 0.25 +
      legScore * 0.30 +
      torsoScore * 0.15 +
      stability * 0.10
    );

    const formQuality = Math.max(0.0, Math.min(1.0, baseQuality * qualityPenalty));

    return {
      skill: 'lsit',
      type: 'hold',
      poseConfidence: Math.round(confidence * 100) / 100,
      skillLikelihood: Math.round(skillLikelihood * 100) / 100,
      formQuality: Math.round(formQuality * 100) / 100,
      metrics: {
        hipAngle: Math.round(hipAngle),
        legExtension: Math.round(legScore * 100) / 100,
        armLockout: Math.round(armLockoutAngle),
        torsoVertical: Math.round(torsoVert),
        handSupport: Math.round(supportScore * 100) / 100,
        stability: Math.round(stability * 100) / 100
      },
      faults
    };
  }
}

/**
 * Live Handstand Evaluator
 * Evaluates streaming frames for inverted orientation, joint stack, arm lockout,
 * and body line alignment. Rejects kick-ups prior to dwell confirmation.
 */
export class HandstandEvaluator extends BaseHoldEvaluator {
  constructor() {
    super('handstand');
  }

  evaluate(landmarks, timestampMs = performance.now()) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) {
      return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);
    }

    const { confidence, shoulder, elbow, wrist, hip, knee, ankle } = sideData;

    // 1. Inversion Check (image coords: y increases downward)
    // In a handstand, body must be inverted: hips and ankles above shoulders,
    // and shoulders stacked above wrists on the ground.
    const isShoulderAboveWrist = shoulder.y < wrist.y - 0.05;
    const isHipAboveShoulder = hip.y < shoulder.y - 0.05;
    const isAnkleAboveHip = ankle.y < hip.y - 0.05;

    let inversion = 0.0;
    if (isHipAboveShoulder && isAnkleAboveHip) {
      inversion = 0.70;
      if (isShoulderAboveWrist) inversion += 0.30;
    } else if (isHipAboveShoulder) {
      inversion = 0.35;
    }

    // 2. Arm Lockout & Elevation
    const armLockoutAngle = angle(wrist, elbow, shoulder);
    const armScore = Math.max(0.0, Math.min(1.0, (armLockoutAngle - 135) / 40));

    // 3. Vertical Stack Alignment (wrist, shoulder, and hip in vertical column)
    const wristShoulderOffsetX = Math.abs(wrist.x - shoulder.x);
    const shoulderHipOffsetX = Math.abs(shoulder.x - hip.x);
    const stackDeviation = wristShoulderOffsetX + shoulderHipOffsetX;
    const stackQuality = Math.max(0.0, Math.min(1.0, 1.0 - (stackDeviation / 0.30)));

    // 4. Body Line (arch vs pike)
    const lineData = bodyLine(shoulder, hip, ankle);
    const bodyLineDeviation = lineData.deviation;
    const bodyLineScore = Math.max(0.0, Math.min(1.0, 1.0 - (bodyLineDeviation / 35)));

    // 5. Leg Straightness
    const legAngle = angle(hip, knee, ankle);
    const legScore = Math.max(0.0, Math.min(1.0, (legAngle - 130) / 45));

    // 6. Stability over time
    const stability = this.computeStability(shoulder);

    // Skill Likelihood: High only when fully or mostly inverted and weight-bearing
    let likelihood = 0.0;
    if (isShoulderAboveWrist && isHipAboveShoulder) {
      likelihood += 0.50;
      if (isAnkleAboveHip) likelihood += 0.35;
      if (armLockoutAngle > 145) likelihood += 0.15;
    }
    const skillLikelihood = Math.max(0.0, Math.min(1.0, likelihood));

    // Form Quality & Faults
    const faults = [];

    if (armLockoutAngle < 165) {
      faults.push('bent_arms');
    }

    if (stackDeviation > 0.16) {
      faults.push('shoulder_misalignment');
    }

    if (bodyLineDeviation > 15) {
      if (lineData.isPike) {
        faults.push('hip_pike');
      } else {
        faults.push('hip_arch');
      }
    }

    if (legAngle < 165) {
      faults.push('bent_legs');
    }

    let qualityPenalty = 1.0;
    if (armLockoutAngle < 155) {
      qualityPenalty *= Math.max(0.4, armScore);
    }
    if (bodyLineDeviation > 20) {
      qualityPenalty *= Math.max(0.5, bodyLineScore);
    }
    if (stackDeviation > 0.20) {
      qualityPenalty *= Math.max(0.5, stackQuality);
    }

    const baseQuality = (
      armScore * 0.25 +
      stackQuality * 0.30 +
      bodyLineScore * 0.25 +
      legScore * 0.10 +
      stability * 0.10
    );

    const formQuality = Math.max(0.0, Math.min(1.0, baseQuality * qualityPenalty * inversion));

    return {
      skill: 'handstand',
      type: 'hold',
      poseConfidence: Math.round(confidence * 100) / 100,
      skillLikelihood: Math.round(skillLikelihood * 100) / 100,
      formQuality: Math.round(formQuality * 100) / 100,
      metrics: {
        inversion: Math.round(inversion * 100) / 100,
        shoulderElevation: Math.round(armScore * 100) / 100,
        stackQuality: Math.round(stackQuality * 100) / 100,
        bodyLineDeviation: Math.round(bodyLineDeviation),
        stability: Math.round(stability * 100) / 100
      },
      faults
    };
  }
}
