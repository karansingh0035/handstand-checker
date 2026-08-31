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

  // 🆕 Handstand Push-up: same cyclic elbow-bend pattern as pushup.
  // bodyLine()/angle() math is orientation-agnostic, so the straight-body
  // (sag/pike), depth, and lockout checks transfer directly — only the
  // cues and tempo threshold are HSPU-specific (controlled descent against
  // a wall is a slower, more deliberate movement than a floor pushup).
  handstandpushup: [
    {
      id: 'hspu_hip_sag',
      priority: PRIORITY.SAFETY,
      cue: "Brace your core — stay stacked over your hands.",
      check: (metrics) => metrics.bodyLineDeviation > 12 && metrics.isSag
    },
    {
      id: 'hspu_hip_pike',
      priority: PRIORITY.EFFICIENCY,
      cue: "Straighten out — you're piking at the hips.",
      check: (metrics) => metrics.bodyLineDeviation > 12 && metrics.isPike
    },
    {
      id: 'hspu_shallow_depth',
      priority: PRIORITY.ROM,
      cue: "Lower until your head nears the floor.",
      check: (metrics) => metrics.minElbowAngle > 100
    },
    {
      id: 'hspu_no_lockout',
      priority: PRIORITY.ROM,
      cue: "Press all the way out — full lockout.",
      check: (metrics) => metrics.maxElbowAngle < 160
    },
    {
      id: 'hspu_rushing',
      priority: PRIORITY.TEMPO,
      cue: "Control the descent — don't drop into it.",
      check: (metrics) => metrics.eccS < 0.8
    }
  ],

  // 🆕 90° Handstand Push-up: same base checks as handstandpushup, plus a
  // rule specific to this variant — the torso must be near-horizontal (~90°
  // from vertical) AT THE BOTTOM of the rep, not just anywhere during it.
  // Uses bottomTorsoVertical (captured at the exact deepest frame in
  // segmentation.js), not torsoVertical (a running max across the whole rep) —
  // those measure different things and aren't interchangeable here.
  ninetydegreehspu: [
    {
      id: 'ninety_hip_sag',
      priority: PRIORITY.SAFETY,
      cue: "Brace your core — stay stacked over your hands.",
      check: (metrics) => metrics.bodyLineDeviation > 12 && metrics.isSag
    },
    {
      id: 'ninety_hip_pike',
      priority: PRIORITY.EFFICIENCY,
      cue: "Straighten out — you're piking at the hips.",
      check: (metrics) => metrics.bodyLineDeviation > 12 && metrics.isPike
    },
    {
      id: 'ninety_bad_angle',
      priority: PRIORITY.ROM,
      cue: "Get your torso parallel to the floor at the bottom.",
      check: (metrics) => Math.abs(metrics.bottomTorsoVertical - 90) > 20
    },
    {
      id: 'ninety_no_lockout',
      priority: PRIORITY.ROM,
      cue: "Press all the way out — full lockout.",
      check: (metrics) => metrics.maxElbowAngle < 160
    },
    {
      id: 'ninety_rushing',
      priority: PRIORITY.TEMPO,
      cue: "Control the descent — don't drop into it.",
      check: (metrics) => metrics.eccS < 0.8
    }
  ],

  // 🆕 Planche Push-up: same straight-body/lockout/tempo checks as pushup,
  // plus a rule specific to planche work — shoulders must protract forward
  // past the wrists (shoulderLean > threshold) at some point in the rep.
  // Uses the running MAX of shoulderLean across the rep (best lean achieved),
  // not a bottom-position snapshot like 90° HSPU's angle check — planche
  // lean is judged by whether sufficient protraction was reached at all,
  // not sustained for the whole rep.
  planchepushup: [
    {
      id: 'planche_hip_sag',
      priority: PRIORITY.SAFETY,
      cue: "Squeeze your glutes — one straight line.",
      check: (metrics) => metrics.bodyLineDeviation > 12 && metrics.isSag
    },
    {
      id: 'planche_hip_pike',
      priority: PRIORITY.EFFICIENCY,
      cue: "Drop your hips into line.",
      check: (metrics) => metrics.bodyLineDeviation > 12 && metrics.isPike
    },
    {
      id: 'planche_insufficient_lean',
      priority: PRIORITY.ROM,
      cue: "Lean further forward — shoulders past your hands.",
      check: (metrics) => metrics.shoulderLean < 0.15
    },
    {
      id: 'planche_no_lockout',
      priority: PRIORITY.ROM,
      cue: "Finish tall — straighten your arms.",
      check: (metrics) => metrics.maxElbowAngle < 160
    },
    {
      id: 'planche_rushing',
      priority: PRIORITY.TEMPO,
      cue: "Slow the way down — control the lean.",
      check: (metrics) => metrics.eccS < 0.7
    }
  ],

  // 🆕 Pike Push-up: reuses the elbow-cycle rep shape, but the alignment
  // check is inverted from every other push-family movement. Pushup/HSPU/
  // planche pushup want a STRAIGHT body line and flag deviation in EITHER
  // direction. Pike push-up starts deliberately hinged/piked — the fault
  // here is the hips OPENING UP toward flat, a one-directional check using
  // the raw hipLineAngle (not bodyLineDeviation, which can't tell direction).
  // Thresholds match pikepushup.js's scoreFn exactly, so the live in-set
  // cues and the post-video score agree on what "lost the pike" means.
  pikepushup: [
    {
      id: 'pike_shallow_depth',
      priority: PRIORITY.ROM,
      cue: "Lower your head toward the floor.",
      check: (metrics) => metrics.minElbowAngle > 95
    },
    {
      id: 'pike_no_lockout',
      priority: PRIORITY.ROM,
      cue: "Push all the way back to lockout.",
      check: (metrics) => metrics.maxElbowAngle < 155
    },
    {
      id: 'pike_opening',
      priority: PRIORITY.EFFICIENCY,
      cue: "Keep your hips high — don't flatten out.",
      check: (metrics) => metrics.hipLineAngle > 115
    }
  ],

  // 🆕 Muscle-up: pull + transition + dip, treated as ONE combined rep.
  // Segmented on verticalProgress (shoulder height relative to wrist), not
  // elbow angle — see primitives.js's verticalProgress() and index.js's
  // primarySignal override for why elbow angle alone isn't reliable here.
  //
  // no_full_hang mirrors pullup's identical check/threshold (maxElbowAngle
  // as a proxy for "did full extension happen somewhere in the rep").
  // no_dip_lockout is new — it uses bottomElbowAngle, captured at the exact
  // frame of deepest support (segmentation.js's "bottom" trigger, which for
  // this negated signal corresponds to the real-world TOP of the movement),
  // not a rep-wide running max/min, since that moment specifically is what
  // needs checking, not "extension anywhere in the rep."
  //
  // Deliberately excludes kip/leg-drive detection (distinguishing a strict
  // vs. kipping muscle-up) — that needs leg/hip swing tracking, a separate,
  // harder problem intentionally out of scope for v1.
  muscleup: [
    {
      id: 'muscleup_no_full_hang',
      priority: PRIORITY.ROM,
      cue: "Start from a full hang — arms straight.",
      check: (metrics) => metrics.maxElbowAngle < 160
    },
    {
      id: 'muscleup_incomplete_transition',
      priority: PRIORITY.ROM,
      cue: "Pull higher — get your shoulders over the bar.",
      check: (metrics) => metrics.verticalProgress < 0.3
    },
    {
      id: 'muscleup_no_dip_lockout',
      priority: PRIORITY.ROM,
      cue: "Finish the dip — press all the way out.",
      check: (metrics) => metrics.bottomElbowAngle < 160
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
      check: (metrics) => metrics.conS < 1.0
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