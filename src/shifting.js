// Virtuelles Schalten für FTMS-Trainer (z. B. Trainer mit nur einem Ritzel).
//
// Prinzip: Der Trainer kennt nur seine eigene, feste Übersetzung. Er meldet die
// Geschwindigkeit seines Schwungrads (v_t) und erzeugt im Simulationsmodus die Kraft
//     F_t = m · g · (crr + Steigung) + cw · v_t²
// Für einen virtuellen Gang mit Übersetzung r_v fährt die Fahrerin virtuell
//     v_v = Trittfrequenz · r_v · Radumfang
// und muss dafür die Leistung P = F_Straße(v_v) · v_v treten. Damit die Leistung
// am Trainer passt, muss er bei v_t die Kraft F_t = F_Straße(v_v) · v_v / v_t
// aufbringen. Wir senden cw = 0 und rechnen alles in eine Ersatzsteigung um.

import { G } from './physics.js';
import { clamp } from './util.js';

export const WHEEL_CIRC = 2.105; // m, 700x28c
export const GEAR_COUNT = 24;
const LOWEST = 0.9;  // etwa 34/38
const HIGHEST = 4.8; // etwa 53/11
export const GEARS = Array.from({ length: GEAR_COUNT }, (_, i) => +(LOWEST * Math.pow(HIGHEST / LOWEST, i / (GEAR_COUNT - 1))).toFixed(3));
export const DEFAULT_GEAR = 9;
/** Angenommene physische Übersetzung, bis sie aus den Trainerdaten geschätzt ist (z. B. 34/14). */
export const DEFAULT_PHYSICAL_RATIO = 34 / 14;
export const SENT_CRR = 0.004;
export const GRADE_MIN = -0.1;
export const GRADE_MAX = 0.25;

/** Widerstandskraft auf der virtuellen Straße (N). */
export function roadForce(v, grade, { mass = 83, cda = 0.32, crr = 0.004, rho = 1.225, draft = 0 } = {}) {
  const theta = Math.atan(grade);
  return mass * G * (crr * Math.cos(theta) + Math.sin(theta)) + 0.5 * rho * cda * (1 - draft) * v * v;
}

export class VirtualShifter {
  constructor(gear = DEFAULT_GEAR) {
    this.gear = clamp(gear, 0, GEAR_COUNT - 1);
    this.physRatio = DEFAULT_PHYSICAL_RATIO;
    this.physRatioSamples = 0;
    this.last = null; // letzte Berechnung (für die Diagnose)
  }

  get ratio() { return GEARS[this.gear]; }
  get count() { return GEAR_COUNT; }

  shiftUp() { const g = this.gear; this.gear = Math.min(GEAR_COUNT - 1, g + 1); return this.gear !== g; }
  shiftDown() { const g = this.gear; this.gear = Math.max(0, g - 1); return this.gear !== g; }

  /** Virtuelle Geschwindigkeit (m/s) aus der Trittfrequenz. */
  virtualSpeed(cadence) {
    return (cadence / 60) * this.ratio * WHEEL_CIRC;
  }

  /** Trittfrequenz, die zu einer Geschwindigkeit im aktuellen Gang gehört. */
  cadenceFor(speed) {
    return (speed / (this.ratio * WHEEL_CIRC)) * 60;
  }

  /** Physische Übersetzung des Trainers aus Trittfrequenz + Trainergeschwindigkeit lernen. */
  observe(cadence, trainerSpeed) {
    if (cadence < 40 || trainerSpeed < 2) return;
    const est = trainerSpeed / ((cadence / 60) * WHEEL_CIRC);
    if (est < 0.5 || est > 8) return;
    this.physRatioSamples++;
    const a = this.physRatioSamples < 20 ? 0.2 : 0.03;
    this.physRatio += (est - this.physRatio) * a;
  }

  /**
   * Ersatzsteigung, die an den Trainer gesendet wird.
   * @param {object} p
   * @param {number} p.cadence       U/min
   * @param {number} p.trainerSpeed  m/s, vom Trainer gemeldet (0 = unbekannt)
   * @param {number} p.grade         Steigung der Strecke (bereits mit Steigungsgefühl skaliert)
   * @param {number} p.mass          Gesamtmasse Fahrer:in + Rad
   * @param {number} p.draft         Windschattenanteil
   */
  trainerGrade({ cadence, trainerSpeed = 0, grade, mass = 83, draft = 0 }) {
    this.observe(cadence, trainerSpeed);
    if (cadence < 20) {
      // Rollen lassen: einfach die echte Steigung senden
      this.last = { grade: clamp(grade, GRADE_MIN, GRADE_MAX), vv: 0, vt: trainerSpeed, k: 1, force: 0 };
      return this.last;
    }
    const vv = this.virtualSpeed(cadence);
    // Trainergeschwindigkeit: gemeldet oder aus geschätzter physischer Übersetzung
    const vt = trainerSpeed > 1 ? trainerSpeed : (cadence / 60) * this.physRatio * WHEEL_CIRC;
    const k = vv / vt;
    const force = roadForce(vv, grade, { mass, draft }) * k;
    const g = clamp(force / (mass * G) - SENT_CRR, GRADE_MIN, GRADE_MAX);
    this.last = { grade: g, vv, vt, k, force };
    return this.last;
  }
}
