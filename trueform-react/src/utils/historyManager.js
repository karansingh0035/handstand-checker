// src/utils/historyManager.js
const HISTORY_KEY = 'calixai_session_history';
const HISTORY_LIMIT = 100;

export function loadSessionHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Could not read session history:', err);
    return [];
  }
}

export function saveSessionToHistory(ended) {
  if (!ended || !ended.report || typeof window === 'undefined') return;
  try {
    const history = loadSessionHistory();
    history.push({
      date: new Date().toISOString(),
      durationMs: ended.report.durationMs || 0,
      segments: (ended.segments || []).map((seg) => ({
        skill: seg.skill,
        label: seg.label || seg.skill,
        type: seg.type,
        reps: seg.reps || 0,
        bestHoldMs: seg.bestHoldMs || 0,
        performed: seg.validation ? seg.validation.performed : false,
        topFault: seg.faults && seg.faults.length ? seg.faults[0].key : null
      }))
    });
    while (history.length > HISTORY_LIMIT) {
      history.shift();
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('Could not save session history:', err);
  }
}

export function clearSessionHistory() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (err) {
    console.warn('Could not clear session history:', err);
  }
}
