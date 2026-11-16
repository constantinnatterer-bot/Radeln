// Eine Fahrt: Spielschleife, Physik, Mitfahrer, Trainersteuerung, Aufzeichnung.
import * as THREE from 'three';
import { RiderPhysics, draftFactor } from './physics.js';
import { createRider } from './riders.js';
import { expand, targetAt } from './workouts.js';
import { mulberry32, clamp, fmtTime } from './util.js';
import { VirtualShifter, SENT_CRR } from './shifting.js';

const BOT_NAMES = ['Lena', 'Jonas', 'Mia', 'Felix', 'Hannah', 'Lukas', 'Emma', 'Paul', 'Sophie', 'Max', 'Clara', 'Elias',
  'Ida', 'Noah', 'Greta', 'Tim', 'Ella', 'Ben', 'Frida', 'Anton', 'Mila', 'Leon', 'Ronja', 'Karl'];
const BOT_COLORS = ['#e03170', '#3d8bfd', '#f5c518', '#fd7e14', '#7b4fd6', '#20c997', '#e8e8e8', '#ff5a5f', '#2bb3ff', '#9acd32'];
const CAMERAS = ['Verfolger', 'Helm', 'Seite', 'Vogel'];

class Bot {
  constructor(i, rng, playerMass) {
    this.name = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? ` ${Math.floor(i / BOT_NAMES.length) + 1}` : '');
    this.color = BOT_COLORS[i % BOT_COLORS.length];
    this.mass = 58 + rng() * 32;
    this.wkg = 1.8 + rng() * 2.4;
    this.group = rng() < 0.5; // fährt gern in der Gruppe der Fahrerin mit
    this.physics = new RiderPhysics({ mass: this.mass, cda: 0.3 + rng() * 0.06 });
    this.dist = (rng() - 0.3) * 300;
    this.lane = (rng() - 0.5) * 4;
    this.targetLane = this.lane;
    this.cadence = 80 + rng() * 15;
    this.phase = rng() * 100;
    this.power = 0;
    this.model = createRider({ jersey: this.color, helmet: rng() < 0.5 ? '#ffffff' : '#1b1d22', name: this.name });
    this.physics.v = 8;
    void playerMass;
  }
}

export class Ride {
  constructor({ world, hud, route, workout, profile, devices, botCount, difficulty, cameraIndex = 0, shifting = true, gear, onEnd }) {
    Object.assign(this, { world, hud, route, workout, profile, devices, onEnd });
    this.difficulty = difficulty / 100;
    this.simulator = !devices.hasTrainer;
    this.blocks = workout ? expand(workout) : null;
    this.physics = new RiderPhysics({ mass: profile.weight });
    this.state = { dist: 0, lane: 0.8, elapsed: 0, elevGain: 0, power: 0, cadence: 0, hr: 0, speed: 0, grade: 0, draft: 0, lap: 1 };
    this.simPower = Math.round(profile.ftp * 0.6);
    this.ergBias = 1;
    // Virtuelles Schalten: im Simulator immer möglich, mit Trainer nur bei steuerbarem FTMS
    this.shifter = shifting && (this.simulator || devices.canControl) ? new VirtualShifter(gear) : null;
    this._shiftPending = false;
    this.samples = [];
    this.camIndex = cameraIndex;
    this.paused = false;
    this.startTime = null;
    this.segment = null; // aktive Wertung
    this.segmentResults = [];
    this.workoutDone = false;
    this._lastControl = 0;
    this._lastSent = null;
    this._recAcc = 0;
    this._hudAcc = 0;
    this._raf = null;
    this._tmp = {};
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._camInit = false;

    const rng = mulberry32(Date.now() & 0xffff);
    this.bots = Array.from({ length: botCount }, (_, i) => new Bot(i, rng, profile.weight));
  }

  start() {
    this.world.build(this.route);
    this.me = createRider({ jersey: this.profile.jersey, helmet: this.profile.helmet });
    this.world.scene.add(this.me.group);
    for (const b of this.bots) this.world.scene.add(b.model.group);
    this.hud.setup(this.route, this.workout, this.profile.ftp, this.simulator, this.shifter);
    this._onGearBtn = (e) => { const b = e.target.closest('[data-shift]'); if (b) this.shift(Number(b.dataset.shift)); };
    document.querySelector('#gear-controls').addEventListener('click', this._onGearBtn);
    this.hud.el.simPower.value = this.simPower;
    this._bindKeys();
    this.hud.toast(this.simulator
      ? 'Simulator-Modus: Leistung mit <kbd>↑</kbd>/<kbd>↓</kbd> oder dem Regler steuern'
      : `Verbunden mit ${this.devices.trainer.device.name || 'Trainer'} – viel Spaß!`, 5000);
    if (this.devices.canControl) this.devices.setSimulation(0);
    this._last = performance.now();
    const loop = (ts) => {
      const dt = Math.min(0.1, (ts - this._last) / 1000);
      this._last = ts;
      if (!this.paused) this.update(dt);
      this.render(dt);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _bindKeys() {
    this._onKey = (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const dir = k === 'ArrowUp' ? 1 : -1;
        if (this.blocks && !this.workoutDone) {
          this.ergBias = clamp(this.ergBias + dir * 0.01, 0.5, 1.5);
          this.hud.toast(`Trainingsintensität ${Math.round(this.ergBias * 100)} %`, 1200);
        } else if (this.simulator) {
          this.simPower = clamp(this.simPower + dir * (e.shiftKey ? 50 : 10), 0, 1500);
          this.hud.el.simPower.value = this.simPower;
        }
      } else if (k === 'ArrowLeft') this.state.lane = clamp(this.state.lane - 1, -3, 3);
      else if (k === 'ArrowRight') this.state.lane = clamp(this.state.lane + 1, -3, 3);
      else if (k === 'c' || k === 'C') this.cycleCamera();
      else if (k === 'p' || k === 'P' || k === ' ') { e.preventDefault(); this.togglePause(); }
      else if (k === 'h' || k === 'H') document.querySelector('#hud').classList.toggle('minimal');
      else if (k === '+' || k === '=' || k === ']' || k === 'PageUp') { e.preventDefault(); this.shift(1); }
      else if (k === '-' || k === '[' || k === 'PageDown') { e.preventDefault(); this.shift(-1); }
      else if (k === 'd' || k === 'D') this.hud.toggleDebug();
    };
    window.addEventListener('keydown', this._onKey);
    this._onSim = (e) => { this.simPower = Number(e.target.value); };
    this.hud.el.simLabel.textContent = `${this.simPower} W`;
    this.hud.el.simPower.addEventListener('input', this._onSim);
  }

  /** Virtuell schalten: +1 = schwerer, -1 = leichter. */
  shift(dir) {
    if (!this.shifter) {
      this.hud.toast('Virtuelles Schalten ist im Menü unter „Geräte“ deaktiviert.', 2000);
      return;
    }
    if (this._ergActive()) {
      this.hud.toast('Im ERG-Modus gibt der Trainer die Leistung vor – Schalten ist pausiert.', 2000);
      return;
    }
    const changed = dir > 0 ? this.shifter.shiftUp() : this.shifter.shiftDown();
    if (changed) this._shiftPending = true;
    this.hud.updateGear(this.shifter, changed ? dir : 0);
  }

  _ergActive() {
    return !!this.blocks && !this.workoutDone && this._woInfo?.fraction != null;
  }

  cycleCamera() {
    this.camIndex = (this.camIndex + 1) % CAMERAS.length;
    this._camInit = false;
    this.hud.toast(`Kamera: ${CAMERAS[this.camIndex]}`, 1200);
  }

  togglePause() {
    this.paused = !this.paused;
    document.querySelector('#pause-overlay').hidden = !this.paused;
    if (this.devices.canControl && this.paused) this.devices.setSimulation(0);
  }

  _targetWatts() {
    if (!this.blocks) return null;
    const info = targetAt(this.blocks, this.state.elapsed);
    this._woInfo = info;
    if (!info) {
      if (!this.workoutDone) {
        this.workoutDone = true;
        this.hud.toast('🏁 Training abgeschlossen! Stark gefahren.', 6000);
      }
      return null;
    }
    return info.fraction === null ? null : info.fraction * this.profile.ftp * this.ergBias;
  }

  update(dt) {
    const s = this.state;
    const r = this.route;
    const target = this._targetWatts();

    // Leistungsquelle
    if (this.simulator) {
      s.power = target !== null ? target : this.simPower;
      if (this.shifter && !this._ergActive()) {
        // Trittfrequenz ergibt sich aus Geschwindigkeit und Gang
        s.cadence = s.power > 0 ? clamp(this.shifter.cadenceFor(s.speed), 45, 140) : 0;
      } else {
        s.cadence = s.power > 0 ? 82 + Math.sin(s.elapsed / 7) * 4 + s.power / 60 : 0;
      }
      s.hr = s.power > 0 ? Math.min(195, 70 + (s.power / this.profile.ftp) * 85 + Math.sin(s.elapsed / 30) * 3) : 0;
    } else {
      const d = this.devices.read();
      s.power = d.power; s.cadence = d.cadence; s.hr = d.hr;
      this._trainerSpeed = d.speed;
    }
    if (this.devices.hrDevice) s.hr = this.devices.read().hr;

    // Trainer steuern
    const now = performance.now();
    if (this.devices.canControl) {
      if (target !== null) {
        // ERG: max. 1×/s
        if (now - this._lastControl > 1000) {
          this._lastControl = now;
          const w = Math.round(target);
          if (this._lastSent !== `p${w}`) { this.devices.setTargetPower(w); this._lastSent = `p${w}`; }
        }
      } else if (this.shifter) {
        // Virtuelles Schalten: Ersatzsteigung bis 4×/s, nach einem Schaltvorgang sofort
        const res = this.shifter.trainerGrade({
          cadence: s.cadence, trainerSpeed: this._trainerSpeed || 0,
          grade: s.grade * this.difficulty, mass: this.physics.totalMass, draft: s.draft,
        });
        const g = Math.round(res.grade * 1000) / 1000;
        if (this._shiftPending || (now - this._lastControl > 250 && this._lastSent !== `v${g}`)) {
          this._lastControl = now;
          this._shiftPending = false;
          this.devices.setSimulation(g, { cw: 0, crr: SENT_CRR });
          this._lastSent = `v${g}`;
        }
      } else if (now - this._lastControl > 1000) {
        this._lastControl = now;
        const g = Math.round(s.grade * this.difficulty * 1000) / 1000;
        if (this._lastSent !== `g${g}`) { this.devices.setSimulation(g); this._lastSent = `g${g}`; }
      }
    }

    // Windschatten
    s.draft = 0;
    for (const b of this.bots) {
      const gap = b.dist - s.dist;
      s.draft = Math.max(s.draft, draftFactor(gap, b.lane - s.lane));
    }

    s.grade = r.gradeAt(s.dist);
    const prevDist = s.dist;
    const prevElev = r.elevationAt(s.dist);
    s.speed = this.physics.step(s.power, s.grade, dt, s.draft);
    s.dist += s.speed * dt;
    const de = r.elevationAt(s.dist) - prevElev;
    if (de > 0) s.elevGain += de;
    const lap = Math.floor(s.dist / r.length) + 1;
    if (lap > s.lap) { s.lap = lap; this.hud.toast(`Runde ${lap - 1} geschafft!`); }

    // Zeit läuft, sobald man sich bewegt hat
    if (this.startTime === null && s.speed > 0.3) this.startTime = new Date();
    if (this.startTime !== null) s.elapsed += dt;

    this._segments(prevDist, s.dist);
    this._updateBots(dt);

    // Aufzeichnung (1 Hz)
    if (this.startTime !== null) {
      this._recAcc += dt;
      while (this._recAcc >= 1) {
        this._recAcc -= 1;
        this.samples.push({
          t: this.samples.length, power: s.power, hr: s.hr, cadence: s.cadence, speed: s.speed,
          dist: s.dist, elev: r.elevationAt(s.dist), elevGain: s.elevGain,
        });
      }
    }
  }

  _crossed(prev, cur, mark) {
    const L = this.route.length;
    return Math.floor((prev - mark) / L) !== Math.floor((cur - mark) / L) && cur > prev;
  }

  _segments(prev, cur) {
    const s = this.state;
    for (const seg of this.route.segments) {
      if (this._crossed(prev, cur, seg.start) && !this.segment) {
        this.segment = { seg, startT: s.elapsed };
        this.hud.toast(`${seg.type === 'berg' ? '⛰️' : '⚡'} ${seg.name} gestartet`);
      }
      if (this.segment?.seg === seg && this._crossed(prev, cur, seg.end % this.route.length || this.route.length)) {
        const time = s.elapsed - this.segment.startT;
        const best = this.profile._bests?.[seg.id];
        const isPB = !best || time < best;
        this.segmentResults.push({ id: seg.id, name: seg.name, time, isPB });
        this.hud.toast(`${seg.name}: <b>${fmtTime(time)}</b>${isPB ? ' – neue Bestzeit! 🏆' : ` (Bestzeit ${fmtTime(best)})`}`, 6000);
        if (isPB && this.profile._bests) this.profile._bests[seg.id] = time;
        this.segment = null;
      }
    }
    if (this.segment) {
      const seg = this.segment.seg;
      const L = this.route.length;
      const pos = this.route.wrap(s.dist);
      let left = (seg.end - pos + L) % L;
      if (left > seg.end - seg.start + 1) left = 0;
      this.hud.setSegment(`<b>${seg.name}</b> · ${fmtTime(s.elapsed - this.segment.startT)} · noch ${Math.round(left)} m`);
    } else this.hud.setSegment(null);
  }

  _updateBots(dt) {
    const s = this.state;
    const r = this.route;
    for (const b of this.bots) {
      const grade = r.gradeAt(b.dist);
      let p = b.wkg * b.mass * (1 + clamp(grade * 4, -0.6, 0.35));
      p *= 1 + 0.08 * Math.sin((s.elapsed + b.phase) / 9) + 0.04 * Math.sin((s.elapsed + b.phase) / 2.3);
      if (b.group) {
        // Gruppenfahrer passen sich an, wenn sie in der Nähe sind
        const gap = b.dist - s.dist;
        if (Math.abs(gap) < 80) {
          const want = s.power > 20 ? s.power * (b.mass / this.profile.weight) : p;
          p = want * (1 - clamp(gap / 60, -0.25, 0.25));
        }
      }
      b.power = Math.max(0, p);
      let draft = 0;
      for (const o of this.bots) if (o !== b) draft = Math.max(draft, draftFactor(o.dist - b.dist, o.lane - b.lane));
      draft = Math.max(draft, draftFactor(s.dist - b.dist, s.lane - b.lane));
      b.physics.step(b.power, grade, dt, draft);
      b.dist += b.physics.v * dt;
      // Überholen: auf eine freie Spur ausweichen
      if (Math.random() < dt * 0.3) b.targetLane = clamp(Math.round((Math.random() - 0.5) * 6), -3, 3);
      b.lane += (b.targetLane - b.lane) * Math.min(1, dt * 0.8);
      b.cadence = 75 + b.power / 15;
    }
  }

  _place(model, dist, lane, speed, cadence, dt) {
    const p = this.route.sample(dist, this._tmp);
    model.group.position.set(p.x + p.rx * lane, p.y + 0.08, p.z + p.rz * lane);
    model.group.rotation.order = 'YXZ';
    model.group.rotation.y = p.heading;
    model.group.rotation.x = -Math.atan(p.grade);
    model.update(dt, speed, cadence);
    return p;
  }

  render(dt) {
    const s = this.state;
    const p = this._place(this.me, s.dist, s.lane, s.speed, s.cadence, this.paused ? 0 : dt);
    const fx = p.fx, fz = p.fz, rx = p.rx, rz = p.rz;
    const pos = this.me.group.position;
    const others = [];
    for (const b of this.bots) {
      const gap = b.dist - s.dist;
      const visible = Math.abs(gap) < 1500;
      b.model.group.visible = visible;
      if (visible) {
        this._place(b.model, b.dist, b.lane, b.physics.v, b.cadence, this.paused ? 0 : dt);
        // Namensschild nur in sinnvoller Entfernung zeigen
        const dc = b.model.group.position.distanceTo(this.world.camera.position);
        b.model.label.visible = dc > 7 && dc < 150;
      }
      const q = this.route.sample(b.dist);
      others.push({ x: q.x, z: q.z, dist: b.dist, color: b.color });
    }

    // Kamera
    const cam = this.world.camera;
    const desired = new THREE.Vector3(), look = new THREE.Vector3();
    switch (this.camIndex) {
      case 1: // Helm
        desired.set(pos.x + fx * 0.6, pos.y + 1.62, pos.z + fz * 0.6);
        look.set(pos.x + fx * 30, pos.y + 1.2 + p.grade * 30, pos.z + fz * 30);
        break;
      case 2: // Seite
        desired.set(pos.x + rx * 7 - fx * 2, pos.y + 1.8, pos.z + rz * 7 - fz * 2);
        look.set(pos.x + fx * 1, pos.y + 1, pos.z + fz * 1);
        break;
      case 3: // Vogel
        desired.set(pos.x - fx * 20, pos.y + 28, pos.z - fz * 20);
        look.set(pos.x + fx * 15, pos.y, pos.z + fz * 15);
        break;
      default: // Verfolger
        desired.set(pos.x - fx * 5.5, pos.y + 2.3, pos.z - fz * 5.5);
        look.set(pos.x + fx * 6, pos.y + 1.1, pos.z + fz * 6);
    }
    const th = this.world.terrainHeight(desired.x, desired.z) + 0.8;
    if (desired.y < th) desired.y = th;
    const k = this._camInit ? 1 - Math.exp(-dt * (this.camIndex === 1 ? 20 : 5)) : 1;
    this._camPos.lerp(desired, k);
    this._camLook.lerp(look, k);
    this._camInit = true;
    cam.position.copy(this._camPos);
    cam.lookAt(this._camLook);
    this.world.follow(pos);
    this.world.render();

    // HUD (10 Hz)
    this._hudAcc += dt;
    if (this._hudAcc > 0.1) {
      this._hudAcc = 0;
      const modeLabel = this.simulator ? 'Simulator' : this._ergActive() && this.devices.canControl ? 'ERG' : this.devices.canControl ? `Sim ${Math.round(this.difficulty * 100)} %${this.shifter ? ' · Schalten' : ''}` : 'Leistungsmesser';
      if (this.shifter) this.hud.updateGear(this.shifter, 0, this._ergActive());
      this.hud.updateDebug(this);
      this.hud.update({ ...s, weight: this.profile.weight, modeLabel });
      if (this.simulator) this.hud.el.simLabel.textContent = this.blocks && !this.workoutDone ? `Training ${Math.round(this.ergBias * 100)} %` : `${this.simPower} W`;
      if (this.blocks) this.hud.updateWorkout(this._woInfo, s.elapsed, s.power, this.profile.ftp);
      this.hud.drawProfile(s.dist, others);
      this.hud.drawMinimap({ x: pos.x, z: pos.z }, others);
      if (!this._ridersAcc || this._ridersAcc++ > 5) {
        this._ridersAcc = 1;
        const list = this.bots
          .map((b) => ({ name: b.name, color: b.color, gap: b.dist - s.dist, wkg: b.power / b.mass }))
          .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))
          .slice(0, 7);
        list.push({ name: this.profile.name, color: this.profile.jersey, gap: 0, wkg: s.power / this.profile.weight, me: true });
        list.sort((a, b) => b.gap - a.gap);
        this.hud.updateRiders(list);
      }
    }
  }

  stop() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKey);
    document.querySelector('#gear-controls').removeEventListener('click', this._onGearBtn);
    this.hud.el.simPower.removeEventListener('input', this._onSim);
    if (this.devices.canControl) this.devices.setSimulation(0);
    document.querySelector('#pause-overlay').hidden = true;
    return {
      samples: this.samples,
      startTime: this.startTime || new Date(),
      segmentResults: this.segmentResults,
      workoutDone: this.workoutDone,
      gear: this.shifter?.gear,
    };
  }
}
