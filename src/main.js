import './style.css';
import { ROUTES, getRoute } from './route.js';
import { PRESETS, parseZWO, parseDSL, drawWorkout, totalDuration } from './workouts.js';
import { Devices } from './ble.js';
import { World } from './world.js';
import { HUD } from './hud.js';
import { Ride } from './ride.js';
import { store } from './storage.js';
import { computeStats, xpForRide, levelFromXp } from './stats.js';
import { buildTCX, download } from './export.js';
import { fmtTime, fmtKm, zoneFor } from './util.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

const devices = new Devices();
let selectedWorkoutId = null;
let world = null;
let hud = null;
let ride = null;
let lastRide = null;

// ---------------------------------------------------------------------------
// Profil & Einstellungen
function bindProfile() {
  const p = store.profile;
  const map = { '#p-name': 'name', '#p-weight': 'weight', '#p-ftp': 'ftp', '#p-jersey': 'jersey', '#p-helmet': 'helmet' };
  for (const [sel, key] of Object.entries(map)) {
    const el = $(sel);
    el.value = p[key];
    el.addEventListener('change', () => {
      let v = el.value;
      if (key === 'weight') v = Math.min(200, Math.max(30, parseFloat(v) || 75));
      if (key === 'ftp') v = Math.min(600, Math.max(50, parseInt(v, 10) || 200));
      if (key === 'name') v = v.trim() || 'Fahrer:in';
      p[key] = v;
      el.value = v;
      store.save();
      renderWorkouts();
      renderSummaryLine();
    });
  }
  const diff = $('#difficulty');
  diff.value = store.settings.difficulty;
  const showDiff = () => ($('#difficulty-val').textContent = `${diff.value} %`);
  showDiff();
  diff.addEventListener('input', () => { store.settings.difficulty = Number(diff.value); showDiff(); store.save(); });
  const shifting = $('#shifting');
  shifting.checked = store.settings.shifting;
  shifting.addEventListener('change', () => { store.settings.shifting = shifting.checked; store.save(); });
  const bots = $('#bot-count');
  bots.value = store.settings.bots;
  const showBots = () => ($('#bots-val').textContent = bots.value);
  showBots();
  bots.addEventListener('input', () => { store.settings.bots = Number(bots.value); showBots(); store.save(); });
}

function renderLevel() {
  const l = levelFromXp(store.xp);
  $('#level-badge').innerHTML = `<b>Level ${l.level}</b> · ${store.xp} XP<div class="level-bar"><i style="width:${(l.progress * 100).toFixed(1)}%"></i></div>`;
}

// ---------------------------------------------------------------------------
// Geräte
function bindDevices() {
  if (!Devices.supported) {
    $('#bt-hint').innerHTML = '⚠️ Dieser Browser unterstützt kein Web Bluetooth. Für Smart-Trainer bitte Chrome oder Edge (Desktop/Android) verwenden. Der Simulator-Modus funktioniert überall.';
  }
  $('#btn-trainer').addEventListener('click', async () => {
    try {
      $('#st-trainer').textContent = 'suche …';
      await devices.connectTrainer();
    } catch (e) {
      $('#st-trainer').textContent = e.name === 'NotFoundError' ? 'abgebrochen' : `Fehler: ${e.message}`;
    }
  });
  $('#btn-hr').addEventListener('click', async () => {
    try {
      $('#st-hr').textContent = 'suche …';
      await devices.connectHR();
    } catch (e) {
      $('#st-hr').textContent = e.name === 'NotFoundError' ? 'abgebrochen' : `Fehler: ${e.message}`;
    }
  });
  devices.addEventListener('status', (e) => {
    const d = e.detail;
    const el = d.kind === 'trainer' ? $('#st-trainer') : $('#st-hr');
    el.classList.toggle('ok', d.connected);
    if (d.kind === 'trainer') {
      el.textContent = d.connected
        ? `✓ ${d.name} (${d.type === 'ftms' ? (d.control ? 'FTMS, steuerbar' : 'FTMS, nur Daten') : 'Powermeter'})`
        : 'getrennt';
    } else el.textContent = d.connected ? `✓ ${d.name}` : 'getrennt';
    renderSummaryLine();
  });
  devices.addEventListener('data', (e) => {
    const d = e.detail;
    if (!ride && d.power !== undefined && devices.hasTrainer) $('#st-trainer').dataset.live = `${d.power} W`;
  });
}

// ---------------------------------------------------------------------------
// Strecken
function drawRouteProfile(canvas, route) {
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = 460), h = (canvas.height = 92);
  const span = Math.max(40, route.maxElevation - route.minElevation);
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x++) {
    const e = route.elevationAt((x / w) * route.length);
    ctx.lineTo(x, h - 6 - ((e - route.minElevation) / span) * (h - 16));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#19c3a6');
  g.addColorStop(1, 'rgba(25,195,166,.1)');
  ctx.fillStyle = g;
  ctx.fill();
}

function renderRoutes() {
  const list = $('#route-list');
  list.innerHTML = '';
  for (const def of ROUTES) {
    const r = getRoute(def.id);
    const best = r.segments.map((s) => (store.bests[s.id] ? `${s.name}: ${fmtTime(store.bests[s.id])}` : null)).filter(Boolean);
    const el = document.createElement('button');
    el.className = 'tile' + (store.settings.route === def.id ? ' selected' : '');
    el.innerHTML = `<b>${esc(def.name)}</b>
      <span class="meta">${fmtKm(r.length)} km · ${Math.round(r.elevationGain)} Hm · max. ${(r.maxGrade * 100).toFixed(0)} %</span>
      <canvas></canvas>
      <span class="desc">${esc(def.desc)}</span>
      ${best.length ? `<span class="meta">🏆 ${best.map(esc).join(' · ')}</span>` : ''}`;
    drawRouteProfile(el.querySelector('canvas'), r);
    el.addEventListener('click', () => { store.settings.route = def.id; store.save(); renderRoutes(); renderSummaryLine(); });
    list.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Trainings
function allWorkouts() {
  return [...PRESETS, ...store.customWorkouts];
}

function renderWorkouts() {
  const list = $('#workout-list');
  list.innerHTML = '';
  const free = document.createElement('button');
  free.className = 'tile' + (selectedWorkoutId === null ? ' selected' : '');
  free.innerHTML = '<b>Freie Fahrt</b><span class="meta">ohne Vorgaben</span><span class="desc">Einfach losfahren – der Trainer simuliert die Steigung der Strecke.</span>';
  free.addEventListener('click', () => { selectedWorkoutId = null; renderWorkouts(); renderSummaryLine(); });
  list.appendChild(free);
  for (const w of allWorkouts()) {
    const el = document.createElement('button');
    el.className = 'tile' + (selectedWorkoutId === w.id ? ' selected' : '');
    el.innerHTML = `<b>${esc(w.name)}</b><span class="meta">${fmtTime(totalDuration(w))} · ${esc(w.custom ? 'eigenes Training' : 'Vorlage')}</span><canvas></canvas><span class="desc">${esc(w.desc || '')}</span>${w.custom ? '<span class="del ghost" role="button" title="Löschen">✕</span>' : ''}`;
    const c = el.querySelector('canvas');
    c.width = 460; c.height = 92;
    drawWorkout(c, w, { colorFn: (f) => zoneFor(f).color });
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('del')) {
        store.customWorkouts = store.customWorkouts.filter((x) => x.id !== w.id);
        if (selectedWorkoutId === w.id) selectedWorkoutId = null;
        store.save();
      } else selectedWorkoutId = w.id;
      renderWorkouts();
      renderSummaryLine();
    });
    list.appendChild(el);
  }
}

function bindWorkoutTools() {
  $('#wo-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      let w;
      if (file.name.toLowerCase().endsWith('.json')) {
        w = JSON.parse(text);
        if (!Array.isArray(w.segments)) throw new Error('JSON braucht ein Feld „segments“.');
        w = { ...w, id: `import-${Date.now()}`, custom: true, name: w.name || file.name };
      } else w = parseZWO(text);
      store.customWorkouts.push(w);
      store.save();
      selectedWorkoutId = w.id;
      renderWorkouts();
      renderSummaryLine();
    } catch (err) {
      alert(`Import fehlgeschlagen: ${err.message}`);
    }
    e.target.value = '';
  });
  $('#btn-builder').addEventListener('click', () => { $('#builder').hidden = !$('#builder').hidden; preview(); });
  const preview = () => {
    try {
      const w = parseDSL($('#b-dsl').value, $('#b-name').value);
      drawWorkout($('#b-preview'), w, { colorFn: (f) => zoneFor(f).color });
      $('#b-error').textContent = `Dauer ${fmtTime(totalDuration(w))}`;
      return w;
    } catch (err) {
      $('#b-error').textContent = err.message;
      return null;
    }
  };
  $('#b-dsl').addEventListener('input', preview);
  $('#b-save').addEventListener('click', () => {
    const w = preview();
    if (!w) return;
    store.customWorkouts.push(w);
    store.save();
    selectedWorkoutId = w.id;
    $('#builder').hidden = true;
    renderWorkouts();
    renderSummaryLine();
  });
}

// ---------------------------------------------------------------------------
function renderHistory() {
  const h = store.history.slice().reverse();
  if (!h.length) {
    $('#history').innerHTML = '<p class="empty">Noch keine Fahrten – zeit für die erste Runde!</p>';
    return;
  }
  $('#history').innerHTML = `<table><thead><tr><th>Datum</th><th>Strecke</th><th>Training</th><th>Zeit</th><th>Distanz</th><th>Ø W</th><th>NP</th><th>TSS</th><th>Hm</th></tr></thead><tbody>${h
    .slice(0, 20)
    .map((r) => `<tr><td>${new Date(r.date).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(r.route)}</td><td>${esc(r.workout || '–')}</td><td>${fmtTime(r.duration)}</td><td>${fmtKm(r.distance)} km</td><td>${Math.round(r.avgPower)}</td><td>${Math.round(r.np)}</td><td>${Math.round(r.tss)}</td><td>${Math.round(r.elevGain)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function renderSummaryLine() {
  const r = getRoute(store.settings.route);
  const w = allWorkouts().find((x) => x.id === selectedWorkoutId);
  const mode = devices.hasTrainer ? (devices.canControl ? 'Smart-Trainer' : 'Powermeter') : 'Simulator';
  $('#selection-summary').innerHTML = `<b>${esc(r.name)}</b> · ${w ? esc(w.name) : 'Freie Fahrt'} · ${mode}`;
}

// ---------------------------------------------------------------------------
// Fahrt starten / beenden
function show(id) {
  for (const s of ['#menu', '#game', '#summary']) $(s).hidden = s !== id;
}

function startRide() {
  const route = getRoute(store.settings.route);
  const workout = allWorkouts().find((x) => x.id === selectedWorkoutId) || null;
  show('#game');
  if (!world) world = new World($('#view'));
  world.resize();
  if (!hud) hud = new HUD();
  ride = new Ride({
    world, hud, route, workout,
    profile: { ...store.profile, weight: Number(store.profile.weight), ftp: Number(store.profile.ftp), _bests: store.bests },
    devices,
    botCount: store.settings.bots,
    difficulty: store.settings.difficulty,
    cameraIndex: store.settings.camera,
    shifting: store.settings.shifting,
    gear: store.settings.gear,
  });
  ride.start();
}

function endRide() {
  if (!ride) return;
  const result = ride.stop();
  store.settings.camera = ride.camIndex;
  const route = ride.route, workout = ride.workout;
  if (result.gear !== undefined) store.settings.gear = result.gear;
  ride = null;
  world.clear();
  const stats = computeStats(result.samples, { ftp: store.profile.ftp, weight: store.profile.weight });
  if (stats.duration < 10) {
    store.save();
    show('#menu');
    return;
  }
  const xp = xpForRide(stats, result.workoutDone);
  const before = levelFromXp(store.xp).level;
  store.xp += xp;
  const after = levelFromXp(store.xp).level;
  store.history.push({
    date: result.startTime.toISOString(), route: route.name, workout: workout?.name || null,
    duration: stats.duration, distance: stats.distance, avgPower: stats.avgPower, np: stats.np, tss: stats.tss, elevGain: stats.elevGain,
  });
  store.save();
  lastRide = { ...result, stats, route, workout };
  show('#summary');
  renderSummary(lastRide, xp, after > before ? after : null);
}

function renderSummary(r, xp, newLevel) {
  const s = r.stats;
  $('#s-title').textContent = r.workout ? r.workout.name : 'Fahrt beendet';
  $('#s-sub').textContent = `${r.route.name} · ${r.startTime.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}`;
  const items = [
    [fmtTime(s.duration), 'Zeit'], [`${fmtKm(s.distance, 2)} km`, 'Distanz'], [`${s.avgSpeed.toFixed(1)} km/h`, 'Ø Tempo'],
    [`${Math.round(s.elevGain)} Hm`, 'Höhenmeter'], [`${Math.round(s.avgPower)} W`, 'Ø Leistung'], [`${Math.round(s.np)} W`, 'Normalisierte Leistung'],
    [`${Math.round(s.maxPower)} W`, 'Max. Leistung'], [`${s.wkg.toFixed(2)}`, 'Ø W/kg'], [s.IF.toFixed(2), 'Intensitätsfaktor'],
    [Math.round(s.tss), 'Trainingsbelastung (TSS)'], [s.avgHr ? `${Math.round(s.avgHr)} / ${Math.round(s.maxHr)}` : '–', 'Ø / max. Puls'],
    [s.avgCadence ? Math.round(s.avgCadence) : '–', 'Ø Trittfrequenz'], [`${Math.round(s.kcal)} kcal`, 'Energie'],
    [`${Math.round(s.best.s5)} W`, 'Beste 5 s'], [`${Math.round(s.best.m1)} W`, 'Beste 1 min'], [s.best.m5 ? `${Math.round(s.best.m5)} W` : '–', 'Beste 5 min'],
    [s.best.m20 ? `${Math.round(s.best.m20)} W` : '–', 'Beste 20 min'], [`+${xp}`, 'XP'],
  ];
  $('#s-grid').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

  let extra = '';
  if (newLevel) extra += `<div class="callout">🎉 Level ${newLevel} erreicht!</div>`;
  for (const seg of r.segmentResults) extra += `<div class="callout">${esc(seg.name)}: <b>${fmtTime(seg.time)}</b>${seg.isPB ? ' – neue Bestzeit 🏆' : ''}</div>`;
  if (r.workout?.test === 'ramp' && s.best.m1 > 0) {
    const ftp = Math.round(s.best.m1 * 0.75);
    extra += `<div class="callout">Rampentest-Ergebnis: geschätzte FTP <b>${ftp} W</b> (${(ftp / store.profile.weight).toFixed(2)} W/kg). <button id="s-ftp">Als FTP übernehmen</button></div>`;
  }
  $('#s-extra').innerHTML = extra;
  $('#s-ftp')?.addEventListener('click', (e) => {
    store.profile.ftp = Math.round(s.best.m1 * 0.75);
    store.save();
    $('#p-ftp').value = store.profile.ftp;
    e.target.textContent = '✓ übernommen';
    e.target.disabled = true;
  });
  drawSummaryChart($('#s-chart'), r.samples, store.profile.ftp);
}

function drawSummaryChart(c, samples, ftp) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = c.getBoundingClientRect();
  c.width = rect.width * dpr; c.height = rect.height * dpr;
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  if (!samples.length) return;
  const maxP = Math.max(ftp * 1.5, ...samples.map((s) => s.power));
  const n = samples.length;
  for (let x = 0; x < w; x++) {
    const i = Math.floor((x / w) * n);
    const p = samples[i].power;
    ctx.fillStyle = zoneFor(p / ftp).color;
    const bh = (p / maxP) * (h - 10);
    ctx.fillRect(x, h - bh, 1, bh);
  }
  const hrs = samples.map((s) => s.hr);
  if (hrs.some((v) => v > 0)) {
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const v = hrs[Math.floor((x / w) * n)];
      const y = h - (v / 210) * h;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#8b99ad';
  ctx.font = `${12 * dpr}px system-ui`;
  ctx.fillText('Leistung (Zonenfarben) · Puls (rot)', 10 * dpr, 18 * dpr);
}

// ---------------------------------------------------------------------------
function init() {
  bindProfile();
  bindDevices();
  bindWorkoutTools();
  renderLevel();
  renderRoutes();
  renderWorkouts();
  renderHistory();
  renderSummaryLine();
  $('#btn-start').addEventListener('click', startRide);
  $('#btn-end').addEventListener('click', () => { if (confirm('Fahrt beenden?')) endRide(); });
  $('#btn-pause').addEventListener('click', () => ride?.togglePause());
  $('#btn-cam').addEventListener('click', () => ride?.cycleCamera());
  $('#s-back').addEventListener('click', () => { renderLevel(); renderRoutes(); renderHistory(); show('#menu'); });
  $('#s-export').addEventListener('click', () => {
    if (!lastRide) return;
    const xml = buildTCX(lastRide.samples, lastRide.stats, lastRide.startTime, `Radeln – ${lastRide.route.name}`);
    const d = lastRide.startTime;
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    download(`radeln_${stamp}.tcx`, xml);
  });
  window.addEventListener('beforeunload', () => devices.disconnectAll());
  // Test-/Debug-Hook
  window.radeln = { startRide, endRide, get ride() { return ride; }, store };
}

init();
