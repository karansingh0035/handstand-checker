// engine/arbitrator.js

export class CueArbitrator {
  constructor(options = {}) {
    this.maxAudioCues = options.maxAudioCues || 4;
    this.debounceWindow = options.debounceWindow || 3;
    this.cleanStreakThreshold = options.cleanStreakThreshold || 3;

    this.audioCueCount = 0;
    this.cleanStreak = 0;
    this.cueLastFiredRep = new Map();
    this.violationHistory = new Map();
  }

  arbitrate(repNumber, violations = []) {
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
  }
}