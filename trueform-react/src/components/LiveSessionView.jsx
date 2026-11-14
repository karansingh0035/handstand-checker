// src/components/LiveSessionView.jsx
import React, { useState } from 'react';
import { getSupportedLiveSkills, SKILLS } from '../utils/skillRegistry.js';
import { PoseCanvas } from './PoseCanvas.jsx';
import { SkillSwitcherModal } from './SkillSwitcherModal.jsx';

function formatSessionClock(ms) {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function LiveSessionView({
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
  startLiveSession,
  stopLiveSession,
  togglePause,
  toggleMute,
  changeSkill
}) {
  const [selectedSkill, setSelectedSkill] = useState(currentSkillKey || 'pushup');
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const supportedSkills = getSupportedLiveSkills();

  const handleGoLive = () => {
    startLiveSession(selectedSkill);
  };

  const handleSkillSwitch = (nextKey) => {
    changeSkill(nextKey);
    setSelectedSkill(nextKey);
    setIsSwitcherOpen(false);
  };

  const skillInfo = SKILLS[currentSkillKey] || { label: currentSkillKey, type: 'rep' };
  const counterText =
    liveStats.type === 'hold'
      ? `${((liveStats.holdTimeMs || 0) / 1000).toFixed(1)}s`
      : liveStats.reps || 0;

  return (
    <section className={`app-section ${isLiveActive ? 'live-session-active' : ''}`} id="section-live">
      {!isLiveActive && (
        <>
          <h2 className="section-heading">Live training</h2>
          <p className="section-sub">
            Pick a skill, go live, and get spoken cues as you work. You can switch skills
            mid-session without restarting the camera.
          </p>
          <div className="skill-chip-row" id="live-skill-chips">
            {supportedSkills.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`skill-chip ${selectedSkill === s.key ? 'is-selected' : ''}`}
                onClick={() => setSelectedSkill(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="upload-bar" style={{ marginTop: '20px' }}>
            <div className="box" id="main-box" style={{ alignItems: 'center' }}>
              <div className="input-row" style={{ width: '100%', justifyContent: 'space-between' }}>
                <input
                  type="text"
                  className="text2"
                  value={SKILLS[selectedSkill]?.label || selectedSkill}
                  readOnly
                  style={{ cursor: 'pointer' }}
                  onClick={() => setIsSwitcherOpen(true)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  id="go-live"
                  aria-label="Start live coaching"
                  onClick={handleGoLive}
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
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 5V3M12 21v-2M5 12H3M21 12h-2" />
                  </svg>
                  <span className="go-live-label">Go Live</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* When live is active, render full-screen PoseCanvas with toolbar & overlays */}
      <div
        className="analysis-workspace"
        id="analysis-workspace"
        style={{ display: isLiveActive ? 'flex' : 'none' }}
      >
        <PoseCanvas
          videoRef={videoRef}
          canvasRef={canvasRef}
          containerRef={containerRef}
          isLive={true}
        >
          {isLiveActive && (
            <>
              <div className="live-toolbar" id="live-toolbar">
                <div className="live-toolbar-left">
                  <span id="session-timer" className="session-timer-badge">
                    {formatSessionClock(sessionElapsedMs)}
                  </span>
                  <span id="current-skill-badge" className="live-skill-badge">
                    {skillInfo.label}
                  </span>
                  <span id="rep-count" className="live-counter-badge">
                    {counterText}
                  </span>
                </div>
                <div className="live-toolbar-right">
                  <button
                    type="button"
                    className="live-tool-btn"
                    id="change-skill-btn"
                    aria-label="Change skill"
                    onClick={() => setIsSwitcherOpen(true)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 7h11" />
                      <path d="M4 17h11" />
                      <path d="M15 7l3-3 3 3" />
                      <path d="M15 17l3 3 3-3" />
                    </svg>
                    <span>Change Skill</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn live-icon-btn"
                    id="pause-live-btn"
                    aria-label={isPaused ? 'Resume live session' : 'Pause live session'}
                    onClick={togglePause}
                  >
                    {isPaused ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-btn live-icon-btn"
                    id="mute-live-btn"
                    aria-label={isMuted ? 'Unmute audio cues' : 'Mute audio cues'}
                    onClick={toggleMute}
                  >
                    {isMuted ? (
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                        <path d="M19 6a9 9 0 0 1 0 12" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    id="stop-live"
                    aria-label="End live session"
                    onClick={stopLiveSession}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                </div>
              </div>

              {isPaused && (
                <div className="pause-overlay" id="pause-overlay">
                  <span>Paused</span>
                </div>
              )}

              {activeCueText && (
                <div
                  className="cue-badge"
                  style={{
                    position: 'absolute',
                    top: '70px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 106,
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
            </>
          )}
        </PoseCanvas>
      </div>

      <SkillSwitcherModal
        isOpen={isSwitcherOpen}
        activeSkillKey={isLiveActive ? currentSkillKey : selectedSkill}
        onSelect={isLiveActive ? handleSkillSwitch : (key) => {
          setSelectedSkill(key);
          setIsSwitcherOpen(false);
        }}
        onClose={() => setIsSwitcherOpen(false)}
      />
    </section>
  );
}
