// Kleine Hilfsfunktionen ohne Abhängigkeiten (auch in Node testbar).

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Deterministischer Zufallsgenerator (mulberry32). */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D-Value-Noise mit glatter Interpolation, Wertebereich ca. -1..1. */
export function makeNoise2D(seed) {
  const rng = mulberry32(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng() * 2 - 1;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const v00 = vals[p[X + p[Y]]];
    const v10 = vals[p[X + 1 + p[Y]]];
    const v01 = vals[p[X + p[Y + 1]]];
    const v11 = vals[p[X + 1 + p[Y + 1]]];
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  };
}

export function fbm(noise, x, y, octaves = 4) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtKm(m, digits = 1) {
  return (m / 1000).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Leistungszonen relativ zur FTP (eigene Farbgebung). */
export const ZONES = [
  { max: 0.55, name: 'Z1 Erholung', color: '#8a94a6' },
  { max: 0.75, name: 'Z2 Grundlage', color: '#3d8bfd' },
  { max: 0.90, name: 'Z3 Tempo', color: '#20c997' },
  { max: 1.05, name: 'Z4 Schwelle', color: '#f5c518' },
  { max: 1.20, name: 'Z5 VO2max', color: '#fd7e14' },
  { max: Infinity, name: 'Z6 Anaerob', color: '#e03170' },
];

export function zoneFor(fraction) {
  return ZONES.find((z) => fraction <= z.max) || ZONES[ZONES.length - 1];
}
