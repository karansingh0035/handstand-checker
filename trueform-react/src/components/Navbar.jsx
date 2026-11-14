// src/components/Navbar.jsx
import React, { useState } from 'react';

export function Navbar({ activeSection, onNavigate, isLiveActive, onEndLiveSession }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleNavClick = (target) => {
    setIsOpen(false);
    if (target === activeSection) return;

    if (isLiveActive && target !== 'live') {
      const ok = window.confirm(
        'A live session is still running. Leaving this tab will stop the camera and finalize your session report. Continue?'
      );
      if (!ok) return;
      if (onEndLiveSession) {
        onEndLiveSession();
      }
    }
    onNavigate(target);
  };

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand" onClick={() => handleNavClick('home')} style={{ cursor: 'pointer' }}>
          CaliX<span className="accent">Ai</span>
        </div>
        <nav className={`app-nav ${isOpen ? 'is-open' : ''}`} id="app-nav">
          <button
            type="button"
            className={`nav-btn ${activeSection === 'home' ? 'is-active' : ''}`}
            onClick={() => handleNavClick('home')}
          >
            Home
          </button>
          <button
            type="button"
            className={`nav-btn ${activeSection === 'live' ? 'is-active' : ''}`}
            onClick={() => handleNavClick('live')}
          >
            Live Training
          </button>
          <button
            type="button"
            className={`nav-btn ${activeSection === 'video' ? 'is-active' : ''}`}
            onClick={() => handleNavClick('video')}
          >
            Video Analysis
          </button>
          <button
            type="button"
            className={`nav-btn ${activeSection === 'progress' ? 'is-active' : ''}`}
            onClick={() => handleNavClick('progress')}
          >
            Progress
          </button>
        </nav>
        <button
          type="button"
          className="nav-toggle"
          id="nav-toggle"
          aria-label="Toggle navigation"
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
      </div>
    </header>
  );
}
