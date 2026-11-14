// src/components/VideoUploadView.jsx
import React, { useState, useRef } from 'react';
import { PoseCanvas } from './PoseCanvas.jsx';

export function VideoUploadView({
  videoRef,
  canvasRef,
  containerRef,
  isAnalyzing,
  formScore,
  coachingAdvice,
  analysisFinalized,
  activeCueText,
  startUploadAnalysis,
  resetUpload
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [skillInput, setSkillInput] = useState('');
  const [videoAspectRatio, setVideoAspectRatio] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.onloadedmetadata = () => {
      if (tempVideo.videoWidth && tempVideo.videoHeight) {
        setVideoAspectRatio(`${tempVideo.videoWidth} / ${tempVideo.videoHeight}`);
      }
    };
    tempVideo.src = url;
  };

  const handleRemovePreview = () => {
    setSelectedFile(null);
    setPreviewUrl('');
    setVideoAspectRatio(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStartAnalysis = () => {
    if (!selectedFile) {
      alert("Please click the '+' button to select a form video first!");
      return;
    }
    if (!skillInput.trim()) {
      alert('Please type a skill name first.');
      return;
    }
    startUploadAnalysis(selectedFile, skillInput);
  };

  const handleNextVideo = () => {
    resetUpload();
    handleRemovePreview();
    setSkillInput('');
  };

  const showWorkspace = isAnalyzing || analysisFinalized;

  return (
    <section className="app-section" id="section-video">
      <h2 className="section-heading">Video analysis</h2>
      <p className="section-sub">
        Upload a clip, name the skill, and get a form score plus AI coaching insights.
      </p>

      <div
        className="upload-bar"
        style={{ display: showWorkspace ? 'none' : 'block', marginTop: '20px' }}
      >
        <div className="box" id="main-box">
          {previewUrl && (
            <div className="preview-container" id="preview-container" style={{ display: 'flex' }}>
              <div className="thumbnail-wrapper">
                <video id="preview-video" src={previewUrl} muted />
                <button
                  type="button"
                  className="remove-btn"
                  id="remove-btn"
                  onClick={handleRemovePreview}
                >
                  &times;
                </button>
              </div>
            </div>
          )}

          <div className="input-row">
            <button
              type="button"
              className="icon-btn"
              id="plus"
              aria-label="Add video"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            <input
              type="text"
              id="skill-input"
              className="text2"
              placeholder="Name of your skill eg. handstand, lsit, etc."
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleStartAnalysis();
              }}
              autoComplete="off"
            />

            <input
              ref={fileInputRef}
              type="file"
              id="hidden-video-input"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            <button
              type="button"
              className="icon-btn"
              id="upload"
              aria-label="Upload and scan"
              onClick={handleStartAnalysis}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div
        className="analysis-workspace"
        id="analysis-workspace"
        style={{ display: showWorkspace ? 'flex' : 'none' }}
      >
          <PoseCanvas
            videoRef={videoRef}
            canvasRef={canvasRef}
            containerRef={containerRef}
            isLive={false}
            aspectRatio={videoAspectRatio}
          >
            {activeCueText && (
              <div
                className="cue-badge"
                style={{
                  position: 'absolute',
                  top: '20px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 10,
                  background: 'rgba(255, 90, 31, 0.9)',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  pointerEvents: 'none'
                }}
              >
                {activeCueText}
              </div>
            )}
          </PoseCanvas>

          <div className="dashboard-row">
            <div className="data-card score-card">
              <span className="card-label">FORM SCORE</span>
              <div className="score-display">
                <span id="form-score-value">{formScore}</span>
                <span className="score-total">/100</span>
              </div>
            </div>

            <div className="data-card advice-card">
              <span className="card-label">AI COACHING INSIGHTS</span>
              <p id="coaching-advice">{coachingAdvice}</p>
            </div>
          </div>

          {analysisFinalized && (
            <button
              type="button"
              className="cta-btn primary next-video-btn"
              id="next-video-btn"
              onClick={handleNextVideo}
            >
              Next Video
            </button>
          )}
        </div>
    </section>
  );
}
