// Eigenes Low-Poly-Fahrermodell inkl. Tretbewegung (Zwei-Gelenk-IK).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function limb(radius, mat) {
  const g = new THREE.CylinderGeometry(radius, radius * 0.85, 1, 6);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/** Zylinder zwischen zwei Punkten (lokale Koordinaten) platzieren. */
function place(mesh, a, b) {
  tmpA.subVectors(b, a);
  const len = tmpA.length();
  mesh.position.copy(a).addScaledVector(tmpA, 0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, tmpA.normalize());
}

/** Zwei-Gelenk-IK in der y/z-Ebene; Knie zeigt nach vorne (+z). */
function solveKnee(hip, foot, l1, l2, out) {
  tmpB.subVectors(foot, hip);
  let d = tmpB.length();
  d = Math.min(d, l1 + l2 - 1e-3);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  tmpB.normalize();
  // Senkrechte in y/z-Ebene, nach vorne zeigend
  let py = -tmpB.z, pz = tmpB.y;
  if (pz < 0) { py = -py; pz = -pz; }
  out.set(hip.x + (foot.x - hip.x) * (a / d), hip.y + tmpB.y * a + py * h, hip.z + tmpB.z * a + pz * h);
  return out;
}

export function createRider({ jersey = '#19c3a6', helmet = '#ffffff', bike = '#2b2f36', name = null } = {}) {
  const group = new THREE.Group();
  const std = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.7, ...extra });
  const matJersey = std(jersey);
  const matShorts = std('#1b1d22');
  const matSkin = std('#e2b48f');
  const matHelmet = std(helmet, { roughness: 0.4 });
  const matBike = std(bike, { metalness: 0.4, roughness: 0.4 });
  const matTyre = std('#111');
  const matRim = std('#c9ccd3', { metalness: 0.6, roughness: 0.3 });

  // Laufräder
  const wheels = [];
  for (const z of [-0.52, 0.52]) {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 20), matTyre);
    tyre.rotation.y = Math.PI / 2;
    const spokes = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.01, 10, 1, true), matRim);
    spokes.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.62, 0.02), matRim);
    const hub2 = hub.clone(); hub2.rotation.x = Math.PI / 2;
    w.add(tyre, spokes, hub, hub2);
    w.position.set(0, 0.34, z);
    w.traverse((o) => (o.castShadow = true));
    wheels.push(w);
    group.add(w);
  }

  // Rahmen (Diamantrahmen)
  const P = {
    rear: new THREE.Vector3(0, 0.34, -0.52),
    front: new THREE.Vector3(0, 0.34, 0.52),
    bb: new THREE.Vector3(0, 0.3, 0),
    seat: new THREE.Vector3(0, 0.86, -0.16),
    head: new THREE.Vector3(0, 0.82, 0.42),
    bar: new THREE.Vector3(0, 0.95, 0.47),
  };
  const tubes = [
    [P.rear, P.bb], [P.rear, P.seat], [P.bb, P.seat], [P.bb, P.head], [P.seat, P.head], [P.head, P.front], [P.head, P.bar],
  ];
  for (const [a, b] of tubes) {
    const t = limb(0.022, matBike);
    place(t, a, b);
    group.add(t);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.03), matBike);
  bar.position.copy(P.bar);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.26), matShorts);
  saddle.position.set(0, 0.89, -0.18);
  group.add(bar, saddle);

  // Körper
  const hip = new THREE.Vector3(0, 0.95, -0.17);
  const shoulder = new THREE.Vector3(0, 1.36, 0.3);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.58, 0.2), matJersey);
  torso.castShadow = true;
  place(torso, hip, shoulder);
  torso.scale.set(1, 1, 1);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), matSkin);
  head.position.set(0, 1.5, 0.42);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), matHelmet);
  helm.position.set(0, 1.52, 0.4);
  helm.rotation.x = 0.35;
  helm.scale.set(1, 0.9, 1.25);
  head.castShadow = helm.castShadow = true;
  group.add(torso, head, helm);

  // Arme (statisch)
  for (const s of [-1, 1]) {
    const sh = new THREE.Vector3(0.17 * s, 1.33, 0.27);
    const el = new THREE.Vector3(0.2 * s, 1.12, 0.38);
    const hand = new THREE.Vector3(0.2 * s, 0.97, 0.47);
    const upper = limb(0.045, matJersey); place(upper, sh, el);
    const lower = limb(0.035, matSkin); place(lower, el, hand);
    group.add(upper, lower);
  }

  // Beine (animiert)
  const legs = [-1, 1].map((s) => {
    const thigh = limb(0.065, matShorts);
    const shin = limb(0.045, matSkin);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.22), matShorts);
    const crank = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.17), matRim);
    group.add(thigh, shin, shoe, crank);
    return { s, thigh, shin, shoe, crank, hip: new THREE.Vector3(0.1 * s, hip.y, hip.z) };
  });

  // Namensschild
  let label = null;
  if (name) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(10,14,22,.7)';
    ctx.beginPath(); ctx.roundRect(4, 8, 248, 48, 14); ctx.fill();
    ctx.fillStyle = jersey; ctx.fillRect(16, 22, 8, 20);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText(name, 34, 33);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    label.scale.set(1.6, 0.4, 1);
    label.position.set(0, 2.05, 0);
    group.add(label);
  }

  const foot = new THREE.Vector3();
  const knee = new THREE.Vector3();
  let crankAngle = Math.random() * Math.PI * 2;

  function update(dt, speed, cadence) {
    crankAngle += (cadence / 60) * Math.PI * 2 * dt;
    for (const w of wheels) w.rotation.x += (speed / 0.34) * dt;
    for (const L of legs) {
      const a = crankAngle + (L.s > 0 ? 0 : Math.PI);
      foot.set(0.13 * L.s, P.bb.y + Math.cos(a) * 0.17, P.bb.z + Math.sin(a) * 0.17);
      solveKnee(L.hip, foot, 0.44, 0.44, knee);
      place(L.thigh, L.hip, knee);
      place(L.shin, knee, foot);
      L.shoe.position.copy(foot).add(tmpA.set(0, -0.03, 0.03));
      L.crank.position.set(0.08 * L.s, P.bb.y + Math.cos(a) * 0.085, P.bb.z + Math.sin(a) * 0.085);
      L.crank.rotation.x = a - Math.PI / 2;
    }
  }
  update(0, 0, 0);

  return { group, update, label };
}
