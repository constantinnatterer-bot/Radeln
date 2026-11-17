// Head-up-Display während der Fahrt.
import { fmtTime, fmtKm, zoneFor } from './util.js';
import { drawWorkout, totalDuration } from './workouts.js';
import { WHEEL_CIRC } from './shifting.js';

const $ = (s) => document.querySelector(s);

export class HUD {
  constructor() {
    this.el = {
      power: $('#m-power'), wkg: $('#m-wkg'), hr: $('#m-hr'), cad: $('#m-cad'),
      speed: $('#m-speed'), dist: $('#m-dist'), time: $('#m-time'), elev: $('#m-elev'),
      grade: $('#m-grade'), gradeBox: $('#grade-box'), lap: $('#m-lap'), draft: $('#m-draft'),
      zone: $('#power-zone'), riders: $('#riders-list'),
      wo: $('#workout-panel'), woName: $('#wo-name'), woTarget: $('#wo-target'), woRemain: $('#wo-remain'), woNext: $('#wo-next'),
      woGraph: $('#wo-graph'), seg: $('#segment-panel'), toast: $('#toast'), sim: $('#sim-panel'),
      simPower: $('#sim-power'), simLabel: $('#sim-label'), mode: $('#m-mode'),
      gearBox: $('#gear-box'), gear: $('#m-gear'), gearBar: $('#m-gear-bar'), gearRatio: $('#m-gear-ratio'),
      gearControls: $('#gear-controls'), debug: $('#debug-panel'),
    };
    this.profileCanvas = $('#profile');
    this.minimap = $('#minimap');
    this._toastTimer = null;
  }

  setup(route, workout, ftp, simulator, shifter = null) {
    this.el.gearBox.hidden = !shifter;
    // +/− Tasten: schalten, im ERG-Training Intensität, im Simulator Leistung
    this.el.gearControls.hidden = !(shifter || workout || simulator);
    if (shifter) this.updateGear(shifter, 0);
    this.route = route;
    this.workout = workout;
    this.ftp = ftp;
    this.el.wo.hidden = !workout;
    this.el.sim.hidden = !simulator;
    if (workout) this.el.woName.textContent = workout.name;
    this._prepareProfile();
    this._prepareMinimap();
  }

  /** Nach Drehen des Geräts / Größenänderung die Canvas-Grafiken neu aufbauen. */
  relayout() {
    if (!this.route) return;
    this._prepareProfile();
    this._prepareMinimap();
  }

  _fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(10, Math.round(r.width * dpr));
    canvas.height = Math.max(10, Math.round(r.height * dpr));
    return dpr;
  }

  _prepareProfile() {
    const c = this.profileCanvas;
    this._fit(c);
    const r = this.route;
    const w = c.width, h = c.height;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d');
    const span = Math.max(30, r.maxElevation - r.minElevation);
    const yOf = (e) => h - 6 - ((e - r.minElevation) / span) * (h - 16);
    for (let x = 0; x < w; x++) {
      const d = (x / w) * r.length;
      const g = r.gradeAt(d);
      ctx.fillStyle = g > 0.07 ? '#e03170' : g > 0.04 ? '#fd7e14' : g > 0.02 ? '#f5c518' : g < -0.02 ? '#3d8bfd' : '#20c997';
      ctx.globalAlpha = 0.85;
      const y = yOf(r.elevationAt(d));
      ctx.fillRect(x, y, 1, h - y);
    }
    ctx.globalAlpha = 1;
    for (const s of r.segments) {
      ctx.fillStyle = s.type === 'berg' ? 'rgba(123,79,214,.35)' : 'rgba(224,49,112,.3)';
      ctx.fillRect((s.start / r.length) * w, 0, ((s.end - s.start) / r.length) * w, 6);
    }
    this._profileBg = off;
    this._yOf = yOf;
  }

  _prepareMinimap() {
    const c = this.minimap;
    this._fit(c);
    const r = this.route;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < r.n; i += 10) {
      minX = Math.min(minX, r.x[i]); maxX = Math.max(maxX, r.x[i]);
      minZ = Math.min(minZ, r.z[i]); maxZ = Math.max(maxZ, r.z[i]);
    }
    const pad = 12;
    const s = Math.min((c.width - 2 * pad) / (maxX - minX), (c.height - 2 * pad) / (maxZ - minZ));
    const ox = (c.width - (maxX - minX) * s) / 2, oz = (c.height - (maxZ - minZ) * s) / 2;
    this._map = (x, z) => [ox + (x - minX) * s, oz + (z - minZ) * s];
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    const ctx = off.getContext('2d');
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= r.n; i += 8) {
      const [x, y] = this._map(r.x[i % r.n], r.z[i % r.n]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    this._mapBg = off;
  }

  drawProfile(playerDist, others) {
    const c = this.profileCanvas, ctx = c.getContext('2d');
    const r = this.route;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this._profileBg, 0, 0);
    const px = (r.wrap(playerDist) / r.length) * c.width;
    for (const o of others) {
      const x = (r.wrap(o.dist) / r.length) * c.width;
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillRect(x - 1, this._yOf(r.elevationAt(o.dist)) - 6, 2, 6);
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(px - 1.5, 0, 3, c.height);
    ctx.beginPath();
    ctx.arc(px, this._yOf(r.elevationAt(playerDist)) - 4, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#19c3a6';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawMinimap(player, others) {
    const c = this.minimap, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this._mapBg, 0, 0);
    for (const o of others) {
      const [x, y] = this._map(o.x, o.z);
      ctx.fillStyle = o.color;
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    const [x, y] = this._map(player.x, player.z);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#19c3a6';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  update(s) {
    const e = this.el;
    e.power.textContent = Math.round(s.power);
    e.wkg.textContent = (s.power / s.weight).toFixed(1);
    e.hr.textContent = s.hr ? Math.round(s.hr) : '–';
    e.cad.textContent = s.cadence ? Math.round(s.cadence) : '–';
    e.speed.textContent = (s.speed * 3.6).toFixed(1);
    e.dist.textContent = fmtKm(s.dist, 2);
    e.time.textContent = fmtTime(s.elapsed);
    e.elev.textContent = Math.round(s.elevGain);
    e.lap.textContent = `Runde ${s.lap}`;
    const g = s.grade * 100;
    e.grade.textContent = `${g >= 0 ? '' : '−'}${Math.abs(g).toFixed(1)} %`;
    e.gradeBox.dataset.level = g > 7 ? '4' : g > 4 ? '3' : g > 2 ? '2' : g < -2 ? '0' : '1';
    const z = zoneFor(s.power / this.ftp);
    e.zone.style.background = z.color;
    e.zone.textContent = z.name;
    e.draft.hidden = s.draft < 0.05;
    e.draft.textContent = `Windschatten −${Math.round(s.draft * 100)} %`;
    e.mode.textContent = s.modeLabel;
  }

  updateWorkout(info, elapsed, power, ftp) {
    const e = this.el;
    if (!this.workout) return;
    if (!info) {
      e.woTarget.textContent = 'Geschafft!';
      e.woRemain.textContent = '';
      e.woNext.textContent = 'Training abgeschlossen – fahr frei weiter oder beende die Fahrt.';
      drawWorkout(e.woGraph, this.workout, { progress: totalDuration(this.workout), colorFn: (f) => zoneFor(f).color });
      return;
    }
    if (info.fraction === null) {
      e.woTarget.textContent = 'Freie Fahrt';
    } else {
      const target = Math.round(info.fraction * ftp);
      const diff = power - target;
      e.woTarget.innerHTML = `${target} W <small>${Math.round(info.fraction * 100)} % FTP</small>`;
      e.woTarget.dataset.compliance = Math.abs(diff) < target * 0.05 ? 'ok' : diff < 0 ? 'low' : 'high';
    }
    e.woRemain.textContent = fmtTime(info.remaining);
    const n = info.next;
    e.woNext.textContent = n ? `Danach: ${fmtTime(n.dur)} @ ${n.from === null ? 'frei' : Math.round(((n.from + n.to) / 2) * ftp) + ' W'}` : 'Letzter Block';
    if (!this._woFrame || this._woFrame++ % 10 === 0) {
      this._woFrame = 1;
      drawWorkout(e.woGraph, this.workout, { progress: elapsed, colorFn: (f) => zoneFor(f).color });
    }
  }

  updateRiders(list) {
    this.el.riders.innerHTML = list
      .map((r) => `<li class="${r.me ? 'me' : ''}"><span class="dot" style="background:${r.color}"></span><span class="nm">${r.name}</span><span class="gap">${r.me ? '' : (r.gap > 0 ? '+' : '−') + Math.abs(r.gap).toFixed(0) + ' m'}</span><span class="wkg">${r.wkg.toFixed(1)}</span></li>`)
      .join('');
  }

  updateGear(shifter, dir = 0, paused = false) {
    const e = this.el;
    e.gear.textContent = shifter.gear + 1;
    e.gearRatio.textContent = paused ? 'ERG' : `${(shifter.ratio * WHEEL_CIRC).toFixed(1)} m/U`;
    e.gearBar.style.width = `${((shifter.gear + 1) / shifter.count) * 100}%`;
    e.gearBox.classList.toggle('paused', paused);
    if (dir) {
      e.gearBox.classList.remove('up', 'down');
      void e.gearBox.offsetWidth; // Animation neu starten
      e.gearBox.classList.add(dir > 0 ? 'up' : 'down');
    }
  }

  toggleDebug() {
    this.el.debug.hidden = !this.el.debug.hidden;
  }

  /** Diagnosewerte für den Test mit echter Hardware. */
  updateDebug(ride) {
    const el = this.el.debug;
    if (el.hidden) return;
    const d = ride.devices;
    const raw = d.read();
    const v = ride.shifter?.last;
    const rows = [
      ['Trainer', d.trainer ? `${d.trainer.device.name || '?'} (${d.trainer.type}${d.canControl ? ', steuerbar' : ''})` : '– (Simulator)'],
      ['Leistung', `${Math.round(raw.power)} W`],
      ['Trittfrequenz', `${Math.round(raw.cadence)} U/min`],
      ['Trainer-Tempo', `${(raw.speed * 3.6).toFixed(1)} km/h`],
      ['Puls', `${raw.hr || '–'}`],
    ];
    if (ride.shifter) {
      const sh = ride.shifter;
      rows.push(
        ['Gang', `${sh.gear + 1}/${sh.count} · Übersetzung ${sh.ratio.toFixed(2)}`],
        ['Phys. Übersetzung', `${sh.physRatio.toFixed(2)} (${sh.physRatioSamples ? 'gelernt' : 'angenommen'})`],
      );
      if (v) rows.push(
        ['Virtuelles Tempo', `${(v.vv * 3.6).toFixed(1)} km/h`],
        ['Faktor k', v.k.toFixed(2)],
        ['Gesendete Steigung', `${(v.grade * 100).toFixed(1)} %`],
      );
    }
    rows.push(
      ['Strecke', `${(ride.state.grade * 100).toFixed(1)} % · Steigungsgefühl ${Math.round(ride.difficulty * 100)} %`],
      ['Letzter Befehl', d.lastCommand ? `${d.lastCommand.label} (vor ${((Date.now() - d.lastCommand.at) / 1000).toFixed(1)} s)` : '–'],
      ['Befehle gesamt', `${d.commandCount || 0}`],
    );
    if (d.lastError) rows.push(['Fehler', d.lastError]);
    el.innerHTML = `<b>Diagnose</b> <small>(D schließt)</small><table>${rows.map(([k, x]) => `<tr><td>${k}</td><td>${x}</td></tr>`).join('')}</table>`;
  }

  setSegment(text) {
    this.el.seg.hidden = !text;
    if (text) this.el.seg.innerHTML = text;
  }

  toast(text, ms = 3500) {
    const t = this.el.toast;
    t.innerHTML = text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
}
