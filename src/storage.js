// Lokale Speicherung (nur im Browser des Nutzers).
const KEY = 'radeln.v1';

const DEFAULTS = {
  profile: { name: 'Fahrer:in', weight: 75, ftp: 200, jersey: '#19c3a6', helmet: '#ffffff' },
  settings: { difficulty: 50, bots: 10, route: 'seeufer', camera: 0 },
  history: [],
  bests: {}, // Segment-Bestzeiten: { [segmentId]: sekunden }
  xp: 0,
  customWorkouts: [],
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const data = load();
export const store = {
  profile: { ...DEFAULTS.profile, ...(data.profile || {}) },
  settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
  history: data.history || [],
  bests: data.bests || {},
  xp: data.xp || 0,
  customWorkouts: data.customWorkouts || [],
  save() {
    try {
      const { profile, settings, history, bests, xp, customWorkouts } = this;
      localStorage.setItem(KEY, JSON.stringify({ profile, settings, history: history.slice(-100), bests, xp, customWorkouts }));
    } catch { /* Speicher nicht verfügbar */ }
  },
};
