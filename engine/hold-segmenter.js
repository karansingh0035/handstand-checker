// engine/hold-segmenter.js

/**
 * Static-Hold State Constants
 */
export const HOLD_STATE = {
  NO_HOLD: 'no_hold',
  CANDIDATE: 'candidate',
  ACTIVE: 'active',
  DEGRADING: 'degrading',
  TRACKING_UNCERTAIN: 'tracking_uncertain',
  ENDED: 'ended'
};

/**
 * Static-Hold Lifecycle Events
 */
export const HOLD_EVENT = {
  HOLD_CANDIDATE_STARTED: 'HOLD_CANDIDATE_STARTED',
  HOLD_CONFIRMED: 'HOLD_CONFIRMED',
  HOLD_DEGRADING: 'HOLD_DEGRADING',
  TRACKING_LOST: 'TRACKING_LOST',
  HOLD_RECOVERED: 'HOLD_RECOVERED',
  HOLD_ENDED: 'HOLD_ENDED'
};

/**
 * Default Hold Configuration based on TrueForm Static-Hold Specification
 */
export const DEFAULT_HOLD_CONFIG = {
  minCandidateDwellMs: 300,        // Minimum dwell time before pose is considered a viable candidate
  minConfirmedHoldMs: 600,          // Minimum dwell time before confirming active hold
  degradationThreshold: 0.45,       // formQuality below this counts toward degradation
  degradationStreakFrames: 8,       // Consecutive frames below threshold required to enter DEGRADING
  recoveryStreakFrames: 4,          // Consecutive frames above threshold required to recover to ACTIVE
  trackingUncertainAfterMs: 150,    // Tracking loss duration before entering TRACKING_UNCERTAIN
  endAfterTrackingLostMs: 500,      // Tracking loss duration before ending hold
  maxFrameGapMs: 250,               // Maximum expected frame gap before clamping dt
  candidateLikelihoodThreshold: 0.60,
  activeLikelihoodThreshold: 0.70,
  exitLikelihoodThreshold: 0.40,
  minConfidence: 0.50
};

/**
 * Reusable HoldSegmenter
 * Manages static hold lifecycle states, dwell times, degradation detection,
 * tracking-loss handling, duration tracking, and event emission.
 */
export class HoldSegmenter {
  constructor(config = {}) {
    this.config = { ...DEFAULT_HOLD_CONFIG, ...config };
    this.reset();
  }

  reset() {
    this.state = HOLD_STATE.NO_HOLD;
    this.lastTimestamp = null;
    this.candidateStartTimestamp = null;
    this.candidateTimeMs = 0;
    this.holdTimeMs = 0;
    this.bestHoldMs = 0;
    this.trackingLostMs = 0;
    this.degradationStreak = 0;
    this.recoveryStreak = 0;
    this.preUncertainState = null;
    this.dominantFault = null;
  }

  /**
   * Updates hold state with the current frame evaluation.
   * @param {Object} evaluation - Per-frame assessment from static evaluator
   * @param {number} timestampMs - Frame timestamp in milliseconds
   * @returns {Object} Common hold result structure
   */
  update(evaluation, timestampMs = performance.now()) {
    if (!evaluation) {
      return this.buildResult(null, null);
    }

    const dt = this.lastTimestamp !== null ? Math.min(Math.max(0, timestampMs - this.lastTimestamp), this.config.maxFrameGapMs) : 0;
    this.lastTimestamp = timestampMs;

    const poseConfidence = typeof evaluation.poseConfidence === 'number' ? evaluation.poseConfidence : 0;
    const isTrackingLost = poseConfidence < this.config.minConfidence || evaluation.skillLikelihood === null;

    if (isTrackingLost) {
      this.trackingLostMs += dt;
    } else {
      this.trackingLostMs = 0;
    }

    let emittedEvent = null;

    switch (this.state) {
      case HOLD_STATE.NO_HOLD:
      case HOLD_STATE.ENDED: {
        if (!isTrackingLost && evaluation.skillLikelihood >= this.config.candidateLikelihoodThreshold) {
          this.state = HOLD_STATE.CANDIDATE;
          this.candidateStartTimestamp = timestampMs;
          this.candidateTimeMs = 0;
          this.holdTimeMs = 0;
          this.degradationStreak = 0;
          this.recoveryStreak = 0;
          emittedEvent = HOLD_EVENT.HOLD_CANDIDATE_STARTED;
        }
        break;
      }

      case HOLD_STATE.CANDIDATE: {
        if (isTrackingLost) {
          if (this.trackingLostMs > this.config.trackingUncertainAfterMs) {
            this.state = HOLD_STATE.NO_HOLD;
            this.candidateTimeMs = 0;
          }
        } else if (evaluation.skillLikelihood < this.config.candidateLikelihoodThreshold) {
          // Reversal: lost resemblance before dwell time met
          this.state = HOLD_STATE.NO_HOLD;
          this.candidateTimeMs = 0;
        } else {
          this.candidateTimeMs = timestampMs - this.candidateStartTimestamp;
          if (this.candidateTimeMs >= this.config.minConfirmedHoldMs) {
            this.state = HOLD_STATE.ACTIVE;
            this.holdTimeMs = this.candidateTimeMs - this.config.minCandidateDwellMs;
            this.bestHoldMs = Math.max(this.bestHoldMs, this.holdTimeMs);
            emittedEvent = HOLD_EVENT.HOLD_CONFIRMED;
          }
        }
        break;
      }

      case HOLD_STATE.ACTIVE: {
        if (isTrackingLost) {
          if (this.trackingLostMs >= this.config.endAfterTrackingLostMs) {
            this.state = HOLD_STATE.ENDED;
            emittedEvent = HOLD_EVENT.HOLD_ENDED;
          } else if (this.trackingLostMs >= this.config.trackingUncertainAfterMs) {
            this.preUncertainState = HOLD_STATE.ACTIVE;
            this.state = HOLD_STATE.TRACKING_UNCERTAIN;
            emittedEvent = HOLD_EVENT.TRACKING_LOST;
          }
          // 0-150ms: Grace period preserves state, but hold time is NOT inflated by missing tracking
        } else if (evaluation.skillLikelihood < this.config.exitLikelihoodThreshold) {
          // Collapse / complete skill loss
          this.state = HOLD_STATE.ENDED;
          emittedEvent = HOLD_EVENT.HOLD_ENDED;
        } else {
          this.holdTimeMs += dt;
          this.bestHoldMs = Math.max(this.bestHoldMs, this.holdTimeMs);

          // Degradation streak detection
          const formQuality = typeof evaluation.formQuality === 'number' ? evaluation.formQuality : 1.0;
          if (formQuality < this.config.degradationThreshold) {
            this.degradationStreak++;
            this.recoveryStreak = 0;
            if (this.degradationStreak >= this.config.degradationStreakFrames) {
              this.state = HOLD_STATE.DEGRADING;
              this.dominantFault = evaluation.faults && evaluation.faults.length > 0 ? evaluation.faults[0] : null;
              emittedEvent = HOLD_EVENT.HOLD_DEGRADING;
            }
          } else {
            this.degradationStreak = 0;
          }
        }
        break;
      }

      case HOLD_STATE.DEGRADING: {
        if (isTrackingLost) {
          if (this.trackingLostMs >= this.config.endAfterTrackingLostMs) {
            this.state = HOLD_STATE.ENDED;
            emittedEvent = HOLD_EVENT.HOLD_ENDED;
          } else if (this.trackingLostMs >= this.config.trackingUncertainAfterMs) {
            this.preUncertainState = HOLD_STATE.DEGRADING;
            this.state = HOLD_STATE.TRACKING_UNCERTAIN;
            emittedEvent = HOLD_EVENT.TRACKING_LOST;
          }
        } else if (evaluation.skillLikelihood < this.config.exitLikelihoodThreshold) {
          this.state = HOLD_STATE.ENDED;
          emittedEvent = HOLD_EVENT.HOLD_ENDED;
        } else {
          // Skill is still recognisable, poor form is distinguished from complete loss
          this.holdTimeMs += dt;
          this.bestHoldMs = Math.max(this.bestHoldMs, this.holdTimeMs);

          const formQuality = typeof evaluation.formQuality === 'number' ? evaluation.formQuality : 0.0;
          if (formQuality >= this.config.degradationThreshold) {
            this.recoveryStreak++;
            if (this.recoveryStreak >= this.config.recoveryStreakFrames) {
              this.state = HOLD_STATE.ACTIVE;
              this.degradationStreak = 0;
              this.dominantFault = null;
              emittedEvent = HOLD_EVENT.HOLD_RECOVERED;
            }
          } else {
            this.recoveryStreak = 0;
            if (evaluation.faults && evaluation.faults.length > 0) {
              this.dominantFault = evaluation.faults[0];
            }
          }
        }
        break;
      }

      case HOLD_STATE.TRACKING_UNCERTAIN: {
        if (this.trackingLostMs >= this.config.endAfterTrackingLostMs) {
          this.state = HOLD_STATE.ENDED;
          emittedEvent = HOLD_EVENT.HOLD_ENDED;
        } else if (!isTrackingLost) {
          // Tracking recovered within grace period!
          if (evaluation.skillLikelihood >= this.config.activeLikelihoodThreshold) {
            this.state = this.preUncertainState === HOLD_STATE.DEGRADING ? HOLD_STATE.DEGRADING : HOLD_STATE.ACTIVE;
            emittedEvent = HOLD_EVENT.HOLD_RECOVERED;
          } else if (evaluation.skillLikelihood >= this.config.candidateLikelihoodThreshold) {
            this.state = HOLD_STATE.CANDIDATE;
          } else {
            this.state = HOLD_STATE.ENDED;
            emittedEvent = HOLD_EVENT.HOLD_ENDED;
          }
        }
        break;
      }
    }

    return this.buildResult(evaluation, emittedEvent);
  }

  buildResult(evaluation, emittedEvent) {
    const isUncertain = this.state === HOLD_STATE.TRACKING_UNCERTAIN;
    return {
      skill: evaluation ? evaluation.skill : null,
      type: 'hold',
      state: this.state,
      poseConfidence: evaluation ? evaluation.poseConfidence : 0,
      skillLikelihood: isUncertain ? null : (evaluation ? evaluation.skillLikelihood : null),
      formQuality: isUncertain ? null : (evaluation ? evaluation.formQuality : null),
      holdTimeMs: Math.round(this.holdTimeMs),
      bestHoldMs: Math.round(this.bestHoldMs),
      candidateTimeMs: Math.round(this.candidateTimeMs),
      trackingLostMs: Math.round(this.trackingLostMs),
      faults: isUncertain ? [] : (evaluation && evaluation.faults ? evaluation.faults : []),
      metrics: isUncertain ? null : (evaluation && evaluation.metrics ? evaluation.metrics : null),
      event: emittedEvent,
      dominantFault: this.dominantFault
    };
  }
}
