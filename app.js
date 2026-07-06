// 1️⃣ DOM INTERFACE ELEMENTS & TARGET HANDLES
const plusBtn = document.getElementById("plus");
const hiddenVideoInput = document.getElementById("hidden-video-input");
const uploadBtn = document.getElementById("upload");
const skillInput = document.getElementById("skill-input");

const previewContainer = document.querySelector(".preview-container");
const previewVideo = document.getElementById("preview-video");
const removeBtn = document.getElementById("remove-btn");
const mainTitle = document.querySelector(".text");
const uploadBar = document.querySelector(".upload-bar");
const analysisWorkspace = document.getElementById("analysis-workspace");
const analysisCanvas = document.getElementById("analysis-canvas");
const canvasWrapper = document.querySelector(".canvas-wrapper");
const formScoreValue = document.getElementById("form-score-value");
const coachingAdvice = document.getElementById("coaching-advice");

// 🎯 FIX: Declare ctx globally so all processing functions can use it safely
const ctx = analysisCanvas.getContext("2d");

// Global state tracking variables
let uploadedVideoFile = null;
let poseEngine = null;
let processingVideoElement = null;

// 🤸 SCORING STATE
// We buffer landmarks for the ENTIRE video and score it once at the end,
// rather than re-scoring on a rolling window during playback — a form
// rating that changes mid-video looks unfinished, so this gives one
// final, stable result instead.
let landmarkHistory = [];      // All frames' landmarks collected across the whole clip
let analysisFinalized = false; // Guards against scoring more than once per video
let activeSkillConfig = null;  // Which skill's scoring function to run for THIS upload

// 🗂️ SKILL REGISTRY — maps a typed skill name to its scoring function.
// Adding a new skill is just adding another entry here, plus its own
// scoreXyz() function in its own file — nothing else in this flow changes.
const SKILL_ANALYZERS = {
  "handstand": { scoreFn: scoreHandstand, label: "Handstand" },
  "pushup": { scoreFn: scorePushup, label: "Push-up" },
  "lsit": { scoreFn: scoreLsit, label: "L-sit" },
  "handstandpushup": { scoreFn: scoreHandstandPushup, label: "Handstand Push-up" },
  "hspu": { scoreFn: scoreHandstandPushup, label: "Handstand Push-up" },
};

function resolveSkill(rawInput) {
  // Normalize away spaces/hyphens so "push up", "push-up", and "pushup"
  // all match the same registry entry.
  const key = rawInput.trim().toLowerCase().replace(/[\s-]/g, "");
  return SKILL_ANALYZERS[key] || null;
}

// 2️⃣ INITIALIZE THE MEDIAPIPE POSE INSTANCE
function initMediaPipe() {
  poseEngine = new Pose({
    // ✅ Pinning the exact version and passing a structured relative fallback URL
    // fixes the asset loader mapping array so it never reads 'undefined'.
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
    }
  });

  poseEngine.setOptions({
    modelComplexity: 1,      
    smoothLandmarks: true,   
    minDetectionConfidence: 0.5, 
    minTrackingConfidence: 0.5 
  });

  poseEngine.onResults(onPoseResults); 
}
// 3️⃣ SKELETON RENDERING OVERLAY + LANDMARK BUFFERING
function onPoseResults(results) {
  // Clear the previous frame landmarks to keep lines crisp and avoid ghosting trails
  ctx.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
  ctx.drawImage(processingVideoElement, 0, 0, analysisCanvas.width, analysisCanvas.height);

  // If a body skeleton structure is detected, draw the overlay tracking map
  if (results && results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
      color: '#FFFFFF',
      lineWidth: 3
    });

    drawLandmarks(ctx, results.poseLandmarks, {
      color: '#FF5A1F',
      lineWidth: 1,
      radius: 4
    });

    // 🤸 Buffer this frame's landmarks — the whole clip gets scored in one
    // pass once the video ends (see runFinalFormScoring), not per-frame.
    landmarkHistory.push(results.poseLandmarks);
  }
}

// 🤸 RUNS THE SKILL-SPECIFIC SCORING FUNCTION ONCE, AFTER THE WHOLE VIDEO
// HAS BEEN BUFFERED, AND REVEALS THE FINAL RESULT
async function runFinalFormScoring() {
  if (analysisFinalized) return; // Never score the same video twice
  analysisFinalized = true;

  const result = activeSkillConfig.scoreFn(
    landmarkHistory,
    processingVideoElement.videoWidth,
    processingVideoElement.videoHeight
  );

  if (result.status !== "ok") {
    formScoreValue.textContent = "--";
    coachingAdvice.textContent = result.message;
    return;
  }

  // Show the score immediately — it's ready — while advice text loads separately
  formScoreValue.textContent = result.score;
  coachingAdvice.textContent = "Getting your coaching feedback...";

  const adviceText = await fetchCoachingAdvice(result.score, result.faults, activeSkillConfig.label);
  coachingAdvice.textContent = adviceText;
}

// 🤖 CALLS THE BACKEND PROXY (never the Gemini API directly — see
// api/coaching-advice.js for why) TO TURN DETECTED FAULTS INTO COACHING TEXT
async function fetchCoachingAdvice(score, faults, skillLabel) {
  try {
    const response = await fetch("/api/coaching-advice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, faults, skill: skillLabel }),
    });

    if (!response.ok) {
      throw new Error(`Coaching advice request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.advice;
  } catch (err) {
    console.error("Failed to fetch coaching advice:", err);
    // 🛟 Fallback: the app still works and shows something useful even if
    // the AI advice call fails or the backend isn't deployed yet.
    return generatePlaceholderAdvice(faults, skillLabel);
  }
}

// 🤸 TEMPORARY: turns raw faults into readable text until the Gemini advice
// layer replaces this with real AI coaching copy (used as a fallback if
// that call fails for any reason).
function generatePlaceholderAdvice(faults, skillLabel) {
  if (faults.length === 0) {
    return `Solid form! Your ${skillLabel.toLowerCase()} looks well aligned.`;
  }
  return faults.map((f) => f.detail).join(" ");
}

// 4️⃣ THE VIDEO PROCESSING TICK ENGINE LOOP
let isFrameInFlight = false; // 🔒 Guards against overlapping poseEngine.send() calls

function scheduleNextFrame() {
  if (processingVideoElement.requestVideoFrameCallback) {
    processingVideoElement.requestVideoFrameCallback(() => startVideoProcessingLoop());
  } else {
    requestAnimationFrame(() => startVideoProcessingLoop());
  }
}

function startVideoProcessingLoop() {
  if (processingVideoElement.paused || processingVideoElement.ended) {
    // The video has finished playing — this is the one moment we score.
    runFinalFormScoring();
    return;
  }

  // 🎯 Skip this tick entirely if the previous send() (or the initial
  // asset/WASM load it triggers) hasn't resolved yet. Firing send() again
  // before that finishes causes MediaPipe to kick off a second concurrent
  // asset load, which races the first and throws inside its internal loader.
  if (isFrameInFlight) {
    scheduleNextFrame();
    return;
  }

  isFrameInFlight = true;
  poseEngine.send({ image: processingVideoElement })
    .catch(err => console.error("MediaPipe Engine Error:", err))
    .finally(() => {
      isFrameInFlight = false;
    });

  // 🔄 Single Paced Driver Loop
  scheduleNextFrame();
}


// 🛠️ SELECTION & INTERACTION HANDLERS
plusBtn.addEventListener("click", () => {
  hiddenVideoInput.click();
});

// VALIDATION CONFIGURATION SETTINGS
const MAX_FILE_SIZE_MB = 50; 
const MAX_DURATION_SECONDS = 60; 
const MIN_VIDEO_HEIGHT = 240;  // Below this, MediaPipe has too little detail to track reliably
const MAX_VIDEO_DIMENSION = 3840; // Beyond 4K, extra pixels just slow processing with no accuracy gain

hiddenVideoInput.addEventListener("change", (event) => {
  const file = event.target.files[0];

  if (!file) return;

  // 1️⃣ IMMEDIATELY CHECK FILE SIZE
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    alert(`File is too big! Maximum size allowed is ${MAX_FILE_SIZE_MB}MB. Your video is ${fileSizeMB.toFixed(1)}MB.`);
    hiddenVideoInput.value = ""; 
    return;
  }

  // 2️⃣ LOAD VIDEO METADATA TO CHECK DURATION & RESOLUTION
  const tempVideo = document.createElement('video');
  tempVideo.preload = 'metadata';
  tempVideo.src = URL.createObjectURL(file);

  tempVideo.onloadedmetadata = () => {
    URL.revokeObjectURL(tempVideo.src);
    const duration = tempVideo.duration;
    const width = tempVideo.videoWidth;
    const height = tempVideo.videoHeight;

    if (duration > MAX_DURATION_SECONDS) {
      alert(`Video is too long! Maximum duration allowed is ${MAX_DURATION_SECONDS} seconds. Your video is ${duration.toFixed(1)} seconds.`);
      hiddenVideoInput.value = ""; 
      return;
    }

    // 🎯 REJECT: resolution too low for reliable pose tracking
    if (height < MIN_VIDEO_HEIGHT) {
      alert(`Video resolution is too low for accurate form analysis. Minimum height allowed is ${MIN_VIDEO_HEIGHT}p. Your video is ${width}x${height}.`);
      hiddenVideoInput.value = "";
      return;
    }

    // ⚠️ WARN ONLY: very high resolution won't improve accuracy, just processing time
    if (width > MAX_VIDEO_DIMENSION || height > MAX_VIDEO_DIMENSION) {
      console.warn(`Video resolution (${width}x${height}) is higher than needed — MediaPipe downsizes internally, so this just adds processing overhead.`);
    }

    // 🎉 VALIDATION PASSED! Stage the file and show the thumbnail preview
    uploadedVideoFile = file;
    console.log(`Validation Passed! Size: ${fileSizeMB.toFixed(1)}MB, Duration: ${duration.toFixed(1)}s, Resolution: ${width}x${height}`);

    const videoURL = URL.createObjectURL(file);
    previewVideo.src = videoURL;
    previewContainer.style.display = "flex";
  };

  tempVideo.onerror = () => {
    alert("Could not read the video file. Please check if it's corrupted or an unsupported format.");
    hiddenVideoInput.value = "";
  };
});

// ❌ Clear out state when cross button is fired
removeBtn.addEventListener("click", () => {
  uploadedVideoFile = null;
  hiddenVideoInput.value = ""; 
  previewVideo.src = "";
  previewContainer.style.display = "none";
});


// 5️⃣ TRIGGER DASHBOARD SWITCH AND PROCESSING ON UPLOAD CLICK
uploadBtn.addEventListener("click", () => {
  if (!uploadedVideoFile) {
    alert("Please click the '+' button to select a form video first!");
    return;
  }

  // 🎯 Only proceed if the typed skill name actually matches a skill we have
  // a scoring function for. Previously this ran the handstand checker
  // regardless of what (or whether anything) was typed here — now it won't
  // silently misanalyze an unrelated skill as a handstand.
  const skillConfig = resolveSkill(skillInput.value);
  if (!skillConfig) {
    const supportedList = Object.values(SKILL_ANALYZERS).map((s) => s.label).join(", ");
    alert(
      skillInput.value.trim()
        ? `"${skillInput.value.trim()}" isn't supported yet. Currently supported: ${supportedList}.`
        : `Please type the name of your skill first. Currently supported: ${supportedList}.`
    );
    return;
  }
  activeSkillConfig = skillConfig;

  // 🔄 Reset scoring state in case this isn't the user's first upload —
  // otherwise a previous video's buffered landmarks would bleed into this one.
  landmarkHistory = [];
  analysisFinalized = false;
  formScoreValue.textContent = "--";
  coachingAdvice.textContent = `Analyzing your ${activeSkillConfig.label.toLowerCase()}...`;

  // Transition UI states instantly
  mainTitle.style.display = "none";
  uploadBar.style.display = "none";
  analysisWorkspace.style.display = "flex";

  // Create an off-screen background video element to run frame extraction safely
  processingVideoElement = document.createElement("video");
  processingVideoElement.src = URL.createObjectURL(uploadedVideoFile);
  processingVideoElement.muted = true;
  processingVideoElement.playsInline = true;
  // 🎯 Looping is OFF during analysis on purpose: we need the video to
  // actually reach an 'ended' state so we know when to run the one, final
  // scoring pass. (Re-enabling loop for casual replay after scoring is an
  // easy later addition, but isn't needed for the analysis flow itself.)
  processingVideoElement.loop = false;

  // Spin up MediaPipe and trigger playback safely
  processingVideoElement.onloadeddata = () => {
    // 🖼️ Size the canvas to match the video's real aspect ratio instead of a
    // hardcoded 16:9. This is purely a display fix (the scoring math is
    // already aspect-corrected separately in handstand-scoring.js) — without
    // this, a portrait phone video would render visually squished into a
    // widescreen box, even though the underlying scores stay accurate.
    const nativeWidth = processingVideoElement.videoWidth;
    const nativeHeight = processingVideoElement.videoHeight;
    const MAX_CANVAS_WIDTH = 640;
    const scale = Math.min(1, MAX_CANVAS_WIDTH / nativeWidth);
    analysisCanvas.width = Math.round(nativeWidth * scale);
    analysisCanvas.height = Math.round(nativeHeight * scale);
    canvasWrapper.style.aspectRatio = `${nativeWidth} / ${nativeHeight}`;

    if (!poseEngine) {
      initMediaPipe();
    }

    // ✅ Attach the driver ONE single time on playback initialization
    processingVideoElement.addEventListener("play", () => {
      startVideoProcessingLoop();
    }, { once: true }); // Executed strictly once to prevent multi-loop collisions

    // 🎯 Explicit, authoritative trigger for the one final scoring pass —
    // fires exactly once when the video naturally reaches its end.
    processingVideoElement.addEventListener("ended", runFinalFormScoring, { once: true });

    processingVideoElement.play();
  };
});


// 🎨 RENDERING UTILITIES
function setupCanvasWorkspace() {
  analysisCanvas.width = 640;
  analysisCanvas.height = 360;
  ctx.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
}

function updateAnalysisUI(score, adviceText) {
  formScoreValue.textContent = score;
  coachingAdvice.textContent = adviceText;
}