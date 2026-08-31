// engine/segmentation.js

export class RepSegmenter {
  constructor(options = {}) {
    this.fps = options.fps || 30;
    this.minRepDuration = options.minRepS || 0.8;
    this.maxRepDuration = options.maxRepS || 15.0;
    this.expectedRom = options.expectedRom || 80.0;

    // 🆕 Configurable per-movement — defaults match the original hardcoded
    // values, so every angle-based movement (pushup, squat, pullup, etc.)
    // behaves identically to before. Only a movement whose primarySignal
    // isn't degree-scale (e.g. muscleup's normalized ratio) needs these
    // overridden via configure(), since the same 12.0/8.0/35.0 constants
    // that work for a 0-180° signal would never trigger on a ~-1.5 to 1.5
    // ratio signal.
    this.troughExitDelta = options.troughExitDelta || 12.0;
    this.topReturnDelta = options.topReturnDelta || 8.0;
    this.bottomOvershootDelta = options.bottomOvershootDelta || 35.0;

    this.state = 'SEARCHING_START';
    this.completedReps = [];
    this.currentRep = null;
    this.frameCount = 0;
  }

  // 🆕 Updates scale-dependent thresholds without touching rep state —
  // called from TrueFormEngine.setMovement() so each movement's segmenter
  // matches its primarySignal's actual numeric scale.
  configure(options = {}) {
    if (options.troughExitDelta !== undefined) this.troughExitDelta = options.troughExitDelta;
    if (options.topReturnDelta !== undefined) this.topReturnDelta = options.topReturnDelta;
    if (options.bottomOvershootDelta !== undefined) this.bottomOvershootDelta = options.bottomOvershootDelta;
    if (options.expectedRom !== undefined) this.expectedRom = options.expectedRom;
  }

  processFrame(metrics, timestamp = performance.now()) {
    this.frameCount++;
    const { 
      primarySignal, 
      meanVisibility, 
      minElbowAngle, 
      maxHipAngle, 
      bodyLineDeviation, 
      isSag, 
      isPike,
      torsoVertical,
      shoulderLean,
      hipLineAngle,
      verticalProgress,
      hipY = 0,
      kneeY = 0,
      noseY = 0,
      wristY = 0
    } = metrics;

    if (meanVisibility < 0.60) {
      return { event: 'LOW_VISIBILITY', rep: null };
    }

    if (this.state === 'SEARCHING_START') {
      this.currentRep = {
        startFrame: this.frameCount,
        startTime: timestamp,
        topVal: primarySignal,
        bottomVal: primarySignal,
        bottomTime: timestamp,
        troughEnterTime: null,
        troughExitTime: null,
        visibilities: [meanVisibility],
        
        // Track running aggregates across full rep duration
        minElbowAngle: minElbowAngle,
        maxElbowAngle: minElbowAngle,
        maxHipAngle: maxHipAngle,
        maxBodyLineDeviation: bodyLineDeviation,
        maxTorsoVertical: torsoVertical,
        maxShoulderLean: shoulderLean,
        maxHipLineAngle: hipLineAngle,
        maxVerticalProgress: verticalProgress,
        hasSagged: isSag,
        hasPiked: isPike,

        // Torso angle AND elbow angle captured AT the deepest point of the
        // rep (not max-anywhere) — bottomTorsoVertical needed for 90° HSPU,
        // bottomElbowAngle needed for muscle-up's dip-lockout check. For
        // muscleup specifically, primarySignal's trough is the REAL-WORLD
        // TOP of the movement (support/lockout) since that signal is
        // negated — see index.js's primarySignal override for why.
        bottomTorsoVertical: torsoVertical,
        bottomElbowAngle: minElbowAngle,

        // Spatial position tracking for Squat & Pull-up rules
        bottomHipY: hipY,
        bottomKneeY: kneeY,
        topNoseY: noseY,
        topWristY: wristY
      };
      this.state = 'DESCENDING';
    } 
    else {
      // Aggregate metrics frame-by-frame
      this.currentRep.visibilities.push(meanVisibility);
      this.currentRep.minElbowAngle = Math.min(this.currentRep.minElbowAngle, minElbowAngle);
      this.currentRep.maxElbowAngle = Math.max(this.currentRep.maxElbowAngle, minElbowAngle);
      this.currentRep.maxHipAngle = Math.max(this.currentRep.maxHipAngle, maxHipAngle);
      this.currentRep.maxBodyLineDeviation = Math.max(this.currentRep.maxBodyLineDeviation, bodyLineDeviation);
      this.currentRep.maxTorsoVertical = Math.max(this.currentRep.maxTorsoVertical, torsoVertical);
      this.currentRep.maxShoulderLean = Math.max(this.currentRep.maxShoulderLean, shoulderLean);
      this.currentRep.maxHipLineAngle = Math.max(this.currentRep.maxHipLineAngle, hipLineAngle);
      this.currentRep.maxVerticalProgress = Math.max(this.currentRep.maxVerticalProgress, verticalProgress);
      if (isSag) this.currentRep.hasSagged = true;
      if (isPike) this.currentRep.hasPiked = true;

      // Track bottom-position Y-coords for Squat depth check
      if (hipY > this.currentRep.bottomHipY) {
        this.currentRep.bottomHipY = hipY;
        this.currentRep.bottomKneeY = kneeY;
      }

      // Track top-position Y-coords for Pull-up chin height check
      if (noseY < this.currentRep.topNoseY) {
        this.currentRep.topNoseY = noseY;
        this.currentRep.topWristY = wristY;
      }

      if (this.state === 'DESCENDING') {
        if (primarySignal < this.currentRep.bottomVal) {
          this.currentRep.bottomVal = primarySignal;
          this.currentRep.bottomFrame = this.frameCount;
          this.currentRep.bottomTime = timestamp;
          this.currentRep.troughEnterTime = timestamp;
          this.currentRep.bottomTorsoVertical = torsoVertical;
          this.currentRep.bottomElbowAngle = minElbowAngle;
        }

        // Detect inflection point out of trough
        if (primarySignal > this.currentRep.bottomVal + this.troughExitDelta) {
          this.currentRep.troughExitTime = timestamp;
          this.state = 'ASCENDING';
        }
      } 
      else if (this.state === 'ASCENDING') {
        if (primarySignal >= this.currentRep.topVal - this.topReturnDelta || primarySignal > this.currentRep.bottomVal + this.bottomOvershootDelta) {
          const endTime = timestamp;
          const durationS = (endTime - this.currentRep.startTime) / 1000.0;
          const eccS = (this.currentRep.bottomTime - this.currentRep.startTime) / 1000.0;
          const conS = (endTime - this.currentRep.bottomTime) / 1000.0;
          
          // Compute bottom pause duration
          const pauseS = this.currentRep.troughExitTime && this.currentRep.troughEnterTime 
            ? (this.currentRep.troughExitTime - this.currentRep.troughEnterTime) / 1000.0 
            : 0.0;

          const rom = Math.abs(this.currentRep.topVal - this.currentRep.bottomVal);
          const avgConf = this.currentRep.visibilities.reduce((a, b) => a + b, 0) / this.currentRep.visibilities.length;

          const repData = {
            repNumber: this.completedReps.length + 1,
            startFrame: this.currentRep.startFrame,
            bottomFrame: this.currentRep.bottomFrame,
            endFrame: this.frameCount,
            rom: rom,
            topVal: this.currentRep.topVal,
            bottomVal: this.currentRep.bottomVal,
            eccS: eccS,
            conS: conS,
            pauseS: pauseS,
            durationS: durationS,
            conf: avgConf,

            // Pass true full-rep aggregates to rule evaluator
            minElbowAngle: this.currentRep.minElbowAngle,
            maxElbowAngle: this.currentRep.maxElbowAngle,
            maxHipAngle: this.currentRep.maxHipAngle,
            bodyLineDeviation: this.currentRep.maxBodyLineDeviation,
            torsoVertical: this.currentRep.maxTorsoVertical,
            bottomTorsoVertical: this.currentRep.bottomTorsoVertical,
            shoulderLean: this.currentRep.maxShoulderLean,
            hipLineAngle: this.currentRep.maxHipLineAngle,
            verticalProgress: this.currentRep.maxVerticalProgress,
            bottomElbowAngle: this.currentRep.bottomElbowAngle,
            isSag: this.currentRep.hasSagged,
            isPike: this.currentRep.hasPiked,

            // Spatial Y-coordinates for rule evaluation
            hipY: this.currentRep.bottomHipY,
            kneeY: this.currentRep.bottomKneeY,
            noseY: this.currentRep.topNoseY,
            wristY: this.currentRep.topWristY
          };

          const isValid = avgConf >= 0.60 &&
                          rom >= (this.expectedRom * 0.40) &&
                          durationS >= this.minRepDuration &&
                          durationS <= this.maxRepDuration;

          this.state = 'SEARCHING_START';

          if (isValid) {
            this.completedReps.push(repData);
            return { event: 'REP_COMPLETE', rep: repData };
          } else {
            return { event: 'REP_REJECTED', rep: repData };
          }
        }
      }
    }

    return { event: 'IN_PROGRESS', rep: null };
  }

  reset() {
    this.state = 'SEARCHING_START';
    this.completedReps = [];
    this.currentRep = null;
    this.frameCount = 0;
  }
}