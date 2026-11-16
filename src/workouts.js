// Strukturierte Trainings. Leistungsangaben sind Anteile der FTP (1.0 = 100 %).

export const PRESETS = [
  {
    id: 'grundlage45',
    name: 'Grundlage 45',
    desc: 'Lockere Ausdauereinheit im aeroben Bereich.',
    segments: [
      { type: 'ramp', dur: 600, from: 0.45, to: 0.65 },
      { type: 'steady', dur: 1800, power: 0.68 },
      { type: 'ramp', dur: 300, from: 0.6, to: 0.45 },
    ],
  },
  {
    id: 'sweetspot3x10',
    name: 'Sweetspot 3 × 10',
    desc: 'Drei Blöcke knapp unter der Schwelle – viel Wirkung pro Minute.',
    segments: [
      { type: 'ramp', dur: 600, from: 0.5, to: 0.75 },
      { type: 'intervals', repeat: 3, onDur: 600, onPower: 0.9, offDur: 300, offPower: 0.55 },
      { type: 'ramp', dur: 300, from: 0.6, to: 0.45 },
    ],
  },
  {
    id: 'schwelle2x20',
    name: 'Schwelle 2 × 20',
    desc: 'Der Klassiker zur Verbesserung der FTP.',
    segments: [
      { type: 'ramp', dur: 720, from: 0.5, to: 0.8 },
      { type: 'intervals', repeat: 2, onDur: 1200, onPower: 0.97, offDur: 360, offPower: 0.55 },
      { type: 'ramp', dur: 360, from: 0.6, to: 0.45 },
    ],
  },
  {
    id: 'vo2-5x3',
    name: 'VO2max 5 × 3',
    desc: 'Harte Intervalle für die maximale Sauerstoffaufnahme.',
    segments: [
      { type: 'ramp', dur: 600, from: 0.5, to: 0.75 },
      { type: 'steady', dur: 120, power: 0.55 },
      { type: 'intervals', repeat: 5, onDur: 180, onPower: 1.15, offDur: 180, offPower: 0.5 },
      { type: 'ramp', dur: 420, from: 0.6, to: 0.45 },
    ],
  },
  {
    id: 'pyramide',
    name: 'Sprint-Pyramide',
    desc: 'Kurze Spitzen mit steigender und fallender Dauer.',
    segments: [
      { type: 'ramp', dur: 600, from: 0.5, to: 0.72 },
      { type: 'steady', dur: 15, power: 1.6 }, { type: 'steady', dur: 120, power: 0.55 },
      { type: 'steady', dur: 30, power: 1.45 }, { type: 'steady', dur: 150, power: 0.55 },
      { type: 'steady', dur: 45, power: 1.35 }, { type: 'steady', dur: 180, power: 0.55 },
      { type: 'steady', dur: 30, power: 1.45 }, { type: 'steady', dur: 150, power: 0.55 },
      { type: 'steady', dur: 15, power: 1.6 }, { type: 'steady', dur: 120, power: 0.55 },
      { type: 'ramp', dur: 480, from: 0.6, to: 0.45 },
    ],
  },
  {
    id: 'rampentest',
    name: 'Rampentest (FTP bestimmen)',
    desc: 'Jede Minute steigt die Leistung um 6 % FTP. Fahre bis zur Erschöpfung, dann „Beenden“. FTP ≈ 75 % der besten 1-Minuten-Leistung.',
    test: 'ramp',
    segments: [
      { type: 'steady', dur: 300, power: 0.45 },
      ...Array.from({ length: 22 }, (_, i) => ({ type: 'steady', dur: 60, power: +(0.5 + i * 0.06).toFixed(2) })),
      { type: 'steady', dur: 300, power: 0.4 },
    ],
  },
];

/** Segmente in eine flache Liste von Blöcken mit Startzeit auflösen. */
export function expand(workout) {
  const blocks = [];
  let t = 0;
  const push = (dur, from, to, kind) => {
    if (dur <= 0) return;
    blocks.push({ start: t, dur, from, to, kind });
    t += dur;
  };
  for (const s of workout.segments) {
    if (s.type === 'steady') push(s.dur, s.power, s.power, 'steady');
    else if (s.type === 'ramp') push(s.dur, s.from, s.to, 'ramp');
    else if (s.type === 'free') push(s.dur, null, null, 'free');
    else if (s.type === 'intervals') {
      for (let i = 0; i < s.repeat; i++) {
        push(s.onDur, s.onPower, s.onPower, 'on');
        push(s.offDur, s.offPower, s.offPower, 'off');
      }
    }
  }
  return blocks;
}

export function totalDuration(workout) {
  const b = expand(workout);
  return b.length ? b[b.length - 1].start + b[b.length - 1].dur : 0;
}

/** Zielwert zum Zeitpunkt t. */
export function targetAt(blocks, t) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (t < b.start + b.dur) {
      const p = (t - b.start) / b.dur;
      const frac = b.from === null ? null : b.from + (b.to - b.from) * p;
      return { index: i, block: b, fraction: frac, remaining: b.start + b.dur - t, next: blocks[i + 1] || null };
    }
  }
  return null; // fertig
}

// ---------------------------------------------------------------------------
// Import: offenes XML-Workoutformat (.zwo) – nur Interoperabilität mit eigenen
// Dateien des Nutzers; Struktur wird in das interne Format übersetzt.
export function parseZWO(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Datei konnte nicht gelesen werden.');
  const name = doc.querySelector('name')?.textContent?.trim() || 'Importiertes Training';
  const desc = doc.querySelector('description')?.textContent?.trim() || '';
  const root = doc.querySelector('workout');
  if (!root) throw new Error('Kein <workout>-Element gefunden.');
  const num = (el, a, d = 0) => {
    const v = parseFloat(el.getAttribute(a));
    return Number.isFinite(v) ? v : d;
  };
  const segments = [];
  for (const el of root.children) {
    const tag = el.tagName.toLowerCase();
    const dur = num(el, 'Duration');
    if (tag === 'steadystate') segments.push({ type: 'steady', dur, power: num(el, 'Power', 0.6) });
    else if (tag === 'warmup' || tag === 'cooldown' || tag === 'ramp')
      segments.push({ type: 'ramp', dur, from: num(el, 'PowerLow', 0.5), to: num(el, 'PowerHigh', 0.7) });
    else if (tag === 'intervalst')
      segments.push({
        type: 'intervals', repeat: Math.max(1, Math.round(num(el, 'Repeat', 1))),
        onDur: num(el, 'OnDuration'), onPower: num(el, 'OnPower', 1),
        offDur: num(el, 'OffDuration'), offPower: num(el, 'OffPower', 0.5),
      });
    else if (tag === 'freeride') segments.push({ type: 'free', dur });
  }
  if (!segments.length) throw new Error('Keine Trainingsblöcke gefunden.');
  return { id: `import-${Date.now()}`, name, desc, segments, custom: true };
}

// ---------------------------------------------------------------------------
// Eigene Kurzschreibweise für den Trainings-Baukasten, z. B.
//   "10m 50-75%, 3x(5m 105%, 3m 55%), 10m 60%, 5m frei"
function parseDuration(tok) {
  const m = /^(\d+(?:[.,]\d+)?)\s*(h|min|m|s)$/i.exec(tok.trim());
  if (!m) throw new Error(`Ungültige Dauer: „${tok}“`);
  const v = parseFloat(m[1].replace(',', '.'));
  const u = m[2].toLowerCase();
  return Math.round(u === 'h' ? v * 3600 : u === 's' ? v : v * 60);
}

function splitTop(str) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseItems(str) {
  const segs = [];
  for (const item of splitTop(str)) {
    const rep = /^(\d+)\s*[x×]\s*\((.*)\)$/i.exec(item);
    if (rep) {
      const inner = parseItems(rep[2]);
      for (let i = 0; i < parseInt(rep[1], 10); i++) segs.push(...inner.map((s) => ({ ...s })));
      continue;
    }
    const m = /^(\S+)\s+(.+)$/.exec(item);
    if (!m) throw new Error(`Unverständlicher Block: „${item}“`);
    const dur = parseDuration(m[1]);
    const p = m[2].trim().toLowerCase();
    if (p === 'frei') { segs.push({ type: 'free', dur }); continue; }
    const pm = /^(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?\s*%$/.exec(p);
    if (!pm) throw new Error(`Ungültige Leistung: „${m[2]}“`);
    const a = parseFloat(pm[1].replace(',', '.')) / 100;
    if (pm[2]) segs.push({ type: 'ramp', dur, from: a, to: parseFloat(pm[2].replace(',', '.')) / 100 });
    else segs.push({ type: 'steady', dur, power: a });
  }
  return segs;
}

export function parseDSL(str, name = 'Eigenes Training') {
  const segments = parseItems(str);
  if (!segments.length) throw new Error('Das Training ist leer.');
  return { id: `custom-${Date.now()}`, name, desc: str, segments, custom: true };
}

/** Kleines Balkendiagramm eines Trainings in ein Canvas zeichnen. */
export function drawWorkout(canvas, workout, { progress = null, colorFn } = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const blocks = expand(workout);
  const total = totalDuration(workout) || 1;
  const maxP = Math.max(1.3, ...blocks.map((b) => Math.max(b.from ?? 0.5, b.to ?? 0.5)));
  for (const b of blocks) {
    const x0 = (b.start / total) * w, x1 = ((b.start + b.dur) / total) * w;
    const f0 = b.from ?? 0.5, f1 = b.to ?? 0.5;
    ctx.fillStyle = b.from === null ? '#556' : colorFn ? colorFn((f0 + f1) / 2) : '#3d8bfd';
    ctx.beginPath();
    ctx.moveTo(x0, h);
    ctx.lineTo(x0, h - (f0 / maxP) * h);
    ctx.lineTo(x1, h - (f1 / maxP) * h);
    ctx.lineTo(x1, h);
    ctx.closePath();
    ctx.fill();
  }
  // FTP-Linie
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, h - h / maxP);
  ctx.lineTo(w, h - h / maxP);
  ctx.stroke();
  ctx.setLineDash([]);
  if (progress !== null) {
    const x = (progress / total) * w;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, x, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 1, 0, 2, h);
  }
}
