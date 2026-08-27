// engine/segmentation.js

export class RepSegmenter {
  constructor(options = {}) {
    this.fps = options.fps || 30;
    this.minRepDuration = options.minRepS || 0.8;
    this.maxRepDuration = options.maxRepS || 15.0;
    this.expectedRom = options.expectedRom || 80.0;

    this.state = 'SEARCHING_START';
    this.completedReps = [];
    this.currentRep = null;
    this.frameCount = 0;
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
        hasSagged: isSag,
        hasPiked: isPike,

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
        }

        // Detect inflection point out of trough
        if (primarySignal > this.currentRep.bottomVal + 12.0) {
          this.currentRep.troughExitTime = timestamp;
          this.state = 'ASCENDING';
        }
      } 
      else if (this.state === 'ASCENDING') {
        if (primarySignal >= this.currentRep.topVal - 8.0 || primarySignal > this.currentRep.bottomVal + 35.0) {
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