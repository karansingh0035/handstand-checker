// engine/smoothing.js

class LowPassFilter {
  constructor(alpha = 0.5) {
    this.s = null;
    this.setAlpha(alpha);
  }

  setAlpha(alpha) {
    this.alpha = Math.max(0.0, Math.min(1.0, alpha));
  }

  filter(val) {
    if (this.s === null) {
      this.s = val;
    } else {
      this.s = this.alpha * val + (1.0 - this.alpha) * this.s;
    }
    return this.s;
  }

  reset() {
    this.s = null;
  }
}

class OneEuroFilter1D {
  constructor(freq = 30, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.lastTime = null;
  }

  alpha(cutoff) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / this.freq;
    return 1.0 / (1.0 + tau / te);
  }

  filter(val, timestamp = performance.now()) {
    if (this.lastTime !== null && timestamp !== this.lastTime) {
      const dt = (timestamp - this.lastTime) / 1000;
      if (dt > 0) this.freq = 1.0 / dt;
    }
    this.lastTime = timestamp;

    const prevX = this.xFilter.s;
    const dx = prevX === null ? 0 : (val - prevX) * this.freq;
    
    // Set alpha BEFORE filtering dx to fix stale alpha frame
    this.dxFilter.setAlpha(this.alpha(this.dCutoff));
    const edx = this.dxFilter.filter(dx);
    
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.xFilter.setAlpha(this.alpha(cutoff));
    return this.xFilter.filter(val);
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

export class LandmarkFilterManager {
  constructor(minCutoff = 1.0, beta = 0.007) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.filters = new Map();
  }

  filterLandmarks(landmarks, timestamp = performance.now()) {
    if (!landmarks || landmarks.length === 0) return landmarks;

    return landmarks.map((lm, idx) => {
      const xKey = `${idx}_x`;
      const yKey = `${idx}_y`;

      if (!this.filters.has(xKey)) {
        this.filters.set(xKey, new OneEuroFilter1D(30, this.minCutoff, this.beta));
        this.filters.set(yKey, new OneEuroFilter1D(30, this.minCutoff, this.beta));
      }

      return {
        ...lm,
        x: this.filters.get(xKey).filter(lm.x, timestamp),
        y: this.filters.get(yKey).filter(lm.y, timestamp)
      };
    });
  }

  reset() {
    this.filters.clear();
  }
}