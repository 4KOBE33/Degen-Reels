// Chunky bean-shaped cartoon characters with procedural (code-driven) animation.
import * as THREE from 'three';
import { part, toon, canvasTexture, INK } from './toon.js';

const EYE_WHITE = 0xffffff;

function buildHat(kind) {
  const hat = new THREE.Group();
  if (kind === 'top') {
    hat.add(part(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), 0x222222));
    const crown = part(new THREE.CylinderGeometry(0.28, 0.3, 0.5, 20), 0x222222);
    crown.position.y = 0.27;
    hat.add(crown);
    const band = part(new THREE.CylinderGeometry(0.305, 0.305, 0.1, 20), 0xe63946, { ink: 0 });
    band.position.y = 0.08;
    hat.add(band);
  } else if (kind === 'cowboy') {
    const brim = part(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 24), 0x8b5a2b);
    brim.scale.z = 0.85;
    hat.add(brim);
    const crown = part(new THREE.SphereGeometry(0.32, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0x8b5a2b);
    crown.scale.y = 1.2;
    hat.add(crown);
  } else if (kind === 'visor') {
    const band = part(new THREE.TorusGeometry(0.4, 0.05, 8, 24), 0x1f8a4c);
    band.rotation.x = Math.PI / 2;
    hat.add(band);
    const bill = part(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 20, 1, false, Math.PI / 2, Math.PI), toon(0x2ecc71, { unique: true, transparent: true, opacity: 0.85 }));
    bill.position.set(0, 0, -0.3);
    hat.add(bill);
    hat.position.y = -0.12;
  } else if (kind === 'party') {
    const cone = part(new THREE.ConeGeometry(0.25, 0.6, 16), 0xff7eb6);
    cone.position.y = 0.3;
    hat.add(cone);
    const pom = part(new THREE.SphereGeometry(0.09, 10, 8), 0xffd23f);
    pom.position.y = 0.62;
    hat.add(pom);
    hat.rotation.z = 0.2;
  } else if (kind === 'beanie') {
    const cap = part(new THREE.SphereGeometry(0.4, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0x2a9d8f);
    cap.scale.y = 0.8;
    cap.position.y = -0.12;
    const cuff = part(new THREE.CylinderGeometry(0.41, 0.41, 0.12, 18), 0x21867a, { ink: 0.02 });
    cuff.position.y = -0.1;
    const pom = part(new THREE.SphereGeometry(0.1, 10, 8), 0xfff6e0, { ink: 0.02 });
    pom.position.y = 0.24;
    hat.add(cap, cuff, pom);
  } else if (kind === 'cap') {
    const dome = part(new THREE.SphereGeometry(0.38, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xe63946);
    dome.position.y = -0.1;
    const bill = part(new THREE.BoxGeometry(0.42, 0.04, 0.32), 0xe63946, { ink: 0.02 });
    bill.position.set(0, -0.08, -0.44);
    hat.add(dome, bill);
  } else if (kind === 'propeller') {
    const dome = part(new THREE.SphereGeometry(0.37, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xffd23f);
    dome.position.y = -0.1;
    const stem = part(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), 0x374151, { ink: 0.01 });
    stem.position.y = 0.36;
    const prop = new THREE.Group();
    prop.position.y = 0.46;
    for (const [c, r] of [[0xe63946, 0], [0x4dabff, Math.PI]]) {
      const blade = part(new THREE.BoxGeometry(0.34, 0.02, 0.09), c, { ink: 0.01 });
      blade.position.x = 0.17;
      const arm = new THREE.Group();
      arm.rotation.y = r;
      arm.add(blade);
      prop.add(arm);
    }
    hat.userData.spin = prop;
    hat.add(dome, stem, prop);
  } else if (kind === 'chef') {
    const band = part(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 18), 0xffffff, { ink: 0.02 });
    band.position.y = 0.02;
    hat.add(band);
    for (const [x, z] of [[0, 0], [0.16, 0.1], [-0.16, 0.1], [0, -0.16]]) {
      const puff = part(new THREE.SphereGeometry(0.22, 12, 10), 0xffffff, { ink: 0.02 });
      puff.position.set(x, 0.3, z);
      hat.add(puff);
    }
  } else if (kind === 'viking') {
    const dome = part(new THREE.SphereGeometry(0.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x9ca3af);
    dome.position.y = -0.12;
    hat.add(dome);
    for (const side of [-1, 1]) {
      const horn = part(new THREE.ConeGeometry(0.09, 0.42, 10), 0xfff6e0, { ink: 0.02 });
      horn.position.set(side * 0.42, 0.12, 0);
      horn.rotation.z = -side * 0.9;
      hat.add(horn);
    }
  } else if (kind === 'halo') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.38;
    hat.add(ring);
  } else if (kind === 'crown') {
    const ring = part(new THREE.CylinderGeometry(0.3, 0.28, 0.22, 10, 1, true), toon(0xffd23f, { unique: true, side: THREE.DoubleSide }));
    ring.position.y = 0.1;
    hat.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = part(new THREE.ConeGeometry(0.07, 0.18, 6), 0xffd23f, { ink: 0.02 });
      spike.position.set(Math.cos(a) * 0.28, 0.29, Math.sin(a) * 0.28);
      hat.add(spike);
    }
  }
  return hat;
}

// ---------- face and outfit pieces (see looks.js for the list) ----------

function buildPupil(style) {
  if (style === 'stars') {
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.085, 0), toon(0xffd23f));
    star.scale.z = 0.4;
    return star;
  }
  if (style === 'dollar') {
    const tex = canvasTexture(64, 64, (c, w, h) => {
      c.fillStyle = '#16a34a';
      c.beginPath(); c.arc(w / 2, h / 2, 30, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff6e0';
      c.font = 'bold 46px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('$', w / 2, h / 2 + 3);
    });
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), new THREE.MeshBasicMaterial({ map: tex }));
    m.rotation.y = Math.PI;
    return m;
  }
  const r = style === 'big' ? 0.11 : 0.075;
  return new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), toon(INK));
}

function addEyeExtras(eye, style, side, color) {
  if (style === 'sleepy') {
    // A heavy lid in the body color over the top half.
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), toon(color));
    lid.rotation.x = -0.35;
    eye.add(lid);
  } else if (style === 'angry') {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.06), toon(INK));
    brow.position.set(0, 0.17, -0.1);
    brow.rotation.z = side * 0.45;
    eye.add(brow);
  } else if (style === 'happy') {
    // ^ ^ eyes: hide the pupil behind a curved line.
    eye.scale.y = 0.75;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 6, 12, Math.PI), toon(INK));
    arc.position.set(0, -0.02, -0.15);
    eye.add(arc);
    eye.userData.hidePupil = true;
  }
}

function buildMouth(style) {
  const g = new THREE.Group();
  g.position.set(0, 0.16, -0.47);
  const ink = toon(INK);
  if (style === 'grin') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), ink);
    m.scale.set(1, 0.7, 0.4);
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.02), toon(0xffffff));
    teeth.position.set(0, -0.02, -0.05);
    g.add(m, teeth);
  } else if (style === 'o') {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.022, 6, 14), ink);
    g.add(m);
  } else if (style === 'flat') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), ink);
    g.add(m);
  } else if (style === 'mustache') {
    for (const side of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.11, 4, 8), toon(0x3b2a1a));
      half.rotation.z = Math.PI / 2 + side * 0.35;
      half.position.set(side * 0.07, 0.05, -0.02);
      g.add(half);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 10, Math.PI), ink);
    smile.rotation.z = Math.PI;
    smile.position.y = -0.03;
    g.add(smile);
  } else {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12, Math.PI), ink);
    m.rotation.set(0.25, 0, Math.PI);
    g.add(m);
    if (style === 'tongue') {
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toon(0xff7eb6));
      t.scale.set(1, 1.3, 0.5);
      t.position.set(0.02, -0.1, -0.01);
      g.add(t);
    }
    if (style === 'goldtooth') {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.02), toon(0xffd23f));
      tooth.position.set(0.04, -0.07, -0.02);
      g.add(tooth);
    }
  }
  return g;
}

function buildGlasses(style) {
  const g = new THREE.Group();
  g.position.set(0, 0.38, -0.52);
  const frame = toon(INK);
  if (style === 'eyepatch') {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), frame);
    patch.position.set(0.19, 0, -0.02);
    patch.rotation.y = Math.PI;
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.015, 4, 32), frame);
    strap.position.set(0, 0.04, 0.42);
    strap.rotation.set(Math.PI / 2, 0, 0.35);
    g.add(patch, strap);
    return g;
  }
  if (style === 'monocle') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 20), toon(0xd4a63a));
    ring.position.x = 0.19;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.14, 18), new THREE.MeshBasicMaterial({ color: 0xbfe3f5, transparent: true, opacity: 0.35 }));
    lens.position.x = 0.19;
    lens.rotation.y = Math.PI;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 4), toon(0xd4a63a));
    chain.position.set(0.3, -0.2, 0.05);
    chain.rotation.z = 0.3;
    g.add(ring, lens, chain);
    return g;
  }
  const tint = { shades: 0x111827, nerd: 0xbfe3f5, star: 0xff3fa4 }[style] || 0x111827;
  const opacity = style === 'nerd' ? 0.3 : 0.92;
  for (const side of [-1, 1]) {
    let lens;
    if (style === 'star') {
      lens = new THREE.Mesh(new THREE.CircleGeometry(0.17, 5), new THREE.MeshBasicMaterial({ color: tint }));
      lens.rotation.z = Math.PI / 2;
    } else {
      lens = new THREE.Mesh(style === 'nerd' ? new THREE.CircleGeometry(0.15, 18) : new THREE.PlaneGeometry(0.28, 0.17), new THREE.MeshBasicMaterial({ color: tint, transparent: opacity < 1, opacity }));
    }
    lens.position.x = side * 0.19;
    lens.rotation.y = Math.PI;
    g.add(lens);
    if (style === 'nerd') {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 20), frame);
      rim.position.x = side * 0.19;
      g.add(rim);
    }
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.03), frame);
  g.add(bridge);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.4), frame);
    arm.position.set(side * 0.38, 0, 0.2);
    g.add(arm);
  }
  return g;
}

function buildNeck(style) {
  const g = new THREE.Group();
  if (style === 'bowtie') {
    g.position.set(0, -0.02, -0.5);
    for (const side of [-1, 1]) {
      const wing = part(new THREE.ConeGeometry(0.1, 0.16, 4), 0xe63946, { ink: 0.015, shadow: false });
      wing.rotation.z = side * Math.PI / 2;
      wing.position.x = side * 0.08;
      g.add(wing);
    }
    const knot = part(new THREE.SphereGeometry(0.045, 8, 6), 0xb5172b, { ink: 0.01, shadow: false });
    g.add(knot);
  } else if (style === 'scarf') {
    const wrap = part(new THREE.TorusGeometry(0.47, 0.09, 8, 24), 0xe63946, { ink: 0.02, shadow: false });
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.0;
    const tail = part(new THREE.BoxGeometry(0.14, 0.4, 0.06), 0xe63946, { ink: 0.02, shadow: false });
    tail.position.set(0.2, -0.22, -0.47);
    tail.rotation.z = 0.15;
    g.add(wrap, tail);
  } else if (style === 'chain' || style === 'medal') {
    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 28, Math.PI), toon(0xffd23f));
    chain.rotation.set(Math.PI / 2 + 0.5, 0, Math.PI);
    chain.position.set(0, 0.04, -0.06);
    g.add(chain);
    const charm = style === 'medal'
      ? part(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), 0xffd23f, { ink: 0.015, shadow: false })
      : part(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), 0xffd23f, { ink: 0.015, shadow: false });
    charm.rotation.x = Math.PI / 2;
    charm.position.set(0, -0.3, -0.49);
    g.add(charm);
  } else if (style === 'cape') {
    const cape = part(new THREE.CylinderGeometry(0.52, 0.62, 1.0, 16, 1, true, -Math.PI * 0.4, Math.PI * 0.8), toon(0x7b2cbf, { side: THREE.DoubleSide }), { ink: 0, shadow: true });
    cape.position.set(0, -0.35, 0.02);
    const clasp = part(new THREE.SphereGeometry(0.05, 8, 6), 0xffd23f, { ink: 0.01, shadow: false });
    clasp.position.set(0, 0.12, -0.46);
    g.add(cape, clasp);
  }
  return g;
}

// Gun models point down -Z from the grip. Each has a `muzzle` marker.
// `tint` recolors the main body for rare guns.
export function buildGun(kind, tint = null) {
  const main = (base) => (tint === null ? base : tint);
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  if (kind === 'spoon') {
    const handle = part(new THREE.BoxGeometry(0.06, 0.06, 0.6), 0xd1d5db, { ink: 0.02 });
    handle.position.z = -0.25;
    const bowl = part(new THREE.SphereGeometry(0.15, 14, 10), main(0xe5e7eb), { ink: 0.025 });
    bowl.scale.set(1, 0.45, 1.35);
    bowl.position.z = -0.65;
    g.add(handle, bowl);
    muzzle.position.z = -0.7;
  } else if (kind === 'pistol') {
    const body = part(new THREE.BoxGeometry(0.14, 0.17, 0.48), main(0x4dabff), { ink: 0.025 });
    body.position.set(0, 0.05, -0.16);
    const grip = part(new THREE.BoxGeometry(0.11, 0.24, 0.13), 0x374151, { ink: 0.025 });
    grip.position.set(0, -0.08, 0.02);
    grip.rotation.x = 0.25;
    const tip = part(new THREE.BoxGeometry(0.15, 0.15, 0.06), 0xff9f43, { ink: 0.02 });
    tip.position.set(0, 0.05, -0.42);
    g.add(body, grip, tip);
    muzzle.position.set(0, 0.05, -0.47);
  } else if (kind === 'smg') {
    const body = part(new THREE.BoxGeometry(0.16, 0.2, 0.72), main(0x2ee6d6), { ink: 0.025 });
    body.position.set(0, 0.05, -0.22);
    const mag = part(new THREE.BoxGeometry(0.1, 0.3, 0.12), 0x374151, { ink: 0.02 });
    mag.position.set(0, -0.17, -0.2);
    const grip = part(new THREE.BoxGeometry(0.1, 0.2, 0.12), 0x374151, { ink: 0.02 });
    grip.position.set(0, -0.08, 0.06);
    const barrel = part(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8), 0x1f2937, { ink: 0.02 });
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.07, -0.66);
    g.add(body, mag, grip, barrel);
    muzzle.position.set(0, 0.07, -0.78);
  } else if (kind === 'shotgun') {
    const stock = part(new THREE.BoxGeometry(0.13, 0.17, 0.5), 0x8b5a2b, { ink: 0.025 });
    stock.position.set(0, 0, 0.1);
    const barrel = part(new THREE.BoxGeometry(0.13, 0.13, 0.85), main(0x4b5563), { ink: 0.025 });
    barrel.position.set(0, 0.05, -0.55);
    const pump = part(new THREE.BoxGeometry(0.16, 0.1, 0.28), 0xb7791f, { ink: 0.02 });
    pump.position.set(0, -0.04, -0.6);
    g.add(stock, barrel, pump);
    muzzle.position.set(0, 0.05, -1.0);
  } else if (kind === 'rifle') {
    // High Roller: a long marksman rifle with a gold scope.
    const stock = part(new THREE.BoxGeometry(0.1, 0.18, 0.42), 0x6b3f1d, { ink: 0.025 });
    stock.position.set(0, -0.01, 0.16);
    const body = part(new THREE.BoxGeometry(0.12, 0.15, 0.6), main(0x7b2cbf), { ink: 0.025 });
    body.position.set(0, 0.03, -0.32);
    const barrel = part(new THREE.CylinderGeometry(0.03, 0.035, 0.75, 8), 0x1f2937, { ink: 0.02 });
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, -0.95);
    const scope = part(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 10), 0xd4a63a, { ink: 0.02 });
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.17, -0.3);
    const grip = part(new THREE.BoxGeometry(0.09, 0.2, 0.11), 0x374151, { ink: 0.02 });
    grip.position.set(0, -0.11, -0.05);
    grip.rotation.x = 0.25;
    g.add(stock, body, barrel, scope, grip);
    muzzle.position.set(0, 0.05, -1.34);
  } else if (kind === 'bat') {
    // Pit Boss Bat: a fat wooden bat with a gold band.
    const handle = part(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 8), 0x3f2e1f, { ink: 0.015 });
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -0.05;
    const barrel = part(new THREE.CylinderGeometry(0.1, 0.05, 0.75, 12), main(0xc08a3e), { ink: 0.025 });
    barrel.rotation.x = -Math.PI / 2;
    barrel.position.z = -0.6;
    const band = part(new THREE.CylinderGeometry(0.095, 0.095, 0.06, 12), 0xffd23f, { ink: 0 });
    band.rotation.x = Math.PI / 2;
    band.position.z = -0.75;
    g.add(handle, barrel, band);
    muzzle.position.z = -1.0;
  } else if (kind === 'revolver') {
    const barrel = part(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 10), main(0x9ca3af), { ink: 0.02 });
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.07, -0.34);
    const cyl = part(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 6), 0x6b7280, { ink: 0.02 });
    cyl.rotation.x = Math.PI / 2;
    cyl.position.set(0, 0.05, -0.08);
    const grip = part(new THREE.BoxGeometry(0.09, 0.22, 0.12), 0x8b5a2b, { ink: 0.02 });
    grip.position.set(0, -0.08, 0.06);
    grip.rotation.x = 0.4;
    g.add(barrel, cyl, grip);
    muzzle.position.set(0, 0.07, -0.56);
  } else if (kind === 'dbarrel') {
    // Double Down: a sawed-off double barrel.
    for (const dx of [-0.045, 0.045]) {
      const b = part(new THREE.CylinderGeometry(0.045, 0.045, 0.55, 10), main(0x4b5563), { ink: 0.02 });
      b.rotation.x = Math.PI / 2;
      b.position.set(dx, 0.06, -0.38);
      g.add(b);
    }
    const body = part(new THREE.BoxGeometry(0.16, 0.13, 0.2), 0x374151, { ink: 0.02 });
    body.position.set(0, 0.05, -0.05);
    const grip = part(new THREE.BoxGeometry(0.1, 0.2, 0.18), 0x8b5a2b, { ink: 0.02 });
    grip.position.set(0, -0.06, 0.12);
    grip.rotation.x = 0.5;
    g.add(body, grip);
    muzzle.position.set(0, 0.06, -0.68);
  } else if (kind === 'ar') {
    // Card Counter: an assault rifle with a card-suit stock.
    const body = part(new THREE.BoxGeometry(0.14, 0.17, 0.7), main(0x1f8a4c), { ink: 0.025 });
    body.position.set(0, 0.05, -0.25);
    const stock = part(new THREE.BoxGeometry(0.1, 0.16, 0.3), 0x1f2937, { ink: 0.02 });
    stock.position.set(0, 0.02, 0.22);
    const barrel = part(new THREE.CylinderGeometry(0.035, 0.035, 0.35, 8), 0x1f2937, { ink: 0.02 });
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.07, -0.76);
    const mag = part(new THREE.BoxGeometry(0.08, 0.26, 0.12), 0x1f2937, { ink: 0.02 });
    mag.position.set(0, -0.15, -0.28);
    mag.rotation.x = -0.2;
    const sight = part(new THREE.BoxGeometry(0.06, 0.06, 0.12), 0xe63946, { ink: 0.015 });
    sight.position.set(0, 0.17, -0.25);
    g.add(body, stock, barrel, mag, sight);
    muzzle.position.set(0, 0.07, -0.95);
  } else if (kind === 'sniper') {
    // Ace in the Hole: very long, big scope, bipod.
    const stock = part(new THREE.BoxGeometry(0.1, 0.18, 0.45), 0x1f2937, { ink: 0.025 });
    stock.position.set(0, -0.01, 0.2);
    const body = part(new THREE.BoxGeometry(0.12, 0.15, 0.6), main(0x111827), { ink: 0.025 });
    body.position.set(0, 0.03, -0.3);
    const barrel = part(new THREE.CylinderGeometry(0.035, 0.04, 1.0, 8), 0x1f2937, { ink: 0.02 });
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, -1.1);
    const scope = part(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 12), 0xffd23f, { ink: 0.02 });
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.19, -0.3);
    for (const dx of [-0.07, 0.07]) {
      const leg = part(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5), 0x374151, { ink: 0 });
      leg.position.set(dx, -0.1, -1.1);
      leg.rotation.z = dx * 4;
      g.add(leg);
    }
    g.add(stock, body, barrel, scope);
    muzzle.position.set(0, 0.05, -1.62);
  } else if (kind === 'minigun') {
    // The Whale: a spinning six-barrel minigun.
    const body = part(new THREE.BoxGeometry(0.28, 0.26, 0.45), main(0x2563eb), { ink: 0.03 });
    body.position.set(0, 0.05, -0.05);
    const barrels = new THREE.Group();
    barrels.position.set(0, 0.06, -0.55);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = part(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), 0x1f2937, { ink: 0.01 });
      b.rotation.x = Math.PI / 2;
      b.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0);
      barrels.add(b);
    }
    const ring = part(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 12), 0xffd23f, { ink: 0.01 });
    ring.rotation.x = Math.PI / 2;
    ring.position.z = -0.25;
    barrels.add(ring);
    g.userData.spin = barrels;
    const handle = part(new THREE.BoxGeometry(0.06, 0.18, 0.06), 0x374151, { ink: 0.01 });
    handle.position.set(0, 0.26, -0.05);
    g.add(body, barrels, handle);
    muzzle.position.set(0, 0.06, -0.92);
  } else if (kind === 'rocket') {
    const tube = part(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 14), main(0x5ee27a), { ink: 0.03 });
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.12, -0.25);
    const band = part(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 14), 0xffd23f, { ink: 0 });
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.12, -0.7);
    const grip = part(new THREE.BoxGeometry(0.1, 0.22, 0.12), 0x374151, { ink: 0.02 });
    grip.position.set(0, -0.08, 0);
    g.add(tube, band, grip);
    muzzle.position.set(0, 0.12, -0.88);
  }
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

function makeNameTag() {
  const tex = canvasTexture(256, 80, () => {});
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.69, 1);
  sprite.renderOrder = 10;
  let last = '';
  sprite.userData.set = (name, chips, armor, color) => {
    const key = `${name}|${chips}|${armor}`;
    if (key === last) return;
    last = key;
    const { ctx } = tex.userData;
    ctx.clearRect(0, 0, 256, 80);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.font = "34px 'Luckiest Guy', 'Arial Black', sans-serif";
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1b0f2b';
    ctx.fillStyle = color;
    ctx.strokeText(name, 128, 34);
    ctx.fillText(name, 128, 34);
    ctx.font = "28px 'Luckiest Guy', 'Arial Black', sans-serif";
    ctx.fillStyle = '#ffd23f';
    const stack = `❤️${chips}${armor > 0 ? `  🛡️${armor}` : ''}`;
    ctx.strokeText(stack, 128, 70);
    ctx.fillText(stack, 128, 70);
    tex.needsUpdate = true;
  };
  return sprite;
}

export function createCharacter({ color = 0xff5d5d, hat = 'top', eyes: eyeStyle = 'normal', mouth: mouthStyle = 'smile', glasses = 'none', neck = 'none', shoes = 0x2b2140 } = {}) {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  // Everything that squashes and leans hangs off this pivot at the feet.
  const pivot = new THREE.Group();
  root.add(pivot);

  const bodyMat = toon(color, { unique: true, emissive: 0xffffff, emissiveIntensity: 0 });
  const body = part(new THREE.CapsuleGeometry(0.5, 0.6, 8, 20), bodyMat, { ink: 0.045 });
  body.position.y = 0.95;
  pivot.add(body);

  // A lighter belly patch.
  const belly = part(new THREE.SphereGeometry(0.36, 16, 12), toon(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHex()), { ink: 0, shadow: false });
  belly.scale.set(1, 1.15, 0.5);
  belly.position.set(0, -0.12, -0.3);
  body.add(belly);

  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = part(new THREE.SphereGeometry(0.17, 16, 12), EYE_WHITE, { ink: 0.025, shadow: false });
    eye.scale.z = 0.7;
    eye.position.set(side * 0.19, 0.38, -0.4);
    const pupil = buildPupil(eyeStyle);
    pupil.position.set(0, 0, -0.14);
    eye.add(pupil);
    addEyeExtras(eye, eyeStyle, side, color);
    const cross = new THREE.Group();
    for (const r of [0.785, -0.785]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), toon(INK));
      bar.rotation.z = r;
      cross.add(bar);
    }
    cross.position.z = -0.13;
    cross.visible = false;
    eye.add(cross);
    eye.userData = { pupil, cross };
    body.add(eye);
    eyes.push(eye);
  }

  body.add(buildMouth(mouthStyle));
  if (glasses !== 'none') body.add(buildGlasses(glasses));
  if (neck !== 'none') body.add(buildNeck(neck));

  const hatMesh = buildHat(hat);
  hatMesh.position.y += 0.78;
  body.add(hatMesh);

  const feet = [];
  for (const side of [-1, 1]) {
    const foot = part(new THREE.SphereGeometry(0.2, 14, 10), shoes, { ink: 0.03 });
    foot.scale.set(0.95, 0.6, 1.3);
    foot.position.set(side * 0.23, 0.11, 0);
    pivot.add(foot);
    feet.push(foot);
  }

  const handMat = toon(color);
  const leftHand = part(new THREE.SphereGeometry(0.14, 12, 10), handMat, { ink: 0.03 });
  leftHand.position.set(-0.58, 0.9, -0.15);
  pivot.add(leftHand);

  // The aim arm pitches up/down with your aim and holds the gun.
  const arm = new THREE.Group();
  arm.position.set(0.42, 1.05, -0.2);
  pivot.add(arm);
  const rightHand = part(new THREE.SphereGeometry(0.14, 12, 10), handMat, { ink: 0.03 });
  rightHand.position.set(0, 0, -0.25);
  arm.add(rightHand);
  const gunMount = new THREE.Group();
  gunMount.position.set(0, 0.04, -0.3);
  arm.add(gunMount);

  // Headshot zone: the top of the bean, where the eyes and hat are.
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  headHit.position.set(0, 0.42, -0.05);
  body.add(headHit);

  const tag = makeNameTag();
  tag.position.y = 2.45;
  root.add(tag);

  const cssColor = `#${new THREE.Color(color).getHexString()}`;

  const anim = {
    phase: 0, squash: 1, squashVel: 0, recoil: 0, swing: 0, flash: 0, dead: 0, t: Math.random() * 10,
  };
  let gun = null;
  let weapon = null;
  let weaponKind = 'fists';

  return {
    root,
    body,
    headHit,
    get muzzle() { return gun ? gun.userData.muzzle : rightHand; },
    setWeapon(kind, tint = null) {
      const key = `${kind}|${tint}`;
      if (key === weapon) return;
      weapon = key;
      weaponKind = kind;
      if (gun) gunMount.remove(gun);
      gun = kind === 'fists' ? null : buildGun(kind, tint);
      if (gun) gunMount.add(gun);
    },
    setTag(name, chips, armor) { tag.userData.set(name, chips, armor, cssColor); },
    showTag(v) { tag.visible = v; },
    // First person: hide everything but the gun arm so it doesn't block the camera.
    firstPerson(on) {
      body.visible = !on;
      leftHand.visible = !on;
      for (const f of feet) f.visible = !on;
    },
    jump() { anim.squashVel = 4; },
    land(speed) { anim.squashVel = -Math.min(6, speed * 0.6); },
    recoil(amount = 1) { anim.recoil = amount; },
    swing() { anim.swing = 1; },
    hurt() { anim.flash = 0.12; anim.squashVel -= 2.5; },

    // s: { speed, forward, side, onGround, pitch, dead }
    animate(dt, s) {
      anim.t += dt;
      // The Whale's barrels spin up while firing.
      if (gun && gun.userData.spin) gun.userData.spin.rotation.z += dt * (anim.recoil > 0.05 ? 40 : 3);
      if (hatMesh.userData.spin) hatMesh.userData.spin.rotation.y += dt * 14;
      const moving = Math.min(1, s.speed / 6);
      anim.phase += dt * (6 + s.speed * 1.1) * (moving > 0.05 ? 1 : 0);

      for (let i = 0; i < 2; i++) {
        const p = anim.phase + i * Math.PI;
        const foot = feet[i];
        if (s.onGround) {
          foot.position.z = Math.sin(p) * 0.32 * moving;
          foot.position.y = 0.11 + Math.max(0, Math.cos(p)) * 0.16 * moving;
        } else {
          foot.position.z = (i ? 0.12 : -0.12);
          foot.position.y = 0.3;
        }
      }

      // Squash and stretch spring.
      anim.squashVel += (1 - anim.squash) * 140 * dt - anim.squashVel * 9 * dt;
      anim.squash += anim.squashVel * dt;
      const sq = Math.max(0.6, Math.min(1.4, anim.squash));
      const breathe = 1 + Math.sin(anim.t * 2.4) * 0.015;
      pivot.scale.set(1 / Math.sqrt(sq), sq * breathe, 1 / Math.sqrt(sq));

      const bob = s.onGround ? Math.abs(Math.sin(anim.phase)) * 0.1 * moving : 0;
      body.position.y = 0.95 + bob;
      pivot.rotation.x += ((-s.forward * 0.1) - pivot.rotation.x) * Math.min(1, dt * 10);
      pivot.rotation.z += ((s.side * 0.08) - pivot.rotation.z) * Math.min(1, dt * 10);

      // Aim arm.
      anim.recoil = Math.max(0, anim.recoil - dt * 8);
      anim.swing = Math.max(0, anim.swing - dt * 4);
      const swingArc = Math.sin(anim.swing * Math.PI) * 1.4;
      arm.rotation.x = s.pitch + anim.recoil * 0.35 - (weaponKind === 'fists' || weaponKind === 'spoon' || weaponKind === 'bat' ? swingArc * 0.6 : 0);
      arm.rotation.y = weaponKind === 'fists' || weaponKind === 'spoon' ? swingArc * 0.6 : 0;
      arm.position.z = -0.2 + anim.recoil * 0.12 - (weaponKind === 'fists' ? swingArc * 0.25 : 0);
      leftHand.position.y = 0.9 + Math.sin(anim.phase) * 0.06 * moving;
      leftHand.position.z = -0.15 + Math.cos(anim.phase) * 0.12 * moving;

      anim.flash = Math.max(0, anim.flash - dt);
      bodyMat.emissiveIntensity = anim.flash > 0 ? 0.8 : 0;

      // Falling over when busted.
      const target = s.dead ? 1 : 0;
      anim.dead += (target - anim.dead) * Math.min(1, dt * (s.dead ? 7 : 12));
      // Downed: flat on your belly, wriggling as you crawl.
      anim.down = (anim.down || 0) + ((s.downed && !s.dead ? 1 : 0) - (anim.down || 0)) * Math.min(1, dt * 8);
      root.rotation.x = anim.dead * (Math.PI / 2 - 0.15) - anim.down * (1.25 + Math.sin(anim.t * 9) * 0.05 * Math.min(1, s.speed));
      root.rotation.z = anim.down * Math.sin(anim.t * 9) * 0.12 * Math.min(1, s.speed);
      // Dodge roll: a full tumble, hopping up off the ground mid-roll.
      if (s.roll > 0 && s.roll < 1) {
        root.rotation.x += s.roll * Math.PI * 2;
        root.position.y += Math.sin(s.roll * Math.PI) * 0.55;
      }
      for (const eye of eyes) {
        eye.userData.pupil.visible = !s.dead && !eye.userData.hidePupil;
        eye.userData.cross.visible = s.dead;
      }
      tag.visible = !s.dead && s.showTag !== false;
    },
  };
}
