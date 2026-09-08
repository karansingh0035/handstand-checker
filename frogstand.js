// 🤸 FROG STAND FORM SCORING
const scoreFrogStand = (function () {
  return function scoreFrogStand(history, videoWidth, videoHeight) {
    if (!history || history.length < 15) {
      return {
        status: "low_confidence",
        message: "Couldn't gather enough tracking frames. Keep your full body visible.",
      };
    }

    // Add your Frog Stand scoring logic here...
    return {
      status: "ok",
      score: 100,
      faults: []
    };
  };
})();
window.scoreFrogStand = scoreFrogStand;

const validateFrogStandVideo = (function () {
  return function validateFrogStandVideo(history, videoWidth, videoHeight) {
    if (!history || history.length < 15) {
      return {
        valid: false,
        message: "Please ensure your full body is visible in the frame for at least 3 seconds.",
      };
    }
    return { valid: true };
  };
})();
window.validateFrogStandVideo = validateFrogStandVideo;