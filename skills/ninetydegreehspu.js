// 💪 90-DEGREE HANDSTAND PUSH-UP FORM SCORING (OPTIMIZED)
const score90DegreeHSPU = (function () {
  const MIN_CONFIDENT_FRAMES = 15; // Slightly more forgiving frame requirements

  // Relaxed thresholds to account for real-world camera angles and tracking jitter
  const STATE_TOP_ELBOW = 140;    // Arms pushing back toward vertical straightness
  const STATE_BOTTOM_ELBOW = 115; // Arms deeply bent near the bottom horizontal shelf

  return function score90DegreeHSPU(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(f => isSideVisible(f, LEFT_SIDE_LANDMARKS) || isSideVisible(f, RIGHT_SIDE_LANDMARKS));

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "ok",
        score: 0,
        faults: [{
          id: "low_visibility",
          severity: "major",
          detail: "The camera lost sight of your side profile. Ensure your entire body stays inside the video frame from handstand to bottom layout."
        }],
        repCount: 0,
        reps: []
      };
    }

    let reps = [];
    let phase = "top"; 
    let minElbowAngleThisRep = Infinity;
    let bottomTiltThisRep = Infinity;

    for (let i = 0; i < confidentFrames.length; i++) {
      const joints = getEffectiveJoints(confidentFrames[i], videoWidth, videoHeight);
      if (!joints) continue;

      const leftElbow = angleBetween(joints.leftWrist, joints.leftElbow, joints.leftShoulder);
      const rightElbow = angleBetween(joints.rightWrist, joints.rightElbow, joints.rightShoulder);
      const currentElbow = averageValid([leftElbow, rightElbow]);

      const dx = joints.hipMid.x - joints.shoulderMid.x;
      const dy = joints.hipMid.y - joints.shoulderMid.y;
      const currentTilt = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
      const normalizedTilt = Math.min(currentTilt, Math.abs(180 - currentTilt));

      if (currentElbow === null) continue;

      if (phase === "top" && currentElbow < STATE_BOTTOM_ELBOW) {
        phase = "bottom";
        minElbowAngleThisRep = currentElbow;
        bottomTiltThisRep = normalizedTilt;
      } else if (phase === "bottom") {
        minElbowAngleThisRep = Math.min(minElbowAngleThisRep, currentElbow);
        bottomTiltThisRep = Math.min(bottomTiltThisRep, normalizedTilt);

        // Exit criteria: Pushed back up toward vertical plane
        if (currentElbow > STATE_TOP_ELBOW && normalizedTilt > 55) {
          reps.push({
            minElbow: minElbowAngleThisRep,
            bottomTilt: bottomTiltThisRep,
          });
          phase = "top";
          minElbowAngleThisRep = Infinity;
          bottomTiltThisRep = Infinity;
        }
      }
    }

    // 🛠️ THE FIX: Instead of breaking the UI, pass a zero score and fault directly to the AI coach
    if (reps.length === 0) {
      return {
        status: "ok",
        score: 0,
        faults: [{
          id: "no_reps_completed",
          severity: "major",
          detail: "No complete reps detected. To trigger a rep, start in a vertical handstand, lower your body into a horizontal 90° hold, and press all the way back up to a straight vertical lockout."
        }],
        repCount: 0,
        reps: []
      };
    }

    const faults = [];

    // 1️⃣ Check for Shallow Depth
    const shallowReps = reps.filter(r => r.minElbow > 105);
    if (shallowReps.length > 0) {
      faults.push({
        id: "shallow_depth",
        severity: "moderate",
        detail: `${shallowReps.length} rep(s) lacked clean depth. Your elbows must approach a sharp 90° angle at the bottom horizontal transition.`
      });
    }

    // 2️⃣ Check for Poor Transition to Horizontal 
    const badTiltReps = reps.filter(r => r.bottomTilt > 35);
    if (badTiltReps.length > 0) {
      faults.push({
        id: "failed_horizontal_transition",
        severity: "major",
        detail: `${badTiltReps.length} rep(s) didn't flatten out. Your torso and legs must lower completely parallel to the ground at the bottom.`
      });
    }

    let score = 100;
    const severityPenalty = { moderate: 10, major: 20 };
    faults.forEach((f) => { score -= severityPenalty[f.severity] || 0; });
    score = Math.max(0, Math.round(score));

    return {
      status: "ok",
      score,
      faults,
      repCount: reps.length,
      reps: reps.map(r => ({
        minElbow: round1(r.minElbow),
        bottomTilt: round1(r.bottomTilt)
      }))
    };
  };
})();
const validate90DegreeHSPUVideo = (function () {
  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  const VALIDATION_MIN_CONFIDENT_FRAMES = 15;
  const NOT_DETECTED_RATIO = 0.25;
  const UNCLEAR_RATIO = 0.5;

  function isPlausible90DegreeHSPUFrame(joints) {
    if (!joints || !joints.wristMid || !joints.shoulderMid || !joints.hipMid) {
      return false;
    }

    // Inverted or dynamic bent support check (body is either vertical inverted or near horizontal)
    const isHandsBelowShoulders = joints.wristMid.y > joints.shoulderMid.y;
    return isHandsBelowShoulders;
  }

  return function validate90DegreeHSPUVideo(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < VALIDATION_MIN_CONFIDENT_FRAMES) {
      return {
        valid: false,
        status: "unclear",
        confidence: 0,
        message:
          "Not enough tracking frames found. Please record a clear side view showing your transition from handstand to bottom layout.",
      };
    }

    let plausibleCount = 0;
    for (const frame of confidentFrames) {
      const joints = getEffectiveJoints(frame, videoWidth, videoHeight);
      if (isPlausible90DegreeHSPUFrame(joints)) plausibleCount++;
    }

    const ratio = plausibleCount / confidentFrames.length;

    if (ratio < NOT_DETECTED_RATIO) {
      return {
        valid: false,
        status: "not_detected",
        confidence: ratio,
        message:
          "We couldn't verify a 90-degree HSPU in this clip. Ensure you start inverted, bend to 90 degrees at horizontal, and push back up.",
      };
    }

    if (ratio < UNCLEAR_RATIO) {
      return {
        valid: false,
        status: "unclear",
        confidence: ratio,
        message:
          "Tracking was inconsistent. Ensure good lighting and keep your whole body inside the frame from top to bottom.",
      };
    }

    return { valid: true, confidence: ratio };
  };
})();
window.validate90DegreeHSPUVideo = validate90DegreeHSPUVideo;
window.score90DegreeHSPU = score90DegreeHSPU;