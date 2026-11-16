// 3D-Welt: Gelände, Straße, Vegetation, Landmarken – alles prozedural.
import * as THREE from 'three';
import { makeNoise2D, fbm, smoothstep, lerp, mulberry32, clamp } from './util.js';

export const THEMES = {
  see: { skyTop: '#4f9be8', skyBottom: '#d9eefc', fog: '#cfe5f4', grassA: '#5c9a3b', grassB: '#86b54a', hillAmp: 70, rise: 0.12, lake: true, trees: 2200, snow: 1e9, rock: 1e9, pine: 0.3 },
  huegel: { skyTop: '#5aa4ee', skyBottom: '#f3ecd8', fog: '#e8e4d2', grassA: '#6aa13e', grassB: '#b5b552', hillAmp: 90, rise: 0.16, lake: false, trees: 2400, snow: 1e9, rock: 1e9, pine: 0.15 },
  alpen: { skyTop: '#2f7fdc', skyBottom: '#e3f0fb', fog: '#d4e4f1', grassA: '#4f8a3a', grassB: '#7aa64a', hillAmp: 240, rise: 0.24, lake: false, trees: 2000, snowRel: 0.82, rockRel: 0.62, pine: 0.85 },
  wald: { skyTop: '#5a9fe0', skyBottom: '#e6f2e4', fog: '#c9dccb', grassA: '#3f7d34', grassB: '#5f9a3c', hillAmp: 45, rise: 0.08, lake: false, trees: 4200, snow: 1e9, rock: 1e9, pine: 0.5, dense: true },
};

const ROAD_HALF = 4;

function textTexture(lines, { w = 512, h = 128, bg = '#19c3a6', fg = '#fff', font = 'bold 64px system-ui, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((l, i) => ctx.fillText(l, w / 2, (h / (arr.length + 1)) * (i + 1)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3b3e44'; ctx.fillRect(0, 0, 128, 256);
  const rng = mulberry32(5);
  for (let i = 0; i < 2500; i++) {
    const v = 45 + Math.floor(rng() * 30);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    ctx.fillRect(rng() * 128, rng() * 256, 1.5, 1.5);
  }
  ctx.fillStyle = '#e9e9e4';
  ctx.fillRect(5, 0, 4, 256); ctx.fillRect(119, 0, 4, 256);
  ctx.fillStyle = '#f2d35b';
  ctx.fillRect(62, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 14000);
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
    });
    this.scene.clear();
  }

  dispose() {
    this.clear();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }

  build(route) {
    this.clear();
    this.route = route;
    const base = THEMES[route.def.theme] || THEMES.see;
    const range = route.maxElevation - route.minElevation;
    const theme = (this.theme = {
      ...base,
      snow: base.snowRel ? route.minElevation + base.snowRel * range : base.snow,
      rock: base.rockRel ? route.minElevation + base.rockRel * range : base.rock,
    });
    this.noise = makeNoise2D(route.def.seed * 7 + 3);
    this._buildBucket(route);
    this._sky(theme);
    this._lights();
    this._terrain(route, theme);
    this._road(route);
    this._vegetation(route, theme);
    this._clouds(route);
    this._landmarks(route);
  }

  // -------------------------------------------------------------------------
  _buildBucket(route) {
    this.B = 50;
    this.bucket = new Map();
    for (let i = 0; i < route.n; i += 2) {
      const k = `${Math.floor(route.x[i] / this.B)},${Math.floor(route.z[i] / this.B)}`;
      let arr = this.bucket.get(k);
      if (!arr) this.bucket.set(k, (arr = []));
      arr.push(i);
    }
  }

  /** Nächster Straßenpunkt im Umkreis von ~50 m (sonst d = Infinity). */
  nearestRoad(x, z) {
    const r = this.route, B = this.B;
    const bx = Math.floor(x / B), bz = Math.floor(z / B);
    let best = Infinity, h = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.bucket.get(`${bx + i},${bz + j}`);
      if (!arr) continue;
      for (const k of arr) {
        const dx = r.x[k] - x, dz = r.z[k] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; h = r.y[k]; }
      }
    }
    return { d: Math.sqrt(best), h };
  }

  _sky(theme) {
    const geo = new THREE.SphereGeometry(9000, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(theme.skyTop) }, bottom: { value: new THREE.Color(theme.skyBottom) } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = clamp(vp.y*1.6+0.05,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.7)),1.0); }',
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(theme.fog, 350, 4200);
    this.scene.background = new THREE.Color(theme.fog);
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight('#dfefff', '#5a6b3a', 1.1));
    const sun = (this.sun = new THREE.DirectionalLight('#fff5e0', 2.2));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 1; s.far = 250;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);
  }

  _terrain(route, theme) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < route.n; i++) {
      minX = Math.min(minX, route.x[i]); maxX = Math.max(maxX, route.x[i]);
      minZ = Math.min(minZ, route.z[i]); maxZ = Math.max(maxZ, route.z[i]);
    }
    const margin = 1600;
    const x0 = minX - margin, z0 = minZ - margin;
    const W = maxX - minX + 2 * margin, H = maxZ - minZ + 2 * margin;
    const seg = 300;
    const sx = W / seg, sz = H / seg;
    const verts = (seg + 1) * (seg + 1);
    const heights = new Float32Array(verts);

    // grobe Stützpunkte für inverse Distanzgewichtung
    const cs = [];
    const stride = Math.max(1, Math.round(40 / route.step));
    for (let i = 0; i < route.n; i += stride) cs.push([route.x[i], route.z[i], route.y[i]]);
    const poly = cs; // für Punkt-in-Polygon (See)
    const inside = (x, z) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };

    const noise = this.noise;
    const waterLevel = (this.waterLevel = theme.lake ? route.minElevation - 2.5 : -1e9);
    for (let iz = 0; iz <= seg; iz++) {
      for (let ix = 0; ix <= seg; ix++) {
        const px = x0 + ix * sx, pz = z0 + iz * sz;
        let ws = 0, hs = 0, dmin = Infinity, hmin = 0;
        for (let c = 0; c < cs.length; c++) {
          const dx = cs[c][0] - px, dz = cs[c][1] - pz;
          const d2 = dx * dx + dz * dz;
          const w = 1 / (d2 * d2 + 1e4);
          ws += w; hs += w * cs[c][2];
          if (d2 < dmin) { dmin = d2; hmin = cs[c][2]; }
        }
        let d = Math.sqrt(dmin), roadH = hmin;
        const near = this.nearestRoad(px, pz);
        if (near.d < d) { d = near.d; roadH = near.h; }
        const base = hs / ws;
        const n1 = fbm(noise, px / 700, pz / 700, 5);
        let hills = n1 * theme.hillAmp * smoothstep(30, 600, d) + theme.rise * Math.max(0, d - 80) * (0.7 + 0.6 * (n1 + 1) / 2);
        if (theme.lake && inside(px, pz)) {
          hills = -Math.min(30, Math.max(0, d - 25) * 0.18) + fbm(noise, px / 120, pz / 120, 2) * 2;
        }
        const far = base + hills + fbm(noise, px / 60, pz / 60, 2) * 1.2 * smoothstep(20, 80, d);
        heights[iz * (seg + 1) + ix] = lerp(roadH - 0.9, far, smoothstep(ROAD_HALF + 4, 55, d));
      }
    }
    this.terrain = { x0, z0, sx, sz, seg, heights };

    // Geometrie
    const pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const cA = new THREE.Color(theme.grassA), cB = new THREE.Color(theme.grassB);
    const cRock = new THREE.Color('#7d7a74'), cSnow = new THREE.Color('#f4f7fb'), cSand = new THREE.Color('#d8c690');
    const tmp = new THREE.Color();
    for (let iz = 0; iz <= seg; iz++) {
      for (let ix = 0; ix <= seg; ix++) {
        const i = iz * (seg + 1) + ix;
        const px = x0 + ix * sx, pz = z0 + iz * sz, h = heights[i];
        pos[i * 3] = px; pos[i * 3 + 1] = h; pos[i * 3 + 2] = pz;
        const t = clamp((noise(px / 90 + 50, pz / 90) + 1) / 2, 0, 1);
        tmp.copy(cA).lerp(cB, t);
        const jitter = (noise(px / 13, pz / 13 + 99) + 1) * 0.04;
        if (h > theme.rock) tmp.lerp(cRock, smoothstep(theme.rock, theme.rock + 60, h));
        if (h > theme.snow) tmp.lerp(cSnow, smoothstep(theme.snow, theme.snow + 40, h + noise(px / 40, pz / 40) * 20));
        if (theme.lake && h < waterLevel + 1.5) tmp.lerp(cSand, 0.8);
        col[i * 3] = tmp.r * (0.96 + jitter); col[i * 3 + 1] = tmp.g * (0.96 + jitter); col[i * 3 + 2] = tmp.b * (0.96 + jitter);
      }
    }
    const idx = new Uint32Array(seg * seg * 6);
    let k = 0;
    for (let iz = 0; iz < seg; iz++) for (let ix = 0; ix < seg; ix++) {
      const a = iz * (seg + 1) + ix, b = a + 1, c = a + seg + 1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    if (theme.lake) {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(W, H),
        new THREE.MeshStandardMaterial({ color: '#2d7fb8', roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set(x0 + W / 2, waterLevel, z0 + H / 2);
      water.receiveShadow = true;
      this.scene.add(water);
    }
  }

  terrainHeight(x, z) {
    const t = this.terrain;
    const fx = clamp((x - t.x0) / t.sx, 0, t.seg - 1e-4), fz = clamp((z - t.z0) / t.sz, 0, t.seg - 1e-4);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz, s = t.seg + 1, h = t.heights;
    const a = h[iz * s + ix], b = h[iz * s + ix + 1], c = h[(iz + 1) * s + ix], d = h[(iz + 1) * s + ix + 1];
    // gleiche Dreiecksaufteilung wie das Mesh
    return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  _ribbon(route, half, yOff, mat, vScale) {
    const n = route.n;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const uv = new Float32Array((n + 1) * 2 * 2);
    const s = {};
    for (let i = 0; i <= n; i++) {
      route.sample(i * route.step, s);
      const k = i % n;
      const y = route.y[k] + yOff;
      const lx = route.x[k] - s.rx * half, lz = route.z[k] - s.rz * half;
      const rx = route.x[k] + s.rx * half, rz = route.z[k] + s.rz * half;
      pos.set([lx, y, lz, rx, y, rz], i * 6);
      const v = (i * route.step) / vScale;
      uv.set([0, v, 1, v], i * 4);
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  _road(route) {
    this._ribbon(route, ROAD_HALF + 1.6, 0.04, new THREE.MeshStandardMaterial({ color: '#9b8f72', roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }), 4);
    const mat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    this._ribbon(route, ROAD_HALF, 0.08, mat, 16);
  }

  _vegetation(route, theme) {
    const rng = mulberry32(route.def.seed + 1000);
    const t = this.terrain;
    const W = t.sx * t.seg, H = t.sz * t.seg;
    const foliageA = new THREE.ConeGeometry(2.2, 6.5, 7); foliageA.translate(0, 5.6, 0);
    const foliageB = new THREE.IcosahedronGeometry(2.6, 0); foliageB.translate(0, 5, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.8, 5); trunkGeo.translate(0, 1.4, 0);
    const matLeaf = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
    const matTrunk = new THREE.MeshStandardMaterial({ color: '#6b4a2f', flatShading: true });
    const count = theme.trees;
    const pines = new THREE.InstancedMesh(foliageA, matLeaf, count);
    const leafs = new THREE.InstancedMesh(foliageB, matLeaf.clone(), count);
    const trunks = new THREE.InstancedMesh(trunkGeo, matTrunk, count * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    let np = 0, nl = 0, nt = 0, tries = 0;
    // Bäume bevorzugt in Straßennähe (dort ist man), sonst gleichmäßig
    while (np + nl < count && tries < count * 12) {
      tries++;
      let x, z;
      if (rng() < 0.6) {
        const i = Math.floor(rng() * route.n);
        const ang = rng() * Math.PI * 2, r = 12 + rng() * (theme.dense ? 120 : 260);
        x = route.x[i] + Math.cos(ang) * r; z = route.z[i] + Math.sin(ang) * r;
      } else {
        x = t.x0 + rng() * W; z = t.z0 + rng() * H;
      }
      const near = this.nearestRoad(x, z);
      if (near.d < ROAD_HALF + 6) continue;
      const h = this.terrainHeight(x, z);
      if (h < this.waterLevel + 1 || h > theme.rock + 20) continue;
      if (fbm(this.noise, x / 400 + 10, z / 400, 2) < (theme.dense ? -0.5 : -0.05)) continue; // Lichtungen
      const s = 0.65 + rng() * 0.9;
      q.setFromAxisAngle(sc.set(0, 1, 0), rng() * Math.PI * 2);
      m.compose(p.set(x, h - 0.2, z), q, sc.set(s, s * (0.85 + rng() * 0.4), s));
      const isPine = rng() < theme.pine;
      if (isPine) {
        pines.setMatrixAt(np, m);
        pines.setColorAt(np++, c.setHSL(0.3 + rng() * 0.05, 0.45, 0.18 + rng() * 0.08));
      } else {
        leafs.setMatrixAt(nl, m);
        leafs.setColorAt(nl++, c.setHSL(0.2 + rng() * 0.1, 0.5, 0.28 + rng() * 0.1));
      }
      trunks.setMatrixAt(nt++, m);
    }
    pines.count = np; leafs.count = nl; trunks.count = nt;
    for (const im of [pines, leafs, trunks]) { im.castShadow = true; im.receiveShadow = true; this.scene.add(im); }

    // Felsen
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: '#8b8882', flatShading: true }), 500);
    let nr = 0;
    for (let i = 0; i < 2500 && nr < 500; i++) {
      const x = t.x0 + rng() * W, z = t.z0 + rng() * H;
      if (this.nearestRoad(x, z).d < ROAD_HALF + 3) continue;
      const h = this.terrainHeight(x, z);
      if (h < this.waterLevel) continue;
      const s = 0.5 + rng() * (h > theme.rock ? 6 : 1.8);
      q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      m.compose(p.set(x, h, z), q, sc.set(s, s * 0.7, s));
      rocks.setMatrixAt(nr++, m);
    }
    rocks.count = nr;
    rocks.castShadow = true;
    this.scene.add(rocks);
  }

  _clouds(route) {
    const rng = mulberry32(route.def.seed + 2000);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, fog: false, roughness: 1, emissive: '#cfd8e6', emissiveIntensity: 0.35 });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const t = this.terrain;
    for (let i = 0; i < 45; i++) {
      const g = new THREE.Group();
      const parts = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < parts; j++) {
        const s = new THREE.Mesh(geo, mat);
        s.position.set((rng() - 0.5) * 120, (rng() - 0.5) * 20, (rng() - 0.5) * 50);
        const sc = 30 + rng() * 40;
        s.scale.set(sc, sc * 0.55, sc * 0.8);
        g.add(s);
      }
      g.position.set(t.x0 + rng() * t.sx * t.seg, this.route.maxElevation + 450 + rng() * 500, t.z0 + rng() * t.sz * t.seg);
      this.scene.add(g);
    }
  }

  _arch(route, d, lines, color) {
    const s = route.sample(d);
    const g = new THREE.Group();
    const post = new THREE.BoxGeometry(0.5, 7, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(post, mat);
      p.position.set(side * (ROAD_HALF + 1.2), 3.5, 0);
      p.castShadow = true;
      g.add(p);
    }
    const tex = textTexture(lines, { bg: color });
    const side = new THREE.MeshStandardMaterial({ color });
    const front = new THREE.MeshStandardMaterial({ map: tex });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(2 * ROAD_HALF + 3, 1.7, 0.3), [side, side, side, side, front, front]);
    banner.position.y = 6.6;
    banner.castShadow = true;
    g.add(banner);
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = s.heading;
    this.scene.add(g);
  }

  _landmarks(route) {
    this._arch(route, 0, ['START · ZIEL'], '#19c3a6');
    for (const seg of route.segments) {
      if (seg.type === 'berg') {
        this._arch(route, seg.start, ['BERGWERTUNG'], '#7b4fd6');
        this._arch(route, seg.end, ['GIPFEL'], '#7b4fd6');
      } else if (seg.type === 'sprint') {
        this._arch(route, seg.start, ['SPRINT 500 m'], '#e03170');
      }
    }
    // Kilometerschilder
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5); postGeo.translate(0, 0.8, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: '#ddd' });
    for (let km = 1; km * 1000 < route.length; km++) {
      const s = route.sample(km * 1000);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(postGeo, postMat));
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshStandardMaterial({ map: textTexture(`${km} km`, { w: 256, h: 128, bg: '#f4f4f0', fg: '#1b1d22', font: 'bold 70px system-ui, sans-serif' }) }));
      board.position.y = 1.8;
      board.rotation.y = Math.PI; // zur ankommenden Fahrerin gedreht
      g.add(board);
      g.position.set(s.x + s.rx * (ROAD_HALF + 2.2), s.y, s.z + s.rz * (ROAD_HALF + 2.2));
      g.rotation.y = s.heading;
      this.scene.add(g);
    }
  }

  /** Sonne/Schatten und Himmel der Kamera nachführen. */
  follow(target) {
    this.sun.position.set(target.x + 40, target.y + 90, target.z + 25);
    this.sun.target.position.copy(target);
    this.sky.position.copy(this.camera.position);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
