// engine/session-manager.js

/**
 * Supported Live Skills Registry
 * Contains all evaluators that are supported for live webcam analysis.
 * FIX Bug #2: Expanded to 21 skills matching SKILL_ANALYZERS in app.js
 */
export const SKILLS = {
  // Rep-based movements (9)
  pushup: {
    key: "pushup",
    label: "Push-up",
    type: "rep",
  },
  squat: {
    key: "squat",
    label: "Squat",
    type: "rep",
  },
  pullup: {
    key: "pullup",
    label: "Pull-up",
    type: "rep",
  },
  muscleup: {
    key: "muscleup",
    label: "Muscle-up",
    type: "rep",
  },
  pikepushup: {
    key: "pikepushup",
    label: "Pike Push-up",
    type: "rep",
  },
  planchepushup: {
    key: "planchepushup",
    label: "Planche Push-up",
    type: "rep",
  },
  pseudoplanchepushup: {
    key: "pseudoplanchepushup",
    label: "Pseudo Planche Push-up",
    type: "rep",
  },
  ninetydegreehspu: {
    key: "ninetydegreehspu",
    label: "90-Degree HSPU",
    type: "rep",
  },
  handstandpushup: {
    key: "handstandpushup",
    label: "Handstand Push-up",
    type: "rep",
  },
  // Hold-based movements (12)
  handstand: {
    key: "handstand",
    label: "Handstand",
    type: "hold",
  },
  lsit: {
    key: "lsit",
    label: "L-sit",
    type: "hold",
  },
  vsit: {
    key: "vsit",
    label: "V-sit",
    type: "hold",
  },
  planche: {
    key: "planche",
    label: "Planche",
    type: "hold",
  },
  straddleplanche: {
    key: "straddleplanche",
    label: "Straddle Planche",
    type: "hold",
  },
  planchelean: {
    key: "planchelean",
    label: "Planche Lean",
    type: "hold",
  },
  frontlever: {
    key: "frontlever",
    label: "Front Lever",
    type: "hold",
  },
  backlever: {
    key: "backlever",
    label: "Back Lever",
    type: "hold",
  },
  crowpose: {
    key: "crowpose",
    label: "Crow Pose",
    type: "hold",
  },
  frogstand: {
    key: "frogstand",
    label: "Frog Stand",
    type: "hold",
  },
  elbowlever: {
    key: "elbowlever",
    label: "Elbow Lever",
    type: "hold",
  },
  ninetydegreehold: {
    key: "ninetydegreehold",
    label: "90-Degree Hold",
    type: "hold",
  }
};

/**
 * Returns list of supported live skill configs for UI dropdowns/modals
 */
export function getSupportedLiveSkills() {
  return Object.values(SKILLS);
}

/**
 * Resolves alias string or key to a canonical live skill key, or null if unsupported
 */
export function resolveLiveSkill(input) {
  if (!input) return null;
  const cleaned = input.trim().toLowerCase().replace(/[\s-_]/g, '').replace(/°/g, 'degree');
  const aliasMap = {
    pushup: 'pushup',
    pushups: 'pushup',
    squat: 'squat',
    squats: 'squat',
    pullup: 'pullup',
    pullups: 'pullup',
    muscleup: 'muscleup',
    muscleups: 'muscleup',
    pikepushup: 'pikepushup',
    pikepushups: 'pikepushup',
    pike: 'pikepushup',
    planchepushup: 'planchepushup',
    planchepushups: 'planchepushup',
    pseudoplanchepushup: 'pseudoplanchepushup',
    pseudoplanchepushups: 'pseudoplanchepushup',
    pppu: 'pseudoplanchepushup',
    pppus: 'pseudoplanchepushup',
    pseudopushup: 'pseudoplanchepushup',
    pseudopushups: 'pseudoplanchepushup',
    ninetydegreehspu: 'ninetydegreehspu',
    ninetydegreehspus: 'ninetydegreehspu',
    '90degreehspu': 'ninetydegreehspu',
    '90deghspu': 'ninetydegreehspu',
    '90deghspus': 'ninetydegreehspu',
    handstandpushup: 'handstandpushup',
    handstandpushups: 'handstandpushup',
    hspu: 'handstandpushup',
    hspus: 'handstandpushup',
    handstand: 'handstand',
    handstands: 'handstand',
    lsit: 'lsit',
    lsits: 'lsit',
    vsit: 'vsit',
    vsits: 'vsit',
    planche: 'planche',
    planches: 'planche',
    straddleplanche: 'straddleplanche',
    straddleplanches: 'straddleplanche',
    planchelean: 'planchelean',
    plancheleans: 'planchelean',
    frontlever: 'frontlever',
    frontlevers: 'frontlever',
    backlever: 'backlever',
    backlevers: 'backlever',
    crowpose: 'crowpose',
    crowposes: 'crowpose',
    crow: 'crowpose',
    frogstand: 'frogstand',
    frogstands: 'frogstand',
    frog: 'frogstand',
    elbowlever: 'elbowlever',
    elbowlevers: 'elbowlever',
    ninetydegreehold: 'ninetydegreehold',
    '90degreehold': 'ninetydegreehold',
    ninety: 'ninetydegreehold',
    '90deg': 'ninetydegreehold'
  };
  const key = aliasMap[cleaned] || cleaned;
  return SKILLS[key] ? key : null;
}

export function isSupportedLiveSkill(input) {
  return resolveLiveSkill(input) !== null;
}

/**
 * Session Event Logger
 * Records chronological session events without resetting across skill switches.
 */
export class SessionEventLog {
  constructor() {
    this.events = [];
  }

  record(event) {
    const entry = {
      ...event,
      timestampMs: event.timestampMs !== undefined ? event.timestampMs : Date.now()
    };
    this.events.push(entry);
    return entry;
  }

  getEvents() {
    return [...this.events];
  }

  clear() {
    this.events = [];
  }
}

/**
 * Segment Manager
 * Opens, closes, and archives individual skill segments during an active live session.
 */
export class SegmentManager {
  constructor(sessionId = `session_${Date.now()}`) {
    this.sessionId = sessionId;
    this.segments = [];
    this.currentSegment = null;
    this.segmentCounter = 0;
  }

  openSegment({ skill, timestampMs = performance.now(), reason = "session_start" }) {
    if (this.currentSegment && this.currentSegment.status === "active") {
      this.closeCurrentSegment({ timestampMs, reason: "auto_close_before_open" });
    }

    const skillConfig = SKILLS[skill] || { key: skill, label: skill, type: "rep" };
    this.segmentCounter++;
    const segmentId = `segment_${String(this.segmentCounter).padStart(3, '0')}`;

    this.currentSegment = {
      id: segmentId,
      sessionId: this.sessionId,
      skill: skillConfig.key,
      label: skillConfig.label,
      type: skillConfig.type,
      startedAt: timestampMs,
      endedAt: null,
      durationMs: 0,
      reasonEnded: null,
      reps: 0,
      bestHoldMs: 0,
      averageFormQuality: 0,
      averageConfidence: 0,
      faultCounts: new Map(),
      faults: [],
      cuesDelivered: 0,
      status: "active",
      _confidenceSum: 0,
      _confidenceFrames: 0,
      _qualitySum: 0,
      _qualityFrames: 0,
      _uncertainFrames: 0,
      _lastRepCount: 0,
    };

    return this.currentSegment;
  }

  updateCurrentSegment(frameResult, timestampMs = performance.now()) {
    if (!this.currentSegment || this.currentSegment.status !== "active") return null;

    const seg = this.currentSegment;
    seg.durationMs = Math.max(0, timestampMs - seg.startedAt);

    if (frameResult) {
      if (typeof frameResult.repCount === 'number') {
        seg.reps = frameResult.repCount;
      } else if (typeof frameResult.reps === 'number') {
        seg.reps = frameResult.reps;
      }

      if (typeof frameResult.bestHoldMs === 'number') {
        seg.bestHoldMs = Math.max(seg.bestHoldMs, frameResult.bestHoldMs);
      } else if (typeof frameResult.holdTimeMs === 'number') {
        seg.bestHoldMs = Math.max(seg.bestHoldMs, frameResult.holdTimeMs);
      }

      if (typeof frameResult.poseConfidence === 'number' && !isNaN(frameResult.poseConfidence)) {
        seg._confidenceSum += frameResult.poseConfidence;
        seg._confidenceFrames++;
        seg.averageConfidence = Math.round((seg._confidenceSum / seg._confidenceFrames) * 100) / 100;
      }

      if (typeof frameResult.formQuality === 'number' && !isNaN(frameResult.formQuality)) {
        seg._qualitySum += frameResult.formQuality;
        seg._qualityFrames++;
        seg.averageFormQuality = Math.round((seg._qualitySum / seg._qualityFrames) * 100) / 100;
      }

      if (frameResult.status === "uncertain") {
        seg._uncertainFrames++;
      }

      const faults = frameResult.faults || (frameResult.holdResult && frameResult.holdResult.faults) || [];
      if (Array.isArray(faults)) {
        for (const fault of faults) {
          const key = typeof fault === 'string' ? fault : (fault.key || fault.id || 'unknown_fault');
          const current = seg.faultCounts.get(key) || 0;
          seg.faultCounts.set(key, current + 1);
        }
      }

      if (frameResult.activeCue) {
        seg.cuesDelivered++;
      }
    }

    return seg;
  }

  recordUncertainFrame(timestampMs, quality) {
    if (!this.currentSegment || this.currentSegment.status !== "active") return;
    this.currentSegment._uncertainFrames++;
    if (quality && typeof quality.confidence === 'number') {
      this.currentSegment._confidenceSum += quality.confidence;
      this.currentSegment._confidenceFrames++;
      this.currentSegment.averageConfidence =
        Math.round((this.currentSegment._confidenceSum / this.currentSegment._confidenceFrames) * 100) / 100;
    }
  }

  recordCueDelivered() {
    if (!this.currentSegment || this.currentSegment.status !== "active") return;
    this.currentSegment.cuesDelivered++;
  }

  closeCurrentSegment({ timestampMs = performance.now(), reason = "user_switch" }) {
    if (!this.currentSegment || this.currentSegment.status !== "active") {
      return null;
    }

    const seg = this.currentSegment;
    seg.endedAt = timestampMs;
    seg.durationMs = Math.max(0, timestampMs - seg.startedAt);
    seg.reasonEnded = reason;
    seg.status = "completed";

    seg.faults = Array.from(seg.faultCounts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

    seg.validation = validateSegmentPerformance(seg);

    this.segments.push(seg);
    this.currentSegment = null;
    return seg;
  }

  getCurrentSegment() {
    return this.currentSegment;
  }

  getAllSegments() {
    const list = [...this.segments];
    if (this.currentSegment) {
      list.push(this.currentSegment);
    }
    return list;
  }

  getCompletedSegments() {
    return [...this.segments];
  }
}

const FOCUS_TIPS = {
  pushup: {
    hip_sag: "Maintain glute and core tension to keep a flat plank line during push-ups.",
    hips_sagging: "Maintain glute and core tension to keep a flat plank line during push-ups.",
    hip_pike: "Lower your hips in line with your shoulders and heels during push-ups.",
    hips_piking: "Lower your hips in line with your shoulders and heels during push-ups.",
    shallow_depth: "Work on full depth — lower chest until elbows bend to 90 degrees.",
    incomplete_lockout: "Press all the way to straight arms at the top of each rep.",
    rushing: "Slow the descent to build eccentric control and chest strength."
  },
  squat: {
    shallow_squat: "Descend until your hips are below knee level for full depth.",
    torso_collapse: "Keep your chest lifted throughout the descent.",
    no_lockout_squat: "Stand up completely to full hip and knee lockout.",
    bouncing_squat: "Control the turnaround at the bottom without bouncing."
  },
  pullup: {
    no_full_hang: "Start and finish every rep from a full dead hang stretch.",
    short_pull: "Pull higher until your chin clearly clears the bar.",
    dropping_pullup: "Lower under control through the negative portion."
  },
  muscleup: {
    muscleup_no_full_hang: "Initiate each rep from a full hang with elbows straight.",
    muscleup_incomplete_transition: "Pull explosively to transition shoulders over the bar.",
    muscleup_no_dip_lockout: "Press out the dip portion until arms are fully locked."
  },
  pikepushup: {
    pike_shallow_depth: "Lower your head forward until forehead nears the floor.",
    pike_no_lockout: "Push all the way back through shoulders to full extension.",
    pike_opening: "Keep your hips elevated and avoid letting hips open into a flat plank."
  },
  planchepushup: {
    planche_hip_sag: "Engage your core to prevent hips sagging below shoulder height.",
    planche_hip_pike: "Keep hips down level with your torso.",
    planche_insufficient_lean: "Maintain strong forward shoulder lean past your wrists.",
    planche_no_lockout: "Push all the way up into protracted shoulder lockout.",
    planche_rushing: "Control the lowering phase to maintain your forward lean."
  },
  pseudoplanchepushup: {
    pppu_hip_sag: "Maintain glute tension to prevent hips sagging during PPPU.",
    pppu_hip_pike: "Keep hips aligned with shoulders, avoid piking upward.",
    pppu_insufficient_lean: "Lean shoulders well past your wrists throughout each rep.",
    pppu_no_lockout: "Press all the way up into protracted straight arms.",
    pppu_rushing: "Slow the tempo down to build tendon strength in the lean."
  },
  ninetydegreehspu: {
    ninety_hip_sag: "Brace your core to keep a solid straight body line.",
    ninety_hip_pike: "Avoid breaking at the hips during the descent.",
    ninety_bad_angle: "Lower until your torso is parallel to the ground at 90 degrees.",
    ninety_no_lockout: "Push all the way back up into handstand lockout.",
    ninety_rushing: "Control the eccentric lowering phase."
  },
  handstandpushup: {
    hspu_hip_sag: "Maintain rigid core tension to avoid excessive back arch.",
    hspu_hip_pike: "Keep your body line vertical, avoiding piking at the hips.",
    hspu_shallow_depth: "Lower until head lightly touches or approaches the floor.",
    hspu_no_lockout: "Push all the way through your shoulders into full elbow lockout.",
    hspu_rushing: "Control the descent to protect neck and shoulders."
  },
  handstand: {
    hip_arch: "Squeeze glutes and draw ribs in to avoid arching into a banana handstand.",
    hip_pike: "Open your hips fully into a vertical stack over your hands.",
    shoulder_misalignment: "Push tall through your shoulders and stack them directly over wrists.",
    bent_arms: "Lock out elbows completely before balancing.",
    bent_legs: "Keep legs straight and toes pointed together."
  },
  lsit: {
    knee_bend: "Point your toes and lock your knees to maintain full leg extension.",
    hips_dropping: "Press through your palms and lift your hips off the floor.",
    torso_lean: "Keep your chest tall and avoid leaning back excessively.",
    bent_arms: "Lock out your elbows completely."
  },
  vsit: {
    knee_bend: "Lock your knees completely with pointed toes.",
    bent_arms: "Press hard through palms to maintain straight arms.",
    insufficient_compression: "Pull legs closer toward your chest for tight compression."
  },
  planche: {
    bent_arms: "Protracted scapulae with completely locked elbows.",
    hip_sag: "Lift your hips level with your shoulders.",
    sagging_hips: "Engage glutes to hold your hips horizontal.",
    piking_hips: "Lower hips down into a flat horizontal line.",
    insufficient_lean: "Shift weight further forward past your wrists."
  },
  straddleplanche: {
    bent_arms: "Lock your elbows straight.",
    hip_sag: "Keep hips level in a clean horizontal line.",
    insufficient_lean: "Shift weight forward into the lean."
  },
  planchelean: {
    bent_arms: "Push hard through your palms with locked elbows.",
    insufficient_lean: "Lean shoulders further past your wrists."
  },
  frontlever: {
    hip_sag: "Squeeze glutes and core to keep your body horizontal.",
    bent_arms: "Pull down on the bar with straight locked arms."
  },
  backlever: {
    hip_sag: "Engage your posterior chain to hold a straight body line.",
    bent_arms: "Lock out your elbows completely."
  },
  crowpose: {
    collapsed: "Engage your core to lift knees higher on triceps.",
    unstable: "Focus eyes forward and balance weight over your fingertips."
  },
  frogstand: {
    collapsed: "Press firmly through fingertips and knuckles.",
    unstable: "Squeeze core to hold balance steady."
  },
  elbowlever: {
    hip_sag: "Engage lower back and glutes to keep legs horizontal.",
    bent_legs: "Extend legs fully straight behind you."
  },
  ninetydegreehold: {
    bent_elbows: "Maintain a strict 90-degree bend at the elbows.",
    hip_sag: "Keep your body horizontal and core braced."
  }
};

export function formatDuration(durationMs) {
  const totalSeconds = Math.round((durationMs || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatFaultLabel(key) {
  const map = {
    hip_sag: "hips sagged",
    hips_sagging: "hips sagged",
    hip_pike: "hips piked",
    hips_piking: "hips piked",
    shallow_depth: "shallow depth",
    incomplete_lockout: "incomplete lockout",
    no_lockout: "incomplete lockout",
    rushing: "rushed tempo",
    knee_bend: "knee bend",
    bent_arms: "bent arms",
    bent_legs: "bent legs",
    torso_lean: "torso lean",
    hips_dropping: "hips dropped",
    hip_arch: "arched back",
    shoulder_misalignment: "shoulders not fully stacked",
    shallow_squat: "shallow squat depth",
    torso_collapse: "chest collapsed forward",
    no_lockout_squat: "incomplete squat lockout",
    bouncing_squat: "bouncing at bottom",
    no_full_hang: "did not reach full hang",
    short_pull: "short pull depth",
    dropping_pullup: "dropping uncontrolled",
    insufficient_compression: "insufficient compression",
    insufficient_lean: "insufficient forward lean",
    sagging_hips: "hips sagged",
    piking_hips: "hips piked",
    collapsed: "collapsed pose",
    unstable: "unstable balance",
    bent_elbows: "elbows lost 90-degree bend",
    hspu_hip_sag: "body arched",
    hspu_hip_pike: "hips piked",
    hspu_shallow_depth: "shallow depth",
    hspu_no_lockout: "incomplete lockout",
    hspu_rushing: "rushed descent",
    ninety_hip_sag: "body arched",
    ninety_hip_pike: "hips piked",
    ninety_bad_angle: "off 90-degree torso angle",
    ninety_no_lockout: "incomplete lockout",
    ninety_rushing: "rushed descent",
    planche_hip_sag: "hips sagged",
    planche_hip_pike: "hips piked",
    planche_insufficient_lean: "insufficient forward lean",
    planche_no_lockout: "incomplete lockout",
    planche_rushing: "rushed tempo",
    pppu_hip_sag: "hips sagged",
    pppu_hip_pike: "hips piked",
    pppu_insufficient_lean: "insufficient forward lean",
    pppu_no_lockout: "incomplete lockout",
    pppu_rushing: "rushed tempo",
    pike_shallow_depth: "shallow depth",
    pike_no_lockout: "incomplete lockout",
    pike_opening: "hips opened too early",
    muscleup_no_full_hang: "did not start from dead hang",
    muscleup_incomplete_transition: "incomplete transition over bar",
    muscleup_no_dip_lockout: "incomplete dip lockout"
  };
  return map[key] || key.replace(/_/g, ' ');
}

/**
 * Validates whether a participant actually performed the specified skill
 * or whether lighting / camera angle prevented reliable analysis.
 */
export function validateSegmentPerformance(seg) {
  if (!seg) {
    return {
      performed: false,
      status: "no_data",
      message: "No tracking data recorded for this segment."
    };
  }

  const isHold = seg.type === "hold";
  const label = seg.label || seg.skill || "exercise";
  const confidenceFrames = seg._confidenceFrames || 0;
  const uncertainFrames = seg._uncertainFrames || 0;
  const avgConfidence = typeof seg.averageConfidence === "number" ? seg.averageConfidence : 0.85;

  // 1. Camera visibility / lighting quality check
  const uncertainRatio = confidenceFrames > 0 ? uncertainFrames / confidenceFrames : 0;
  const isBadLightingOrAngle =
    (confidenceFrames > 0 && avgConfidence < 0.45) ||
    (confidenceFrames >= 10 && uncertainRatio > 0.65);

  if (isBadLightingOrAngle) {
    return {
      performed: false,
      status: "bad_lighting_or_camera_angle",
      message: `Bad lighting and camera angle: We could not detect your body clearly enough during ${label}. Use good lighting, keep your full body in frame, and record from a side angle.`
    };
  }

  // 2. Performance check: Did user actually execute reps or a hold?
  if (isHold) {
    const minHoldMs = 600;
    if ((seg.bestHoldMs || 0) < minHoldMs) {
      return {
        performed: false,
        status: "not_detected",
        message: `Could not detect any ${label} in the video/feed. Keep your full body in frame and hold the position steadily.`
      };
    }
  } else {
    if ((seg.reps || 0) === 0) {
      return {
        performed: false,
        status: "not_detected",
        message: `Could not detect any ${label} in the video/feed. Make sure your full range of motion is visible on camera from a side angle.`
      };
    }
  }

  // 3. User performed the movement! Check form quality
  const hasFaults = seg.faults && seg.faults.length > 0;
  const avgQuality = typeof seg.averageFormQuality === "number" ? seg.averageFormQuality : 0.8;

  if (!hasFaults && avgQuality >= 0.85) {
    return {
      performed: true,
      status: "perfect",
      message: `Excellent form! Your ${label.toLowerCase()} looked well aligned with no major faults.`
    };
  }

  return {
    performed: true,
    status: "performed_with_faults",
    message: null
  };
}

export class SessionReportBuilder {
  static generateReport({ sessionState, segments = [], eventLog = null }) {
    const durationMs = sessionState.elapsedMs || (sessionState.endedAt && sessionState.startedAt ? sessionState.endedAt - sessionState.startedAt : 0);
    const durationText = formatDuration(durationMs);

    const segmentSummaries = segments.map((seg) => {
      const isHold = seg.type === 'hold';
      const confPercent = Math.round((seg.averageConfidence || 0.85) * 100);
      const validation = seg.validation || validateSegmentPerformance(seg);
      seg.validation = validation;

      let issueText = "Good alignment with no major faults detected";
      if (!validation.performed) {
        if (validation.status === "bad_lighting_or_camera_angle") {
          issueText = "Bad lighting and camera angle — unable to detect body clearly";
        } else {
          issueText = `Could not detect any ${seg.label || seg.skill} in the video/feed`;
        }
      } else if (seg.faults && seg.faults.length > 0) {
        const topFault = seg.faults[0];
        const label = formatFaultLabel(topFault.key);
        issueText = isHold
          ? `${label} detected during hold`
          : `${label} in ${topFault.count} frames/reps`;
      }

      let primaryStat = isHold
        ? `Best hold: ${(seg.bestHoldMs / 1000).toFixed(1)} seconds`
        : `${seg.reps} detected reps`;

      return {
        skill: seg.label || seg.skill,
        key: seg.skill,
        type: seg.type,
        duration: formatDuration(seg.durationMs),
        primaryStat,
        confidence: `${confPercent}%`,
        mainIssue: issueText,
        reps: seg.reps,
        bestHoldMs: seg.bestHoldMs,
        faults: seg.faults,
        performed: validation.performed,
        status: validation.status,
        feedbackMessage: validation.message,
        validationMessage: validation.message
      };
    });

    const confirmedSkills = Array.from(
      new Set(segmentSummaries.filter((s) => s.performed).map((s) => s.skill))
    );
    const allSkills = Array.from(new Set(segments.map((s) => s.label || s.skill)));
    const skillsPerformed = confirmedSkills.length > 0 ? confirmedSkills : allSkills;
    const skillsText = skillsPerformed.length > 0 ? skillsPerformed.join(', ') : 'None';

    // Global session feedback notice
    let feedbackNotice = null;
    const hasUnperformed = segmentSummaries.some((s) => !s.performed);
    const allUnperformed = segmentSummaries.length > 0 && segmentSummaries.every((s) => !s.performed);
    const hasBadLighting = segmentSummaries.some((s) => s.status === "bad_lighting_or_camera_angle");

    if (allUnperformed) {
      if (hasBadLighting) {
        feedbackNotice = "Bad lighting and camera angle: We could not detect a person clearly enough throughout this session. Use good lighting, keep your full body in frame, and position your camera at a clear side angle.";
      } else {
        const attempted = allSkills.join(", ");
        feedbackNotice = `Could not detect any ${attempted || "skills"} in the video/feed. Make sure your full body is visible and perform full-range reps or holds.`;
      }
    } else if (hasUnperformed) {
      feedbackNotice = "Some skills were not detected or had poor camera visibility. Check the segment breakdown below.";
    }

    const focusItems = [];
    if (allUnperformed) {
      if (hasBadLighting) {
        focusItems.push("Improve lighting: place a light source in front of you, not behind.");
        focusItems.push("Camera setup: ensure camera captures head-to-toe with no obstacles in the view.");
      } else {
        focusItems.push("Position your camera from a side profile angle so reps and body line can be tracked.");
        focusItems.push("Complete full-range repetitions or sustained static holds for at least a few seconds.");
      }
    } else {
      for (const seg of segments) {
        if (seg.faults && seg.faults.length > 0) {
          const topFault = seg.faults[0].key;
          const tip = FOCUS_TIPS[seg.skill]?.[topFault];
          if (tip && !focusItems.includes(tip)) {
            focusItems.push(tip);
          }
        }
      }

      if (focusItems.length === 0) {
        focusItems.push("Solid session! Maintain consistency and progress to longer hold times or added reps.");
      }
    }

    let textReport = `Session duration: ${durationText}\n`;
    textReport += `Skills performed: ${skillsText}\n\n`;

    if (feedbackNotice) {
      textReport += `Feedback Notice: ${feedbackNotice}\n\n`;
    }

    segmentSummaries.forEach((s) => {
      textReport += `${s.skill}\n`;
      textReport += `- ${s.primaryStat}\n`;
      textReport += `- Average confidence: ${s.confidence}\n`;
      textReport += `- Main issue: ${s.mainIssue}\n`;
      if (s.feedbackMessage && !s.performed) {
        textReport += `- Notice: ${s.feedbackMessage}\n`;
      }
      textReport += `\n`;
    });

    textReport += `Next focus\n`;
    focusItems.forEach((tip) => {
      textReport += `- ${tip}\n`;
    });

    return {
      durationText,
      durationMs,
      skillsPerformed,
      segmentSummaries,
      focusItems,
      feedbackNotice,
      hasUnperformed,
      allUnperformed,
      textReport
    };
  }
}

export class LiveSessionController {
  constructor(options = {}) {
    this.onStateChange = options.onStateChange || (() => {});
    this.eventLog = new SessionEventLog();
    this.segmentManager = null;
    this.sessionId = null;
    this.isActive = false;
    this.isPaused = false;
    this.startedAt = null;
    this.pausedAt = null;
    this.totalPausedMs = 0;
    this.currentSkill = null;
    this.audioEnabled = true;
  }

  start(initialSkillKey, timestampMs) {
    return this.startSession(initialSkillKey, timestampMs);
  }

  pause(timestampMs) {
    return this.pauseSession(timestampMs);
  }

  resume(timestampMs) {
    return this.resumeSession(timestampMs);
  }

  end(timestampMs) {
    return this.endSession(timestampMs);
  }

  get currentSegmentId() {
    return this.segmentManager?.getCurrentSegment()?.id || null;
  }

  startSession(initialSkillKey = "pushup", timestampMs = performance.now()) {
    const validSkill = resolveLiveSkill(initialSkillKey) || "pushup";
    this.sessionId = `session_${Date.now()}`;
    this.isActive = true;
    this.isPaused = false;
    this.startedAt = timestampMs;
    this.pausedAt = null;
    this.totalPausedMs = 0;
    this.currentSkill = validSkill;
    this.audioEnabled = true;

    this.segmentManager = new SegmentManager(this.sessionId);
    this.eventLog.clear();

    this.eventLog.record({
      type: "SESSION_STARTED",
      sessionId: this.sessionId,
      initialSkill: validSkill,
      timestampMs
    });

    const firstSegment = this.segmentManager.openSegment({
      skill: validSkill,
      timestampMs,
      reason: "session_start"
    });

    this.notifyStateChange();
    return firstSegment;
  }

  pauseSession(timestampMs = performance.now()) {
    if (!this.isActive || this.isPaused) return;
    this.isPaused = true;
    this.pausedAt = timestampMs;
    this.eventLog.record({ type: "PAUSED", timestampMs });
    this.notifyStateChange();
  }

  resumeSession(timestampMs = performance.now()) {
    if (!this.isActive || !this.isPaused) return;
    if (this.pausedAt != null) {
      this.totalPausedMs += Math.max(0, timestampMs - this.pausedAt);
    }
    this.isPaused = false;
    this.pausedAt = null;
    this.eventLog.record({ type: "RESUMED", timestampMs });
    this.notifyStateChange();
  }

  togglePause(timestampMs = performance.now()) {
    if (this.isPaused) {
      this.resumeSession(timestampMs);
    } else {
      this.pauseSession(timestampMs);
    }
    return this.isPaused;
  }

  changeSkill(nextSkillKey, timestampMs = performance.now()) {
    if (!this.isActive) return null;
    const validNext = resolveLiveSkill(nextSkillKey);
    if (!validNext) {
      return { error: `Unsupported live skill: "${nextSkillKey}"` };
    }

    if (validNext === this.currentSkill) {
      return {
        previousSkill: this.currentSkill,
        nextSkill: validNext,
        closedSegment: null,
        newSegment: this.segmentManager.getCurrentSegment(),
        unchanged: true
      };
    }

    const previousSkill = this.currentSkill;

    const closedSegment = this.segmentManager.closeCurrentSegment({
      timestampMs,
      reason: "user_switch"
    });

    if (closedSegment) {
      this.eventLog.record({
        type: "SEGMENT_CLOSED",
        segmentId: closedSegment.id,
        skill: closedSegment.skill,
        reason: "user_switch",
        timestampMs
      });
    }

    this.eventLog.record({
      type: "SKILL_SWITCHED",
      from: previousSkill,
      to: validNext,
      timestampMs
    });

    const newSegment = this.segmentManager.openSegment({
      skill: validNext,
      timestampMs,
      reason: "user_switch"
    });

    this.currentSkill = validNext;
    this.notifyStateChange();

    return {
      previousSkill,
      nextSkill: validNext,
      closedSegment,
      newSegment,
      unchanged: false
    };
  }

  ingestFrame(frameResult, timestampMs = performance.now()) {
    if (!this.isActive || this.isPaused || !this.segmentManager) {
      return this.segmentManager ? this.segmentManager.getCurrentSegment() : null;
    }

    const segment = this.segmentManager.updateCurrentSegment(frameResult, timestampMs);

    if (frameResult && frameResult.activeCue) {
      this.eventLog.record({
        type: "CUE_DELIVERED",
        skill: this.currentSkill,
        cue: frameResult.activeCue,
        timestampMs
      });
    }

    return segment;
  }

  getElapsedMs(now = performance.now()) {
    if (this.startedAt == null) return 0;
    if (this.isPaused && this.pausedAt != null) {
      return Math.max(0, this.pausedAt - this.startedAt - this.totalPausedMs);
    }
    return Math.max(0, now - this.startedAt - this.totalPausedMs);
  }

  toggleAudio(forceState = null) {
    this.audioEnabled = forceState !== null ? forceState : !this.audioEnabled;
    this.notifyStateChange();
    return this.audioEnabled;
  }

  endSession(timestampMs = performance.now()) {
    if (!this.isActive) return null;

    const lastSegment = this.segmentManager.closeCurrentSegment({
      timestampMs,
      reason: "session_end"
    });

    if (lastSegment) {
      this.eventLog.record({
        type: "SEGMENT_CLOSED",
        segmentId: lastSegment.id,
        skill: lastSegment.skill,
        reason: "session_end",
        timestampMs
      });
    }

    this.eventLog.record({
      type: "SESSION_ENDED",
      sessionId: this.sessionId,
      timestampMs
    });

    const elapsedMs = this.getElapsedMs(timestampMs);
    const sessionState = {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: timestampMs,
      elapsedMs,
      skillsPerformed: Array.from(new Set(this.segmentManager.getAllSegments().map(s => s.skill)))
    };

    const completedSegments = this.segmentManager.getCompletedSegments();
    const report = SessionReportBuilder.generateReport({
      sessionState,
      segments: completedSegments,
      eventLog: this.eventLog
    });

    this.isActive = false;
    this.isPaused = false;
    this.notifyStateChange();

    return {
      sessionState,
      segments: completedSegments,
      report
    };
  }

  notifyStateChange() {
    this.onStateChange({
      sessionId: this.sessionId,
      isActive: this.isActive,
      isPaused: this.isPaused,
      currentSkill: this.currentSkill,
      currentSegmentId: this.currentSegmentId,
      audioEnabled: this.audioEnabled,
      elapsedMs: this.getElapsedMs()
    });
  }
}