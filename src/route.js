// Prozedural erzeugte Rundkurse. Alle Strecken sind eigene Erfindungen und
// werden aus einem Seed deterministisch generiert.
import { CatmullRomCurve3, Vector3 } from 'three';
import { mulberry32, lerp } from './util.js';

export const ROUTES = [
  {
    id: 'seeufer',
    name: 'Seeufer-Runde',
    desc: 'Flacher, schneller Kurs rund um einen Bergsee. Ideal zum Einrollen und für Gruppenfahrten.',
    length: 12000,
    seed: 11,
    radiusVar: 0.28,
    ctrl: 13,
    hills: [ { k: 2, a: 5 }, { k: 5, a: 2.5 }, { k: 11, a: 1.2 } ],
    theme: 'see',
  },
  {
    id: 'huegel',
    name: 'Hügelland-Schleife',
    desc: 'Welliges Terrain mit kurzen, giftigen Anstiegen durch Felder und Wiesen.',
    length: 18000,
    seed: 23,
    radiusVar: 0.38,
    ctrl: 16,
    hills: [ { k: 3, a: 32 }, { k: 7, a: 11 }, { k: 13, a: 4 } ],
    theme: 'huegel',
  },
  {
    id: 'gipfel',
    name: 'Gipfelsturm',
    desc: 'Ein langer, gleichmäßiger Pass mit über 500 Höhenmetern – oben wartet der Schnee.',
    length: 24000,
    seed: 42,
    radiusVar: 0.32,
    ctrl: 15,
    hills: [ { k: 1, a: 240 }, { k: 3, a: 22 }, { k: 9, a: 5 } ],
    theme: 'alpen',
  },
  {
    id: 'wald',
    name: 'Waldkriterium',
    desc: 'Kurze, kurvige Runde durch dichten Mischwald. Perfekt für Intervalle.',
    length: 6000,
    seed: 77,
    radiusVar: 0.42,
    ctrl: 11,
    hills: [ { k: 2, a: 9 }, { k: 4, a: 4 }, { k: 9, a: 1.5 } ],
    theme: 'wald',
  },
];

export class Route {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.length = def.length;
    const rng = mulberry32(def.seed);

    // Kontrollpunkte eines geschlossenen Kurses
    const n = def.ctrl || 14;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      const r = 1 + (rng() * 2 - 1) * def.radiusVar;
      pts.push(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.8));
    }
    let curve = new CatmullRomCurve3(pts, true, 'centripetal');
    const scale = this.length / curve.getLength();
    pts.forEach((p) => p.multiplyScalar(scale));
    curve = new CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 6000;

    this.n = Math.round(this.length / 2);
    this.step = this.length / this.n;
    const sp = curve.getSpacedPoints(this.n);
    this.x = new Float32Array(this.n);
    this.z = new Float32Array(this.n);
    this.y = new Float32Array(this.n);

    // Höhenprofil aus periodischen Harmonischen -> nahtlose Runde
    const phases = def.hills.map(() => rng() * Math.PI * 2);
    let minY = Infinity;
    for (let i = 0; i < this.n; i++) {
      this.x[i] = sp[i].x;
      this.z[i] = sp[i].z;
      const s = i * this.step;
      let e = 0;
      def.hills.forEach((h, j) => {
        e += h.a * Math.sin((2 * Math.PI * h.k * s) / this.length + phases[j]);
      });
      this.y[i] = e;
      if (e < minY) minY = e;
    }
    const base = 10;
    for (let i = 0; i < this.n; i++) this.y[i] += base - minY;

    // Startlinie in eine flache Stelle legen: Strecke so rotieren, dass Index 0 flach liegt
    this._rotateToFlatStart();

    let gain = 0, maxY = -Infinity, minY2 = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = this.y[(i + 1) % this.n] - this.y[i];
      if (d > 0) gain += d;
      maxY = Math.max(maxY, this.y[i]);
      minY2 = Math.min(minY2, this.y[i]);
    }
    this.elevationGain = gain;
    this.maxElevation = maxY;
    this.minElevation = minY2;

    let maxGrade = 0;
    for (let d = 0; d < this.length; d += 20) maxGrade = Math.max(maxGrade, this.gradeAt(d));
    this.maxGrade = maxGrade;

    this.segments = this._findSegments();
  }

  _rotateToFlatStart() {
    let best = 0, bestScore = Infinity;
    const win = Math.round(300 / this.step);
    for (let i = 0; i < this.n; i += 10) {
      const a = this.y[(i - win + this.n) % this.n];
      const b = this.y[(i + win) % this.n];
      const score = Math.abs(b - a);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    const rot = (arr) => {
      const out = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i++) out[i] = arr[(i + best) % arr.length];
      return out;
    };
    this.x = rot(this.x); this.z = rot(this.z); this.y = rot(this.y);
  }

  _findSegments() {
    const segs = [];
    // größter zusammenhängender Anstieg
    let minI = 0, bestGain = 0, bestStart = 0, bestEnd = 0;
    for (let i = 1; i < this.n; i++) {
      if (this.y[i] < this.y[minI]) minI = i;
      const g = this.y[i] - this.y[minI];
      if (g > bestGain) { bestGain = g; bestStart = minI; bestEnd = i; }
    }
    if (bestGain >= 15 && (bestEnd - bestStart) * this.step > 400) {
      const start = bestStart * this.step, end = bestEnd * this.step;
      segs.push({
        id: `${this.id}-berg`,
        type: 'berg',
        name: 'Bergwertung',
        start,
        end,
        gain: bestGain,
        avgGrade: bestGain / (end - start),
      });
    }
    segs.push({ id: `${this.id}-sprint`, type: 'sprint', name: 'Zielsprint', start: this.length - 500, end: this.length });
    return segs;
  }

  wrap(d) {
    const L = this.length;
    return ((d % L) + L) % L;
  }

  elevationAt(d) {
    const f = this.wrap(d) / this.step;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    return lerp(this.y[i], this.y[j], f - Math.floor(f));
  }

  gradeAt(d) {
    return (this.elevationAt(d + 10) - this.elevationAt(d - 10)) / 20;
  }

  /** Position, Richtung und Steigung bei Distanz d. */
  sample(d, out = {}) {
    const f = this.wrap(d) / this.step;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    const t = f - Math.floor(f);
    out.x = lerp(this.x[i], this.x[j], t);
    out.z = lerp(this.z[i], this.z[j], t);
    out.y = lerp(this.y[i], this.y[j], t);
    // Richtung geglättet über ±6 m
    const a = (i - 3 + this.n) % this.n, b = (i + 3) % this.n;
    const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
    const len = Math.hypot(dx, dz) || 1;
    out.fx = dx / len;
    out.fz = dz / len;
    // Vektor "nach rechts" aus Fahrersicht
    out.rx = -out.fz;
    out.rz = out.fx;
    out.heading = Math.atan2(dx, dz);
    out.grade = this.gradeAt(d);
    return out;
  }
}

const cache = new Map();
export function getRoute(id) {
  if (!cache.has(id)) {
    const def = ROUTES.find((r) => r.id === id) || ROUTES[0];
    cache.set(id, new Route(def));
  }
  return cache.get(id);
}
