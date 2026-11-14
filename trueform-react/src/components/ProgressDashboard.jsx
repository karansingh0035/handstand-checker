// src/components/ProgressDashboard.jsx
import React, { useState } from 'react';
import { loadSessionHistory, clearSessionHistory } from '../utils/historyManager.js';

export function ProgressDashboard({ onNavigate }) {
  const [history, setHistory] = useState(() => loadSessionHistory());

  const refreshHistory = () => {
    setHistory(loadSessionHistory());
  };

  const handleClearHistory = () => {
    if (window.confirm('Delete all locally stored session history? This cannot be undone.')) {
      clearSessionHistory();
      refreshHistory();
    }
  };

  if (history.length === 0) {
    return (
      <section className="app-section" id="section-progress">
        <h2 className="section-heading">Progress</h2>
        <p className="section-sub">
          Built from live sessions you have completed on this device. Nothing is uploaded anywhere.
        </p>
        <div id="progress-content">
          <div className="progress-empty">
            <h3>No sessions recorded yet</h3>
            <p>
              Finish a live training session and your reps, hold times, and most common
              form faults will show up here. History is stored only in this browser.
            </p>
            <button
              type="button"
              className="cta-btn primary"
              onClick={() => onNavigate('live')}
            >
              Start Live Training
            </button>
          </div>
        </div>
      </section>
    );
  }

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
        label: seg.label || seg.skill,
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
  const recent = history.slice(-8).reverse();

  return (
    <section className="app-section" id="section-progress">
      <h2 className="section-heading">Progress</h2>
      <p className="section-sub">
        Built from live sessions you have completed on this device. Nothing is uploaded anywhere.
      </p>
      <div id="progress-content">
        <div className="metric-banner">
          <div className="metric-tile">
            <div className="metric-value">{history.length}</div>
            <span className="metric-label">Sessions</span>
          </div>
          <div className="metric-tile">
            <div className="metric-value">{hours}h</div>
            <span className="metric-label">Training time</span>
          </div>
          <div className="metric-tile">
            <div className="metric-value">{totalReps}</div>
            <span className="metric-label">Total reps</span>
          </div>
          <div className="metric-tile">
            <div className="metric-value">{holdSeconds}s</div>
            <span className="metric-label">Total hold time</span>
          </div>
        </div>

        {bySkill.size > 0 && (
          <>
            <h3 className="section-heading" style={{ fontSize: '1.15rem', marginTop: '16px' }}>
              Skill breakdown
            </h3>
            <div className="mastery-grid">
              {Array.from(bySkill.entries()).map(([key, entry]) => {
                const best =
                  entry.type === 'hold'
                    ? `${(entry.bestHoldMs / 1000).toFixed(1)}s`
                    : `${entry.bestReps} reps`;
                const topFault = Array.from(entry.faults.entries()).sort(
                  (a, b) => b[1] - a[1]
                )[0];
                return (
                  <article key={key} className="mastery-card">
                    <div className="mastery-head">
                      <h4>{entry.label}</h4>
                      <span className="mastery-best">{best}</span>
                    </div>
                    <div className="mastery-meta">
                      {entry.sessions} session{entry.sessions === 1 ? '' : 's'} &middot; personal best
                    </div>
                    {topFault && (
                      <div className="mastery-fault">
                        Most common fault: {topFault[0].replace(/_/g, ' ')} ({topFault[1]}&times;)
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}

        <h3 className="section-heading" style={{ fontSize: '1.15rem', marginTop: '16px' }}>
          Recent sessions
        </h3>
        <div className="session-list">
          {recent.map((s, idx) => {
            const skills = (s.segments || [])
              .filter((seg) => seg.performed)
              .map((seg) => seg.label);
            const label = skills.length ? skills.join(', ') : 'No skills confirmed';
            const mins = Math.round((s.durationMs || 0) / 60000);
            return (
              <div key={idx} className="session-row">
                <span className="session-date">{new Date(s.date).toLocaleDateString()}</span>
                <span className="session-skills">{label}</span>
                <span>{mins}m</span>
              </div>
            );
          })}
        </div>

        <div className="progress-actions">
          <button
            type="button"
            className="text-btn"
            id="clear-history-btn"
            onClick={handleClearHistory}
          >
            Clear history
          </button>
        </div>
      </div>
    </section>
  );
}
