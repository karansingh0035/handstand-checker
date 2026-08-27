// engine/arbitrator.js

/**
 * Arbitrator for cue selection and timing management.
 * Enforces:
 * 1. Single highest-priority cue per rep (SAFETY > ROM > TEMPO > EFFICIENCY).
 * 2. Debouncing: Same cue cannot re-fire for 3 reps.
 * 3. Persistence: Must violate rule on 2 of last 3 reps before firing.
 * 4. Cue budget: Maximum 4 audio cues per set.
 * 5. Positive reinforcement: Triggers after 3 consecutive clean reps.
 */
export class CueArbitrator {
  constructor(options = {}) {
    this.maxAudioCues = options.maxAudioCues || 4;
    this.debounceWindow = options.debounceWindow || 3;
    this.cleanStreakThreshold = options.cleanStreakThreshold || 3;

    this.audioCueCount = 0;
    this.cleanStreak = 0;
    this.cueLastFiredRep = new Map(); // cueId -> repNumber
    this.violationHistory = new Map(); // cueId -> array of booleans
  }

  arbitrate(repNumber, violations = []) {
    // Check if audio cue budget is exhausted
    if (this.audioCueCount >= this.maxAudioCues) {
      return null;
    }

    // Handle positive confirmation (3 consecutive clean reps)
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

    // Reset clean streak when a violation occurs
    this.cleanStreak = 0;

    // Track persistence (2 of last 3 reps)
    const persistentViolations = violations.filter((v) => {
      const history = this.violationHistory.get(v.id) || [];
      history.push(true);
      if (history.length > 3) history.shift();
      this.violationHistory.set(v.id, history);

      const trueCount = history.filter(Boolean).length;
      return trueCount >= Math.min(2, history.length);
    });

    if (persistentViolations.length === 0) {
      return null;
    }

    // Filter out debounced cues (same cue cannot fire for 3 reps)
    const candidateCues = persistentViolations.filter((v) => {
      const lastFired = this.cueLastFiredRep.get(v.id);
      if (lastFired === undefined) return true;
      return repNumber - lastFired > this.debounceWindow;
    });

    if (candidateCues.length === 0) {
      return null;
    }

    // Pick top priority violation (array is pre-sorted by SAFETY > ROM > TEMPO > EFFICIENCY)
    const selectedCue = candidateCues[0];

    // Update tracking
    this.cueLastFiredRep.set(selectedCue.id, repNumber);
    this.audioCueCount++;

    return selectedCue;
  }

  reset() {
    this.audioCueCount = 0;
    this.cleanStreak = 0;
    this.cueLastFiredRep.clear();
    this.violationHistory.clear();
  }
}