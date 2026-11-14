// src/components/SessionReportModal.jsx
import React from 'react';

export function SessionReportModal({ report, onClose }) {
  if (!report) return null;

  return (
    <div
      className="modal-backdrop"
      id="session-report-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card report-card"
        role="dialog"
        aria-labelledby="session-report-title"
        aria-modal="true"
      >
        <h2 id="session-report-title">Session report</h2>
        <div id="session-report-body">
          <div className="report-summary">
            <p>
              Session duration: <strong>{report.durationText || '00:00'}</strong>
            </p>
            <p>
              Skills performed:{' '}
              <strong>{(report.skillsPerformed || []).join(', ') || 'None'}</strong>
            </p>
          </div>

          {report.feedbackNotice && (
            <div className="report-notice warning">
              <p>
                <strong>Feedback:</strong> {report.feedbackNotice}
              </p>
            </div>
          )}

          {(report.segmentSummaries || []).map((segment, idx) => {
            const isUnperformed = !segment.performed;
            return (
              <article
                key={idx}
                className={`report-segment ${isUnperformed ? 'segment-warning' : ''}`}
              >
                <div className="segment-header">
                  <h3>{segment.skill}</h3>
                  {isUnperformed ? (
                    <span className="badge unconfirmed-badge">Not Detected</span>
                  ) : (
                    <span className="badge confirmed-badge">Confirmed</span>
                  )}
                </div>
                <p>
                  <strong>{segment.primaryStat}</strong>
                </p>
                <p>Average confidence: {segment.confidence}</p>
                <p className={isUnperformed ? 'warning-text' : ''}>
                  Main issue: {segment.mainIssue}
                </p>
                {segment.feedbackMessage && isUnperformed && (
                  <p className="segment-detail-msg">{segment.feedbackMessage}</p>
                )}
              </article>
            );
          })}

          <h3>Next focus</h3>
          <ul className="report-focus">
            {(report.focusItems || []).map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn primary"
            id="close-session-report"
            onClick={onClose}
          >
            Close &amp; New Workout
          </button>
        </div>
      </div>
    </div>
  );
}
