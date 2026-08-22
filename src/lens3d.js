/*
 * NODAL — the lens as geometry.
 *
 * Everything here is generated from the prescription in optics.js. There are
 * no modelled assets and no GLB: each element is lathed from the sag of its
 * own two spherical surfaces, the barrel is fitted around whatever the glass
 * envelope turns out to be, and the light path is the actual traced rays.
 *
 * That is the whole point. Change a radius in the prescription and the solid,
 * the barrel that has to contain it, the rays through it and the numbers
 * printed beside it all move together, because none of them are written down
 * separately.
 */

import * as THREE from '../vendor/three.module.js';
import {
  SURFACES, GLASS, STOP_RADIUS, STOP_Z, HALF_FIELD,
  buildElements, buildGroups, elementProfile, trace, aimThroughStop,
  solveStopRadius, specSheet, lastVertexZ,
} from './optics.js';

/** World units are centimetres, so a 40mm lens is a comfortable 4 units. */
export const U = 0.1;

/** Where the ray bundles are launched from, ahead of the front vertex (mm). */
export const RAY_START = -34;

/* The interface has no hue: the drawing and the engraved marks sit at the
   foreground tone and take their emphasis from value. The RAYS deliberately do
   not follow it, because light is not interface: they run cool white to warm,
   which is also what the wavelength-split trace will need. Together with the
   glass, they are the only colour left anywhere on the page. */
const ACCENT = new THREE.Color(0xe8e5de);
const RAY_COOL = new THREE.Color(0xdfe9f2);
const RAY_WARM = new THREE.Color(0xffcf9a);

/* ------------------------------------------------------------------ *
 * Studio environment.
 *
 * Without scene.environment every metal in the scene renders near-black and
 * every piece of glass renders like grey plastic. A 32x256 canvas gradient
 * through PMREMGenerator is enough: one broad soft key, a narrow hot rim and
 * a dark floor. It costs nothing and it is doing most of the work of making
 * this look expensive.
 * ------------------------------------------------------------------ */
export function makeEnvironment(renderer, plate = 0) {
  const w = 256, h = 128;
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');

  /* The environment is a function of the plate, because the object has to be
     lit by the page it is standing on. On black it is a dark studio with a few
     crisp sources. On paper the floor becomes a large warm bounce, which is
     what an object actually receives when it sits on warm stock. Relighting
     the lens is what stops the ground flip from reading as a CSS theme swap.

     Note the equirect convention: v = 0 is straight up, v = 1 is straight
     down, so the bottom of this canvas is the floor. */
  const p = Math.min(1, Math.max(0, plate));
  const mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * p));
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  const stops = [
    [0.00, [ 22,  29,  37], [ 42,  48,  56]],   // ceiling
    [0.40, [ 57,  69,  79], [ 85,  96, 106]],
    [0.58, [ 74,  88,  99], [110, 122, 132]],   // horizon
    [0.78, [ 29,  36,  43], [156, 150, 138]],
    [1.00, [ 11,  14,  18], [207, 198, 180]],   // floor: void, or warm paper
  ];

  const base = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, dark, light] of stops) base.addColorStop(at, rgb(mix(dark, light)));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  /* Softboxes: bright, bounded, with a falloff at the ends so they read as
     objects in a room rather than as bands on a sphere. Broad soft gradients
     are what make glass look like milk. */
  const strip = (cx, cy, rw, rh, peak, tint) => {
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rw, rh));
    grd.addColorStop(0, tint.replace('ALPHA', peak));
    grd.addColorStop(0.55, tint.replace('ALPHA', peak * 0.35));
    grd.addColorStop(1, tint.replace('ALPHA', 0));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, rh / rw);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = grd;
    ctx.fillRect(cx - rw, cy - rw, rw * 2, rw * 2);
    ctx.restore();
  };

  ctx.globalCompositeOperation = 'lighter';
  // The key softens as the paper's ambient bounce takes over the fill duty.
  strip(w * 0.50, h * 0.42, w * 0.66, h * 1.15, 0.55 - 0.25 * p, 'rgba(176,198,220,ALPHA)');
  strip(w * 0.26, h * 0.28, w * 0.30, h * 0.52, 1.00 - 0.35 * p, 'rgba(255,255,255,ALPHA)');
  strip(w * 0.70, h * 0.34, w * 0.13, h * 0.34, 0.72 - 0.22 * p, 'rgba(206,232,250,ALPHA)');
  strip(w * 0.95, h * 0.52, w * 0.06, h * 0.52, 0.95 - 0.30 * p, 'rgba(255,232,196,ALPHA)');
  strip(w * 0.04, h * 0.58, w * 0.05, h * 0.50, 0.80 - 0.25 * p, 'rgba(150,206,236,ALPHA)');

  const tex = new THREE.CanvasTexture(cvs);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  /* Returns the render TARGET, not its texture. `pmrem.dispose()` frees the
     generator's own scratch resources but not the target it handed back, so
     rebuilding the environment as the page turns and disposing only
     `.texture` leaks a target every time. The caller disposes this. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return target;
}

/* ------------------------------------------------------------------ *
 * Glass.
 * ------------------------------------------------------------------ */

/**
 * One element, lathed from its own profile.
 *
 * The material's index of refraction is not a look-and-feel number here — it
 * is the same `n` the ray tracer refracted with, so the render and the physics
 * are quoting the same glass. `specularColor` carries the anti-reflection
 * coating tint, which is the faint colour you see glinting off a real lens.
 */
function makeElementMesh(el, quality) {
  const profile = elementProfile(el, quality.latheSteps);
  const pts = profile.map(([z, h]) => new THREE.Vector2(Math.max(h, 1e-4) * U, z * U));
  const geo = new THREE.LatheGeometry(pts, quality.latheSegments);
  geo.computeVertexNormals();

  const g = GLASS[el.glass];
  const mat = new THREE.MeshPhysicalMaterial({
    /* Without a transmission pass the fallback has to suggest glass with
       opacity alone, and a pale tint at 40% reads as frosted plastic. Going
       darker and more transparent lets the specular do the describing, which
       is what actually says "glass". */
    color: new THREE.Color(quality.transmission ? g.tint : g.tintDark),
    metalness: 0,
    roughness: 0.015,
    ior: g.n,                       // the very same n used in the ray trace
    transmission: quality.transmission ? 1 : 0,
    opacity: quality.transmission ? 1 : 0.30,
    transparent: !quality.transmission,
    thickness: el.thickness * U * 1.4,
    attenuationColor: new THREE.Color(g.tint),
    attenuationDistance: 1.1,
    specularColor: new THREE.Color(g.coat),
    specularIntensity: 1,
    envMapIntensity: 1.5,

    /* The anti-reflection coating, modelled as what it physically is: a thin
       film. Interference across its thickness is what makes a real lens throw
       magenta, green and amber back at you from different elements, and it is
       the single thing most responsible for coated glass not looking like blue
       plastic. Thickness varies per element so the stack shows a range of
       coating colours in depth rather than one flat hue. */
    iridescence: 0.34,
    iridescenceIOR: 1.28,
    iridescenceThicknessRange: [210, 300 + (el.id % 5) * 42],

    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  // LatheGeometry builds around +Y, and the optical axis is +Z.
  mesh.rotation.x = Math.PI / 2;
  mesh.renderOrder = 10 + el.id;
  mesh.userData.element = el;
  return mesh;
}

/**
 * A thin rim on the edge of each element.
 *
 * Real elements are ground with a fine matte land around the circumference so
 * the mount has something to grip and so stray light does not skip along the
 * edge. It is a small thing that reads as "made" rather than "rendered".
 */
function makeElementRim(el, quality) {
  const rim = Math.max(el.sdFront, el.sdBack) * U;
  const geo = new THREE.CylinderGeometry(rim * 1.002, rim * 1.002, Math.max(el.thickness * U * 0.55, 0.02), quality.latheSegments, 1, true);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x04060a, roughness: 1.0, metalness: 0.0,
    envMapIntensity: 0.12, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = ((el.z1 + el.z2) / 2) * U;
  mesh.userData.rim = true;    // the inspector lights these to mark a selection
  return mesh;
}

/**
 * Build every element, bundled by cemented group.
 *
 * `home` is the untouched resting position of each group. Every explode reads
 * from `home` and writes an absolute position, never an increment, so the
 * motion cannot accumulate drift and is exactly reversible — scrub back to the
 * top and the lens is bit-for-bit assembled again.
 */
export function buildGlassStack(quality) {
  const elements = buildElements();
  const groups = buildGroups(elements);
  const root = new THREE.Group();
  const built = [];

  groups.forEach((els, gi) => {
    const g = new THREE.Group();
    // Each element gets its own sub-group so a cemented doublet can crack
    // open by a hair during the explode without leaving its group.
    const parts = els.map((el) => {
      const p = new THREE.Group();
      p.add(makeElementMesh(el, quality));
      p.add(makeElementRim(el, quality));
      g.add(p);
      return { node: p, element: el };
    });
    const zc = els.reduce((a, e) => a + (e.z1 + e.z2) / 2, 0) / els.length;
    root.add(g);
    built.push({
      group: g,
      parts,
      elements: els,
      index: gi,
      centreZ: zc,
      home: g.position.clone(),
      sd: Math.max(...els.map((e) => e.sd)),
      cemented: els.length > 1,
    });
  });

  return { root, groups: built, elements };
}

/* ------------------------------------------------------------------ *
 * The barrel.
 *
 * Fitted to the glass rather than authored: walk the elements, take the
 * widest semi-diameter at each station, add a wall, and lathe that. If the
 * prescription changes, the barrel reshapes itself around it.
 * ------------------------------------------------------------------ */

function glassEnvelope(elements) {
  const stations = [];
  for (const el of elements) {
    stations.push([el.z1, el.sdFront], [el.z2, el.sdBack]);
  }
  stations.sort((a, b) => a[0] - b[0]);
  return stations;
}

/** Widest glass at or near a given z, used to size the barrel wall. */
function envelopeAt(stations, z, window = 6) {
  let m = 0;
  for (const [sz, sd] of stations) {
    if (Math.abs(sz - z) <= window) m = Math.max(m, sd);
  }
  if (m === 0) {
    let best = Infinity, bestSd = stations[0][1];
    for (const [sz, sd] of stations) {
      const d = Math.abs(sz - z);
      if (d < best) { best = d; bestSd = sd; }
    }
    m = bestSd;
  }
  return m;
}

export function buildBarrel(spec, quality) {
  const elements = buildElements();
  const stations = glassEnvelope(elements);
  const zEnd = lastVertexZ(SURFACES);
  const frontSd = elements[0].sd;

  const WALL = 2.6;
  const CLEAR = 1.4;
  const maxSd = Math.max(...elements.map((e) => e.sd));

  /* Barrel silhouette as [z, rInner, rOuter] rows — the same idea as the
     AXIAL profile table. Rings bulge proud of the tube; the mount steps down. */
  const R = (z) => envelopeAt(stations, z) + CLEAR;
  const ringR = maxSd + CLEAR + WALL + 3.4;
  const tubeR = maxSd + CLEAR + WALL;

  const rows = [
    [-9.0, frontSd + 1.0, frontSd + WALL + 4.2],   // filter ring face
    [-6.2, frontSd + 1.0, frontSd + WALL + 4.2],
    [-6.0, R(-6), frontSd + WALL + 4.6],           // front bell
    [-1.0, R(-1), tubeR + 1.2],
    [3.0, R(3), tubeR],
    [8.0, R(8), tubeR],
    [8.4, R(8.4), ringR],                          // focus ring, proud
    [24.0, R(24), ringR],
    [24.4, R(24.4), tubeR],
    [30.0, R(30), tubeR],
    [30.4, R(30.4), ringR * 0.985],                // iris ring, proud
    [41.0, R(41), ringR * 0.985],
    [41.4, R(41.4), tubeR],
    [zEnd - 2, R(zEnd - 2), tubeR],
    [zEnd + 2, R(zEnd + 2), tubeR * 0.9],          // step down to the mount
    [zEnd + 5.5, R(zEnd + 5.5), tubeR * 0.9],
  ];

  const group = new THREE.Group();
  const materials = [];
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x141719, roughness: 0.52, metalness: 0.62, envMapIntensity: 0.85,
    transparent: true, opacity: 1,
  });
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0x030407, roughness: 1.0, metalness: 0.0,
    envMapIntensity: 0.08, side: THREE.BackSide,
    transparent: true, opacity: 1,
  });
  materials.push(shellMat, innerMat);

  // Outer skin, inner bore, and the two annular end caps that close the tube.
  const outer = rows.map(([z, , ro]) => new THREE.Vector2(ro * U, z * U));
  const inner = rows.map(([z, ri]) => new THREE.Vector2(ri * U, z * U));

  const outerGeo = new THREE.LatheGeometry(outer, quality.latheSegments);
  const innerGeo = new THREE.LatheGeometry(inner, quality.latheSegments);
  const outerMesh = new THREE.Mesh(outerGeo, shellMat);
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  outerMesh.rotation.x = innerMesh.rotation.x = Math.PI / 2;
  group.add(outerMesh, innerMesh);

  for (const [z, ri, ro] of [rows[0], rows[rows.length - 1]]) {
    const cap = new THREE.Mesh(
      new THREE.RingGeometry(ri * U, ro * U, quality.latheSegments),
      shellMat
    );
    cap.position.z = z * U;
    group.add(cap);
  }

  /* Follow-focus teeth. A cine lens is defined by these: a 0.8-module gear
     ring on focus and another on iris, so a motor can drive them. */
  const focusRing = makeGearRing(8.6, 23.8, ringR, quality, 0.8);
  const irisRing = makeGearRing(30.6, 40.8, ringR * 0.985, quality, 0.8);
  group.add(focusRing.group, irisRing.group);
  materials.push(focusRing.material, irisRing.material);

  // Engraved scales, drawn to a canvas and wrapped round each ring.
  const focusScale = makeScaleRing(24.6, 29.6, tubeR * 1.004, focusScaleTexture(spec), quality);
  const irisScale = makeScaleRing(41.6, 45.6, tubeR * 1.004, irisScaleTexture(spec), quality);
  group.add(focusScale, irisScale);
  materials.push(focusScale.material, irisScale.material);

  const mount = makeMount(zEnd + 5.5, tubeR * 0.9, quality);
  group.add(mount.group);
  materials.push(mount.material);

  return { group, rows, materials, tubeR, ringR, zEnd, focusRing, irisRing };
}

/** A ring of fine axial teeth — the follow-focus gear. */
function makeGearRing(z0, z1, radius, quality, module_) {
  const teeth = Math.max(24, Math.round((2 * Math.PI * radius) / module_ / Math.PI));
  const g = new THREE.Group();
  const h = (z1 - z0) * U;
  const geo = new THREE.BoxGeometry(module_ * 0.5 * U, module_ * 0.9 * U, h);
  const mat = new THREE.MeshStandardMaterial({ color: 0x101315, roughness: 0.62, metalness: 0.55, envMapIntensity: 0.8, transparent: true, opacity: 1 });
  const inst = new THREE.InstancedMesh(geo, mat, teeth);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    e.set(0, 0, a);
    q.setFromEuler(e);
    m.compose(
      new THREE.Vector3(Math.cos(a) * radius * U, Math.sin(a) * radius * U, (z0 + z1) / 2 * U),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  g.add(inst);
  return { group: g, material: mat };
}

/** Wrap an engraved canvas around a cylinder band. */
function makeScaleRing(z0, z1, radius, texture, quality) {
  const geo = new THREE.CylinderGeometry(radius * U, radius * U, (z1 - z0) * U, quality.latheSegments, 1, true);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1e21, roughness: 0.58, metalness: 0.5, envMapIntensity: 0.8,
    map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.22,
    transparent: true, opacity: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.z = ((z0 + z1) / 2) * U;
  return mesh;
}

/* ------------------------------------------------------------------ *
 * Canvas 2D and webfonts.
 *
 * A 2D context only uses a webfont that has ALREADY downloaded — ask for one
 * too early and it silently substitutes, then caches the wrong metrics in
 * whatever layout you measured from it. Every canvas here is built at module
 * load, well before Martian Mono lands, so each one registers a redraw that
 * fires when the face is ready. `document.fonts.load` resolves immediately on
 * a repeat visit, so this costs nothing once cached.
 *
 * `fontStretch` is how a 2D context reaches a variable width axis: there is no
 * font-variation-settings here. Martian Mono runs wdth 75–112.5, which maps
 * exactly onto the CSS keywords condensed → semi-expanded.
 * ------------------------------------------------------------------ */
export const FACE = "'Martian Mono', ui-monospace, monospace";
const fontReady = (typeof document !== 'undefined' && document.fonts)
  ? document.fonts.load('700 100px "Martian Mono"').catch(() => {})
  : Promise.resolve();

function onFontReady(fn) { fontReady.then(fn); }

function engraveCanvas(draw) {
  const cvs = document.createElement('canvas');
  cvs.width = 2048; cvs.height = 128;
  const ctx = cvs.getContext('2d');
  const paint = () => {
    ctx.fillStyle = '#15181a';
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    if ('fontStretch' in ctx) ctx.fontStretch = 'condensed';
    draw(ctx, cvs.width, cvs.height);
  };
  paint();
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  onFontReady(() => { paint(); tex.needsUpdate = true; });
  return tex;
}

/** Focus distances, spaced the way they actually fall: by 1/distance. */
function focusScaleTexture(spec) {
  const marks = [0.45, 0.5, 0.6, 0.7, 0.85, 1, 1.2, 1.5, 2, 3, 5, 10, Infinity];
  const near = 0.45;
  return engraveCanvas((ctx, W, H) => {
    ctx.strokeStyle = '#e8e6e1';
    ctx.fillStyle = '#e8e6e1';
    ctx.font = `600 40px ${FACE}`;
    ctx.textAlign = 'center';
    for (const d of marks) {
      // Focus travel goes as 1/d, which is why the far marks crowd together.
      const t = d === Infinity ? 1 : (1 / near - 1 / d) / (1 / near - 1 / 10);
      const x = 40 + t * (W - 90);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, H * 0.62);
      ctx.lineTo(x, H * 0.88);
      ctx.stroke();
      ctx.fillText(d === Infinity ? '∞' : String(d), x, H * 0.5);
    }
  });
}

/** T-stop scale, spaced by whole stops, with the wide-open value first. */
function irisScaleTexture(spec) {
  const first = Math.round(spec.tStop * 10) / 10;
  const stops = [first];
  let v = first;
  for (let i = 0; i < 6; i++) { v *= Math.SQRT2; stops.push(Math.round(v * 10) / 10); }
  return engraveCanvas((ctx, W, H) => {
    ctx.font = `600 40px ${FACE}`;
    ctx.textAlign = 'center';
    stops.forEach((s, i) => {
      const x = 40 + (i / (stops.length - 1)) * (W - 90);
      const wide = i === 0;
      ctx.strokeStyle = ctx.fillStyle = wide ? '#ffffff' : '#8e8b85';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, H * 0.62);
      ctx.lineTo(x, H * 0.88);
      ctx.stroke();
      ctx.fillText(s >= 10 ? String(Math.round(s)) : s.toFixed(1), x, H * 0.5);
    });
  });
}

/** A PL-style mount: a flange, four locating flats and a bayonet ring. */
function makeMount(z, radius, quality) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa1a7, roughness: 0.34, metalness: 0.95, envMapIntensity: 1.0, transparent: true, opacity: 1 });
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.02 * U, radius * 1.02 * U, 2.2 * U, quality.latheSegments, 1, true),
    mat
  );
  flange.rotation.x = Math.PI / 2;
  flange.position.z = (z + 1.1) * U;
  g.add(flange);

  const face = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.62 * U, radius * 1.02 * U, quality.latheSegments),
    mat
  );
  face.position.z = (z + 2.2) * U;
  g.add(face);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const flat = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.30 * U, 1.6 * U, 3.0 * U),
      mat
    );
    flat.position.set(Math.cos(a) * radius * 0.86 * U, Math.sin(a) * radius * 0.86 * U, (z + 3.4) * U);
    flat.rotation.z = a;
    g.add(flat);
  }
  return { group: g, material: mat };
}

/* ------------------------------------------------------------------ *
 * The iris.
 *
 * Nine straight blades, each a thin plate rotated about a pivot on a circle.
 * Closing the iris rotates every blade by the same angle, which is exactly how
 * the real mechanism works and why the opening stays a regular polygon.
 * ------------------------------------------------------------------ */
export function buildIris(quality, blades = 9) {
  const group = new THREE.Group();

  /* Simulating nine overlapping blades and their pivots is a lot of machinery
     to arrive at a shape that is, at any opening, simply a regular polygon.
     So the opening is built as the polygon directly: a disc with an n-sided
     hole whose inradius is the aperture. It gives the correct straight-edged
     silhouette, the correct number of edges, and it rebuilds in microseconds.
     Faint radial seams are drawn on top so it still reads as blades. */
  const maxOpen = STOP_RADIUS * U;
  const outer = STOP_RADIUS * 2.5 * U;

  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a0c0e, roughness: 0.66, metalness: 0.45,
    envMapIntensity: 0.5, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.rotation.x = Math.PI;   // face the incoming light
  group.add(mesh);

  const seamMat = new THREE.LineBasicMaterial({
    color: 0x2a3238, transparent: true, opacity: 0.75,
  });
  const seams = new THREE.LineSegments(new THREE.BufferGeometry(), seamMat);
  group.add(seams);

  group.position.z = STOP_Z * U;
  const iris = { group, mesh, seams, blades, maxOpen, outer, open: -1 };
  setIris(iris, 0);
  return iris;
}

/** 0 = wide open at the design aperture, 1 = stopped well down. */
export function setIris(iris, t) {
  const open = Math.max(iris.maxOpen * 0.18, iris.maxOpen * (1 - t * 0.82));
  if (Math.abs(open - iris.open) < 1e-4) return;
  iris.open = open;

  const n = iris.blades;
  // The blade edges rotate as the iris closes, which is the giveaway that a
  // real iris is turning rather than a hole simply shrinking.
  const phase = t * (Math.PI / n) * 1.6;

  const shape = new THREE.Shape();
  shape.absarc(0, 0, iris.outer, 0, Math.PI * 2, false);

  // Circumradius from the inradius of a regular n-gon.
  const R = open / Math.cos(Math.PI / n);
  const hole = new THREE.Path();
  for (let i = 0; i <= n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const x = Math.cos(a) * R, y = Math.sin(a) * R;
    if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
  }
  shape.holes.push(hole);

  iris.mesh.geometry.dispose();
  iris.mesh.geometry = new THREE.ShapeGeometry(shape, 24);

  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    pts.push(
      Math.cos(a) * R, Math.sin(a) * R, 0,
      Math.cos(a - 0.55) * iris.outer, Math.sin(a - 0.55) * iris.outer, 0
    );
  }
  iris.seams.geometry.dispose();
  iris.seams.geometry = new THREE.BufferGeometry();
  iris.seams.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}

/* ------------------------------------------------------------------ *
 * The light path.
 *
 * Not decoration: these are the polylines the tracer returns, lifted straight
 * into 3D. Where they bend is where the glass actually bends them, and where
 * they converge is the plane the tracer solved for.
 * ------------------------------------------------------------------ */
export function buildRays(spec, quality) {
  const fields = [0, HALF_FIELD * 0.62, HALF_FIELD];
  const stopR = solveStopRadius(SURFACES, spec.fNumber);
  const perFan = quality.raysPerFan;
  const fans = [];

  for (let fi = 0; fi < fields.length; fi++) {
    const field = fields[fi];
    const tan = Math.tan((field * Math.PI) / 180);
    for (let i = 0; i < perFan; i++) {
      const pf = perFan === 1 ? 0 : (i / (perFan - 1)) * 2 - 1;
      const y0 = aimThroughStop(SURFACES, field, pf * stopR * 0.97);
      if (!isFinite(y0)) continue;
      const r = trace(SURFACES, y0, RAY_START, tan, 1, spec.focusZ);
      if (r.points.length < 3) continue;
      fans.push({ field, fieldIndex: fi, points: r.points, complete: r.ok });
    }
  }

  /* One BufferGeometry for all of them. `aProgress` runs 0..1 along each
     polyline by arc length, so the draw-on can be a single uniform compared
     per-vertex instead of rebuilding geometry every frame. */
  const positions = [];
  const progress = [];
  const fieldAttr = [];

  for (const fan of fans) {
    let total = 0;
    const cum = [0];
    for (let i = 1; i < fan.points.length; i++) {
      const a = fan.points[i - 1], b = fan.points[i];
      total += Math.hypot(b.y - a.y, b.z - a.z);
      cum.push(total);
    }
    for (let i = 1; i < fan.points.length; i++) {
      const a = fan.points[i - 1], b = fan.points[i];
      positions.push(0, a.y * U, a.z * U, 0, b.y * U, b.z * U);
      progress.push(cum[i - 1] / total, cum[i] / total);
      fieldAttr.push(fan.fieldIndex, fan.fieldIndex);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aProgress', new THREE.Float32BufferAttribute(progress, 1));
  geo.setAttribute('aField', new THREE.Float32BufferAttribute(fieldAttr, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uDraw: { value: 0 },
      uAccent: { value: RAY_COOL.clone() },
      uWarm: { value: RAY_WARM.clone() },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      attribute float aProgress;
      attribute float aField;
      varying float vP;
      varying float vField;
      void main() {
        vP = aProgress;
        vField = aField;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uDraw;
      uniform float uOpacity;
      uniform vec3 uAccent;
      uniform vec3 uWarm;
      varying float vP;
      varying float vField;
      void main() {
        // The head of the draw is hot and fades back along the ray.
        float head = uDraw;
        if (vP > head) discard;
        float tail = smoothstep(head - 0.55, head, vP);
        vec3 col = mix(uAccent, uWarm, clamp(vField * 0.42, 0.0, 1.0));
        float a = (0.55 + 0.45 * tail) * uOpacity;
        gl_FragColor = vec4(col * (1.15 + 0.85 * tail), a);
      }
    `,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 60;
  return { lines, material: mat, fans };
}

/* ------------------------------------------------------------------ *
 * The image plane, drawn as a thin frame at the solved focus.
 * ------------------------------------------------------------------ */
export function buildImagePlane(spec) {
  const g = new THREE.Group();

  /* Drawn as the sensor's DIAGONAL, not its 16:9 face.
   *
   * Every ray in the trace is pushed at x = 0 — it is a meridional fan — so the
   * section on screen cuts the sensor corner to corner, and the corner field
   * lands at the half-DIAGONAL. Outlining the 16:9 half-height instead left two
   * of the three foci hanging in space above the frame: with EFL 40 and a 15.5°
   * half-field the bundles land at 0, 6.78 and 11.09mm while the outline
   * stopped at 5.43mm. The outline now spans the image circle, so the corner
   * bundle lands exactly on its edge, and two ticks mark where the 16:9 frame
   * edge falls along that diagonal. */
  const halfDiag  = (spec.imageCircle / 2) * U;
  const halfFrame = (spec.imageCircle / 2) * 0.49 * U;
  const depth     = spec.imageCircle * 0.09 * U;   // reads as a plate, not a hairline

  const line = (pts, opacity) => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xe8e5de, transparent: true, opacity })
  );

  g.add(line([
    new THREE.Vector3(-depth / 2, -halfDiag, 0), new THREE.Vector3(depth / 2, -halfDiag, 0),
    new THREE.Vector3(depth / 2,  halfDiag, 0), new THREE.Vector3(-depth / 2,  halfDiag, 0),
    new THREE.Vector3(-depth / 2, -halfDiag, 0),
  ], 0.5));

  for (const side of [-1, 1]) {
    g.add(line([
      new THREE.Vector3(-depth * 0.85, side * halfFrame, 0),
      new THREE.Vector3( depth * 0.85, side * halfFrame, 0),
    ], 0.3));
  }

  g.position.z = spec.focusZ * U;
  return g;
}


/* ------------------------------------------------------------------ *
 * Fit.
 *
 * Measure the bounds the object ACTUALLY occupies at the current explode,
 * then solve the camera distance that frames it. Never hand-tune a distance
 * per breakpoint: measuring is what makes the exploded stack sit correctly on
 * a short window and on a phone without a single magic number.
 * ------------------------------------------------------------------ */
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();

export function fitDistance(object, camera, aspect, padding = 1.16) {
  _box.setFromObject(object);
  if (_box.isEmpty()) return { distance: 6, centre: new THREE.Vector3() };
  _box.getSize(_size);
  _box.getCenter(_centre);

  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const dV = (_size.y / 2) / Math.tan(vFov / 2);
  const dH = (Math.max(_size.x, _size.z) / 2) / Math.tan(hFov / 2);
  return {
    distance: Math.max(dV, dH) * padding + _size.z * 0.35,
    centre: _centre.clone(),
    size: _size.clone(),
  };
}

/* ------------------------------------------------------------------ *
 * The barrel, as a drawing.
 *
 * When the glass separates, the metal is in the way. Rather than dissolving
 * it into nothing, it hands over to its own elevation: the same profile rows
 * drawn as thin line-work in the axial plane, mirrored above and below the
 * axis, with a tick at every optical surface. The object becomes the drawing
 * of itself, which is a more interesting answer than a fade.
 * ------------------------------------------------------------------ */
export function buildBarrelBlueprint(rows, elements) {
  const pos = [];
  const seq = [];        // 0..1 along the drawing, so it can draw itself on
  let order = 0;

  const push = (z1, r1, z2, r2, o) => {
    pos.push(0, r1 * U, z1 * U, 0, r2 * U, z2 * U);
    seq.push(o, o);
  };

  // Outer and inner walls, mirrored top and bottom.
  for (const sign of [1, -1]) {
    for (let i = 0; i < rows.length - 1; i++) {
      const o = i / (rows.length - 1);
      push(rows[i][0], rows[i][2] * sign, rows[i + 1][0], rows[i + 1][2] * sign, o);
      push(rows[i][0], rows[i][1] * sign, rows[i + 1][0], rows[i + 1][1] * sign, o);
    }
    // Close the ends so the section reads as a tube rather than four lines.
    for (const r of [rows[0], rows[rows.length - 1]]) {
      push(r[0], r[1] * sign, r[0], r[2] * sign, 0.5);
    }
  }

  // A tick at every optical surface, on the axis.
  for (const el of elements) {
    for (const [z, sd] of [[el.z1, el.sdFront], [el.z2, el.sdBack]]) {
      push(z, sd * 1.18, z, sd * 1.32, 0.55 + 0.4 * (order / (elements.length * 2)));
      push(z, -sd * 1.18, z, -sd * 1.32, 0.55 + 0.4 * (order / (elements.length * 2)));
      order++;
    }
  }

  // The optical axis itself, dashed by the shader.
  const zA = rows[0][0], zB = rows[rows.length - 1][0] + 12;
  push(zA, 0, zB, 0, 0.02);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSeq', new THREE.Float32BufferAttribute(seq, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uDraw: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: ACCENT.clone() },
    },
    vertexShader: `
      attribute float aSeq;
      varying float vSeq;
      void main() {
        vSeq = aSeq;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uDraw, uOpacity;
      uniform vec3 uColor;
      varying float vSeq;
      void main() {
        if (vSeq > uDraw) discard;
        gl_FragColor = vec4(uColor, uOpacity * 0.95);
      }
    `,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 40;
  return { lines, material: mat };
}

/* ------------------------------------------------------------------ *
 * Visibility-aware bounds.
 *
 * Box3.setFromObject walks the whole subtree regardless of `visible`, so an
 * object that is switched off still votes on the framing. The ray polylines
 * run from well in front of the lens to the focal plane behind it, which is
 * most of the scene's extent — measuring them while they are hidden pushed the
 * camera back far enough to lose the object entirely. This skips hidden
 * subtrees, so the camera frames what is actually on screen.
 * ------------------------------------------------------------------ */
const _v = new THREE.Vector3();

export function visibleBounds(root, target) {
  target.makeEmpty();
  root.updateWorldMatrix(true, false);

  (function walk(obj) {
    if (obj.visible === false) return;
    obj.updateWorldMatrix(false, false);
    const geo = obj.geometry;
    if (geo && obj.material?.visible !== false) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (bb && !bb.isEmpty()) {
        for (let i = 0; i < 8; i++) {
          _v.set(
            i & 1 ? bb.max.x : bb.min.x,
            i & 2 ? bb.max.y : bb.min.y,
            i & 4 ? bb.max.z : bb.min.z
          ).applyMatrix4(obj.matrixWorld);
          target.expandByPoint(_v);
        }
      }
    }
    for (const child of obj.children) walk(child);
  })(root);

  return target;
}


/* ------------------------------------------------------------------ *
 * The glow behind the object.
 *
 * This is in the SCENE, not a CSS layer over the canvas, and the difference is
 * the whole point. An overlay would paint over the lens and read as fog. A
 * plane parked behind it keeps depth testing, so the barrel occludes the glow
 * and the object sits in front of a light source instead of under a veil. The
 * glass, which samples the scene for transmission, also picks it up.
 *
 * It is a HALO, tight on the object, not a wash over the plate. The plane is
 * centred on the object rather than on the frame, so a gradient centred in the
 * texture lands directly behind the lens; the radius is set so the bloom
 * reaches roughly 1.5x the barrel and the corners of the frame stay black. A
 * much fainter squashed ellipse sits under it, enough to suggest the light
 * gathering below the object without becoming a floor.
 *
 * Both are authored in screen fractions and the plane is built to the
 * viewport's aspect, so those fractions land where they were drawn no matter
 * how the window is shaped.
 * ------------------------------------------------------------------ */
export function buildGlow() {
  const S = 1024;
  const cvs = document.createElement('canvas');
  cvs.width = S; cvs.height = S;
  const ctx = cvs.getContext('2d');

  // Deeper and less saturated than the interface accent: this is light, not a
  // mark, and a glow authored at label brightness reads as a coloured gel.
  const halo = ctx.createRadialGradient(S * 0.5, S * 0.5, 0, S * 0.5, S * 0.5, S * 0.40);
  halo.addColorStop(0.00, 'rgba(116, 162, 220, 0.30)');
  halo.addColorStop(0.28, 'rgba(92, 134, 194, 0.125)');
  halo.addColorStop(0.60, 'rgba(58, 88, 140, 0.032)');
  halo.addColorStop(1.00, 'rgba(38, 58, 94, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, S, S);

  // A whisper below the object, not a pool. Roughly a third of the halo.
  ctx.save();
  ctx.translate(S * 0.5, S * 0.63);
  ctx.scale(1, 0.30);
  const under = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.34);
  under.addColorStop(0.00, 'rgba(124, 168, 224, 0.11)');
  under.addColorStop(0.45, 'rgba(88, 130, 190, 0.04)');
  under.addColorStop(1.00, 'rgba(38, 58, 94, 0)');
  ctx.fillStyle = under;
  ctx.fillRect(-S, -S, S * 2, S * 2);
  ctx.restore();

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = -9;                    // after the wordmark, before everything solid

  /** Sized to the frustum at its own depth, and to the viewport's aspect so the
   *  gradients keep the proportions they were drawn at. */
  function fit(camera, aspect, distance, spread = 1.15) {
    const vH = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
    mesh.scale.set(vH * aspect * spread, vH * spread, 1);
  }

  return { mesh, material: mat, fit };
}

/* ------------------------------------------------------------------ *
 * The wordmark, as geometry.
 *
 * It has to live in the scene rather than in the DOM. A transparent canvas
 * would let DOM type sit behind the object, but MeshPhysicalMaterial samples
 * the scene's own render target for transmission, and an empty target makes
 * every piece of glass turn white. Putting the word on a plane inside the
 * scene keeps transmission working AND means the lens actually refracts it:
 * the product shows you its own name through itself.
 *
 * The per-letter entrance is drawn rather than transformed. Canvas 2D has
 * clip(), so each glyph can rise through its own mask exactly the way an
 * overflow-hidden box would do it in CSS.
 * ------------------------------------------------------------------ */
export function buildWordmark(text, quality) {
  const W = quality.transmission ? 4096 : 2048;
  const H = Math.round(W / 3.0);
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    toneMapped: false, opacity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = -10;          // always the backdrop

  const chars = [...text];
  let layout = null;

  /* Fit the INK, not the advance run.
   *
   * A monospace pads every glyph out to a fixed cell, so the first and last
   * letters carry a sidebearing that belongs to the metrics, not to the word.
   * Fitting advances leaves NODAL visibly short of both edges — it measured 79%
   * of the viewport at a nominal 96% target. Measuring the real ink box and
   * trimming those two bearings is what makes it reach the edges.
   *
   * Same argument vertically: `middle` centres the em box, which in an all-caps
   * word leaves the cap sitting high by the depth of the unused descender. The
   * baseline is placed from the actual ascent and descent instead. */
  function measure() {
    const size = H * 0.80;
    if ('fontStretch' in ctx) ctx.fontStretch = 'semi-expanded';   // wdth 112.5
    ctx.font = `700 ${size}px ${FACE}`;
    ctx.textBaseline = 'alphabetic';
    // Positive, where the old proportional face wanted negative. Mono already
    // sets every letter in its own equal cell, so opening it up reads as a
    // stamped brand plate; closing it up just makes the cells collide.
    const tracking = size * 0.018;
    const m = chars.map((c) => ctx.measureText(c));
    const widths = m.map((x) => x.width);
    const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);

    const lead  = -m[0].actualBoundingBoxLeft;                             // left bearing
    const trail = widths[widths.length - 1] - m[m.length - 1].actualBoundingBoxRight;
    const ink   = total - lead - trail;
    const scale = (W * 0.985) / ink;

    const xs = [];
    let x = (W - ink * scale) / 2 - lead * scale;   // ink edge lands, not the pen
    for (let i = 0; i < chars.length; i++) {
      xs.push(x);
      x += (widths[i] + tracking) * scale;
    }

    const asc  = Math.max.apply(null, m.map((x) => x.actualBoundingBoxAscent))  * scale;
    const desc = Math.max.apply(null, m.map((x) => x.actualBoundingBoxDescent)) * scale;
    const baseY = H * 0.5 + (asc - desc) / 2;

    layout = { size, xs, widths, scale, tracking, baseY };
  }

  let lastP = 0;
  onFontReady(() => { layout = null; draw(lastP); });

  /** 0 = every letter below its mask, 1 = the word landed. */
  function draw(p) {
    lastP = p;
    if (!layout) measure();
    const { size, xs, widths, scale, baseY } = layout;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    if ('fontStretch' in ctx) ctx.fontStretch = 'semi-expanded';
    ctx.font = `700 ${size * scale}px ${FACE}`;
    ctx.textBaseline = 'alphabetic';

    for (let i = 0; i < chars.length; i++) {
      const lp = Math.min(1, Math.max(0, (p - i * 0.12) / 0.58));
      // Smootherstep, not expo-out: it leaves rest gently instead of being
      // flicked, which is the difference between a letter arriving and a
      // letter snapping into place.
      const e = lp * lp * lp * (lp * (lp * 6 - 15) + 10);
      const w = widths[i] * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(xs[i] - w * 0.06, 0, w * 1.12, H);
      ctx.clip();
      ctx.fillText(chars[i], xs[i], baseY + (1 - e) * H * 1.15);
      ctx.restore();
    }
    tex.needsUpdate = true;
  }

  /** Size and place the plane so the word spans the frame behind the object.
   *
   * `distance` must be camera-to-plane, not object-to-plane. Getting that wrong
   * solves the frustum at the wrong depth and silently shrinks the word — it
   * was landing at 84% of the frame while nominally asking for 134%.
   *
   * The multiplier is under 1 on purpose: measure() already fills 98.5% of the
   * texture with ink, so this is the actual share of the frame the letters
   * take. 0.944 puts NODAL across ~93% of the width — full-bleed to read, with
   * enough margin that it never looks cropped. */
  function fit(camera, aspect, distance) {
    const vH = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
    const vW = vH * aspect;
    const w = vW * 0.944;
    mesh.scale.set(w, w * (H / W), 1);
  }

  draw(0);
  return { mesh, material: mat, draw, fit, remeasure: () => { layout = null; } };
}
