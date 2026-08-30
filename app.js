// app.js
import { TrueFormEngine } from './engine/index.js';

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

// Maps resolved skill keys to corresponding TrueFormEngine movement keys.
// Dynamic rep-based exercises trigger live cues; static holds/levers bypass live processing.
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
  "squat": "squat",
};

// 🗂️ SKILL REGISTRY — maps typed skill names to scoring functions.
const SKILL_ANALYZERS = {
  "handstand": { scoreFn: scoreHandstand, label: "Handstand" },
  "pushup": { scoreFn: scorePushup, label: "Push-up" },
  "lsit": { scoreFn: scoreLsit, label: "L-sit" },
  "handstandpushup": { scoreFn: scoreHandstandPushup, label: "Handstand Push-up" },
  "hspu": { scoreFn: scoreHandstandPushup, label: "Handstand Push-ups" },
  "elbowlever": { scoreFn: scoreElbowLever, label: "Elbow Lever" },
  "planche": { scoreFn: scorePlanche, label: "Planche" },
  "frontlever": { scoreFn: scoreFrontLever, label: "Front Lever" },
  "pullup": { scoreFn: scorePullup, label: "Pull-up" },
  "pullups": { scoreFn: scorePullup, label: "Pull-ups" },
  "muscleup": { scoreFn: scoreMuscleUp, label: "Muscle-up" },
  "muscleups": { scoreFn: scoreMuscleUp, label: "Muscle-ups" },
  "backlever": { scoreFn: scoreBackLever, label: "Back Lever" },
  "vsit": { scoreFn: scoreVSit, label: "V-sit" },
  "pikepushup": { scoreFn: scorePikePushup, label: "Pike Push-up" },
  "90degreehold": { scoreFn: score90DegreeHold, label: "90-Degree Hold" },
  "crowpose": { scoreFn: scoreCrowPose, label: "Crow Pose" },
  "frogstand": { scoreFn: scoreFrogStand, label: "Frog Stand" },
  "straddleplanche": { scoreFn: scoreStraddlePlanche, label: "Straddle Planche" },
  "planchelean": { scoreFn: scorePlancheLean, label: "Planche Lean" },
  "90degreehspu": { scoreFn: score90DegreeHSPU, label: "90-Degree HSPU" },
  "pseudoplanchepushup": { scoreFn: scorePseudoPlanchePushup, label: "Pseudo Planche Push-up" },
  "pikepushups": { scoreFn: scorePikePushup, label: "Pike Push-ups" },
  "planchepushup": { scoreFn: scorePlanchePushup, label: "Planche Push-up" },
  "squat": { scoreFn: scoreSquat, label: "Squat" },
  "squats": { scoreFn: scoreSquat, label: "Squats" },
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

// 3️⃣ SKELETON RENDERING OVERLAY + SINGLE-DRIVEN ENGINE INTEGRATION
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
    // Always store raw landmarks for post-hoc scoring function
    landmarkHistory.push(results.poseLandmarks);

    let displayLandmarks = results.poseLandmarks;

    if (isLiveEngineEnabled) {
      // 1. Process frame with live engine
      const frameResult = engine.processFrame(results.poseLandmarks);
      displayLandmarks = frameResult.landmarks;

      // 2. Update live rep counter
      const repDisplay = document.getElementById('rep-count') || document.getElementById('repCount');
      if (repDisplay) {
        repDisplay.innerText = frameResult.repCount;
      }

      // 3. Draw visual coaching cue pill on canvas
      if (frameResult.activeCue) {
        drawCueOverlay(ctx, frameResult.activeCue.cue);
      }
    } else {
      // Bypassed for static holds/levers — clear or hide rep counters
      const repDisplay = document.getElementById('rep-count') || document.getElementById('repCount');
      if (repDisplay) {
        repDisplay.innerText = "--";
      }
    }

    // Render skeleton overlay
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

// 🤸 POST-VIDEO SCORING
async function runFinalFormScoring() {
  if (analysisFinalized) return; 
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

// 4️⃣ VIDEO PROCESSING TICK LOOP
let isFrameInFlight = false;

function scheduleNextFrame() {
  if (processingVideoElement.requestVideoFrameCallback) {
    processingVideoElement.requestVideoFrameCallback(() => startVideoProcessingLoop());
  } else {
    requestAnimationFrame(() => startVideoProcessingLoop());
  }
}

function startVideoProcessingLoop() {
  if (processingVideoElement.ended) {
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

// 5️⃣ SINGLE SOURCE OF TRUTH: DRIVE ENGINE & SCORER FROM ONE INPUT
uploadBtn.addEventListener("click", () => {
  if (!uploadedVideoFile) {
    alert("Please click the '+' button to select a form video first!");
    return;
  }

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

  // Resolve engine support key
  const engineKey = LIVE_ENGINE_SKILL_MAP[activeSkillConfig.key];
  if (engineKey) {
    isLiveEngineEnabled = true;
    engine.setMovement(engineKey);
  } else {
    isLiveEngineEnabled = false;
  }

  landmarkHistory = [];
  analysisFinalized = false;
  formScoreValue.textContent = "--";
  coachingAdvice.textContent = `Analyzing your ${activeSkillConfig.label.toLowerCase()}...`;

  mainTitle.style.display = "none";
  uploadBar.style.display = "none";
  analysisWorkspace.style.display = "flex";

  processingVideoElement = document.createElement("video");
  processingVideoElement.muted = true;
  processingVideoElement.playsInline = true;
  processingVideoElement.loop = false;

  processingVideoElement.onloadeddata = () => {
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

    processingVideoElement.addEventListener("play", () => {
      startVideoProcessingLoop();
    }, { once: true });

    processingVideoElement.addEventListener("ended", runFinalFormScoring, { once: true });

    processingVideoElement.play();
  };

  processingVideoElement.src = URL.createObjectURL(uploadedVideoFile);
});