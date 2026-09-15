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
  "pseudoplanchepushup": "planchepushup",
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

  ctx.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);

  try {
    ctx.drawImage(imageSource, 0, 0, analysisCanvas.width, analysisCanvas.height);
  } catch (err) {
    return;
  }

  if (results.poseLandmarks) {
    landmarkHistory.push(results.poseLandmarks);
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
          drawCueOverlay(ctx, currentVisualCue);
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
}

function drawCueOverlay(canvasCtx, text) {
  const padding = 16;
  canvasCtx.font = 'bold 20px sans-serif';
  const textWidth = canvasCtx.measureText(text).width;
  
  const x = (analysisCanvas.width - textWidth) / 2;
  const y = 50;

  canvasCtx.fillStyle = 'rgba(255, 90, 31, 0.9)';
  if (canvasCtx.roundRect) {
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

  const scale = Math.min(
    1,
    MAX_CANVAS_WIDTH / nativeWidth,
    MAX_CANVAS_HEIGHT / nativeHeight
  );

  analysisCanvas.width = Math.round(nativeWidth * scale);
  analysisCanvas.height = Math.round(nativeHeight * scale);
  canvasWrapper.style.aspectRatio = `${nativeWidth} / ${nativeHeight}`;

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

  // Resolve against the full SKILL_ANALYZERS / SKILLS list instead of restricting to live-only
  const skillConfig = resolveSkill(skillInput.value);
  
  if (!skillConfig) {
    const supportedList = Object.values(SKILL_ANALYZERS).map((s) => s.label).join(", ");
    alert(
      skillInput.value.trim()
        ? `"${skillInput.value.trim()}" isn't supported yet. Supported skills: ${supportedList}.`
        : `Please type a skill name first. Supported skills: ${supportedList}.`
    );
    return null;
  }

  activeSkillConfig = skillConfig;
  isLiveEngineEnabled = true;

  // Map to the live engine key if available, or default to the base skill key
  const engineKey = LIVE_ENGINE_SKILL_MAP[skillConfig.key] || skillConfig.key;
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

function syncLiveChrome(state = {}) {
  if (!liveToolbar) return;
  const skill = SKILLS[state.currentSkill] || SKILLS[liveSession.currentSkill];
  if (currentSkillBadge && skill) {
    currentSkillBadge.textContent = skill.label;
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

  // Use SKILL_ANALYZERS so all 20+ skills populate into the modal list
  skillSwitcherList.innerHTML = Object.entries(SKILL_ANALYZERS).map(([key, skill]) => {
    const isHold = key.includes("hold") || key.includes("sit") || key.includes("stand") || key.includes("lever") || key.includes("planche") || key.includes("pose");
    const activeKey = liveSession.currentSkill || activeSkillConfig?.key;

    return `
      <label class="skill-option">
        <input type="radio" name="live-skill" value="${key}" ${key === activeKey ? "checked" : ""} />
        <span class="skill-option-copy">
          <strong>${escapeHtml(skill.label || key)}</strong>
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
  const nextConfig = SKILL_ANALYZERS[nextSkillKey];
  if (!nextConfig) {
    alert("Selected skill is not recognized.");
    return;
  }

  // Update movement key for engine
  const engineKey = LIVE_ENGINE_SKILL_MAP[nextSkillKey] || nextSkillKey;
  engine.setMovement(engineKey);

  // Sync state
  liveSession.currentSkill = nextSkillKey;
  activeSkillConfig = resolveSkill(nextSkillKey) || { key: nextSkillKey, label: nextConfig.label };

  if (currentSkillBadge) {
    currentSkillBadge.textContent = nextConfig.label;
  }

  currentVisualCue = null;

  const isHold = nextSkillKey.includes("hold") || nextSkillKey.includes("sit") || nextSkillKey.includes("stand") || nextSkillKey.includes("lever") || nextSkillKey.includes("planche");
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
  const segmentsHtml = (report.segmentSummaries || []).map((segment) => `
    <article class="report-segment">
      <h3>${escapeHtml(segment.skill)}</h3>
      <p>${escapeHtml(segment.primaryStat)}</p>
      <p>Average confidence: ${escapeHtml(segment.confidence)}</p>
      <p>Main issue: ${escapeHtml(segment.mainIssue)}</p>
    </article>
  `).join("");

  const focusHtml = (report.focusItems || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  sessionReportBody.innerHTML = `
    <div class="report-summary">
      <p>Session duration: <strong>${escapeHtml(report.durationText)}</strong></p>
      <p>Skills performed: <strong>${escapeHtml((report.skillsPerformed || []).join(", "))}</strong></p>
    </div>
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
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
  } catch (err) {
    console.error("Camera access failed:", err);
    alert("Couldn't access your camera. Please allow camera permission and try again.");
    return;
  }

  liveStream = stream;

  // 1. Force the current skill property before starting session segments
  liveSession.currentSkill = skillConfig.key;

  // 2. Start the session controller
  try {
    liveSession.start(skillConfig.key);
  } catch (e) {
    console.warn("LiveSessionController fallback intercepted:", e);
  }

  // 3. Guarantee active segment matches current selected skill label
  if (liveSession.activeSegment) {
    liveSession.activeSegment.skillKey = skillConfig.key;
    liveSession.activeSegment.skillLabel = skillConfig.label;
  }

  if (currentSkillBadge) {
    currentSkillBadge.textContent = skillConfig.label;
  }

  setAudioMuted(!liveSession.audioEnabled);
  showLiveChrome();
  startLiveTimer();

  const isHold = skillConfig.key.includes("hold") || skillConfig.key.includes("sit") || skillConfig.key.includes("stand") || skillConfig.key.includes("lever") || skillConfig.key.includes("planche") || skillConfig.key.includes("pose");
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