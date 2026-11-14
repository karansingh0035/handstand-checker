// src/hooks/usePoseTracker.js
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  TrueFormEngine,
  warmUpSpeech,
  setAudioMuted,
  LiveSessionController,
  SKILLS
} from '../engine/index.js';
import {
  LIVE_ENGINE_SKILL_MAP,
  resolveSkill
} from '../utils/skillRegistry.js';
import { saveSessionToHistory } from '../utils/historyManager.js';
import {
  getMediaPipePose,
  ensureMediaPipeSingleton,
  subscribeToPoseResults
} from '../utils/mediaPipeSingleton.js';

function drawCueOverlay(ctx, text, canvasWidth) {
  const padding = 16;
  ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
  const textWidth = ctx.measureText(text).width;
  const x = Math.max(padding, (canvasWidth - textWidth) / 2);
  const y = 50;

  ctx.fillStyle = 'rgba(255, 90, 31, 0.9)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x - padding, y - 28, textWidth + padding * 2, 40, 8);
    ctx.fill();
  } else {
    ctx.fillRect(x - padding, y - 28, textWidth + padding * 2, 40);
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, x, y);
}

export function usePoseTracker() {
  // DOM element refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Engine & Singleton refs
  const engineRef = useRef(null);
  const liveSessionRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const animationFrameIdRef = useRef(null);
  const visualCueTimerRef = useRef(null);
  const timerIntervalRef = useRef(null);

  // State mirror refs (to keep event callbacks pure and avoid stale closures)
  const isLiveModeRef = useRef(false);
  const isSessionActiveRef = useRef(false);
  const isPausedRef = useRef(false);
  const isMutedRef = useRef(false);
  const currentSkillRef = useRef('pushup');
  const activeSkillConfigRef = useRef(SKILLS.pushup || null);
  const landmarkHistoryRef = useRef([]);
  const isFrameInFlightRef = useRef(false);
  const analysisFinalizedRef = useRef(false);
  const currentVisualCueRef = useRef(null);

  // Throttling refs
  const lastRepsRef = useRef(-1);
  const lastHoldSecondsRef = useRef(-1);

  // React UI States
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSkillKey, setCurrentSkillKey] = useState('pushup');
  const [liveStats, setLiveStats] = useState({ type: 'rep', reps: 0, holdTimeMs: 0 });
  const [sessionElapsedMs, setSessionElapsedMs] = useState(0);
  const [activeCueText, setActiveCueText] = useState(null);
  const [sessionReport, setSessionReport] = useState(null);

  // Upload Analysis UI States
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [formScore, setFormScore] = useState('--');
  const [coachingAdvice, setCoachingAdvice] = useState(
    'Awaiting video upload to run biomechanical analysis...'
  );
  const [analysisFinalized, setAnalysisFinalized] = useState(false);

  // Keep ref mirrors in sync with state
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    currentSkillRef.current = currentSkillKey;
  }, [currentSkillKey]);

  // Sync canvas size with video/wrapper
  const syncCanvasDimensions = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const wrapper = containerRef.current || (canvas ? canvas.parentElement : null);
    if (!canvas) return;

    let width = 0;
    let height = 0;

    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
    }

    if (!width || !height) {
      if (video && video.videoWidth && video.videoHeight) {
        width = video.videoWidth;
        height = video.videoHeight;
      } else {
        width = window.innerWidth || 640;
        height = window.innerHeight || 480;
      }
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.max(1, Math.round(width * dpr));
    const targetH = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
  }, []);

  // Frame schedule tick
  const scheduleNextFrameRef = useRef(null);
  const processFrameTickRef = useRef(null);
  const runFinalFormScoringRef = useRef(null);
  const handlePoseResultsRef = useRef(null);

  const scheduleNextFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isSessionActiveRef.current) return;

    if (video.requestVideoFrameCallback) {
      animationFrameIdRef.current = video.requestVideoFrameCallback(() => {
        animationFrameIdRef.current = null;
        processFrameTickRef.current?.();
      });
    } else {
      animationFrameIdRef.current = requestAnimationFrame(() => {
        animationFrameIdRef.current = null;
        processFrameTickRef.current?.();
      });
    }
  }, []);

  const processFrameTick = useCallback(() => {
    if (!isSessionActiveRef.current) return;
    const video = videoRef.current;
    if (!video) return;

    if (video.ended) {
      isSessionActiveRef.current = false;
      if (!isLiveModeRef.current) {
        runFinalFormScoringRef.current?.();
      }
      return;
    }

    if (video.paused || video.readyState < 2) {
      scheduleNextFrameRef.current?.();
      return;
    }

    if (isFrameInFlightRef.current) {
      scheduleNextFrameRef.current?.();
      return;
    }

    const pose = getMediaPipePose();
    if (pose) {
      isFrameInFlightRef.current = true;
      pose
        .send({ image: video })
        .catch((err) => {
          console.warn('Pose send dropped frame:', err);
        })
        .finally(() => {
          isFrameInFlightRef.current = false;
        });
    }

    scheduleNextFrameRef.current?.();
  }, []);

  // Pose results listener registered ONCE with MediaPipe singleton
  const handlePoseResults = useCallback((results) => {
    if (!results) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;

    // Self-healing: if canvas width or height is 0, sync dimensions immediately
    if (canvas.width === 0 || canvas.height === 0) {
      syncCanvasDimensions();
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageSource =
      results.image || (video && video.readyState >= 2 ? video : null);
    if (!imageSource) return;

    const canvasWidth = canvas.width || 640;
    const canvasHeight = canvas.height || 480;
    if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
    if (canvas.height !== canvasHeight) canvas.height = canvasHeight;

    const sourceWidth = imageSource.videoWidth || imageSource.width || canvasWidth;
    const sourceHeight = imageSource.videoHeight || imageSource.height || canvasHeight;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const isLive = isLiveModeRef.current;
    const fitScale =
      (isLive
        ? Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
        : Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight)) || 1;

    const drawWidth = sourceWidth * fitScale;
    const drawHeight = sourceHeight * fitScale;
    const offsetX = (canvasWidth - drawWidth) / 2;
    const offsetY = (canvasHeight - drawHeight) / 2;
    const letterboxTransform = [
      drawWidth / canvasWidth,
      0,
      0,
      drawHeight / canvasHeight,
      offsetX,
      offsetY
    ];

    ctx.save();

    if (results.poseLandmarks) {
      landmarkHistoryRef.current.push(results.poseLandmarks);
      if (isLive && landmarkHistoryRef.current.length > 1800) {
        landmarkHistoryRef.current.shift();
      }

      let displayLandmarks = results.poseLandmarks;

      // Real-time evaluation through TrueFormEngine (both live and upload if supported)
      if (!isPausedRef.current && engineRef.current) {
        try {
          const frameResult = engineRef.current.processFrame(results.poseLandmarks);
          if (frameResult) {
            displayLandmarks = frameResult.landmarks || displayLandmarks;

            if (isLive && liveSessionRef.current && liveSessionRef.current.isActive) {
              liveSessionRef.current.ingestFrame(frameResult);
            }

            if (isLive) {
              const reps =
                typeof frameResult.reps === 'number'
                  ? frameResult.reps
                  : frameResult.repCount || 0;
              const holdSeconds = Math.floor((frameResult.holdTimeMs || 0) / 100);

              if (
                frameResult.type === 'hold'
                  ? holdSeconds !== lastHoldSecondsRef.current
                  : reps !== lastRepsRef.current
              ) {
                lastRepsRef.current = reps;
                lastHoldSecondsRef.current = holdSeconds;
                setLiveStats({
                  type: frameResult.type,
                  reps: reps,
                  holdTimeMs: frameResult.holdTimeMs || 0
                });
              }
            }

            // Active visual cue display
            if (frameResult.activeCue) {
              const cueText = frameResult.activeCue.cue;
              currentVisualCueRef.current = cueText;
              setActiveCueText(cueText);
              if (visualCueTimerRef.current) {
                clearTimeout(visualCueTimerRef.current);
              }
              visualCueTimerRef.current = setTimeout(() => {
                currentVisualCueRef.current = null;
                setActiveCueText(null);
              }, 2500);
            }
          }
        } catch (engineErr) {
          console.warn('Engine frame processing notice:', engineErr);
        }
      }

      // Draw skeleton transformed to match video positioning
      ctx.setTransform(...letterboxTransform);

      const dc =
        window.drawConnectors ||
        (typeof drawConnectors !== 'undefined' ? drawConnectors : null);
      const pc =
        window.POSE_CONNECTIONS ||
        (typeof POSE_CONNECTIONS !== 'undefined' ? POSE_CONNECTIONS : null);
      const dl =
        window.drawLandmarks ||
        (typeof drawLandmarks !== 'undefined' ? drawLandmarks : null);

      if (dc && pc) {
        dc(ctx, displayLandmarks, pc, {
          color: '#FFFFFF',
          lineWidth: 3
        });
      }
      if (dl) {
        dl(ctx, displayLandmarks, {
          color: '#FF5A1F',
          lineWidth: 1,
          radius: 4
        });
      }

      // Render prominent cue overlay directly on canvas
      if (currentVisualCueRef.current) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawCueOverlay(ctx, currentVisualCueRef.current, canvasWidth);
      }
    }

    ctx.restore();
  }, [syncCanvasDimensions]);

  // Connect to MediaPipe singleton subscriber
  useEffect(() => {
    ensureMediaPipeSingleton();
    const unsubscribe = subscribeToPoseResults((results) => {
      handlePoseResultsRef.current?.(results);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Lazy Engine & LiveSession initialization
  const ensureEngine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new TrueFormEngine();
    }
    if (!liveSessionRef.current) {
      liveSessionRef.current = new LiveSessionController({
        onStateChange: (state = {}) => {
          setIsPaused(Boolean(state.isPaused));
          setIsMuted(!state.audioEnabled);
          if (state.currentSkill) {
            setCurrentSkillKey(state.currentSkill);
          }
        }
      });
    }
  }, []);

  // Upload video scoring & feedback
  const runFinalFormScoring = useCallback(async () => {
    if (analysisFinalizedRef.current) return;
    analysisFinalizedRef.current = true;
    setAnalysisFinalized(true);
    setIsAnalyzing(false);

    const video = videoRef.current;
    const history = landmarkHistoryRef.current;
    const skillConfig = activeSkillConfigRef.current;

    if (!video || !skillConfig) return;

    const videoWidth = video.videoWidth || 640;
    const videoHeight = video.videoHeight || 480;

    if (typeof window.validateVideoQuality === 'function') {
      const quality = window.validateVideoQuality(history);
      if (!quality.valid) {
        setFormScore('--');
        setCoachingAdvice(quality.message);
        return;
      }
    }

    if (skillConfig.validateFn) {
      const skillCheck = skillConfig.validateFn(history, videoWidth, videoHeight);
      if (!skillCheck.valid) {
        setFormScore('--');
        setCoachingAdvice(skillCheck.message);
        return;
      }
    }

    if (skillConfig.scoreFn) {
      const result = skillConfig.scoreFn(history, videoWidth, videoHeight);
      if (result.status !== 'ok') {
        setFormScore('--');
        setCoachingAdvice(result.message);
        return;
      }

      setFormScore(result.score);
      setCoachingAdvice('Getting your coaching feedback...');

      try {
        const response = await fetch('/api/coaching-advice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            score: result.score,
            faults: result.faults,
            skill: skillConfig.label
          })
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();
        setCoachingAdvice(data.advice);
      } catch (err) {
        console.error('Coaching advice error:', err);
        if (result.faults && result.faults.length > 0) {
          setCoachingAdvice(result.faults.map((f) => f.detail).join(' '));
        } else {
          setCoachingAdvice(
            `Solid form! Your ${skillConfig.label.toLowerCase()} looks well aligned.`
          );
        }
      }
    }
  }, []);

  useEffect(() => {
    handlePoseResultsRef.current = handlePoseResults;
    scheduleNextFrameRef.current = scheduleNextFrame;
    processFrameTickRef.current = processFrameTick;
    runFinalFormScoringRef.current = runFinalFormScoring;
  }, [handlePoseResults, scheduleNextFrame, processFrameTick, runFinalFormScoring]);

  // 1 Hz timer for live session
  const startLiveClock = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      if (liveSessionRef.current && liveSessionRef.current.isActive) {
        setSessionElapsedMs(liveSessionRef.current.getElapsedMs());
      }
    }, 1000);
  }, []);

  const stopLiveClock = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Stop camera tracks cleanly
  const stopCameraStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Start live session (User gesture click handler)
  const startLiveSession = useCallback(
    async (skillKey = 'pushup') => {
      warmUpSpeech();
      ensureEngine();
      ensureMediaPipeSingleton();

      const resolvedSkill = SKILLS[skillKey] || SKILLS.pushup;
      activeSkillConfigRef.current = resolvedSkill;
      currentSkillRef.current = resolvedSkill.key;
      setCurrentSkillKey(resolvedSkill.key);

      const engineKey = LIVE_ENGINE_SKILL_MAP[resolvedSkill.key] || resolvedSkill.key;
      engineRef.current.setMovement(engineKey);

      let stream;
      const isPortrait = window.innerHeight >= window.innerWidth;
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: isPortrait ? 720 : 1280 },
              height: { ideal: isPortrait ? 1280 : 720 },
              frameRate: { ideal: 30, min: 20 }
            },
            audio: false
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        }
      } catch (err) {
        console.error('Camera access failed:', err);
        alert("Couldn't access camera. Please allow camera permissions and try again.");
        return;
      }

      mediaStreamRef.current = stream;
      isLiveModeRef.current = true;
      isSessionActiveRef.current = true;
      landmarkHistoryRef.current = [];
      lastRepsRef.current = -1;
      lastHoldSecondsRef.current = -1;

      liveSessionRef.current.start(resolvedSkill.key);
      setAudioMuted(!liveSessionRef.current.audioEnabled);

      setIsLiveActive(true);
      setIsPaused(false);
      setLiveStats({
        type: resolvedSkill.type || 'rep',
        reps: 0,
        holdTimeMs: 0
      });
      setSessionElapsedMs(0);
      startLiveClock();

      const video = videoRef.current;
      if (video) {
        video.muted = true;
        video.playsInline = true;
        video.src = '';
        video.srcObject = stream;
        video.onloadeddata = () => {
          requestAnimationFrame(() => {
            syncCanvasDimensions();
            video
              .play()
              .then(() => {
                scheduleNextFrame();
              })
              .catch(() => {});
          });
        };
      }
    },
    [ensureEngine, startLiveClock, syncCanvasDimensions, scheduleNextFrame]
  );

  // Stop live session
  const stopLiveSession = useCallback(() => {
    isSessionActiveRef.current = false;
    isLiveModeRef.current = false;
    stopLiveClock();
    stopCameraStream();
    setAudioMuted(false);

    if (visualCueTimerRef.current) {
      clearTimeout(visualCueTimerRef.current);
      visualCueTimerRef.current = null;
    }
    currentVisualCueRef.current = null;
    setActiveCueText(null);

    let ended = null;
    if (liveSessionRef.current && liveSessionRef.current.isActive) {
      ended = liveSessionRef.current.end();
    }

    setIsLiveActive(false);

    if (ended && ended.report) {
      saveSessionToHistory(ended);
      setSessionReport(ended.report);
    }

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [stopLiveClock, stopCameraStream]);

  // Pause toggle
  const togglePause = useCallback(() => {
    if (!liveSessionRef.current || !liveSessionRef.current.isActive) return;
    liveSessionRef.current.togglePause();
    const paused = liveSessionRef.current.isPaused;
    setIsPaused(paused);
    isPausedRef.current = paused;

    if (paused) {
      setAudioMuted(true);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } else {
      setAudioMuted(!liveSessionRef.current.audioEnabled);
    }
  }, []);

  // Mute toggle
  const toggleMute = useCallback(() => {
    if (!liveSessionRef.current || !liveSessionRef.current.isActive) return;
    const enabled = liveSessionRef.current.toggleAudio();
    setIsMuted(!enabled);
    setAudioMuted(!enabled);
  }, []);

  // Change skill during live session
  const changeSkill = useCallback((nextSkillKey) => {
    if (!liveSessionRef.current || !liveSessionRef.current.isActive) return;
    const switchResult = liveSessionRef.current.changeSkill(nextSkillKey);
    if (switchResult && switchResult.error) {
      alert(switchResult.error);
      return;
    }

    const engineKey = LIVE_ENGINE_SKILL_MAP[nextSkillKey] || nextSkillKey;
    if (engineRef.current) {
      try {
        engineRef.current.setMovement(engineKey);
      } catch {}
    }

    const skillConfig = SKILLS[nextSkillKey] || {
      key: nextSkillKey,
      label: nextSkillKey,
      type: 'rep'
    };
    activeSkillConfigRef.current = skillConfig;
    currentSkillRef.current = nextSkillKey;
    setCurrentSkillKey(nextSkillKey);

    lastRepsRef.current = 0;
    lastHoldSecondsRef.current = 0;
    setLiveStats({
      type: skillConfig.type || 'rep',
      reps: 0,
      holdTimeMs: 0
    });
    currentVisualCueRef.current = null;
    setActiveCueText(null);
  }, []);

  // Upload video analysis
  const startUploadAnalysis = useCallback(
    (file, skillName) => {
      if (!file) return;

      const skillConfig = resolveSkill(skillName);
      if (!skillConfig) {
        alert(
          skillName?.trim()
            ? `"${skillName.trim()}" isn't supported yet.`
            : 'Please specify the skill name.'
        );
        return;
      }

      ensureEngine();
      const engineKey = LIVE_ENGINE_SKILL_MAP[skillConfig.key] || skillConfig.key;
      if (engineKey && engineRef.current) {
        try {
          engineRef.current.setMovement(engineKey);
        } catch {}
      }

      ensureMediaPipeSingleton();
      activeSkillConfigRef.current = skillConfig;
      isLiveModeRef.current = false;
      isSessionActiveRef.current = true;
      analysisFinalizedRef.current = false;
      landmarkHistoryRef.current = [];
      currentVisualCueRef.current = null;
      setActiveCueText(null);
      setAnalysisFinalized(false);
      setIsAnalyzing(true);
      setFormScore('--');
      setCoachingAdvice(`Analyzing your ${skillConfig.label.toLowerCase()}...`);

      const video = videoRef.current;
      if (video) {
        video.muted = true;
        video.playsInline = true;
        video.loop = false;
        video.srcObject = null;
        video.src = URL.createObjectURL(file);

        // Crucial: Handle video ended directly on the element
        const onVideoEnded = () => {
          isSessionActiveRef.current = false;
          runFinalFormScoringRef.current?.();
        };
        video.addEventListener('ended', onVideoEnded, { once: true });

        video.onloadeddata = () => {
          requestAnimationFrame(() => {
            syncCanvasDimensions();
            video
              .play()
              .then(() => {
                scheduleNextFrame();
              })
              .catch((err) => {
                console.warn('Video playback warning:', err);
              });
          });
        };
      }
    },
    [ensureEngine, scheduleNextFrame, syncCanvasDimensions]
  );

  // Reset upload session
  const resetUpload = useCallback(() => {
    isSessionActiveRef.current = false;
    isLiveModeRef.current = false;
    analysisFinalizedRef.current = false;
    currentVisualCueRef.current = null;
    setActiveCueText(null);
    setAnalysisFinalized(false);
    setIsAnalyzing(false);
    setFormScore('--');
    setCoachingAdvice('Awaiting video upload to run biomechanical analysis...');
    landmarkHistoryRef.current = [];

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.src = '';
      video.srcObject = null;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const closeSessionReport = useCallback(() => {
    setSessionReport(null);
  }, []);

  // Strict cleanup on unmount
  useEffect(() => {
    const handleResize = () => syncCanvasDimensions();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      isSessionActiveRef.current = false;
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      stopCameraStream();
      stopLiveClock();
      if (visualCueTimerRef.current) {
        clearTimeout(visualCueTimerRef.current);
      }
      currentVisualCueRef.current = null;
      // Note: We do NOT call pose.close() here to keep the WebAssembly module warm and ready
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [stopCameraStream, stopLiveClock, syncCanvasDimensions]);

  return {
    videoRef,
    canvasRef,
    containerRef,
    isLiveActive,
    isPaused,
    isMuted,
    currentSkillKey,
    liveStats,
    sessionElapsedMs,
    activeCueText,
    sessionReport,
    isAnalyzing,
    formScore,
    coachingAdvice,
    analysisFinalized,
    syncCanvasDimensions,
    startLiveSession,
    stopLiveSession,
    togglePause,
    toggleMute,
    changeSkill,
    startUploadAnalysis,
    resetUpload,
    closeSessionReport
  };
}
