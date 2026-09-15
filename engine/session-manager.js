// engine/session-manager.js

/**
 * Supported Live Skills Registry
 * Only contains evaluators that are actually supported for live webcam analysis.
 */
export const SKILLS = {
  pushup: {
    key: "pushup",
    label: "Push-up",
    type: "rep",
  },
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
  squat: {
    key: "squat",
    label: "Squat",
    type: "rep",
  },
  pullup: {
    key: "pullup",
    label: "Pull-up",
    type: "rep",
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
  const cleaned = input.trim().toLowerCase().replace(/[\s-_]/g, '');
  const aliasMap = {
    pushup: 'pushup',
    pushups: 'pushup',
    handstand: 'handstand',
    handstands: 'handstand',
    lsit: 'lsit',
    lsits: 'lsit',
    squat: 'squat',
    squats: 'squat',
    pullup: 'pullup',
    pullups: 'pullup',
    // Upload-only aliases must NOT resolve to a live skill
    hspu: null,
    hspus: null,
    handstandpushup: null,
    handstandpushups: null
  };
  if (Object.prototype.hasOwnProperty.call(aliasMap, cleaned) && aliasMap[cleaned] === null) {
    return null;
  }
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
      faultCounts: new Map(), // faultKey -> count
      faults: [],
      cuesDelivered: 0,
      status: "active",
      // Internal tracking accumulators
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
      // Rep updates
      if (typeof frameResult.repCount === 'number') {
        seg.reps = frameResult.repCount;
      } else if (typeof frameResult.reps === 'number') {
        seg.reps = frameResult.reps;
      }

      // Hold updates
      if (typeof frameResult.bestHoldMs === 'number') {
        seg.bestHoldMs = Math.max(seg.bestHoldMs, frameResult.bestHoldMs);
      } else if (typeof frameResult.holdTimeMs === 'number') {
        seg.bestHoldMs = Math.max(seg.bestHoldMs, frameResult.holdTimeMs);
      }

      // Confidence & Quality accumulators
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

      // Fault frequency tracking
      const faults = frameResult.faults || (frameResult.holdResult && frameResult.holdResult.faults) || [];
      if (Array.isArray(faults)) {
        for (const fault of faults) {
          const key = typeof fault === 'string' ? fault : (fault.key || fault.id || 'unknown_fault');
          const current = seg.faultCounts.get(key) || 0;
          seg.faultCounts.set(key, current + 1);
        }
      }

      // Active cue count
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

    // Format fault counts array
    seg.faults = Array.from(seg.faultCounts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);

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

/**
 * Focus recommendations dictionary based on dominant detected faults
 */
const FOCUS_TIPS = {
  pushup: {
    hip_sag: "Maintain glute and core tension to keep a flat plank line during push-ups.",
    hips_sagging: "Maintain glute and core tension to keep a flat plank line during push-ups.",
    hip_pike: "Lower your hips in line with your shoulders and heels during push-ups.",
    hips_piking: "Lower your hips in line with your shoulders and heels during push-ups.",
    shallow_depth: "Work on full depth — lower chest until elbows bend to 90 degrees.",
    incomplete_lockout: "Press all the way to straight arms at the top of each rep."
  },
  handstand: {
    hip_arch: "Squeeze glutes and draw ribs in to avoid arching into a banana handstand.",
    hip_pike: "Open your hips fully into a vertical stack over your hands.",
    shoulder_misalignment: "Push tall through your shoulders and stack them directly over wrists.",
    bent_arms: "Lock out elbows completely before balancing."
  },
  lsit: {
    knee_bend: "Point your toes and lock your knees to maintain full leg extension.",
    hips_dropping: "Press through your palms and lift your hips off the floor.",
    torso_lean: "Keep your chest tall and avoid leaning back excessively."
  },
  squat: {
    shallow_squat: "Descend until your hips are below knee level for full depth.",
    torso_collapse: "Keep your chest lifted throughout the descent."
  },
  pullup: {
    no_full_hang: "Start and finish every rep from a full dead hang stretch.",
    short_pull: "Pull higher until your chin clearly clears the bar."
  }
};

/**
 * Formats a duration in milliseconds to human-readable string (e.g. "2m 18s" or "45s")
 */
export function formatDuration(durationMs) {
  const totalSeconds = Math.round((durationMs || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Human-readable fault labels
 */
export function formatFaultLabel(key) {
  const map = {
    hip_sag: "hips sagged",
    hips_sagging: "hips sagged",
    hip_pike: "hips piked",
    hips_piking: "hips piked",
    shallow_depth: "shallow depth",
    incomplete_lockout: "incomplete lockout",
    no_lockout: "incomplete lockout",
    knee_bend: "knee bend",
    bent_arms: "bent arms",
    torso_lean: "torso lean",
    hips_dropping: "hips dropped",
    hip_arch: "arched back",
    shoulder_misalignment: "shoulders not fully stacked",
    shallow_squat: "shallow squat depth",
    torso_collapse: "chest collapsed forward",
    no_full_hang: "did not reach full hang"
  };
  return map[key] || key.replace(/_/g, ' ');
}

/**
 * Session Report Builder
 * Generates a structured multi-skill session summary.
 */
export class SessionReportBuilder {
  static generateReport({ sessionState, segments = [], eventLog = null }) {
    const durationMs = sessionState.elapsedMs || (sessionState.endedAt && sessionState.startedAt ? sessionState.endedAt - sessionState.startedAt : 0);
    const durationText = formatDuration(durationMs);

    const skillsPerformed = Array.from(new Set(segments.map(s => s.label || s.skill)));
    const skillsText = skillsPerformed.length > 0 ? skillsPerformed.join(', ') : 'None';

    const segmentSummaries = segments.map((seg) => {
      const isHold = seg.type === 'hold';
      const confPercent = Math.round((seg.averageConfidence || 0.85) * 100);

      // Dominant issue
      let issueText = "Good alignment with no major faults detected";
      if (seg.faults && seg.faults.length > 0) {
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
        faults: seg.faults
      };
    });

    // Next focus tips
    const focusItems = [];
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

    // Generate formatted plain text report
    let textReport = `Session duration: ${durationText}\n`;
    textReport += `Skills performed: ${skillsText}\n\n`;

    segmentSummaries.forEach((s) => {
      textReport += `${s.skill}\n`;
      textReport += `- ${s.primaryStat}\n`;
      textReport += `- Average confidence: ${s.confidence}\n`;
      textReport += `- Main issue: ${s.mainIssue}\n\n`;
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
      textReport
    };
  }
}

/**
 * Live Session Controller
 * Owns session lifecycle (start, pause, resume, change skill, end)
 * and keeps session ID & timer continuous across evaluator switches.
 */
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

    // 1. Finalize previous segment
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

    // 2. Record switch event
    this.eventLog.record({
      type: "SKILL_SWITCHED",
      from: previousSkill,
      to: validNext,
      timestampMs
    });

    // 3. Open next segment with new skill
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

    // Close final segment
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
