// src/components/SkillSwitcherModal.jsx
import React, { useState, useEffect } from 'react';
import { getSupportedLiveSkills } from '../utils/skillRegistry.js';

export function SkillSwitcherModal({ isOpen, activeSkillKey, onSelect, onClose }) {
  const [selectedKey, setSelectedKey] = useState(activeSkillKey || 'pushup');
  const [prevActiveKey, setPrevActiveKey] = useState(activeSkillKey);
  const skills = getSupportedLiveSkills();

  if (activeSkillKey !== prevActiveKey) {
    setPrevActiveKey(activeSkillKey);
    setSelectedKey(activeSkillKey);
  }

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selectedKey) {
      onSelect(selectedKey);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      id="skill-switcher-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-labelledby="skill-switcher-title"
        aria-modal="true"
      >
        <h2 id="skill-switcher-title">Change skill</h2>
        <p className="modal-copy">
          Pick the next live skill. Your camera, session timer, and previous segments stay running.
        </p>
        <div className="skill-card-list" id="skill-switcher-list">
          {skills.map((skill) => {
            const isHold = skill.type === 'hold';
            const isChecked = selectedKey === skill.key;
            return (
              <label
                key={skill.key}
                className={`skill-option ${isChecked ? 'selected' : ''}`}
                onDoubleClick={() => onSelect(skill.key)}
              >
                <input
                  type="radio"
                  name="live-skill"
                  value={skill.key}
                  checked={isChecked}
                  onChange={() => setSelectedKey(skill.key)}
                />
                <span className="skill-option-copy">
                  <strong>{skill.label || skill.key}</strong>
                  <span>{isHold ? 'HOLD' : 'REPS'}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn secondary"
            id="cancel-skill-switch"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="modal-btn primary"
            id="confirm-skill-switch"
            onClick={handleConfirm}
          >
            Switch Skill
          </button>
        </div>
      </div>
    </div>
  );
}
