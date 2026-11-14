// src/utils/skillRegistry.js
import { SKILLS, getSupportedLiveSkills, resolveLiveSkill } from '../engine/index.js';

export { SKILLS, getSupportedLiveSkills, resolveLiveSkill };

export const LIVE_ENGINE_SKILL_MAP = {
  pushup: 'pushup',
  squat: 'squat',
  pullup: 'pullup',
  pullups: 'pullup',
  handstandpushup: 'handstandpushup',
  hspu: 'handstandpushup',
  '90degreehspu': 'ninetydegreehspu',
  planchepushup: 'planchepushup',
  pseudoplanchepushup: 'pseudoplanchepushup',
  pikepushup: 'pikepushup',
  muscleup: 'muscleup',
  lsit: 'lsit',
  handstand: 'handstand',
  vsit: 'vsit',
  elbowlever: 'elbowlever',
  planche: 'planche',
  frontlever: 'frontlever',
  backlever: 'backlever',
  '90degreehold': 'ninetydegreehold',
  crowpose: 'crowpose',
  frogstand: 'frogstand',
  straddleplanche: 'straddleplanche',
  planchelean: 'planchelean'
};

/**
 * Returns dynamic analyzers referencing global functions loaded from /skills/*.js
 */
export function getSkillAnalyzers() {
  const w = typeof window !== 'undefined' ? window : {};
  return {
    handstand: { validateFn: w.validateHandstandVideo, scoreFn: w.scoreHandstand, label: 'Handstand' },
    pushup: { validateFn: w.validatePushupVideo, scoreFn: w.scorePushup, label: 'Push-up' },
    lsit: { validateFn: w.validateLsitVideo, scoreFn: w.scoreLsit, label: 'L-sit' },
    handstandpushup: { validateFn: w.validateHandstandPushupVideo, scoreFn: w.scoreHandstandPushup, label: 'Handstand Push-up' },
    hspu: { validateFn: w.validateHandstandPushupVideo, scoreFn: w.scoreHandstandPushup, label: 'Handstand Push-ups' },
    elbowlever: { validateFn: w.validateElbowLeverVideo, scoreFn: w.scoreElbowLever, label: 'Elbow Lever' },
    planche: { validateFn: w.validatePlancheVideo, scoreFn: w.scorePlanche, label: 'Planche' },
    frontlever: { validateFn: w.validateFrontLeverVideo, scoreFn: w.scoreFrontLever, label: 'Front Lever' },
    pullup: { validateFn: w.validatePullupVideo, scoreFn: w.scorePullup, label: 'Pull-up' },
    pullups: { validateFn: w.validatePullupVideo, scoreFn: w.scorePullup, label: 'Pull-ups' },
    muscleup: { validateFn: w.validateMuscleUpVideo, scoreFn: w.scoreMuscleUp, label: 'Muscle-up' },
    muscleups: { validateFn: w.validateMuscleUpVideo, scoreFn: w.scoreMuscleUp, label: 'Muscle-ups' },
    backlever: { validateFn: w.validateBackLeverVideo, scoreFn: w.scoreBackLever, label: 'Back Lever' },
    vsit: { validateFn: w.validateVSitVideo, scoreFn: w.scoreVSit, label: 'V-sit' },
    pikepushup: { validateFn: w.validatePikePushupVideo, scoreFn: w.scorePikePushup, label: 'Pike Push-up' },
    '90degreehold': { validateFn: w.validate90DegreeHoldVideo, scoreFn: w.score90DegreeHold, label: '90-Degree Hold' },
    crowpose: { validateFn: w.validateCrowPoseVideo, scoreFn: w.scoreCrowPose, label: 'Crow Pose' },
    frogstand: { validateFn: w.validateFrogStandVideo, scoreFn: w.scoreFrogStand, label: 'Frog Stand' },
    straddleplanche: { validateFn: w.validateStraddlePlancheVideo, scoreFn: w.scoreStraddlePlanche, label: 'Straddle Planche' },
    planchelean: { validateFn: w.validatePlancheLeanVideo, scoreFn: w.scorePlancheLean, label: 'Planche Lean' },
    '90degreehspu': { validateFn: w.validateHandstandPushupVideo, scoreFn: w.score90DegreeHSPU, label: '90-Degree HSPU' },
    pseudoplanchepushup: { validateFn: w.validatePseudoPlanchePushupVideo, scoreFn: w.scorePseudoPlanchePushup, label: 'Pseudo Planche Push-up' },
    pikepushups: { validateFn: w.validatePikePushupVideo, scoreFn: w.scorePikePushup, label: 'Pike Push-ups' },
    planchepushup: { validateFn: w.validatePlanchePushupVideo, scoreFn: w.scorePlanchePushup, label: 'Planche Push-up' },
    squat: { validateFn: w.validateSquatVideo, scoreFn: w.scoreSquat, label: 'Squat' },
    squats: { validateFn: w.validateSquatVideo, scoreFn: w.scoreSquat, label: 'Squats' }
  };
}

export function resolveSkill(rawInput) {
  if (!rawInput) return null;

  let key = rawInput
    .trim()
    .toLowerCase()
    .replace(/[\s-_]/g, '')
    .replace(/°/g, 'degree')
    .replace(/deg$/g, 'degree')
    .replace(/pushups$/g, 'pushup')
    .replace(/pullups$/g, 'pullup');

  const aliasMap = {
    hspus: 'hspu',
    handstandpushups: 'handstandpushup',
    '90deghspu': '90degreehspu',
    '90deghspus': '90degreehspu',
    '90degreehspus': '90degreehspu',
    pppu: 'pseudoplanchepushup',
    pppus: 'pseudoplanchepushup',
    pseudoplanchepushups: 'pseudoplanchepushup',
    pseudopushup: 'pseudoplanchepushup',
    pseudopushups: 'pseudoplanchepushup',
    plancheleans: 'planchelean',
    straddleplanches: 'straddleplanche',
    frogstands: 'frogstand',
    crowposes: 'crowpose'
  };

  if (aliasMap[key]) {
    key = aliasMap[key];
  }

  const analyzers = getSkillAnalyzers();

  if (!analyzers[key] && key.endsWith('s') && key.length > 3) {
    const singularKey = key.slice(0, -1);
    if (analyzers[singularKey]) {
      key = singularKey;
    }
  }

  const match = analyzers[key];
  return match ? { ...match, key } : null;
}
