// src/App.jsx
import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.jsx';
import { HomeSection } from './components/HomeSection.jsx';
import { LiveSessionView } from './components/LiveSessionView.jsx';
import { VideoUploadView } from './components/VideoUploadView.jsx';
import { ProgressDashboard } from './components/ProgressDashboard.jsx';
import { SessionReportModal } from './components/SessionReportModal.jsx';
import { usePoseTracker } from './hooks/usePoseTracker.js';

export function App() {
  const [activeSection, setActiveSection] = useState('home');
  const tracker = usePoseTracker();

  // Synchronize body classes and dataset for CSS styling and scroll lock
  useEffect(() => {
    const isLiveFull = tracker.isLiveActive && activeSection === 'live';
    document.body.classList.toggle('live-active', isLiveFull);
    document.body.dataset.section = activeSection;

    return () => {
      document.body.classList.remove('live-active');
    };
  }, [tracker.isLiveActive, activeSection]);

  const handleNavigate = (section) => {
    setActiveSection(section);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {/* Cinematic Background Video Layer */}
      <video id="bg-video" autoPlay loop muted playsInline>
        <source src="/video.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>

      {/* Top Navigation */}
      <Navbar
        activeSection={activeSection}
        onNavigate={handleNavigate}
        isLiveActive={tracker.isLiveActive}
        onEndLiveSession={tracker.stopLiveSession}
      />

      <main className="app-main">
        {activeSection === 'home' && <HomeSection onNavigate={handleNavigate} />}

        {activeSection === 'live' && (
          <LiveSessionView
            videoRef={tracker.videoRef}
            canvasRef={tracker.canvasRef}
            containerRef={tracker.containerRef}
            isLiveActive={tracker.isLiveActive}
            isPaused={tracker.isPaused}
            isMuted={tracker.isMuted}
            currentSkillKey={tracker.currentSkillKey}
            liveStats={tracker.liveStats}
            sessionElapsedMs={tracker.sessionElapsedMs}
            activeCueText={tracker.activeCueText}
            startLiveSession={tracker.startLiveSession}
            stopLiveSession={tracker.stopLiveSession}
            togglePause={tracker.togglePause}
            toggleMute={tracker.toggleMute}
            changeSkill={tracker.changeSkill}
          />
        )}

        {activeSection === 'video' && (
          <VideoUploadView
            videoRef={tracker.videoRef}
            canvasRef={tracker.canvasRef}
            containerRef={tracker.containerRef}
            isAnalyzing={tracker.isAnalyzing}
            formScore={tracker.formScore}
            coachingAdvice={tracker.coachingAdvice}
            analysisFinalized={tracker.analysisFinalized}
            activeCueText={tracker.activeCueText}
            startUploadAnalysis={tracker.startUploadAnalysis}
            resetUpload={tracker.resetUpload}
          />
        )}

        {activeSection === 'progress' && (
          <ProgressDashboard onNavigate={handleNavigate} />
        )}
      </main>

      {/* Session Report Modal */}
      <SessionReportModal
        report={tracker.sessionReport}
        onClose={tracker.closeSessionReport}
      />
    </>
  );
}

export default App;
