// app.js
import { TrueFormEngine, warmUpSpeech, LiveSessionController, getSupportedLiveSkills, resolveLiveSkill, SKILLS, setAudioMuted } from './engine/index.js';

// 1️⃣ DOM INTERFACE ELEMENTS & TARGET HANDLES
const plusBtn = document.getElementById("plus");
const hiddenVideoInput = document.getElementById("hidden-video-input");
const uploadBtn = document.getElementById("upload");
const skillInput = document.getElementById("skill-input");
const goLiveBtn = document.getElementById("go-live");
const stopLiveBtn = document.getElementById("stop-live");
const liveToolbar = document.getElementById("live-toolbar");
const sessionTimerEl = document.getElementById("session-timer");
const currentSkillBadge = document.getElementById("current-skill-badge");
const pauseLiveBtn = document.getElementById("pause-live-btn");
const muteLiveBtn = document.getElementById("mute-live-btn");
const changeSkillBtn = document.getElementById("change-skill-btn");
const pauseOverlay = document.getElementById("pause-overlay");
const skillSwitcherModal = document.getElementById("skill-switcher-modal");
const skillSwitcherList = document.getElementById("skill-switcher-list");
const cancelSkillSwitchBtn = document.getElementById("cancel-skill-switch");
const confirmSkillSwitchBtn = document.getElementById("confirm-skill-switch");
const sessionReportModal = document.getElementById("session-report-modal");
const sessionReportBody = document.getElementById("session-report-body");
const closeSessionReportBtn = document.getElementById("close-session-report");

const previewContainer = document.querySelector(".preview-container");
const previewVideo = document.getElementById("preview-video");
const removeBtn = document.getElementById("remove-btn");
const mainTitle = document.querySelector(".text");
const uploadBar = document.querySelector(".upload-bar");
const analysisWorkspace = document.getElementById("analysis-workspace");
const analysisCanvas = document.getElementById("analysis-canvas");
const canvasWrapper = document.querySelector(".canvas-wrapper");
const dashboardRow = document.querySelector(".dashboard-row");
const formScoreValue = document.getElementById("form-score-value");
const coachingAdvice = document.getElementById("coaching-advice");

// ⚡ Global Engine Instance & Analysis State
const engine = new TrueFormEngine();
const ctx = analysisCanvas.getContext("2d");

let uploadedVideoFile = null;
let poseEngine = null;
let processingVideoElement = null;

let landmarkHistory = [];      
let analysisFinalized = false; 
let activeSkillConfig = null;  
let isLiveEngineEnabled = false; 
let isLiveSessionMode = false;

let isSessionActive = false;
let liveStream = null;
let liveTimerInterval = null;
let pendingSkillKey = null;
let currentVisualCue = null;
let visualCueTimer = null;

const MAX_LIVE_LANDMARK_HISTORY = 1800; // Bug #5 Fix: Limit memory during long live streams

const liveSession = new LiveSessionController({
  onStateChange: syncLiveChrome
});

// Maps resolved skill keys to corresponding engine movement keys.
const LIVE_ENGINE_SKILL_MAP = {
  "pushup": "pushup",
  "squat": "squat",
  "pullup": "pullup",
  "pullups": "pullup",
  "handstandpushup": "handstandpushup",
  "hspu": "handstandpushup",
  "90degreehspu": "ninetydegreehspu",
  "planchepushup": "planchepushup",
  "pseudoplanchepushup": "pseudoplanchepushup",
  "pikepushup": "pikepushup",
  "muscleup": "muscleup",
  "lsit": "lsit",
  "handstand": "handstand",
  "vsit": "vsit",
  "elbowlever": "elbowlever",
  "planche": "planche",
  "frontlever": "frontlever",
  "backlever": "backlever",
  "90degreehold": "ninetydegreehold",
  "crowpose": "crowpose",
  "frogstand": "frogstand",
  "straddleplanche": "straddleplanche",
  "planchelean": "planchelean"
};

const SKILL_ANALYZERS = {
  "handstand": { validateFn: validateHandstandVideo, scoreFn: scoreHandstand, label: "Handstand" },
  "pushup": { validateFn: validatePushupVideo, scoreFn: scorePushup, label: "Push-up" },
  "lsit": { validateFn: validateLsitVideo, scoreFn: scoreLsit, label: "L-sit" },
  "handstandpushup": { validateFn: validateHandstandPushupVideo, scoreFn: scoreHandstandPushup, label: "Handstand Push-up" },
  "hspu": { validateFn: validateHandstandPushupVideo, scoreFn: scoreHandstandPushup, label: "Handstand Push-ups" },
  "elbowlever": { validateFn: validateElbowLeverVideo, scoreFn: scoreElbowLever, label: "Elbow Lever" },
  "planche": { validateFn: validatePlancheVideo, scoreFn: scorePlanche, label: "Planche" },
  "frontlever": { validateFn: validateFrontLeverVideo, scoreFn: scoreFrontLever, label: "Front Lever" },
  "pullup": { validateFn: validatePullupVideo, scoreFn: scorePullup, label: "Pull-up" },
  "pullups": { validateFn: validatePullupVideo, scoreFn: scorePullup, label: "Pull-ups" },
  "muscleup": { validateFn: validateMuscleUpVideo, scoreFn: scoreMuscleUp, label: "Muscle-up" },
  "muscleups": { validateFn: validateMuscleUpVideo, scoreFn: scoreMuscleUp, label: "Muscle-ups" },
  "backlever": { validateFn: validateBackLeverVideo, scoreFn: scoreBackLever, label: "Back Lever" },
  "vsit": { validateFn: validateVSitVideo, scoreFn: scoreVSit, label: "V-sit" },
  "pikepushup": { validateFn: validatePikePushupVideo, scoreFn: scorePikePushup, label: "Pike Push-up" },
  "90degreehold": { validateFn: validate90DegreeHoldVideo, scoreFn: score90DegreeHold, label: "90-Degree Hold" },
  "crowpose": { validateFn: validateCrowPoseVideo, scoreFn: scoreCrowPose, label: "Crow Pose" },
  "frogstand": { validateFn: validateFrogStandVideo, scoreFn: scoreFrogStand, label: "Frog Stand" },
  "straddleplanche": { validateFn: validateStraddlePlancheVideo, scoreFn: scoreStraddlePlanche, label: "Straddle Planche" },
  "planchelean": { validateFn: validatePlancheLeanVideo, scoreFn: scorePlancheLean, label: "Planche Lean" },
  "90degreehspu": { validateFn: validateHandstandPushupVideo, scoreFn: score90DegreeHSPU, label: "90-Degree HSPU" },
  "pseudoplanchepushup": { validateFn: validatePseudoPlanchePushupVideo, scoreFn: scorePseudoPlanchePushup, label: "Pseudo Planche Push-up" },
  "pikepushups": { validateFn: validatePikePushupVideo, scoreFn: scorePikePushup, label: "Pike Push-ups" },
  "planchepushup": { validateFn: validatePlanchePushupVideo, scoreFn: scorePlanchePushup, label: "Planche Push-up" },
  "squat": { validateFn: validateSquatVideo, scoreFn: scoreSquat, label: "Squat" },
  "squats": { validateFn: validateSquatVideo, scoreFn: scoreSquat, label: "Squats" }
};

function resolveSkill(rawInput) {
  if (!rawInput) return null;

  let key = rawInput.trim().toLowerCase()
    .replace(/[\s-_]/g, "")       
    .replace(/°/g, "degree")      
    .replace(/deg$/g, "degree")   
    .replace(/pushups$/g, "pushup") 
    .replace(/pullups$/g, "pullup"); 

  const aliasMap = {
    "hspus": "hspu",
    "handstandpushups": "handstandpushup",
    "90deghspu": "90degreehspu",
    "90deghspus": "90degreehspu",
    "90degreehspus": "90degreehspu",
    "pppu": "pseudoplanchepushup",
    "pppus": "pseudoplanchepushup",
    "pseudoplanchepushups": "pseudoplanchepushup",
    "pseudopushup": "pseudoplanchepushup",
    "pseudopushups": "pseudoplanchepushup",
    "plancheleans": "planchelean",
    "straddleplanches": "straddleplanche",
    "frogstands": "frogstand",
    "crowposes": "crowpose"
  };

  if (aliasMap[key]) {
    key = aliasMap[key];
  }

  if (!SKILL_ANALYZERS[key] && key.endsWith("s") && key.length > 3) {
    const singularKey = key.slice(0, -1);
    if (SKILL_ANALYZERS[singularKey]) {
      key = singularKey;
    }
  }

  const match = SKILL_ANALYZERS[key];
  return match ? { ...match, key } : null;
}

// 2️⃣ INITIALIZE MEDIAPIPE POSE
function initMediaPipe() {
  if (poseEngine) return; 

  poseEngine = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`
  });

  poseEngine.setOptions({
    modelComplexity: 0,
    smoothLandmarks: true,   
    minDetectionConfidence: 0.5, 
    minTrackingConfidence: 0.5 
  });

  poseEngine.onResults(onPoseResults); 

  const dummyCanvas = document.createElement("canvas");
  dummyCanvas.width = 64;
  dummyCanvas.height = 64;
  poseEngine.send({ image: dummyCanvas }).catch(() => {});
}

document.addEventListener("DOMContentLoaded", () => {
  initMediaPipe();
});

// 3️⃣ SKELETON RENDERING OVERLAY & REAL-TIME INGESTION
function onPoseResults(results) {
  if (!results) return;

  const imageSource = results.image || (processingVideoElement && processingVideoElement.readyState >= 2 ? processingVideoElement : null);
  if (!imageSource) return;

  const canvasWidth = analysisCanvas.width;
  const canvasHeight = analysisCanvas.height;

  // 🆕 FIX: previously this was an unconditional
  // drawImage(imageSource, 0, 0, canvasWidth, canvasHeight) — a hard
  // stretch to fill the canvas regardless of the source's real aspect
  // ratio. That was invisible in upload mode (the canvas bitmap is sized
  // to exactly match the video's native dimensions there, so "stretch"
  // and "fit" happen to be the same thing) but broke live mode once the
  // canvas bitmap stopped being tied to the camera's native resolution
  // (see beginFrameProcessing) — relying on CSS object-fit to fix it
  // after the fact turned out to be inconsistent for canvas specifically,
  // and it also wouldn't have kept the skeleton overlay aligned with the
  // now-repositioned video image anyway. This computes a manual
  // "contain" fit (preserve aspect ratio, center, letterbox) and applies
  // the exact same transform to the skeleton draw calls below, so both
  // land in the same place. In upload mode this scale works out to
  // exactly 1 with a zero offset — identical behavior to before.
  const sourceWidth = imageSource.videoWidth || imageSource.width || canvasWidth;
  const sourceHeight = imageSource.videoHeight || imageSource.height || canvasHeight;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // 🆕 REAL FIX for the short/mostly-black live canvas: this was using
  // Math.min (a "contain" fit) unconditionally. Contain preserves the
  // WHOLE source frame by scaling to fit inside the destination box,
  // letterboxing whichever axis doesn't match — which is correct for
  // upload mode (canvas is sized to the video's own dimensions, so
  // contain/cover are equivalent there), but wrong for live mode: a
  // phone's rear camera very often hands getUserMedia a LANDSCAPE-shaped
  // frame (e.g. 1280x720) regardless of the portrait `ideal` hint
  // requested above — ideal is only ever a hint, hardware/OS can and does
  // ignore it — while canvasWidth/canvasHeight are now correctly tall
  // (portrait, matching the wrapper's CSS box). Containing a landscape
  // source inside a tall portrait box necessarily leaves a large empty
  // gap on whichever axis has room to spare — that's not a bug in the
  // math, it's just what "contain" does when the shapes genuinely differ
  // this much. Every earlier fix attempt (see comments above/below)
  // correctly fixed the CONTAINER's shape but never addressed that the
  // video CONTENT is a different shape than the container, which contain
  // will always letterbox on principle.
  // A live camera view should behave like a normal camera app: fill the
  // box, crop the sides evenly if needed — a "cover" fit (Math.max
  // instead of Math.min). Upload mode keeps "contain" since the canvas
  // there is already sized to exactly match the video's own dimensions
  // (see beginFrameProcessing's else-branch), so cover vs. contain is a
  // no-op there either way — preserving the "identical behavior to
  // before" guarantee the comment below describes for that path.
 // 📱 Live mode me Math.max (Cover fit) use karo taaki koi upar-neeche black bars na aayein
// Screen aur video ka aspect ratio
  const screenRatio = canvasWidth / canvasHeight;
  const sourceRatio = sourceWidth / sourceHeight;

  // Agar stream ulti (landscape) aa rahi hai toh Math.min karo taaki wide view bache, 
  // warna standard cover scale
  let fitScale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  if (Math.abs(screenRatio - sourceRatio) > 0.6) {
    fitScale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  }

  const drawWidth = sourceWidth * fitScale;
  const drawHeight = sourceHeight * fitScale;
  const offsetX = (canvasWidth - drawWidth) / 2;
  const offsetY = (canvasHeight - drawHeight) / 2;
  const letterboxTransform = [drawWidth / canvasWidth, 0, 0, drawHeight / canvasHeight, offsetX, offsetY];

  ctx.save();
  ctx.setTransform(...letterboxTransform);

  try {
    ctx.drawImage(imageSource, 0, 0, canvasWidth, canvasHeight);
  } catch (err) {
    ctx.restore();
    return;
  }

  if (results.poseLandmarks) {
    landmarkHistory.push(results.poseLandmarks);

    // Bug #5 Fix: Prevent memory leak during long live streams
    if (isLiveSessionMode && landmarkHistory.length > MAX_LIVE_LANDMARK_HISTORY) {
      landmarkHistory.shift();
    }

    let displayLandmarks = results.poseLandmarks;

    if (isLiveEngineEnabled) {
      if (liveSession.isActive && liveSession.isPaused) {
        if (pauseOverlay) pauseOverlay.hidden = false;
      } else {
        if (pauseOverlay) pauseOverlay.hidden = true;

        const frameResult = engine.processFrame(results.poseLandmarks);
        displayLandmarks = frameResult.landmarks || displayLandmarks;

        if (liveSession.isActive) {
          liveSession.ingestFrame(frameResult);
        }

        updateLiveCounter(frameResult);

        if (frameResult.activeCue) {
          currentVisualCue = frameResult.activeCue.cue;
          if (visualCueTimer) clearTimeout(visualCueTimer);
          visualCueTimer = setTimeout(() => {
            currentVisualCue = null;
          }, 2500);
        }

        if (currentVisualCue) {
          // 🆕 The cue banner is UI chrome, not part of the video/skeleton
          // — it must stay in real screen-pixel space regardless of the
          // letterbox transform above, or its font size and position
          // would shift with whatever resolution the camera happens to
          // report. Drop to identity just for this draw, then restore the
          // letterbox transform for the skeleton below.
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          drawCueOverlay(ctx, currentVisualCue);
          ctx.setTransform(...letterboxTransform);
        }
      }
    } else {
      const repDisplay = document.getElementById('rep-count') || document.getElementById('repCount');
      if (repDisplay) {
        repDisplay.innerText = "--";
      }
    }

    drawConnectors(ctx, displayLandmarks, POSE_CONNECTIONS, {
      color: '#FFFFFF',
      lineWidth: 3
    });

    drawLandmarks(ctx, displayLandmarks, {
      color: '#FF5A1F',
      lineWidth: 1,
      radius: 4
    });
  }

  ctx.restore();
}

// Bug #9 Fix: Safe roundRect polyfill fallback
function drawCueOverlay(canvasCtx, text) {
  const padding = 16;
  canvasCtx.font = 'bold 20px sans-serif';
  const textWidth = canvasCtx.measureText(text).width;
  
  const x = (analysisCanvas.width - textWidth) / 2;
  const y = 50;

  canvasCtx.fillStyle = 'rgba(255, 90, 31, 0.9)';
  
  if (typeof canvasCtx.roundRect === 'function') {
    canvasCtx.beginPath();
    canvasCtx.roundRect(x - padding, y - 28, textWidth + (padding * 2), 40, 8);
    canvasCtx.fill();
  } else {
    canvasCtx.fillRect(x - padding, y - 28, textWidth + (padding * 2), 40);
  }

  canvasCtx.fillStyle = '#FFFFFF';
  canvasCtx.fillText(text, x, y);
}

// 🤸 UPLOADED VIDEO POST-PROCESSING & SCORING
async function runFinalFormScoring() {
  if (analysisFinalized || isLiveSessionMode) return; 
  analysisFinalized = true;
  if (nextVideoBtn) nextVideoBtn.hidden = false;

  const videoWidth = processingVideoElement.videoWidth;
  const videoHeight = processingVideoElement.videoHeight;

  const quality = validateVideoQuality(landmarkHistory);
  if (!quality.valid) {
    formScoreValue.textContent = "--";
    coachingAdvice.textContent = quality.message;
    return;
  }

  if (activeSkillConfig.validateFn) {
    const skillCheck = activeSkillConfig.validateFn(landmarkHistory, videoWidth, videoHeight);
    if (!skillCheck.valid) {
      formScoreValue.textContent = "--";
      coachingAdvice.textContent = skillCheck.message;
      return;
    }
  }

  const result = activeSkillConfig.scoreFn(landmarkHistory, videoWidth, videoHeight);

  if (result.status !== "ok") {
    formScoreValue.textContent = "--";
    coachingAdvice.textContent = result.message;
    return;
  }

  formScoreValue.textContent = result.score;
  coachingAdvice.textContent = "Getting your coaching feedback...";

  const adviceText = await fetchCoachingAdvice(result.score, result.faults, activeSkillConfig.label);
  coachingAdvice.textContent = adviceText;
}

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
    return generatePlaceholderAdvice(faults, skillLabel);
  }
}

function generatePlaceholderAdvice(faults, skillLabel) {
  if (faults.length === 0) {
    return `Solid form! Your ${skillLabel.toLowerCase()} looks well aligned.`;
  }
  return faults.map((f) => f.detail).join(" ");
}

// 4️⃣ FRAME PROCESSING TICK LOOP
let isFrameInFlight = false;

function scheduleNextFrame() {
  if (processingVideoElement.requestVideoFrameCallback) {
    processingVideoElement.requestVideoFrameCallback(() => startVideoProcessingLoop());
  } else {
    requestAnimationFrame(() => startVideoProcessingLoop());
  }
}

function startVideoProcessingLoop() {
  if (!isSessionActive) return;

  if (processingVideoElement.ended) {
    isSessionActive = false;
    runFinalFormScoring();
    return;
  }

  if (processingVideoElement.paused || processingVideoElement.readyState < 2) {
    scheduleNextFrame();
    return;
  }

  if (isFrameInFlight) {
    scheduleNextFrame();
    return;
  }

  isFrameInFlight = true;
  poseEngine.send({ image: processingVideoElement })
    .catch(() => {})
    .finally(() => {
      isFrameInFlight = false;
    });

  scheduleNextFrame();
}

function beginFrameProcessing() {
  const nativeWidth = processingVideoElement.videoWidth;
  const nativeHeight = processingVideoElement.videoHeight;

  const MAX_CANVAS_WIDTH = 640;
  const MAX_CANVAS_HEIGHT = 640;

if (isLiveSessionMode) {
    // Exact screen pixel match taaki stretch ya blur na ho
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // Mobile performance ke liye 720p aspect ratio match
    const scale = Math.min(1, 720 / screenW);
    analysisCanvas.width = Math.round(screenW * scale);
    analysisCanvas.height = Math.round(screenH * scale);
    canvasWrapper.style.aspectRatio = "";
  } else {
    // Upload mode: lock the box to the video's real aspect ratio, as before.
    const scale = Math.min(1, MAX_CANVAS_WIDTH / nativeWidth, MAX_CANVAS_HEIGHT / nativeHeight);
    analysisCanvas.width = Math.round(nativeWidth * scale);
    analysisCanvas.height = Math.round(nativeHeight * scale);
    canvasWrapper.style.aspectRatio = `${nativeWidth} / ${nativeHeight}`;
  }

  if (!poseEngine) {
    initMediaPipe();
  }

  isSessionActive = true;

  processingVideoElement.addEventListener("play", () => {
    startVideoProcessingLoop();
  }, { once: true });

  processingVideoElement.play();
}

// 🛠️ SELECTION & UPLOAD HANDLERS
plusBtn.addEventListener("click", () => {
  hiddenVideoInput.click();
});

const MAX_FILE_SIZE_MB = 50; 
const MAX_DURATION_SECONDS = 60; 
const MIN_VIDEO_HEIGHT = 240;  
const MAX_VIDEO_DIMENSION = 3840; 

hiddenVideoInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    alert(`File is too big! Maximum size allowed is ${MAX_FILE_SIZE_MB}MB. Your video is ${fileSizeMB.toFixed(1)}MB.`);
    hiddenVideoInput.value = ""; 
    return;
  }

  const tempVideo = document.createElement('video');
  tempVideo.preload = 'metadata';

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

    if (height < MIN_VIDEO_HEIGHT) {
      alert(`Video resolution is too low for accurate form analysis. Minimum height allowed is ${MIN_VIDEO_HEIGHT}p. Your video is ${width}x${height}.`);
      hiddenVideoInput.value = "";
      return;
    }

    if (width > MAX_VIDEO_DIMENSION || height > MAX_VIDEO_DIMENSION) {
      console.warn(`Video resolution (${width}x${height}) is high. MediaPipe will resize internal buffers.`);
    }

    uploadedVideoFile = file;
    const videoURL = URL.createObjectURL(file);
    previewVideo.src = videoURL;
    previewContainer.style.display = "flex";
  };

  tempVideo.onerror = () => {
    alert("Could not read the video file. Please check if it's corrupted or an unsupported format.");
    hiddenVideoInput.value = "";
  };

  tempVideo.src = URL.createObjectURL(file);
});

removeBtn.addEventListener("click", () => {
  uploadedVideoFile = null;
  hiddenVideoInput.value = ""; 
  previewVideo.src = "";
  previewContainer.style.display = "none";
});

function resetSessionVisuals() {
  landmarkHistory = [];
  analysisFinalized = false;
  formScoreValue.textContent = "--";
  currentVisualCue = null;
  if (visualCueTimer) {
    clearTimeout(visualCueTimer);
    visualCueTimer = null;
  }
}

function prepareSession() {
  isLiveSessionMode = false;
  dashboardRow.style.display = "flex";

  const skillConfig = resolveSkill(skillInput.value);
  if (!skillConfig) {
    const supportedList = Object.values(SKILL_ANALYZERS).map((s) => s.label).join(", ");
    alert(
      skillInput.value.trim()
        ? `"${skillInput.value.trim()}" isn't supported yet. Currently supported: ${supportedList}.`
        : `Please type the name of your skill first. Currently supported: ${supportedList}.`
    );
    return null;
  }

  activeSkillConfig = skillConfig;

  const engineKey = LIVE_ENGINE_SKILL_MAP[activeSkillConfig.key];
  if (engineKey) {
    isLiveEngineEnabled = true;
    engine.setMovement(engineKey);
  } else {
    isLiveEngineEnabled = false;
  }

  resetSessionVisuals();
  return skillConfig;
}

function prepareLiveSession() {
  isLiveSessionMode = true;
  dashboardRow.style.display = "none";

  const resolvedKey = resolveLiveSkill(skillInput.value);
  if (!resolvedKey) {
    const supportedList = getSupportedLiveSkills().map((s) => s.label).join(", ");
    alert(
      skillInput.value.trim()
        ? `"${skillInput.value.trim()}" isn't supported for live camera mode yet. Supported live skills: ${supportedList}.`
        : `Please type a skill name first. Supported live skills: ${supportedList}.`
    );
    return null;
  }

  const skillConfig = SKILLS[resolvedKey];
  activeSkillConfig = skillConfig;
  isLiveEngineEnabled = true;

  const engineKey = LIVE_ENGINE_SKILL_MAP[resolvedKey] || resolvedKey;
  engine.setMovement(engineKey);

  resetSessionVisuals();
  return skillConfig;
} 

function formatSessionClock(ms) {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateLiveCounter(frameResult) {
  const repDisplay = document.getElementById("rep-count") || document.getElementById("repCount");
  if (!repDisplay || !frameResult) return;
  if (frameResult.type === "hold") {
    repDisplay.innerText = `${((frameResult.holdTimeMs || 0) / 1000).toFixed(1)}s`;
  } else {
    const reps = typeof frameResult.reps === "number" ? frameResult.reps : frameResult.repCount;
    repDisplay.innerText = reps ?? 0;
  }
}

// Bug #6 Fix: Null guard fallback for skills missing in SKILLS
function syncLiveChrome(state = {}) {
  if (!liveToolbar) return;
  const currentKey = state.currentSkill || liveSession.currentSkill;
  const skill = SKILLS[currentKey] || SKILL_ANALYZERS[currentKey] || activeSkillConfig;
  
  if (currentSkillBadge && skill) {
    currentSkillBadge.textContent = skill.label || currentKey;
  }
  if (sessionTimerEl) {
    sessionTimerEl.textContent = formatSessionClock(liveSession.getElapsedMs());
  }
  if (pauseOverlay) {
    pauseOverlay.hidden = !state.isPaused;
  }
  if (pauseLiveBtn) {
    pauseLiveBtn.setAttribute("aria-label", state.isPaused ? "Resume live session" : "Pause live session");
  }
  if (muteLiveBtn) {
    muteLiveBtn.setAttribute("aria-label", state.audioEnabled ? "Mute audio cues" : "Unmute audio cues");
  }
}

function startLiveTimer() {
  stopLiveTimer();
  liveTimerInterval = setInterval(() => {
    if (sessionTimerEl && liveSession.isActive) {
      sessionTimerEl.textContent = formatSessionClock(liveSession.getElapsedMs());
    }
  }, 250);
}

function stopLiveTimer() {
  if (liveTimerInterval) {
    clearInterval(liveTimerInterval);
    liveTimerInterval = null;
  }
}

function showLiveChrome() {
  if (liveToolbar) liveToolbar.hidden = false;
  if (pauseOverlay) pauseOverlay.hidden = true;
}

function hideLiveChrome() {
  if (liveToolbar) liveToolbar.hidden = true;
  if (pauseOverlay) pauseOverlay.hidden = true;
  stopLiveTimer();
}

function populateSkillSwitcher() {
  if (!skillSwitcherList) return;
  const supported = getSupportedLiveSkills();
  const activeKey = liveSession.currentSkill || activeSkillConfig?.key;

  skillSwitcherList.innerHTML = supported.map((skill) => {
    const isHold = skill.type === "hold";
    return `
      <label class="skill-option">
        <input type="radio" name="live-skill" value="${skill.key}" ${skill.key === activeKey ? "checked" : ""} />
        <span class="skill-option-copy">
          <strong>${escapeHtml(skill.label || skill.key)}</strong>
          <span>${isHold ? "HOLD" : "REPS"}</span>
        </span>
      </label>
    `;
  }).join("");
}

function openSkillSwitcher() {
  pendingSkillKey = liveSession.currentSkill;
  populateSkillSwitcher();
  skillSwitcherModal.hidden = false;
}

function closeSkillSwitcher() {
  skillSwitcherModal.hidden = true;
}

function applySkillSwitch(nextSkillKey) {
  const switchResult = liveSession.changeSkill(nextSkillKey);
  if (switchResult && switchResult.error) {
    alert(switchResult.error);
    return;
  }

  const engineKey = LIVE_ENGINE_SKILL_MAP[nextSkillKey] || nextSkillKey;
  engine.setMovement(engineKey);

  activeSkillConfig = SKILLS[nextSkillKey] || { key: nextSkillKey, label: nextSkillKey, type: "rep" };

  if (currentSkillBadge) {
    currentSkillBadge.textContent = activeSkillConfig.label || nextSkillKey;
  }

  currentVisualCue = null;

  const isHold = activeSkillConfig.type === "hold";
  updateLiveCounter({
    type: isHold ? "hold" : "rep",
    reps: 0,
    holdTimeMs: 0
  });

  closeSkillSwitcher();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSessionReport(report) {
  if (!sessionReportBody || !report) return;

  const noticeHtml = report.feedbackNotice
    ? `
    <div class="report-notice warning">
      <p><strong>Feedback:</strong> ${escapeHtml(report.feedbackNotice)}</p>
    </div>`
    : "";

  const segmentsHtml = (report.segmentSummaries || []).map((segment) => {
    const isUnperformed = !segment.performed;
    return `
    <article class="report-segment ${isUnperformed ? "segment-warning" : ""}">
      <div class="segment-header">
        <h3>${escapeHtml(segment.skill)}</h3>
        ${isUnperformed ? `<span class="badge unconfirmed-badge">Not Detected</span>` : `<span class="badge confirmed-badge">Confirmed</span>`}
      </div>
      <p><strong>${escapeHtml(segment.primaryStat)}</strong></p>
      <p>Average confidence: ${escapeHtml(segment.confidence)}</p>
      <p class="${isUnperformed ? "warning-text" : ""}">Main issue: ${escapeHtml(segment.mainIssue)}</p>
      ${segment.feedbackMessage && isUnperformed ? `<p class="segment-detail-msg">${escapeHtml(segment.feedbackMessage)}</p>` : ""}
    </article>
  `;
  }).join("");

  const focusHtml = (report.focusItems || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  sessionReportBody.innerHTML = `
    <div class="report-summary">
      <p>Session duration: <strong>${escapeHtml(report.durationText)}</strong></p>
      <p>Skills performed: <strong>${escapeHtml((report.skillsPerformed || []).join(", "))}</strong></p>
    </div>
    ${noticeHtml}
    ${segmentsHtml}
    <h3>Next focus</h3>
    <ul class="report-focus">${focusHtml}</ul>
  `;
  sessionReportModal.hidden = false;
}

function resetToHome() {
  sessionReportModal.hidden = true;
  hideLiveChrome();
  analysisWorkspace.style.display = "none";
  mainTitle.style.display = "";
  uploadBar.style.display = "";
  coachingAdvice.textContent = "Awaiting video upload to run biomechanical analysis...";
  formScoreValue.textContent = "--";
  dashboardRow.style.display = "flex";
  isLiveSessionMode = false;
}

// 5️⃣ SINGLE SOURCE OF TRUTH: UPLOADED VIDEO ENGINE ANALYSIS
uploadBtn.addEventListener("click", () => {
  if (!uploadedVideoFile) {
    alert("Please click the '+' button to select a form video first!");
    return;
  }

  const skillConfig = prepareSession();
  if (!skillConfig) return;

  if (nextVideoBtn) nextVideoBtn.hidden = true;
  coachingAdvice.textContent = `Analyzing your ${skillConfig.label.toLowerCase()}...`;

  mainTitle.style.display = "none";
  uploadBar.style.display = "none";
  analysisWorkspace.style.display = "flex";

  processingVideoElement = document.createElement("video");
  processingVideoElement.muted = true;
  processingVideoElement.playsInline = true;
  processingVideoElement.loop = false;

  processingVideoElement.onloadeddata = () => {
    beginFrameProcessing();
    processingVideoElement.addEventListener("ended", runFinalFormScoring, { once: true });
  };

  processingVideoElement.src = URL.createObjectURL(uploadedVideoFile);
});

goLiveBtn.addEventListener("click", async () => {
  warmUpSpeech();

  const skillConfig = prepareLiveSession();
  if (!skillConfig) return;

let stream;
  try {
    const isPortrait = window.innerHeight >= window.innerWidth;
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }, // Front camera by default for workout check
      width: { ideal: isPortrait ? 1080 : 1920, min: 720 },
        height: { ideal: isPortrait ? 1920 : 1080, min: 1280 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });
  } catch (err) {
    console.error("Camera access failed:", err);
    alert("Couldn't access your camera. Please allow camera permission and try again.");
    return;
  }

  liveStream = stream;

  liveSession.start(skillConfig.key);

  if (currentSkillBadge) {
    currentSkillBadge.textContent = skillConfig.label;
  }

  setAudioMuted(!liveSession.audioEnabled);
  showLiveChrome();
  startLiveTimer();

  const isHold = skillConfig.type === "hold";
  updateLiveCounter({
    type: isHold ? "hold" : "rep",
    reps: 0,
    holdTimeMs: 0
  });

  mainTitle.style.display = "none";
  uploadBar.style.display = "none";
  analysisWorkspace.style.display = "flex";

  processingVideoElement = document.createElement("video");
  processingVideoElement.muted = true;
  processingVideoElement.playsInline = true;
  processingVideoElement.srcObject = stream;

  processingVideoElement.onloadeddata = () => {
    beginFrameProcessing();
  };
});

function stopLiveCamera() {
  if (liveStream) {
    liveStream.getTracks().forEach((track) => track.stop());
    liveStream = null;
  }
}

stopLiveBtn.addEventListener("click", () => {
  if (!liveSession.isActive && !isSessionActive) return;

  isSessionActive = false;
  currentVisualCue = null;
  if (visualCueTimer) {
    clearTimeout(visualCueTimer);
    visualCueTimer = null;
  }

  const ended = liveSession.end();
  stopLiveCamera();
  hideLiveChrome();
  setAudioMuted(false);

  if (ended && ended.report) {
    saveSessionToHistory(ended);
    renderSessionReport(ended.report);
  }
});

changeSkillBtn.addEventListener("click", () => {
  if (!liveSession.isActive) return;
  openSkillSwitcher();
});

cancelSkillSwitchBtn.addEventListener("click", () => {
  closeSkillSwitcher();
});

confirmSkillSwitchBtn.addEventListener("click", () => {
  const selected = skillSwitcherList.querySelector('input[name="live-skill"]:checked');
  const nextKey = selected ? selected.value : pendingSkillKey;
  applySkillSwitch(nextKey);
});

skillSwitcherList.addEventListener("change", (event) => {
  if (event.target && event.target.name === "live-skill") {
    pendingSkillKey = event.target.value;
  }
});

pauseLiveBtn.addEventListener("click", () => {
  if (!liveSession.isActive) return;
  liveSession.togglePause();
  if (liveSession.isPaused) {
    setAudioMuted(true);
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } else {
    setAudioMuted(!liveSession.audioEnabled);
  }
});

muteLiveBtn.addEventListener("click", () => {
  const enabled = liveSession.toggleAudio();
  setAudioMuted(!enabled);
});

closeSessionReportBtn.addEventListener("click", () => {
  resetToHome();
});
/* =========================================================================
   6️⃣ MULTI-SECTION SHELL: ROUTER, SKILL CHIPS, PROGRESS DASHBOARD
   Appended for the 4-section redesign. Everything above this block is
   unchanged — this layer only moves the shared workspace between sections
   and adds the Progress view. It deliberately does not touch the analysis
   pipeline, the live session controller, or any existing handler.
   ========================================================================= */

const navEl = document.getElementById("app-nav");
const navToggle = document.getElementById("nav-toggle");
const sharedWorkspace = document.getElementById("shared-workspace");
const liveMount = document.getElementById("live-mount");
const videoMount = document.getElementById("video-mount");
const liveSkillChips = document.getElementById("live-skill-chips");
const progressContent = document.getElementById("progress-content");

/**
 * Moves the shared workspace into the given section's mount point.
 * appendChild MOVES a node rather than copying it, so element identity,
 * IDs, and every previously attached event listener survive the move —
 * which is why none of the earlier app.js wiring needs to change.
 */
function mountWorkspace(target) {
  const mount = target === "live" ? liveMount : target === "video" ? videoMount : null;
  if (!mount) {
    sharedWorkspace.classList.remove("is-mounted");
    return;
  }
  if (sharedWorkspace.parentElement !== mount) {
    mount.appendChild(sharedWorkspace);
  }
  sharedWorkspace.classList.add("is-mounted");
}

function setSection(target) {
  // Guard: never tear the user out of a running live session by accident.
  if (liveSession.isActive && target !== "live") {
    const ok = confirm(
      "A live session is still running. Leaving this tab keeps the camera and timer going — " +
      "use the stop button to end it properly. Continue?"
    );
    if (!ok) return;
  }

  document.body.dataset.section = target;

  navEl.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.target === target);
  });

  navEl.classList.remove("is-open");
  mountWorkspace(target);

  if (target === "progress") {
    renderProgress();
  }

  // The canvas was sized while possibly hidden; re-sync it on reveal.
  // Same live-vs-upload split as beginFrameProcessing: live mode must NOT
  // get locked to the camera's raw (unreliable) aspect ratio here either,
  // or switching back into the Live tab would silently re-break the box.
  if (target === "video" && processingVideoElement) {
    const w = processingVideoElement.videoWidth;
    const h = processingVideoElement.videoHeight;
    if (w && h) {
      canvasWrapper.style.aspectRatio = `${w} / ${h}`;
    }
  } else if (target === "live") {
    canvasWrapper.style.aspectRatio = "";
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

navEl.addEventListener("click", (event) => {
  const btn = event.target.closest(".nav-btn");
  if (btn && btn.dataset.target) setSection(btn.dataset.target);
});

navToggle.addEventListener("click", () => {
  navEl.classList.toggle("is-open");
});

document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => setSection(btn.dataset.goto));
});

/* ---------------- Live section: quick skill chips ---------------------- */

function renderSkillChips() {
  if (!liveSkillChips) return;
  const skills = getSupportedLiveSkills();
  liveSkillChips.innerHTML = skills
    .map(
      (s) =>
        `<button type="button" class="skill-chip" data-skill="${escapeHtml(s.key)}">${escapeHtml(s.label)}</button>`
    )
    .join("");
}

if (liveSkillChips) {
  liveSkillChips.addEventListener("click", (event) => {
    const chip = event.target.closest(".skill-chip");
    if (!chip) return;
    // Chips are a convenience only: they fill the same #skill-input the
    // existing prepareLiveSession()/resolveLiveSkill() path already reads,
    // so there is exactly one source of truth for the selected skill.
    skillInput.value = chip.dataset.skill;
    liveSkillChips.querySelectorAll(".skill-chip").forEach((c) => {
      c.classList.toggle("is-selected", c === chip);
    });
  });
}

/* ---------------- Progress: real local session history ------------------ */

const HISTORY_KEY = "calixai_session_history";
const HISTORY_LIMIT = 100;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Could not read session history:", err);
    return [];
  }
}

function saveSessionToHistory(ended) {
  if (!ended || !ended.report) return;
  try {
    const history = loadHistory();
    history.push({
      date: new Date().toISOString(),
      durationMs: ended.report.durationMs || 0,
      segments: (ended.segments || []).map((seg) => ({
        skill: seg.skill,
        label: seg.label || seg.skill,
        type: seg.type,
        reps: seg.reps || 0,
        bestHoldMs: seg.bestHoldMs || 0,
        performed: seg.validation ? seg.validation.performed : false,
        topFault: seg.faults && seg.faults.length ? seg.faults[0].key : null
      }))
    });
    while (history.length > HISTORY_LIMIT) history.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn("Could not save session history:", err);
  }
}

function renderProgress() {
  if (!progressContent) return;
  const history = loadHistory();

  if (history.length === 0) {
    progressContent.innerHTML = `
      <div class="progress-empty">
        <h3>No sessions recorded yet</h3>
        <p>
          Finish a live training session and your reps, hold times, and most common
          form faults will show up here. History is stored only in this browser.
        </p>
        <button type="button" class="cta-btn primary" data-goto="live">Start Live Training</button>
      </div>`;
    progressContent.querySelectorAll("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => setSection(btn.dataset.goto));
    });
    return;
  }

  // Aggregate only segments the engine actually confirmed were performed,
  // so unverified/"not detected" attempts never inflate these numbers.
  let totalMs = 0;
  let totalReps = 0;
  let totalHoldMs = 0;
  const bySkill = new Map();

  history.forEach((session) => {
    totalMs += session.durationMs || 0;
    (session.segments || []).forEach((seg) => {
      if (!seg.performed) return;
      totalReps += seg.reps || 0;
      totalHoldMs += seg.bestHoldMs || 0;

      const entry = bySkill.get(seg.skill) || {
        label: seg.label,
        type: seg.type,
        sessions: 0,
        bestReps: 0,
        bestHoldMs: 0,
        faults: new Map()
      };
      entry.sessions++;
      entry.bestReps = Math.max(entry.bestReps, seg.reps || 0);
      entry.bestHoldMs = Math.max(entry.bestHoldMs, seg.bestHoldMs || 0);
      if (seg.topFault) {
        entry.faults.set(seg.topFault, (entry.faults.get(seg.topFault) || 0) + 1);
      }
      bySkill.set(seg.skill, entry);
    });
  });

  const hours = (totalMs / 3600000).toFixed(1);
  const holdSeconds = Math.round(totalHoldMs / 1000);

  const metricsHtml = `
    <div class="metric-banner">
      <div class="metric-tile">
        <div class="metric-value">${history.length}</div>
        <span class="metric-label">Sessions</span>
      </div>
      <div class="metric-tile">
        <div class="metric-value">${hours}h</div>
        <span class="metric-label">Training time</span>
      </div>
      <div class="metric-tile">
        <div class="metric-value">${totalReps}</div>
        <span class="metric-label">Total reps</span>
      </div>
      <div class="metric-tile">
        <div class="metric-value">${holdSeconds}s</div>
        <span class="metric-label">Total hold time</span>
      </div>
    </div>`;

  const masteryHtml = bySkill.size
    ? `<h3 class="section-heading" style="font-size:1.15rem;margin-top:8px;">Skill breakdown</h3>
       <div class="mastery-grid">
         ${Array.from(bySkill.entries())
           .map(([key, entry]) => {
             const best =
               entry.type === "hold"
                 ? `${(entry.bestHoldMs / 1000).toFixed(1)}s`
                 : `${entry.bestReps} reps`;
             const topFault = Array.from(entry.faults.entries()).sort((a, b) => b[1] - a[1])[0];
             const faultHtml = topFault
               ? `<div class="mastery-fault">Most common fault: ${escapeHtml(topFault[0].replace(/_/g, " "))} (${topFault[1]}&times;)</div>`
               : "";
             return `
               <article class="mastery-card">
                 <div class="mastery-head">
                   <h4>${escapeHtml(entry.label)}</h4>
                   <span class="mastery-best">${best}</span>
                 </div>
                 <div class="mastery-meta">${entry.sessions} session${entry.sessions === 1 ? "" : "s"} &middot; personal best</div>
                 ${faultHtml}
               </article>`;
           })
           .join("")}
       </div>`
    : "";

  const recent = history.slice(-8).reverse();
  const sessionsHtml = `
    <h3 class="section-heading" style="font-size:1.15rem;margin-top:8px;">Recent sessions</h3>
    <div class="session-list">
      ${recent
        .map((s) => {
          const skills = (s.segments || [])
            .filter((seg) => seg.performed)
            .map((seg) => seg.label);
          const label = skills.length ? skills.join(", ") : "No skills confirmed";
          const mins = Math.round((s.durationMs || 0) / 60000);
          return `
            <div class="session-row">
              <span class="session-date">${new Date(s.date).toLocaleDateString()}</span>
              <span class="session-skills">${escapeHtml(label)}</span>
              <span>${mins}m</span>
            </div>`;
        })
        .join("")}
    </div>
    <div class="progress-actions">
      <button type="button" class="text-btn" id="clear-history-btn">Clear history</button>
    </div>`;

  progressContent.innerHTML = metricsHtml + masteryHtml + sessionsHtml;

  const clearBtn = document.getElementById("clear-history-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (confirm("Delete all locally stored session history? This cannot be undone.")) {
        localStorage.removeItem(HISTORY_KEY);
        renderProgress();
      }
    });
  }
}

/* ---------------- Boot ------------------------------------------------- */

renderSkillChips();
setSection("home");

/* -------------- Live-session chrome: full-stage canvas ------------------
   When a live session is running we hide the section heading, blurb, and
   skill chips so the canvas sits at the top of the viewport instead of
   being pushed below a screenful of controls.

   This watches the live toolbar's `hidden` attribute rather than hooking
   the go-live / stop-live handlers directly: the toolbar is the single
   thing that is shown exactly while a session is live, and observing it
   means this stays correct for every path that can end a session (stop
   button, camera failure, report close) without duplicating that logic. */
if (liveToolbar) {
  const syncLiveChrome = () => {
    const isLive = !liveToolbar.hidden;
    document.body.classList.toggle("live-active", isLive);
    if (isLive) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  new MutationObserver(syncLiveChrome).observe(liveToolbar, {
    attributes: true,
    attributeFilter: ["hidden"]
  });

  syncLiveChrome();
}

/* -------------- Next Video: reset the upload UI without a reload -------- */

const nextVideoBtn = document.getElementById("next-video-btn");

if (nextVideoBtn) {
  nextVideoBtn.addEventListener("click", () => {
    nextVideoBtn.hidden = true;

    // Mirror the state uploadBtn's handler expects to start fresh from,
    // without touching anything live-session related.
    uploadedVideoFile = null;
    hiddenVideoInput.value = "";
    previewVideo.src = "";
    previewContainer.style.display = "none";
    skillInput.value = "";

    analysisWorkspace.style.display = "none";
    uploadBar.style.display = "";

    formScoreValue.textContent = "--";
    coachingAdvice.textContent = "Awaiting video upload to run biomechanical analysis...";

    landmarkHistory = [];
    analysisFinalized = false;
  });
}