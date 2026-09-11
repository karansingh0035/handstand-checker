// engine/arbitrator.js
import { PRIORITY } from './rules.js';

export class CueArbitrator {
  constructor(options = {}) {
    this.maxAudioCues = options.maxAudioCues || 4;
    this.debounceWindow = options.debounceWindow || 3;
    this.cleanStreakThreshold = options.cleanStreakThreshold || 3;

    this.audioCueCount = 0;
    this.cleanStreak = 0;
    this.cueLastFiredRep = new Map();
    this.violationHistory = new Map();

    // 🆕 SAFETY ESCALATION — deliberately separate state from everything
    // above. A "take a break" cue must never go silent just because the
    // routine maxAudioCues budget got used up on unrelated form tips
    // earlier in the session — that was the actual bug being fixed here.
    // safetyStreakThreshold: consecutive reps with a SAFETY-tier violation
    // (from rules.js's PRIORITY.SAFETY) required before escalating —
    // mirrors cleanStreakThreshold's "requires repetition, not a one-off"
    // pattern, just for the opposite case.
    // maxSafetyCues: its own budget, independent of maxAudioCues, so a
    // struggling user can still get warned even after routine cues are
    // exhausted (and vice versa — safety escalating doesn't eat into the
    // routine budget either).
    this.safetyStreakThreshold = options.safetyStreakThreshold || 3;
    this.maxSafetyCues = options.maxSafetyCues || 3;
    this.safetyStreak = 0;
    this.safetyCueCount = 0;
  }

  arbitrate(repNumber, violations = []) {
    // 🆕 SAFETY ESCALATION — checked FIRST, before the routine
    // maxAudioCues cap below, and using its own separate budget
    // (maxSafetyCues) so it can never go silent just because routine form
    // cues already used up the session's regular budget. Tracks
    // consecutive reps containing a SAFETY-tier violation (evaluateRules()
    // in rules.js already tags each violation with its priority tier, so
    // no new detection logic is needed here — just watching for
    // repetition of what's already flagged as SAFETY).
    const hasSafetyViolation = violations.some((v) => v.priority === PRIORITY.SAFETY);
    this.safetyStreak = hasSafetyViolation ? this.safetyStreak + 1 : 0;

    if (this.safetyStreak >= this.safetyStreakThreshold && this.safetyCueCount < this.maxSafetyCues) {
      this.safetyCueCount++;
      // Reset immediately, requiring a fresh streak of violations before
      // firing again — same "don't nag every single rep" reasoning as the
      // debounce window below, just implemented as a streak reset instead
      // since this cue isn't tied to one specific violation id.
      this.safetyStreak = 0;
      return {
        id: 'safety_break',
        cue: "Your form is breaking down — take a break.",
        priority: PRIORITY.SAFETY,
        isSafety: true,
      };
    }

    // --- Everything below is the existing routine-cue logic, unchanged,
    // with its own separate maxAudioCues budget. ---
    if (this.audioCueCount >= this.maxAudioCues) {
      return null;
    }

    if (violations.length === 0) {
      this.cleanStreak++;
      if (this.cleanStreak === this.cleanStreakThreshold) {
        this.audioCueCount++;
        return {
          id: 'positive_reinforcement',
          cue: "That's it — hold that.",
          priority: 0,
          isPositive: true
        };
      }
      return null;
    }

    this.cleanStreak = 0;

    // Require at least 2 actual true violations in recent history
    const persistentViolations = violations.filter((v) => {
      const history = this.violationHistory.get(v.id) || [];
      history.push(true);
      if (history.length > 3) history.shift();
      this.violationHistory.set(v.id, history);

      const trueCount = history.filter(Boolean).length;
      return trueCount >= 2;
    });

    if (persistentViolations.length === 0) {
      return null;
    }

    const candidateCues = persistentViolations.filter((v) => {
      const lastFired = this.cueLastFiredRep.get(v.id);
      if (lastFired === undefined) return true;
      return repNumber - lastFired > this.debounceWindow;
    });

    if (candidateCues.length === 0) {
      return null;
    }

    const selectedCue = candidateCues[0];
    this.cueLastFiredRep.set(selectedCue.id, repNumber);
    this.audioCueCount++;

    return selectedCue;
  }

  reset() {
    this.audioCueCount = 0;
    this.cleanStreak = 0;
    this.cueLastFiredRep.clear();
    this.violationHistory.clear();
    // 🆕
    this.safetyStreak = 0;
    this.safetyCueCount = 0;
  }
}