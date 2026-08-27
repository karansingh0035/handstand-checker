// engine/rules.js

/**
 * Priority Tiers: SAFETY > ROM > TEMPO > EFFICIENCY
 */
export const PRIORITY = {
  SAFETY: 1,
  ROM: 2,
  TEMPO: 3,
  EFFICIENCY: 4
};

/**
 * Calisthenics Movement Rule Specifications
 */
export const MOVEMENT_RULES = {
  pushup: [
    {
      id: 'hip_sag',
      priority: PRIORITY.SAFETY,
      cue: "Squeeze your glutes — one straight line.",
      check: (metrics) => metrics.bodyLineDeviation > 12 && metrics.isSag
    },
    {
      id: 'hip_pike',
      priority: PRIORITY.EFFICIENCY,
      cue: "Drop your hips into line.",
      check: (metrics) => metrics.bodyLineDeviation > 12 && metrics.isPike
    },
    {
      id: 'shallow_depth',
      priority: PRIORITY.ROM,
      cue: "Go deeper — chest toward the floor.",
      check: (metrics) => metrics.minElbowAngle > 100
    },
    {
      id: 'no_lockout',
      priority: PRIORITY.ROM,
      cue: "Finish tall — straighten your arms.",
      check: (metrics) => metrics.maxElbowAngle < 160
    },
    {
      id: 'rushing',
      priority: PRIORITY.TEMPO,
      cue: "Slow the way down — three seconds.",
      check: (metrics) => metrics.eccS < 0.7
    }
  ],

  squat: [
    {
      id: 'shallow_squat',
      priority: PRIORITY.ROM,
      cue: "Sit deeper — hips below knees.",
      check: (metrics) => metrics.hipY <= metrics.kneeY
    },
    {
      id: 'torso_collapse',
      priority: PRIORITY.EFFICIENCY,
      cue: "Chest up.",
      check: (metrics) => metrics.torsoVertical > 50
    },
    {
      id: 'no_lockout_squat',
      priority: PRIORITY.ROM,
      cue: "Stand all the way up.",
      check: (metrics) => metrics.maxHipAngle < 165
    },
    {
      id: 'bouncing_squat',
      priority: PRIORITY.TEMPO,
      cue: "Control the bottom — no bounce.",
      check: (metrics) => metrics.pauseS < 0.1 && metrics.eccS < 0.8
    }
  ],

  pullup: [
    {
      id: 'no_full_hang',
      priority: PRIORITY.ROM,
      cue: "All the way down — full stretch.",
      check: (metrics) => metrics.maxElbowAngle < 160
    },
    {
      id: 'short_pull',
      priority: PRIORITY.ROM,
      cue: "Chin over the bar.",
      check: (metrics) => metrics.noseY >= metrics.wristY
    },
    {
      id: 'dropping_pullup',
      priority: PRIORITY.TEMPO,
      cue: "Lower under control.",
      check: (metrics) => metrics.eccS < 1.0
    }
  ]
};

/**
 * Evaluates a set of computed rep metrics against a movement's rule set.
 * Returns all violated rules sorted by priority (SAFETY first).
 */
export function evaluateRules(movementKey, metrics) {
  const rules = MOVEMENT_RULES[movementKey] || [];
  const violations = [];

  for (const rule of rules) {
    if (rule.check(metrics)) {
      violations.push({
        id: rule.id,
        priority: rule.priority,
        cue: rule.cue
      });
    }
  }

  // Sort by priority rank ascending (1 = SAFETY, 2 = ROM, etc.)
  return violations.sort((a, b) => a.priority - b.priority);
}