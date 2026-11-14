// src/utils/mediaPipeSingleton.js

let globalPose = null;
let isInitializing = false;
let isWarmedUp = false;
const listeners = new Set();

/**
 * Ensures a single, persistent MediaPipe Pose instance across the application lifetime.
 * Prevents multiple wasm module instantiations and Emscripten deadlocks.
 */
export function getMediaPipePose() {
  if (globalPose) return globalPose;
  if (typeof window === 'undefined' || !window.Pose) return null;
  if (isInitializing) return null;

  isInitializing = true;

  try {
    const pose = new window.Pose({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
    });

    pose.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    pose.onResults((results) => {
      listeners.forEach((listener) => {
        try {
          listener(results);
        } catch (err) {
          console.error('Error in pose listener:', err);
        }
      });
    });

    // Pre-warm with a tiny dummy canvas to trigger wasm asset loading immediately
    const dummyCanvas = document.createElement('canvas');
    dummyCanvas.width = 64;
    dummyCanvas.height = 64;
    pose
      .send({ image: dummyCanvas })
      .then(() => {
        isWarmedUp = true;
      })
      .catch((e) => {
        console.warn('MediaPipe prewarm notification:', e);
      });

    globalPose = pose;
  } catch (err) {
    console.error('Failed to initialize MediaPipe Pose singleton:', err);
    isInitializing = false;
  }

  return globalPose;
}

export function ensureMediaPipeSingleton() {
  if (globalPose) return globalPose;
  if (typeof window !== 'undefined' && window.Pose) {
    return getMediaPipePose();
  }

  // Poll briefly if script is still downloading
  if (typeof window !== 'undefined') {
    const checkInterval = setInterval(() => {
      if (window.Pose) {
        clearInterval(checkInterval);
        getMediaPipePose();
      }
    }, 100);
    setTimeout(() => clearInterval(checkInterval), 10000);
  }
  return null;
}

export function subscribeToPoseResults(callback) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function isMediaPipeWarmedUp() {
  return isWarmedUp;
}
