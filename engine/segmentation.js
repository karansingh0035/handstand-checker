// engine/segmentation.js

/**
 * Real-time Rep Segmentation Engine.
 * Segments reps via peak -> trough -> peak signal tracking and computes rep timing/ROM[cite: 2].
 */
export class RepSegmenter {
  constructor(options = {}) {
    this.fps = options.fps || 30;
    this.minRepDuration = options.minRepS || 0.8; // Minimum valid rep duration[cite: 2]
    this.maxRepDuration = options.maxRepS || 15.0; // Max allowed rep duration before rejection[cite: 2]
    this.expectedRom = options.expectedRom || 80.0; // Target ROM in degrees

    this.state = 'SEARCHING_START'; // States: SEARCHING_START | DESCENDING | ASCENDING
    this.completedReps = [];
    this.currentRep = null;
    this.frameCount = 0;
  }

  /**
   * Processes a single frame's primary angle signal (e.g., mean elbow or knee angle)[cite: 2].
   */
  processFrame(signalVal, meanVisibility, timestamp = performance.now()) {
    this.frameCount++;

    // Immediately return if low overall landmark visibility[cite: 2]
    if (meanVisibility < 0.60) {
      return { event: 'LOW_VISIBILITY', rep: null };
    }

    if (this.state === 'SEARCHING_START') {
      this.currentRep = {
        startFrame: this.frameCount,
        startTime: timestamp,
        topVal: signalVal,
        bottomVal: signalVal,
        bottomTime: timestamp,
        visibilities: [meanVisibility]
      };
      this.state = 'DESCENDING';
    } 
    else if (this.state === 'DESCENDING') {
      this.currentRep.visibilities.push(meanVisibility);

      if (signalVal < this.currentRep.bottomVal) {
        this.currentRep.bottomVal = signalVal;
        this.currentRep.bottomFrame = this.frameCount;
        this.currentRep.bottomTime = timestamp;
      }

      // Movement starts reversing upward (inflection point out of trough)
      if (signalVal > this.currentRep.bottomVal + 12.0) {
        this.state = 'ASCENDING';
      }
    } 
    else if (this.state === 'ASCENDING') {
      this.currentRep.visibilities.push(meanVisibility);

      // Reached completion near initial peak
      if (signalVal >= this.currentRep.topVal - 8.0 || signalVal > this.currentRep.bottomVal + 35.0) {
        const endTime = timestamp;
        const durationS = (endTime - this.currentRep.startTime) / 1000.0;
        const eccS = (this.currentRep.bottomTime - this.currentRep.startTime) / 1000.0;
        const conS = (endTime - this.currentRep.bottomTime) / 1000.0;
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
          durationS: durationS,
          conf: avgConf
        };

        // Reject reps under 40% expected ROM, under min time, or over 15s[cite: 2]
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

    return { event: 'IN_PROGRESS', rep: null };
  }

  reset() {
    this.state = 'SEARCHING_START';
    this.completedReps = [];
    this.currentRep = null;
    this.frameCount = 0;
  }
}