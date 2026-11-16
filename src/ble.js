// Bluetooth-LE-Anbindung über die Web-Bluetooth-API.
// Unterstützt offene Standards der Bluetooth SIG:
//  - Fitness Machine Service (FTMS) für Smart-Trainer inkl. ERG- und Simulationsmodus
//  - Cycling Power Service (CPS) für Powermeter / Trainer ohne FTMS
//  - Heart Rate Service (HRS) für Brustgurte und Uhren

export const UUID = {
  FTMS: 0x1826,
  INDOOR_BIKE_DATA: 0x2ad2,
  FTMS_CONTROL_POINT: 0x2ad9,
  CPS: 0x1818,
  CP_MEASUREMENT: 0x2a63,
  HRS: 0x180d,
  HR_MEASUREMENT: 0x2a37,
};

/** Indoor Bike Data (0x2AD2) parsen. */
export function parseIndoorBikeData(dv) {
  const flags = dv.getUint16(0, true);
  let o = 2;
  const out = {};
  if (!(flags & 0x0001)) { out.speed = dv.getUint16(o, true) / 100; o += 2; } // km/h
  if (flags & 0x0002) o += 2; // Durchschnittsgeschwindigkeit
  if (flags & 0x0004) { out.cadence = dv.getUint16(o, true) / 2; o += 2; }
  if (flags & 0x0008) o += 2; // Durchschnittstrittfrequenz
  if (flags & 0x0010) o += 3; // Gesamtdistanz
  if (flags & 0x0020) o += 2; // Widerstandsstufe
  if (flags & 0x0040) { out.power = dv.getInt16(o, true); o += 2; }
  if (flags & 0x0080) o += 2; // Durchschnittsleistung
  if (flags & 0x0100) o += 5; // Energie
  if (flags & 0x0200) { out.hr = dv.getUint8(o); o += 1; }
  return out;
}

/** Cycling Power Measurement (0x2A63) parsen. */
export function parseCyclingPower(dv) {
  const flags = dv.getUint16(0, true);
  const out = { power: dv.getInt16(2, true) };
  let o = 4;
  if (flags & 0x0001) o += 1; // Pedal-Balance
  if (flags & 0x0004) o += 2; // akkumuliertes Drehmoment
  if (flags & 0x0010) o += 6; // Radumdrehungen
  if (flags & 0x0020) {
    out.crankRevs = dv.getUint16(o, true);
    out.crankTime = dv.getUint16(o + 2, true); // 1/1024 s
    o += 4;
  }
  return out;
}

/** Heart Rate Measurement (0x2A37) parsen. */
export function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return { hr: flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1) };
}

/** Berechnet die Trittfrequenz aus kumulativen Kurbelumdrehungen. */
export class CadenceCalc {
  constructor() { this.last = null; this.cadence = 0; this.lastChange = 0; }
  update(revs, time, now = Date.now()) {
    if (this.last) {
      const dr = (revs - this.last.revs + 65536) % 65536;
      const dt = ((time - this.last.time + 65536) % 65536) / 1024;
      if (dr > 0 && dt > 0) {
        this.cadence = Math.min(200, (dr / dt) * 60);
        this.lastChange = now;
      } else if (now - this.lastChange > 2500) {
        this.cadence = 0;
      }
    }
    this.last = { revs, time };
    return this.cadence;
  }
}

export function encodeTargetPower(watts) {
  const buf = new DataView(new ArrayBuffer(3));
  buf.setUint8(0, 0x05);
  buf.setInt16(1, Math.round(watts), true);
  return buf.buffer;
}

export function encodeSimulation(grade, { wind = 0, crr = 0.004, cw = 0.51 } = {}) {
  const buf = new DataView(new ArrayBuffer(7));
  buf.setUint8(0, 0x11);
  buf.setInt16(1, Math.round(wind * 1000), true);
  buf.setInt16(3, Math.round(Math.max(-0.4, Math.min(0.4, grade)) * 10000), true);
  buf.setUint8(5, Math.round(crr * 10000));
  buf.setUint8(6, Math.round(cw * 100));
  return buf.buffer;
}

export class Devices extends EventTarget {
  constructor() {
    super();
    this.trainer = null; // { device, type: 'ftms'|'cps', cp }
    this.hrDevice = null;
    this.power = 0;
    this.cadence = 0;
    this.hr = 0;
    this.lastPowerAt = 0;
    this.lastHrAt = 0;
    this._cad = new CadenceCalc();
    this.speed = 0; // km/h vom Trainer
    this._busy = false;
    this._pending = null;
    this.lastCommand = null;
    this._controlGranted = false;
  }

  static get supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  get hasTrainer() { return !!this.trainer; }
  get canControl() { return this.trainer?.type === 'ftms' && !!this.trainer.cp; }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connectTrainer() {
    if (!Devices.supported) throw new Error('Web Bluetooth wird von diesem Browser nicht unterstützt (Chrome oder Edge verwenden).');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UUID.FTMS] }, { services: [UUID.CPS] }],
      optionalServices: [UUID.FTMS, UUID.CPS, UUID.HRS],
    });
    device.addEventListener('gattserverdisconnected', () => {
      this.trainer = null;
      this._controlGranted = false;
      this._emit('status', { kind: 'trainer', connected: false, name: device.name });
    });
    const server = await device.gatt.connect();
    let type = null, cp = null;
    try {
      const svc = await server.getPrimaryService(UUID.FTMS);
      const data = await svc.getCharacteristic(UUID.INDOOR_BIKE_DATA);
      data.addEventListener('characteristicvaluechanged', (e) => this._onBikeData(e.target.value));
      await data.startNotifications();
      try {
        cp = await svc.getCharacteristic(UUID.FTMS_CONTROL_POINT);
        cp.addEventListener('characteristicvaluechanged', () => {});
        await cp.startNotifications();
      } catch (err) {
        console.warn('FTMS Control Point nicht verfügbar', err);
        cp = null;
      }
      type = 'ftms';
    } catch {
      const svc = await server.getPrimaryService(UUID.CPS);
      const meas = await svc.getCharacteristic(UUID.CP_MEASUREMENT);
      meas.addEventListener('characteristicvaluechanged', (e) => this._onPower(e.target.value));
      await meas.startNotifications();
      type = 'cps';
    }
    // Viele Trainer liefern zusätzlich Cycling Power – Trittfrequenz daraus nutzen
    if (type === 'ftms') {
      try {
        const svc = await server.getPrimaryService(UUID.CPS);
        const meas = await svc.getCharacteristic(UUID.CP_MEASUREMENT);
        meas.addEventListener('characteristicvaluechanged', (e) => {
          const r = parseCyclingPower(e.target.value);
          if (r.crankRevs !== undefined && !this._ftmsCadence) this.cadence = this._cad.update(r.crankRevs, r.crankTime);
        });
        await meas.startNotifications();
      } catch { /* optional */ }
    }
    this.trainer = { device, type, cp };
    this._controlGranted = false;
    this._emit('status', { kind: 'trainer', connected: true, name: device.name || 'Trainer', type, control: !!cp });
    return this.trainer;
  }

  async connectHR() {
    if (!Devices.supported) throw new Error('Web Bluetooth wird von diesem Browser nicht unterstützt (Chrome oder Edge verwenden).');
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.HRS] }] });
    device.addEventListener('gattserverdisconnected', () => {
      this.hrDevice = null;
      this._emit('status', { kind: 'hr', connected: false, name: device.name });
    });
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(UUID.HRS);
    const ch = await svc.getCharacteristic(UUID.HR_MEASUREMENT);
    ch.addEventListener('characteristicvaluechanged', (e) => {
      this.hr = parseHeartRate(e.target.value).hr;
      this.lastHrAt = Date.now();
      this._emit('data', { hr: this.hr });
    });
    await ch.startNotifications();
    this.hrDevice = device;
    this._emit('status', { kind: 'hr', connected: true, name: device.name || 'Herzfrequenz' });
  }

  _onBikeData(dv) {
    const r = parseIndoorBikeData(dv);
    if (r.power !== undefined) { this.power = Math.max(0, r.power); this.lastPowerAt = Date.now(); }
    if (r.cadence !== undefined) { this.cadence = r.cadence; this._ftmsCadence = true; }
    if (r.speed !== undefined) this.speed = r.speed;
    if (r.hr && !this.hrDevice) { this.hr = r.hr; this.lastHrAt = Date.now(); }
    this._emit('data', r);
  }

  _onPower(dv) {
    const r = parseCyclingPower(dv);
    this.power = Math.max(0, r.power);
    this.lastPowerAt = Date.now();
    if (r.crankRevs !== undefined) this.cadence = this._cad.update(r.crankRevs, r.crankTime);
    this._emit('data', { power: this.power, cadence: this.cadence });
  }

  /** Aktuelle Werte; veraltete Werte (> 3 s) werden als 0 gewertet. speed in m/s (nur FTMS). */
  read() {
    const now = Date.now();
    const fresh = now - this.lastPowerAt < 3000;
    return {
      power: fresh ? this.power : 0,
      cadence: fresh ? this.cadence : 0,
      speed: fresh ? this.speed / 3.6 : 0,
      hr: now - this.lastHrAt < 5000 ? this.hr : 0,
    };
  }

  /**
   * Schreibt auf den FTMS Control Point. Befehle werden zusammengefasst:
   * Läuft gerade ein Schreibvorgang, wird nur der jeweils neueste Befehl nachgeschickt.
   * So staut sich beim schnellen Schalten nichts auf.
   */
  _write(buffer, label) {
    if (!this.canControl) return;
    this._pending = { buffer, label };
    if (this._busy) return;
    this._busy = true;
    const cp = this.trainer.cp;
    (async () => {
      try {
        if (!this._controlGranted) {
          await cp.writeValue(new Uint8Array([0x00])); // Request Control
          await cp.writeValue(new Uint8Array([0x07])); // Start/Resume
          this._controlGranted = true;
        }
        while (this._pending) {
          const { buffer: b, label: l } = this._pending;
          this._pending = null;
          await cp.writeValue(b);
          this.lastCommand = { label: l, at: Date.now() };
          this.commandCount = (this.commandCount || 0) + 1;
        }
      } catch (err) {
        console.warn('FTMS-Schreibfehler', err);
        this.lastError = String(err?.message || err);
      } finally {
        this._busy = false;
      }
    })();
  }

  setTargetPower(watts) { this._write(encodeTargetPower(watts), `ERG ${Math.round(watts)} W`); }
  setSimulation(grade, opts) { this._write(encodeSimulation(grade, opts), `Sim ${(grade * 100).toFixed(1)} %`); }

  disconnectAll() {
    try { this.trainer?.device.gatt.disconnect(); } catch { /* ignore */ }
    try { this.hrDevice?.gatt.disconnect(); } catch { /* ignore */ }
  }
}
