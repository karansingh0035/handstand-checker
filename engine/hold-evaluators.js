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
    return Math.max(0.0, Math.min(1.0, 1.0 - (avgMovement / 0.05)));
  }

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

  getVisibleSideJoints(landmarks) {
    if (!landmarks || landmarks.length < 29) return null;

    const leftIndices = [11, 13, 15, 23, 25, 27]; 
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

/** 1. L-sit Evaluator */
export class LsitEvaluator extends BaseHoldEvaluator {
  constructor() { super('lsit'); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, wrist, hip, knee, ankle } = sideData;
    const armLock = angle(wrist, elbow, shoulder);
    const hipAng = angle(shoulder, hip, knee);
    const legExt = angle(hip, knee, ankle);
    const stability = this.computeStability(hip);

    const isHandsSupporting = wrist.y > shoulder.y + 0.15;
    const hipElevationDelta = wrist.y - hip.y;
    const isHipsElevated = hipElevationDelta > -0.04;
    const legReach = Math.abs(ankle.x - hip.x);

    let likelihood = 0.0;
    if (isHandsSupporting && isHipsElevated) {
      likelihood += 0.40;
      if (hipAng >= 65 && hipAng <= 120) likelihood += 0.35;
      if (legReach > 0.12) likelihood += 0.25;
    }

    const faults = [];
    if (armLock < 160) faults.push('bent_arms');
    if (hipAng > 105 || hipElevationDelta < -0.02) faults.push('hips_dropping');
    if (legExt < 155) faults.push('knee_bend');

    const formQuality = Math.max(0, Math.min(1, ((armLock / 180) * 0.3 + (1 - Math.abs(hipAng - 90)/50) * 0.4 + stability * 0.3)));

    return {
      skill: 'lsit', type: 'hold', poseConfidence: confidence,
      skillLikelihood: Math.min(1, likelihood), formQuality,
      metrics: { hipAngle: Math.round(hipAng), armLockout: Math.round(armLock), stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}

/** 2. V-sit Evaluator */
export class VsitEvaluator extends BaseHoldEvaluator {
  constructor() { super('vsit'); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, wrist, hip, knee, ankle } = sideData;
    const hipAng = angle(shoulder, hip, knee);
    const legExt = angle(hip, knee, ankle);
    const stability = this.computeStability(hip);

    const faults = [];
    if (hipAng > 70) faults.push('insufficient_compression');
    if (legExt < 160) faults.push('knee_bend');

    const likelihood = hipAng < 80 ? 0.9 : 0.2;
    const formQuality = Math.max(0, Math.min(1, (1 - hipAng / 90) * 0.7 + stability * 0.3));

    return {
      skill: 'vsit', type: 'hold', poseConfidence: confidence,
      skillLikelihood: likelihood, formQuality,
      metrics: { compressionAngle: Math.round(hipAng), stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}

/** 3. Handstand Evaluator */
export class HandstandEvaluator extends BaseHoldEvaluator {
  constructor() { super('handstand'); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, wrist, hip, knee, ankle } = sideData;
    const isShoulderAboveWrist = shoulder.y < wrist.y - 0.05;
    const isHipAboveShoulder = hip.y < shoulder.y - 0.05;
    const isAnkleAboveHip = ankle.y < hip.y - 0.05;

    const armLock = angle(wrist, elbow, shoulder);
    const line = bodyLine(shoulder, hip, ankle);
    const stability = this.computeStability(shoulder);

    let likelihood = 0.0;
    if (isShoulderAboveWrist && isHipAboveShoulder) {
      likelihood += 0.6;
      if (isAnkleAboveHip) likelihood += 0.4;
    }

    const faults = [];
    if (armLock < 165) faults.push('bent_arms');
    if (line.deviation > 15) faults.push(line.isPike ? 'hip_pike' : 'hip_arch');

    const formQuality = Math.max(0, Math.min(1, (armLock / 180) * 0.4 + (1 - line.deviation / 35) * 0.4 + stability * 0.2));

    return {
      skill: 'handstand', type: 'hold', poseConfidence: confidence,
      skillLikelihood: likelihood, formQuality,
      metrics: { armLockout: Math.round(armLock), bodyLineDev: Math.round(line.deviation), stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}

/** 4. Planche Evaluators */
export class PlancheEvaluator extends BaseHoldEvaluator {
  constructor(variant = 'planche') { super(variant); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, wrist, hip, knee, ankle } = sideData;
    const armLock = angle(wrist, elbow, shoulder);
    const line = bodyLine(shoulder, hip, ankle);
    const stability = this.computeStability(hip);

    const isHorizontal = Math.abs(shoulder.y - hip.y) < 0.12;

    const faults = [];
    if (armLock < 165) faults.push('bent_arms');
    if (hip.y > shoulder.y + 0.08) faults.push('sagging_hips');
    if (hip.y < shoulder.y - 0.08) faults.push('piking_hips');

    const likelihood = isHorizontal ? 0.85 : 0.2;
    const formQuality = Math.max(0, Math.min(1, (armLock / 180) * 0.4 + (1 - line.deviation / 30) * 0.4 + stability * 0.2));

    return {
      skill: this.skillName, type: 'hold', poseConfidence: confidence,
      skillLikelihood: likelihood, formQuality,
      metrics: { armLockout: Math.round(armLock), bodyLineDev: Math.round(line.deviation), stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}

export class StraddlePlancheEvaluator extends PlancheEvaluator {
  constructor() { super('straddleplanche'); }
}

export class PlancheLeanEvaluator extends PlancheEvaluator {
  constructor() { super('planchelean'); }
}

/** 5. Front Lever Evaluator */
export class FrontLeverEvaluator extends BaseHoldEvaluator {
  constructor() { super('frontlever'); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, wrist, hip, knee, ankle } = sideData;
    const armLock = angle(wrist, elbow, shoulder);
    const line = bodyLine(shoulder, hip, ankle);
    const stability = this.computeStability(hip);

    const isHorizontal = Math.abs(shoulder.y - hip.y) < 0.10;

    const faults = [];
    if (armLock < 165) faults.push('bent_arms');
    if (hip.y > shoulder.y + 0.06) faults.push('hip_drop');

    const likelihood = isHorizontal ? 0.9 : 0.2;
    const formQuality = Math.max(0, Math.min(1, (1 - line.deviation / 25) * 0.7 + stability * 0.3));

    return {
      skill: 'frontlever', type: 'hold', poseConfidence: confidence,
      skillLikelihood: likelihood, formQuality,
      metrics: { armLockout: Math.round(armLock), bodyLineDev: Math.round(line.deviation), stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}

/** 6. Back Lever Evaluator */
export class BackLeverEvaluator extends BaseHoldEvaluator {
  constructor() { super('backlever'); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, wrist, hip, knee, ankle } = sideData;
    const armLock = angle(wrist, elbow, shoulder);
    const line = bodyLine(shoulder, hip, ankle);
    const stability = this.computeStability(hip);

    const faults = [];
    if (armLock < 160) faults.push('bent_arms');
    if (line.deviation > 20) faults.push('arch_or_pike');

    const likelihood = Math.abs(shoulder.y - hip.y) < 0.12 ? 0.85 : 0.2;
    const formQuality = Math.max(0, Math.min(1, (1 - line.deviation / 30) * 0.7 + stability * 0.3));

    return {
      skill: 'backlever', type: 'hold', poseConfidence: confidence,
      skillLikelihood: likelihood, formQuality,
      metrics: { armLockout: Math.round(armLock), bodyLineDev: Math.round(line.deviation), stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}

/** 7. Crow Pose / Frog Stand Evaluators */
export class CrowPoseEvaluator extends BaseHoldEvaluator {
  constructor(variant = 'crowpose') { super(variant); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, wrist, hip, knee } = sideData;
    const isKneeNearElbow = Math.hypot(knee.x - elbow.x, knee.y - elbow.y) < 0.15;
    const isSupported = wrist.y > shoulder.y + 0.1;
    const stability = this.computeStability(hip);

    const faults = [];
    if (!isKneeNearElbow) faults.push('knees_off_arms');

    const likelihood = isSupported && isKneeNearElbow ? 0.9 : 0.3;
    const formQuality = Math.max(0, Math.min(1, (isKneeNearElbow ? 0.6 : 0.2) + stability * 0.4));

    return {
      skill: this.skillName, type: 'hold', poseConfidence: confidence,
      skillLikelihood: likelihood, formQuality,
      metrics: { kneeArmContact: isKneeNearElbow ? 1.0 : 0.0, stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}

export class FrogStandEvaluator extends CrowPoseEvaluator {
  constructor() { super('frogstand'); }
}

/** 8. Elbow Lever Evaluator */
export class ElbowLeverEvaluator extends BaseHoldEvaluator {
  constructor() { super('elbowlever'); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, hip, ankle } = sideData;
    const line = bodyLine(shoulder, hip, ankle);
    const isElbowSupporting = Math.hypot(elbow.x - hip.x, elbow.y - hip.y) < 0.18;
    const stability = this.computeStability(hip);

    const faults = [];
    if (!isElbowSupporting) faults.push('elbows_flared');

    const likelihood = isElbowSupporting ? 0.85 : 0.2;
    const formQuality = Math.max(0, Math.min(1, (1 - line.deviation / 30) * 0.6 + stability * 0.4));

    return {
      skill: 'elbowlever', type: 'hold', poseConfidence: confidence,
      skillLikelihood: likelihood, formQuality,
      metrics: { bodyLineDev: Math.round(line.deviation), stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}

/** 9. 90-Degree Hold Evaluator */
export class NinetyDegreeHoldEvaluator extends BaseHoldEvaluator {
  constructor() { super('90degreehold'); }

  evaluate(landmarks) {
    const sideData = this.getVisibleSideJoints(landmarks);
    if (!sideData || sideData.confidence < 0.45) return this.buildTrackingLossResult(sideData ? sideData.confidence : 0);

    const { confidence, shoulder, elbow, wrist, hip, ankle } = sideData;
    const elbowAngle = angle(shoulder, elbow, wrist);
    const line = bodyLine(shoulder, hip, ankle);
    const stability = this.computeStability(hip);

    const faults = [];
    if (Math.abs(elbowAngle - 90) > 15) faults.push('improper_elbow_bend');

    const likelihood = Math.abs(elbowAngle - 90) < 25 ? 0.85 : 0.2;
    const formQuality = Math.max(0, Math.min(1, (1 - Math.abs(elbowAngle - 90)/30) * 0.6 + stability * 0.4));

    return {
      skill: '90degreehold', type: 'hold', poseConfidence: confidence,
      skillLikelihood: likelihood, formQuality,
      metrics: { elbowAngle: Math.round(elbowAngle), bodyLineDev: Math.round(line.deviation), stability: Math.round(stability * 100) / 100 },
      faults
    };
  }
}