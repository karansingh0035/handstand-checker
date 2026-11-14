// src/components/HomeSection.jsx
import React from 'react';

export function HomeSection({ onNavigate }) {
  return (
    <section className="app-section" id="section-home">
      <div className="hero">
        <h1 className="hero-title">
          AI Biomechanics &amp;
          <br />
          Form Coaching
        </h1>
        <p className="hero-sub">
          Real-time pose analysis for calisthenics. Get live audio cues while you train,
          or upload a clip for a detailed breakdown of your form.
        </p>
        <div className="hero-actions">
          <button
            type="button"
            className="cta-btn primary"
            onClick={() => onNavigate('live')}
          >
            Start Live Training
          </button>
          <button
            type="button"
            className="cta-btn secondary"
            onClick={() => onNavigate('video')}
          >
            Analyze a Video
          </button>
        </div>
      </div>

      <h2 className="section-heading">Recording best practices</h2>
      <div className="guideline-grid">
        <article className="guideline-card">
          <div className="guideline-icon">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
            </svg>
          </div>
          <h3>Lighting &amp; contrast</h3>
          <p>
            Put your light source in front of you, not behind. Backlit silhouettes
            lose landmark tracking fast.
          </p>
        </article>
        <article className="guideline-card">
          <div className="guideline-icon">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 20h18" />
              <path d="M7 20V9l7-5v16" />
              <path d="M14 20V11l4-3v12" />
            </svg>
          </div>
          <h3>Camera angle</h3>
          <p>
            A clean 90&deg; side profile is what lets the engine measure depth,
            lockout, and body line correctly.
          </p>
        </article>
        <article className="guideline-card">
          <div className="guideline-icon">
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18M15 3v18" />
            </svg>
          </div>
          <h3>Full body in frame</h3>
          <p>
            Head to toes visible through the entire range of motion &mdash; partial
            framing is the top cause of rejected clips.
          </p>
        </article>
      </div>
    </section>
  );
}
