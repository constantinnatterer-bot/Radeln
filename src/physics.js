// Fahrphysik: Leistung -> Geschwindigkeit unter Berücksichtigung von
// Luftwiderstand, Rollwiderstand, Steigung und Windschatten.

export const G = 9.81;

export class RiderPhysics {
  constructor({ mass = 75, bikeMass = 8, cda = 0.32, crr = 0.004, rho = 1.225, eta = 0.97 } = {}) {
    this.mass = mass;
    this.bikeMass = bikeMass;
    this.cda = cda;
    this.crr = crr;
    this.rho = rho;
    this.eta = eta;
    this.v = 0; // m/s
  }

  get totalMass() {
    return this.mass + this.bikeMass;
  }

  /**
   * Integriert einen Zeitschritt.
   * @param {number} power  Tretleistung in Watt
   * @param {number} grade  Steigung als Bruch (0.05 = 5 %)
   * @param {number} dt     Zeitschritt in s
   * @param {number} draft  Windschattenanteil 0..1 (Reduktion des Luftwiderstands)
   */
  step(power, grade, dt, draft = 0) {
    const m = this.totalMass;
    const theta = Math.atan(grade);
    const v = this.v;
    const vEff = Math.max(v, 1.0);
    // Antriebskraft; bei sehr geringer Geschwindigkeit begrenzt.
    const fDrive = Math.min((power * this.eta) / vEff, m * 3);
    const fAero = 0.5 * this.rho * this.cda * (1 - draft) * v * v;
    const fRoll = v > 0.01 || fDrive > 0 ? this.crr * m * G * Math.cos(theta) : 0;
    const fGrav = m * G * Math.sin(theta);
    // effektive Masse inkl. rotierender Laufräder
    const a = (fDrive - fAero - fRoll - fGrav) / (m + 1.2);
    this.v = Math.max(0, v + a * dt);
    return this.v;
  }
}

/** Stationäre Geschwindigkeit (m/s) für eine Leistung – per Bisektion. */
export function steadySpeed(power, grade, opts = {}) {
  const { mass = 75, bikeMass = 8, cda = 0.32, crr = 0.004, rho = 1.225, eta = 0.97, draft = 0 } = opts;
  const m = mass + bikeMass;
  const theta = Math.atan(grade);
  const need = (v) =>
    (0.5 * rho * cda * (1 - draft) * v * v + crr * m * G * Math.cos(theta) + m * G * Math.sin(theta)) * v;
  let lo = 0, hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (need(mid) > power * eta) hi = mid; else lo = mid;
  }
  return lo;
}

/** Windschatten-Anteil für einen Abstand (m) zum Vordermann. */
export function draftFactor(gap, lateral) {
  if (gap < 0.3 || gap > 12 || Math.abs(lateral) > 1.3) return 0;
  const longi = gap < 1.5 ? 1 : 1 - (gap - 1.5) / 10.5;
  const lat = 1 - Math.abs(lateral) / 1.3;
  return 0.32 * longi * lat;
}
