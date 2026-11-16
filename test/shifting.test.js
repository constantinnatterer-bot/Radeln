import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualShifter, GEARS, GEAR_COUNT, roadForce, WHEEL_CIRC, SENT_CRR } from '../src/shifting.js';
import { G } from '../src/physics.js';

test('24 Gänge, streng aufsteigend', () => {
  assert.equal(GEARS.length, GEAR_COUNT);
  for (let i = 1; i < GEARS.length; i++) assert.ok(GEARS[i] > GEARS[i - 1]);
});

test('Schalten bleibt in den Grenzen', () => {
  const s = new VirtualShifter(0);
  assert.equal(s.shiftDown(), false);
  for (let i = 0; i < 50; i++) s.shiftUp();
  assert.equal(s.gear, GEAR_COUNT - 1);
  assert.equal(s.shiftUp(), false);
});

test('Gang = physische Übersetzung, langsam: Ersatzsteigung ≈ echte Steigung', () => {
  const s = new VirtualShifter();
  // Gang suchen, der der physischen Übersetzung am nächsten liegt, und diese exakt setzen
  s.physRatio = s.ratio;
  const cadence = 30; // langsam -> Luftwiderstand vernachlässigbar
  const vt = (cadence / 60) * s.ratio * WHEEL_CIRC;
  const r = s.trainerGrade({ cadence, trainerSpeed: vt, grade: 0.06, mass: 83 });
  assert.ok(Math.abs(r.grade - 0.06) < 0.003, `grade=${r.grade}`);
});

test('Schwererer Gang -> höhere Ersatzsteigung bei gleicher Trittfrequenz', () => {
  const s = new VirtualShifter(5);
  const args = { cadence: 85, trainerSpeed: 8, grade: 0.03, mass: 83 };
  const low = s.trainerGrade(args).grade;
  s.shiftUp(); s.shiftUp(); s.shiftUp();
  const high = s.trainerGrade(args).grade;
  assert.ok(high > low + 0.005, `${low} -> ${high}`);
});

test('Leistung am Trainer entspricht der virtuellen Straßenleistung', () => {
  const s = new VirtualShifter(14);
  const cadence = 90, vt = 9, mass = 83, grade = 0.02;
  const r = s.trainerGrade({ cadence, trainerSpeed: vt, grade, mass });
  // Trainer erzeugt F = m g (crr + g_t) bei cw = 0 -> Leistung = F * vt
  const pTrainer = mass * G * (SENT_CRR + r.grade) * vt;
  const vv = s.virtualSpeed(cadence);
  const pRoad = roadForce(vv, grade, { mass }) * vv;
  assert.ok(Math.abs(pTrainer - pRoad) < 1, `${pTrainer} vs ${pRoad}`);
});

test('Physische Übersetzung wird aus Trainerdaten gelernt', () => {
  const s = new VirtualShifter();
  const truth = 50 / 14;
  for (let i = 0; i < 200; i++) s.observe(90, (90 / 60) * truth * WHEEL_CIRC);
  assert.ok(Math.abs(s.physRatio - truth) < 0.02);
});

test('Rollen lassen sendet die echte Steigung', () => {
  const s = new VirtualShifter();
  assert.equal(s.trainerGrade({ cadence: 0, trainerSpeed: 5, grade: -0.04 }).grade, -0.04);
});
