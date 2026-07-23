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

// 🎯 Declare ctx globally so all processing functions can use it safely
const ctx = analysisCanvas.getContext("2d");

// Global state tracking variables
let uploadedVideoFile = null;
let poseEngine = null;
let processingVideoElement = null;

// 🤸 SCORING STATE
let landmarkHistory = [];      // All frames' landmarks collected across the whole clip
let analysisFinalized = false; // Guards against scoring more than once per video
let activeSkillConfig = null;  // Which skill's scoring function to run for THIS upload

// 🗂️ SKILL REGISTRY — maps a typed skill name to its scoring function.
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
  "pikepushups": { scoreFn: scorePikePushup, label: "Pike Push-ups" }
};

function resolveSkill(rawInput) {
  if (!rawInput) return null;

  let key = rawInput.trim().toLowerCase()
    .replace(/[\s-_]/g, "")       
    .replace(/°/g, "degree")      
    .replace(/deg$/g, "degree")   
    .replace(/pushups$/g, "pushup") 
    .replace(/pullups$/g, "pullup"); 

  if (SKILL_ANALYZERS[key]) {
    return SKILL_ANALYZERS[key];
  }

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
      return SKILL_ANALYZERS[singularKey];
    }
  }

  return SKILL_ANALYZERS[key] || null;
}

// 2️⃣ INITIALIZE THE MEDIAPIPE POSE INSTANCE (OPTIMIZED FOR SPEED)
function initMediaPipe() {
  if (poseEngine) return; 

  poseEngine = new Pose({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
    }
  });

  poseEngine.setOptions({
    modelComplexity: 0,         // ⚡ Lite model for high FPS & low latency
    smoothLandmarks: true,   
    minDetectionConfidence: 0.5, 
    minTrackingConfidence: 0.5 
  });

  poseEngine.onResults(onPoseResults); 

  // ⚡ Warmup trick: Send a 64x64 canvas to compile WebGL shaders safely
  const dummyCanvas = document.createElement("canvas");
  dummyCanvas.width = 64;
  dummyCanvas.height = 64;
  poseEngine.send({ image: dummyCanvas }).catch(() => {});
}

// Pre-load immediately on page load
document.addEventListener("DOMContentLoaded", () => {
  initMediaPipe();
});

// 3️⃣ SKELETON RENDERING OVERLAY + LANDMARK BUFFERING
function onPoseResults(results) {
  if (!results) return;

  // 🛡️ Prefer MediaPipe's processed frame canvas; fallback to video element if ready
  const imageSource = results.image || (processingVideoElement && processingVideoElement.readyState >= 2 ? processingVideoElement : null);

  // Guard against drawing when no valid image source is available
  if (!imageSource) return;

  ctx.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);

  // Safely draw frame background
  try {
    ctx.drawImage(imageSource, 0, 0, analysisCanvas.width, analysisCanvas.height);
  } catch (err) {
    // Silently skip corrupted or unready frame ticks without breaking the engine
    return;
  }

  // If a body skeleton structure is detected, draw the overlay tracking map
  if (results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
      color: '#FFFFFF',
      lineWidth: 3
    });

    drawLandmarks(ctx, results.poseLandmarks, {
      color: '#FF5A1F',
      lineWidth: 1,
      radius: 4
    });

    landmarkHistory.push(results.poseLandmarks);
  }
}

// 🤸 RUNS THE SKILL-SPECIFIC SCORING FUNCTION ONCE VIDEO ENDS
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

// 🤖 CALLS BACKEND API FOR GEMINI AI ADVICE
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

// 4️⃣ THE VIDEO PROCESSING TICK ENGINE LOOP
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

  // 🛡️ Skip processing tick if video is paused or buffering data
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
    .catch(err => {
      // Suppress temporary frame-drop errors during video playback
    })
    .finally(() => {
      isFrameInFlight = false;
    });

  scheduleNextFrame();
}
// 🛠️ SELECTION & INTERACTION HANDLERS
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

// 5️⃣ TRIGGER DASHBOARD SWITCH AND PROCESSING ON UPLOAD CLICK
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

  landmarkHistory = [];
  analysisFinalized = false;
  formScoreValue.textContent = "--";
  coachingAdvice.textContent = `Analyzing your ${activeSkillConfig.label.toLowerCase()}...`;

  mainTitle.style.display = "none";
  uploadBar.style.display = "none";
  analysisWorkspace.style.display = "flex";

  // Create video element
  processingVideoElement = document.createElement("video");
  processingVideoElement.muted = true;
  processingVideoElement.playsInline = true;
  processingVideoElement.loop = false;

  // 🎯 FIX: Attach event listeners BEFORE setting .src to prevent race conditions
  processingVideoElement.onloadeddata = () => {
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

    processingVideoElement.addEventListener("play", () => {
      startVideoProcessingLoop();
    }, { once: true });

    processingVideoElement.addEventListener("ended", runFinalFormScoring, { once: true });

    processingVideoElement.play();
  };

  processingVideoElement.src = URL.createObjectURL(uploadedVideoFile);
});