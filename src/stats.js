// Auswertung einer Fahrt aus 1-Hz-Messpunkten.

export function bestAverage(values, window) {
  if (values.length < window) return 0;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += values[i];
  let best = sum;
  for (let i = window; i < values.length; i++) {
    sum += values[i] - values[i - window];
    if (sum > best) best = sum;
  }
  return best / window;
}

export function normalizedPower(values) {
  if (values.length < 30) return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  let sum = 0, acc = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= 30) sum -= values[i - 30];
    if (i >= 29) { acc += Math.pow(sum / 30, 4); n++; }
  }
  return Math.pow(acc / n, 0.25);
}

export function computeStats(samples, { ftp = 200, weight = 75 } = {}) {
  const n = samples.length;
  const power = samples.map((s) => s.power);
  const hrs = samples.map((s) => s.hr).filter((v) => v > 0);
  const cads = samples.map((s) => s.cadence).filter((v) => v > 0);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const avgPower = avg(power);
  const np = normalizedPower(power);
  const IF = ftp > 0 ? np / ftp : 0;
  const tss = ftp > 0 ? ((n * np * IF) / (ftp * 3600)) * 100 : 0;
  const kj = power.reduce((a, b) => a + b, 0) / 1000;
  const last = samples[n - 1] || { dist: 0, elevGain: 0 };
  return {
    duration: n,
    distance: last.dist || 0,
    elevGain: last.elevGain || 0,
    avgPower,
    maxPower: n ? Math.max(...power) : 0,
    np,
    IF,
    tss,
    wkg: weight > 0 ? avgPower / weight : 0,
    avgHr: avg(hrs),
    maxHr: hrs.length ? Math.max(...hrs) : 0,
    avgCadence: avg(cads),
    avgSpeed: n ? (last.dist / n) * 3.6 : 0,
    kj,
    kcal: kj * 1.0, // ~24 % Wirkungsgrad: kJ mechanisch ≈ kcal Umsatz
    best: {
      s5: bestAverage(power, 5),
      m1: bestAverage(power, 60),
      m5: bestAverage(power, 300),
      m20: bestAverage(power, 1200),
    },
  };
}

export function xpForRide(stats, workoutCompleted) {
  return Math.round(stats.distance / 1000 * 20 + stats.duration / 60 * 2 + (workoutCompleted ? 100 : 0));
}

export function levelFromXp(xp) {
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const cur = 100 * (level - 1) ** 2;
  const next = 100 * level ** 2;
  return { level, progress: (xp - cur) / (next - cur), next };
}
