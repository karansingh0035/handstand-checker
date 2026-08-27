// engine/progression.js

export const SKILL_GRAPH = {
  F1: { id: 'F1', name: 'Dead Hang', category: 'foundation', prereqs: [] },
  F2: { id: 'F2', name: 'Plank', category: 'foundation', prereqs: [] },
  F3: { id: 'F3', name: 'Bodyweight Squat', category: 'foundation', prereqs: [] },
  F4: { id: 'F4', name: 'Incline Push-up', category: 'foundation', prereqs: [] },

  pikepushup: { id: 'pikepushup', name: 'Pike Push-up', category: 'push', prereqs: ['F4'] },
  handstand: { id: 'handstand', name: 'Handstand', category: 'skill', prereqs: ['pikepushup'] },
  handstandpushup: { id: 'handstandpushup', name: 'Handstand Push-up', category: 'push', prereqs: ['handstand', 'pikepushup'] },
  ninetydegreehspu: { id: 'ninetydegreehspu', name: '90 Degree HSPU', category: 'push', prereqs: ['handstandpushup'] },

  planchelean: { id: 'planchelean', name: 'Planche Lean', category: 'push', prereqs: ['F4'] },
  frogstand: { id: 'frogstand', name: 'Frog Stand', category: 'skill', prereqs: ['planchelean'] },
  crowpose: { id: 'crowpose', name: 'Crow Pose', category: 'skill', prereqs: ['frogstand'] },
  elbowlever: { id: 'elbowlever', name: 'Elbow Lever', category: 'skill', prereqs: ['frogstand'] },
  straddleplanche: { id: 'straddleplanche', name: 'Straddle Planche', category: 'skill', prereqs: ['crowpose'] },
  planche: { id: 'planche', name: 'Full Planche', category: 'skill', prereqs: ['straddleplanche'] },

  pullup: { id: 'pullup', name: 'Pull-up', category: 'pull', prereqs: ['F1'] },
  muscleup: { id: 'muscleup', name: 'Muscle-up', category: 'pull', prereqs: ['pullup'] },
  frontlever: { id: 'frontlever', name: 'Front Lever', category: 'pull', prereqs: ['pullup'] },
  backlever: { id: 'backlever', name: 'Back Lever', category: 'pull', prereqs: ['pullup'] },

  lsit: { id: 'lsit', name: 'L-Sit', category: 'core', prereqs: ['F2'] },
  '90degreehold': { id: '90degreehold', name: '90 Degree Hold', category: 'core', prereqs: ['lsit', 'elbowlever'] }
};

const STORAGE_KEY = 'trueform_progression_history';

export class ProgressionManager {
  constructor() {
    this.history = this.loadHistory();
  }

  loadHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch (e) {
      console.error('Failed to persist progression history', e);
    }
  }

  recordSession(skillId, sessionResult) {
    const { medianScore, visibility, hasPain, timestamp = Date.now() } = sessionResult;

    if (!this.history[skillId]) {
      this.history[skillId] = { qualifyingSessions: [], lastPainDate: null, unlocked: false };
    }

    const record = this.history[skillId];

    if (hasPain) {
      record.lastPainDate = timestamp;
      this.saveHistory();
      return { status: 'PAIN_FLAGGED', message: 'Pain reported. Skill regression recommended.' };
    }

    // Enforce 7-day lockout window if pain was reported recently
    if (record.lastPainDate) {
      const daysSincePain = (timestamp - record.lastPainDate) / (1000 * 60 * 60 * 24);
      if (daysSincePain < 7) {
        return { status: 'PAIN_LOCKOUT', message: `Skill locked due to pain within last 7 days (${Math.ceil(7 - daysSincePain)} days remaining).` };
      }
    }

    const meetsQuality = medianScore >= 75;
    const meetsConfidence = visibility >= 0.75;

    if (meetsQuality && meetsConfidence) {
      const lastQualifying = record.qualifyingSessions[record.qualifyingSessions.length - 1];
      const hoursSinceLast = lastQualifying ? (timestamp - lastQualifying) / (1000 * 60 * 60) : Infinity;

      if (hoursSinceLast >= 48) {
        record.qualifyingSessions.push(timestamp);
      }
    }

    if (record.qualifyingSessions.length >= 2) {
      record.unlocked = true;
    }

    this.saveHistory();

    return {
      status: record.unlocked ? 'UNLOCKED' : 'IN_PROGRESS',
      qualifyingCount: record.qualifyingSessions.length,
      unlocked: record.unlocked
    };
  }

  getUnlockedSkills() {
    const unlocked = ['F1', 'F2', 'F3', 'F4'];
    Object.keys(this.history).forEach((id) => {
      if (this.history[id].unlocked) unlocked.push(id);
    });
    return unlocked;
  }
}