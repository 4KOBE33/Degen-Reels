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

export function createCharacter({ color, hat }) {
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
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), toon(INK));
    pupil.position.set(0, 0, -0.14);
    eye.add(pupil);
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

  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12, Math.PI), toon(INK));
  mouth.position.set(0, 0.16, -0.48);
  mouth.rotation.set(0.25, 0, Math.PI);
  body.add(mouth);

  const hatMesh = buildHat(hat);
  hatMesh.position.y += 0.78;
  body.add(hatMesh);

  const feet = [];
  for (const side of [-1, 1]) {
    const foot = part(new THREE.SphereGeometry(0.2, 14, 10), 0x2b2140, { ink: 0.03 });
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
      arm.rotation.x = s.pitch + anim.recoil * 0.35 - (weaponKind === 'fists' || weaponKind === 'spoon' ? swingArc * 0.6 : 0);
      arm.rotation.y = weaponKind === 'fists' || weaponKind === 'spoon' ? swingArc * 0.6 : 0;
      arm.position.z = -0.2 + anim.recoil * 0.12 - (weaponKind === 'fists' ? swingArc * 0.25 : 0);
      leftHand.position.y = 0.9 + Math.sin(anim.phase) * 0.06 * moving;
      leftHand.position.z = -0.15 + Math.cos(anim.phase) * 0.12 * moving;

      anim.flash = Math.max(0, anim.flash - dt);
      bodyMat.emissiveIntensity = anim.flash > 0 ? 0.8 : 0;

      // Falling over when busted.
      const target = s.dead ? 1 : 0;
      anim.dead += (target - anim.dead) * Math.min(1, dt * (s.dead ? 7 : 12));
      root.rotation.x = anim.dead * (Math.PI / 2 - 0.15);
      for (const eye of eyes) {
        eye.userData.pupil.visible = !s.dead;
        eye.userData.cross.visible = s.dead;
      }
      tag.visible = !s.dead && s.showTag !== false;
    },
  };
}
