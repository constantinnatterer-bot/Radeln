import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steadySpeed, RiderPhysics, draftFactor } from '../src/physics.js';
import { parseIndoorBikeData, parseCyclingPower, parseHeartRate, CadenceCalc, encodeSimulation, encodeTargetPower } from '../src/ble.js';
import { expand, targetAt, totalDuration, parseDSL, PRESETS } from '../src/workouts.js';
import { normalizedPower, bestAverage, computeStats, levelFromXp } from '../src/stats.js';
import { Route, ROUTES } from '../src/route.js';

test('Physik: 200 W in der Ebene ≈ 30-34 km/h', () => {
  const v = steadySpeed(200, 0) * 3.6;
  assert.ok(v > 29 && v < 35, `v=${v}`);
});

test('Physik: Integration konvergiert zur stationären Geschwindigkeit', () => {
  const p = new RiderPhysics();
  for (let i = 0; i < 6000; i++) p.step(250, 0.05, 0.05);
  assert.ok(Math.abs(p.v - steadySpeed(250, 0.05)) < 0.05);
});

test('Windschatten nur dicht hinter dem Vordermann', () => {
  assert.ok(draftFactor(1, 0) > 0.3);
  assert.equal(draftFactor(20, 0), 0);
  assert.equal(draftFactor(2, 3), 0);
});

test('FTMS Indoor Bike Data parsen', () => {
  // Flags: Speed vorhanden (Bit0=0), Kadenz (Bit2), Leistung (Bit6)
  const dv = new DataView(new ArrayBuffer(8));
  dv.setUint16(0, 0x0044, true);
  dv.setUint16(2, 3250, true); // 32.5 km/h
  dv.setUint16(4, 180, true);  // 90 rpm
  dv.setInt16(6, 245, true);
  assert.deepEqual(parseIndoorBikeData(dv), { speed: 32.5, cadence: 90, power: 245 });
});

test('Cycling Power mit Kurbeldaten parsen + Trittfrequenz', () => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setUint16(0, 0x20, true); dv.setInt16(2, 310, true); dv.setUint16(4, 100, true); dv.setUint16(6, 1024, true);
  const r = parseCyclingPower(dv);
  assert.equal(r.power, 310);
  const c = new CadenceCalc();
  c.update(100, 1024, 0);
  assert.equal(Math.round(c.update(101, 1024 + 683, 700)), 90);
  // Überlauf
  c.update(65535, 65000, 1000);
  assert.ok(c.update(0, 65000 + 683 - 65536, 1700) > 80);
});

test('Herzfrequenz 8 und 16 bit', () => {
  assert.equal(parseHeartRate(new DataView(new Uint8Array([0, 142]).buffer)).hr, 142);
  assert.equal(parseHeartRate(new DataView(new Uint8Array([1, 44, 1]).buffer)).hr, 300);
});

test('FTMS-Steuerbefehle kodieren', () => {
  const s = new DataView(encodeSimulation(0.055));
  assert.equal(s.getUint8(0), 0x11);
  assert.equal(s.getInt16(3, true), 550);
  const p = new DataView(encodeTargetPower(250));
  assert.equal(p.getUint8(0), 0x05);
  assert.equal(p.getInt16(1, true), 250);
});

test('Workouts expandieren und Zielwerte', () => {
  const w = PRESETS.find((p) => p.id === 'sweetspot3x10');
  const b = expand(w);
  assert.equal(b.length, 1 + 6 + 1);
  assert.equal(totalDuration(w), 600 + 3 * 900 + 300);
  assert.equal(targetAt(b, 0).fraction, 0.5);
  assert.equal(targetAt(b, 650).fraction, 0.9);
  assert.equal(targetAt(b, 99999), null);
});

test('Trainings-Kurzschreibweise', () => {
  const w = parseDSL('10m 50-75%, 3x(30s 120%, 1m 50%), 5m frei');
  assert.equal(totalDuration(w), 600 + 3 * 90 + 300);
  assert.throws(() => parseDSL('10 Minuten locker'));
});

test('Statistik: NP ≥ Durchschnitt, Bestwerte', () => {
  const vals = Array.from({ length: 600 }, (_, i) => (i % 60 < 30 ? 300 : 100));
  assert.ok(normalizedPower(vals) > 200);
  assert.equal(bestAverage(vals, 30), 300);
  const st = computeStats(vals.map((p, t) => ({ t, power: p, hr: 0, cadence: 90, dist: t * 8, elevGain: 0 })), { ftp: 250 });
  assert.equal(Math.round(st.avgPower), 200);
  assert.equal(levelFromXp(0).level, 1);
  assert.equal(levelFromXp(100).level, 2);
});

test('Strecken: geschlossen, korrekte Länge, realistische Steigungen', () => {
  for (const def of ROUTES) {
    const r = new Route(def);
    const gap = Math.hypot(r.x[0] - r.x[r.n - 1], r.z[0] - r.z[r.n - 1]);
    assert.ok(gap < 5, `${def.id} Lücke ${gap}`);
    assert.ok(r.maxGrade < 0.13, `${def.id} max ${r.maxGrade}`);
    assert.ok(Math.abs(r.gradeAt(0)) < 0.03, `${def.id} Start nicht flach`);
    assert.ok(r.segments.length >= 1);
  }
});
