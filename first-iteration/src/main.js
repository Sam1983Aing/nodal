/*
 * NODAL — the page.
 *
 * One persistent scene that is never swapped, one scroll state object that
 * every subsystem reads, and a camera whose distance is measured rather than
 * authored. The chapter ledger below is the only place the choreography is
 * written down.
 *
 * Two rules the whole file obeys:
 *
 *   1. Every scroll-driven value is an absolute function of scroll position,
 *      never an accumulation. Scrub backwards and the page returns exactly to
 *      where it was; reload halfway down and it is already correct.
 *
 *   2. Scroll owns the route. The pointer only ever owns local detail, so the
 *      two inputs compose instead of fighting.
 */

import * as THREE from '../../vendor/three.module.js';
import Lenis from '../../vendor/lenis.mjs';
import { Conductor, clamp, lerp, smootherstep, vw, vh } from './conductor.js';
import {
  SURFACES, GLASS, STOP_Z, HALF_FIELD, TARGET_FNUMBER,
  specSheet, buildElements, lastVertexZ,
} from './optics.js';
import {
  U, makeEnvironment, buildGlassStack, buildBarrel, buildIris, setIris,
  buildRays, buildImagePlane, buildBarrelBlueprint, visibleBounds, RAY_START,
} from './lens3d.js';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const spec = specSheet();

/* ------------------------------------------------------------------ *
 * Quality.
 *
 * Transmission is the expensive one: it costs an extra render pass and it is
 * what makes the glass read as glass. Desktop gets it, small screens do not
 * and fall back to tinted translucency, which still reads correctly.
 * ------------------------------------------------------------------ */
/* Gate on the SMALLER dimension only. Keying off width alone switched a
   merely narrow desktop window down to the cheap path, which is the one place
   the glass stops looking like glass. */
const narrow = Math.min(vw(), vh()) < 700;
const QUALITY = {
  transmission: !narrow,
  latheSegments: narrow ? 48 : 112,
  latheSteps: narrow ? 20 : 44,
  raysPerFan: narrow ? 5 : 9,
  dpr: Math.min(window.devicePixelRatio || 1, narrow ? 2 : 2),
};

/* ------------------------------------------------------------------ *
 * Chapter ledger.
 *
 * Each chapter states a viewing DIRECTION, a field of view and how much air
 * to leave — never a camera position. The distance is solved every frame from
 * the bounding sphere of whatever that chapter is framing, so the exploded
 * stack fits a short window and a phone without one magic number anywhere.
 * ------------------------------------------------------------------ */
/* `shift` is where the object should sit across the frame: -1 hard left,
   +1 hard right. `lift` is the same idea vertically, positive being up. They
   exist so the object and the copy never fight for the same part of the
   screen — the camera pans, it does not re-aim, so the object stays square to
   the lens instead of skewing toward the corner.
 *
 * `liftP` is the portrait equivalent, and it is a separate number rather than
 * a global nudge because the copy does not go to the same place in a portrait
 * frame for every chapter: most move it to the lower third, the trace and the
 * explode keep it at the top, and the series index sits across the middle. One
 * blanket portrait offset put the object on top of the copy in half of them. */
const CHAPTERS = [
  { id: 'hero',    dir: [ 0.58,  0.26, -0.77], fov: 34, pad: 1.30, frame: 'front', shift:  0.36, lift: -0.04, liftP:  0.30 },
  /* From here the camera sits on -X. That is not a taste call: with the camera
     on -X the optical axis (+Z) runs left-to-right across the screen, so the
     light in the trace chapter travels the way a reader expects a diagram to
     be read. On +X the whole sequence runs backwards. */
  { id: 'object',  dir: [-0.97,  0.20,  0.14], fov: 30, pad: 1.34, frame: 'whole', shift:  0.30, lift:  0.05, liftP:  0.34 },
  { id: 'beat',    dir: [-0.82,  0.13, -0.56], fov: 26, pad: 1.95, frame: 'whole', shift:  0.00, lift:  0.16, liftP:  0.30 },
  { id: 'explode', dir: [-1.00,  0.09,  0.00], fov: 26, pad: 1.14, frame: 'glass', shift:  0.00, lift: -0.02, liftP: -0.16 },
  { id: 'trace',   dir: [-1.00,  0.00,  0.00], fov: 25, pad: 1.16, frame: 'trace', shift:  0.02, lift: -0.44, liftP: -0.60 },
  { id: 'series',  dir: [-0.70,  0.32, -0.64], fov: 30, pad: 2.20, frame: 'whole', shift:  0.30, lift:  0.20, liftP: -0.64 },
  { id: 'end',     dir: [ 0.10,  0.03, -0.99], fov: 32, pad: 1.34, frame: 'front', shift:  0.00, lift: -0.34, liftP: -0.52 },
];

/* ------------------------------------------------------------------ *
 * Scene.
 * ------------------------------------------------------------------ */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
});
renderer.setPixelRatio(QUALITY.dpr);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0b0c);
scene.environment = makeEnvironment(renderer);

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);

/* A whisper of direct light on top of the environment, purely to put a hard
   highlight on the barrel edge that an environment map alone cannot give. */
const key = new THREE.DirectionalLight(0xffffff, 1.9);
key.position.set(6, 7, -4);
scene.add(key);
const fill = new THREE.DirectionalLight(0x8fc6e0, 0.65);
fill.position.set(-7, -2, 5);
scene.add(fill);

/* ------------------------------------------------------------------ *
 * Build.
 * ------------------------------------------------------------------ */
const lens = new THREE.Group();          // everything, so it can be nudged as one
const glass = buildGlassStack(QUALITY);
const barrel = buildBarrel(spec, QUALITY);
const iris = buildIris(QUALITY);
const rays = buildRays(spec, QUALITY);
const imagePlane = buildImagePlane(spec);
const blueprint = buildBarrelBlueprint(barrel.rows, glass.elements);

lens.add(glass.root, barrel.group, iris.group, rays.lines, imagePlane, blueprint.lines);
rays.lines.visible = false;
imagePlane.visible = false;

/* Nested transform groups, so scroll, pointer and idle drift each own exactly
   one of them and can never overwrite each other. */
const spin = new THREE.Group();     // idle rotation
const tilt = new THREE.Group();     // pointer
tilt.add(spin);
spin.add(lens);
scene.add(tilt);

// Centre the whole object on its own glass so rotation happens about the lens,
// not about the origin of the prescription.
const glassMid = lastVertexZ(SURFACES) / 2;
lens.position.z = -glassMid * U;

/* ------------------------------------------------------------------ *
 * Framing.
 *
 * A bounding sphere, measured now, for whatever the current chapter cares
 * about. Interpolating a centre and a radius between chapters is smooth in a
 * way that interpolating two different camera positions is not.
 * ------------------------------------------------------------------ */
const _box = new THREE.Box3();

/**
 * Framing returns a centre and half-extents, not a bounding sphere.
 *
 * A sphere that circumscribes this layout is dominated by its length — the
 * light path is 130mm end to end and only 52mm across — so fitting the sphere
 * pushed the diagonal into frame and scaled everything else up with it. Half
 * extents let the fit below use the actual silhouette.
 */
function boxOf(obj) {
  visibleBounds(obj, _box);
  if (_box.isEmpty()) return { c: new THREE.Vector3(), half: new THREE.Vector3(1, 1, 1) };
  const c = new THREE.Vector3(), half = new THREE.Vector3();
  _box.getCenter(c);
  _box.getSize(half).multiplyScalar(0.5);
  half.set(Math.max(half.x, 0.05), Math.max(half.y, 0.05), Math.max(half.z, 0.05));
  return { c, half };
}

const frontRadius = glass.elements[0].sd * U * 1.5;

/* The trace chapter frames the whole light path: from where the bundles are
   launched, through the glass, to the plane the solver put the focus on. */
const traceHalf = new THREE.Vector3(
  glass.elements[0].sd * U,
  glass.elements[0].sd * U,
  ((spec.focusZ - RAY_START) / 2) * U
);
const traceCentre = new THREE.Vector3(
  0, 0, ((RAY_START + spec.focusZ) / 2 - glassMid) * U
);

function framing(name) {
  switch (name) {
    case 'front': {
      // Looking into the front of the lens: frame the front element only.
      const c = new THREE.Vector3();
      glass.groups[0].group.getWorldPosition(c);
      c.z += glass.elements[0].thickness * U * 0.5;
      return { c, half: new THREE.Vector3(frontRadius, frontRadius, frontRadius * 0.5) };
    }
    case 'glass':  return boxOf(glass.root);
    /* Stated outright rather than measured off a proxy object. An invisible
       proxy mesh is precisely what visibleBounds is built to ignore, so asking
       it to measure one collapsed the frame to a unit box. The trace chapter's
       extent is known exactly anyway: it runs from where the rays are launched
       to the focal plane that was solved for them. */
    case 'trace':  return { c: traceCentre, half: traceHalf };
    case 'whole':
    default:       return boxOf(lens);
  }
}

/**
 * Exact distance to fit a box, for any view direction.
 *
 * For a corner at offset `o` from the centre, the camera at distance d sees it
 * at depth (d - o·dir) and lateral offset (o·right). Requiring the corner to
 * sit inside the frustum gives d >= |o·right| / tan(hFov/2) + o·dir, and the
 * same for the vertical. Taking the largest over all eight corners is the
 * smallest distance that contains the whole box, with no diagonal padding.
 */
const _corner = new THREE.Vector3();

function distanceForBox(half, dir, right, up, fov, aspect, pad) {
  const vFov = (fov * Math.PI) / 180;
  const tanV = Math.tan(vFov / 2);
  const tanH = tanV * aspect;
  let d = 0;
  for (let i = 0; i < 8; i++) {
    _corner.set(
      (i & 1 ? 1 : -1) * half.x,
      (i & 2 ? 1 : -1) * half.y,
      (i & 4 ? 1 : -1) * half.z
    );
    const along = _corner.dot(dir);
    const h = Math.abs(_corner.dot(right)) / tanH + along;
    const v = Math.abs(_corner.dot(up)) / tanV + along;
    d = Math.max(d, h, v);
  }
  return d * pad;
}

/* ------------------------------------------------------------------ *
 * Scroll.
 * ------------------------------------------------------------------ */
const sections = [...document.querySelectorAll('[data-chapter]')];
const conductor = new Conductor(sections);

const lenis = new Lenis({
  duration: 1.35,                                             // heavy, deliberate
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),   // matches --ease
  smoothWheel: !REDUCED,
  wheelMultiplier: 0.92,
  touchMultiplier: 1.5,
});

/* ------------------------------------------------------------------ *
 * One scroll value, split into overlapping windows.
 *
 * No timeline and no per-chapter bookkeeping: every phase is a smoothstep of
 * the same fractional chapter number, which makes the whole sequence trivially
 * retunable and reversible for free.
 * ------------------------------------------------------------------ */
const win = (v, a, b) => smootherstep(clamp((v - a) / (b - a), 0, 1));

function phases(e) {
  // Rises out of the blank beat, holds open, then collapses before the trace —
  // because the traced rays are only truthful when the glass is assembled.
  const explode = win(e, 2.25, 3.12) * (1 - win(e, 3.42, 3.90));
  return {
    explode,
    /* The barrel stays dissolved from the explode all the way through the
       trace and only returns for the series. The rays are inside the lens, so
       putting the metal back before they have been drawn would hide the one
       thing that chapter exists to show. */
    blueprint: win(e, 2.55, 3.30) * (1 - win(e, 4.74, 5.12)),
    barrelFade: win(e, 2.30, 3.00) * (1 - win(e, 4.70, 5.08)),
    rays: win(e, 3.66, 4.00),
    raysOut: win(e, 4.72, 5.06),
    iris: win(e, 0.55, 1.35) * (1 - win(e, 1.62, 2.15)),
    focusRing: win(e, 0.6, 1.9),
    drift: clamp((e - 2.5) / 1.2, -0.2, 1.2),
  };
}

/* ------------------------------------------------------------------ *
 * Explode.
 *
 * Every group is written to an absolute position derived from its home, so
 * this never drifts and reverses exactly. Groups keep their order and every
 * air gap grows by the same amount, which is what an exploded view of an
 * assembly actually looks like.
 * ------------------------------------------------------------------ */
const GAP = 0.62;          // world units added between neighbouring groups
const CEMENT_GAP = 0.13;   // how far a cemented doublet cracks open

function applyExplode(t) {
  const n = glass.groups.length;
  for (let i = 0; i < n; i++) {
    const g = glass.groups[i];
    g.group.position.z = g.home.z + (i - (n - 1) / 2) * GAP * t;

    const m = g.parts.length;
    if (m > 1) {
      for (let j = 0; j < m; j++) {
        g.parts[j].node.position.z = (j - (m - 1) / 2) * CEMENT_GAP * t;
      }
    }
  }
  // The iris lives in the air gap and travels with the half in front of it.
  const half = Math.floor(glass.groups.length / 2);
  iris.group.position.z = STOP_Z * U + (half - (n - 1) / 2) * GAP * t * 0.5;
}

/* ------------------------------------------------------------------ *
 * DOM.
 * ------------------------------------------------------------------ */

/* Masked line reveals: each headline line gets an inner element to slide up
   through its own overflow-hidden box. Done here rather than in the markup so
   the HTML stays readable. */
for (const line of document.querySelectorAll('[data-reveal-line]')) {
  const i = document.createElement('i');
  i.innerHTML = line.innerHTML;
  line.innerHTML = '';
  line.appendChild(i);
}

/* The page reports its own prescription. Nothing here is a typed-in number. */
const fmt = {
  designation: `Series A · ${spec.efl.toFixed(0)}mm · T${spec.tStop.toFixed(1)}`,
  eflShort: spec.efl.toFixed(0),
  efl: `${spec.efl.toFixed(1)} mm`,
  fnumber: `f/${spec.fNumber.toFixed(2)}`,
  tstop: spec.tStop.toFixed(1),
  tstop2: spec.tStop.toFixed(1),
  tstopFull: `T${spec.tStop.toFixed(2)}`,
  elements: `${spec.elements} / ${spec.groups}`,
  elementsShort: `${spec.elements} elements / ${spec.groups} groups`,
  airglass: String(spec.airGlassSurfaces),
  transmission: `${(spec.transmission * 100).toFixed(1)} %`,
  frontdia: `${spec.frontDiameter.toFixed(1)} mm`,
  bfd: `${spec.bfd.toFixed(1)} mm`,
  circle: `${spec.imageCircle.toFixed(1)} mm`,
  aov: `${(spec.halfField * 2).toFixed(1)}°`,
  rms: `${(spec.focusRMS * 1000).toFixed(1)} µm`,
  focus: `${spec.focusZ.toFixed(1)} mm from S1`,
  glass: spec.glassTypes.map((g) => GLASS[g].name).join(' · '),
  glassCount: `${spec.glassTypes.length} types`,
  surfacesCount: `${spec.surfaces} surfaces`,
};
for (const el of document.querySelectorAll('[data-spec]')) {
  const v = fmt[el.dataset.spec];
  if (v != null) el.textContent = v;
}

/* Reveals. The chapter carries `.is-in` and the CSS cascades from there, so
   one observer drives every stagger on the page. */
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) e.target.classList.add('is-in');
    }
  },
  { rootMargin: '-12% 0px -12% 0px' }
);
for (const s of sections) io.observe(s);

/* Element callouts, one per cemented group, positioned from the projected
   screen position of the glass they name. */
const calloutHost = document.querySelector('[data-callouts]');
const callouts = glass.groups.map((g, gi) => {
  const el = document.createElement('div');
  // Alternate above and below the axis so eight labels can sit along a lens
  // barrel's length without piling on top of each other.
  el.className = gi % 2 === 0 ? 'callout callout--up' : 'callout callout--down';
  const names = [...new Set(g.elements.map((e) => GLASS[e.glass].name))].join(' + ');
  const ids = g.elements.map((e) => String(e.id).padStart(2, '0')).join('·');
  el.innerHTML =
    `<b>${ids}</b>${names}<br><span>n ${g.elements[0].n.toFixed(3)} · ` +
    `⌀${(g.sd * 2).toFixed(1)}mm${g.cemented ? ' · cemented' : ''}</span>`;
  calloutHost.appendChild(el);
  return { el, group: g };
});

/* The narrow-screen legend, built from the same groups as the callouts so the
   two can never describe different lenses. */
const legendHost = document.querySelector('[data-legend]');
for (const g of glass.groups) {
  const li = document.createElement('li');
  const names = [...new Set(g.elements.map((e) => GLASS[e.glass].name))].join(' + ');
  li.innerHTML =
    `<b>${g.elements.map((e) => String(e.id).padStart(2, '0')).join('·')}</b>` +
    `<span>${names}</span>` +
    `<em>n ${g.elements[0].n.toFixed(3)} · ⌀${(g.sd * 2).toFixed(1)}</em>`;
  legendHost.appendChild(li);
}

const labelEl = document.querySelector('[data-chapter-label]');
const progressEl = document.querySelector('[data-progress]');
const driftEl = document.querySelector('[data-drift]');
let lastLabel = '';

/* ------------------------------------------------------------------ *
 * Pointer owns local detail only.
 * ------------------------------------------------------------------ */
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
if (!REDUCED) {
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / vw()) * 2 - 1;
    pointer.ty = (e.clientY / vh()) * 2 - 1;
  }, { passive: true });
}

/* ------------------------------------------------------------------ *
 * Resize.
 * ------------------------------------------------------------------ */
const _proj = new THREE.Vector3();
const _look = new THREE.Vector3();
const _view = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _pan = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _half = new THREE.Vector3();
const _dir = new THREE.Vector3();
let aspect = 1;

function resize() {
  const w = vw(), h = vh();
  renderer.setSize(w, h, false);
  aspect = w / h;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  conductor.measure();
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ *
 * The loop.
 *
 * One clock. Lenis is driven from here and nowhere else — a second
 * requestAnimationFrame calling lenis.raf is the classic way to make a page
 * like this stutter.
 * ------------------------------------------------------------------ */
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  lenis.raf(now);
  const s = conductor.read(dt);
  render(s, dt);
  requestAnimationFrame(frame);
}

function render(s, dt) {
  const e = s.exact;
  const p = phases(e);

  /* --- object state ------------------------------------------------ */
  applyExplode(p.explode);
  setIris(iris, p.iris * 0.85);

  for (const m of barrel.materials) m.opacity = 1 - p.barrelFade;
  barrel.group.visible = p.barrelFade < 0.995;

  blueprint.material.uniforms.uOpacity.value = p.blueprint;
  blueprint.material.uniforms.uDraw.value = clamp(p.blueprint * 1.35, 0, 1);
  blueprint.lines.visible = p.blueprint > 0.004;

  rays.lines.visible = p.rays > 0.004;
  rays.material.uniforms.uDraw.value = p.rays;
  rays.material.uniforms.uOpacity.value = 1 - p.raysOut * 0.85;
  imagePlane.visible = p.rays > 0.55;

  // Focus ring turns as the chapter about the barrel plays.
  if (barrel.focusRing) barrel.focusRing.group.rotation.z = -p.focusRing * 1.1;
  if (barrel.irisRing) barrel.irisRing.group.rotation.z = -p.iris * 0.85;

  /* --- idle and pointer -------------------------------------------- */
  if (!REDUCED) {
    spin.rotation.y = Math.sin(performance.now() * 0.00012) * 0.055;
    pointer.x = lerp(pointer.x, pointer.tx, 1 - Math.exp(-3.2 * dt));
    pointer.y = lerp(pointer.y, pointer.ty, 1 - Math.exp(-3.2 * dt));
    tilt.rotation.y = pointer.x * 0.055;
    tilt.rotation.x = pointer.y * 0.035;
  }

  /* --- camera ------------------------------------------------------
     Read the damped chapter, interpolate the ledger, then solve the
     distance from what is actually on screen right now. */
  const sm = clamp(s.smooth, 0, CHAPTERS.length - 1);
  const i = Math.min(CHAPTERS.length - 2, Math.floor(sm));
  const f = smootherstep(clamp(sm - i, 0, 1));
  const A = CHAPTERS[i], B = CHAPTERS[i + 1];

  const fa = framing(A.frame), fb = framing(B.frame);
  const centre = _centre.copy(fa.c).lerp(fb.c, f);
  const half = _half.copy(fa.half).lerp(fb.half, f);
  const fov = lerp(A.fov, B.fov, f);
  const pad = lerp(A.pad, B.pad, f);

  const dir = _dir.set(
    lerp(A.dir[0], B.dir[0], f),
    lerp(A.dir[1], B.dir[1], f),
    lerp(A.dir[2], B.dir[2], f)
  ).normalize();

  /* `dir` points from the object TO the camera, so the camera's own right
     vector comes from the view direction, which is its negation. Crossing with
     `dir` instead gives camera-left and silently mirrors every shift. */
  const viewDir = _view.copy(dir).negate();
  const right = _right.crossVectors(viewDir, camera.up).normalize();
  const up = _up.crossVectors(right, viewDir).normalize();

  // A portrait frame steps back rather than cropping sideways.
  const portrait = aspect < 1.15 ? clamp(1.15 / aspect, 1, 1.5) : 1;
  const dist = distanceForBox(half, dir, right, up, fov, aspect, pad * portrait);

  camera.fov = fov;
  camera.updateProjectionMatrix();

  /* Pan, do not re-aim. Offsetting the camera and its look-at point by the
     same vector slides the object across the frame while keeping it square to
     the lens; offsetting only the look-at point would skew it. In a portrait
     frame the copy sits in the lower third instead of beside the object, so
     the sideways shift is traded for a lift. */
  const portraitLayout = aspect < 1.15;
  const visH = 2 * dist * Math.tan((fov * Math.PI) / 360);
  const visW = visH * aspect;

  const shiftX = portraitLayout ? 0 : -lerp(A.shift, B.shift, f) * visW * 0.5;
  const lift = portraitLayout
    ? lerp(A.liftP, B.liftP, f)
    : lerp(A.lift, B.lift, f);

  const pan = _pan.copy(right).multiplyScalar(shiftX).addScaledVector(up, -lift * visH * 0.5);

  camera.position.copy(centre).addScaledVector(dir, dist).add(pan);
  camera.lookAt(_look.copy(centre).add(pan));

  /* --- interface reads `exact`, never `smooth` --------------------- */
  const label = sections[s.index]?.dataset.label || '';
  if (label !== lastLabel) { labelEl.innerHTML = label; lastLabel = label; }
  progressEl.style.transform = `scaleX(${clamp(s.progress, 0, 1).toFixed(4)})`;

  if (driftEl && !REDUCED) {
    // Counter-drift: the line travels across the object at its own rate.
    driftEl.style.setProperty('--drift', `${lerp(42, -62, clamp(p.drift, 0, 1)).toFixed(2)}vw`);
  }

  // Callouts follow their glass, and only while the stack is open.
  const show = p.explode > 0.12 && aspect >= 1.15;
  for (const c of callouts) {
    if (!show) { if (c.el.style.opacity !== '0') c.el.style.opacity = '0'; continue; }
    /* Anchor to the CENTRE OF THE GLASS, not the group's origin. Every group's
       origin sits at the lens datum and only moves by its explode offset, so
       anchoring there bunched all eight labels around the front of the lens
       instead of spreading them along it. */
    const side = c.group.index % 2 === 0 ? 1 : -1;
    _proj.set(0, side * (c.group.sd * U + 0.5), c.group.centreZ * U);
    c.group.group.localToWorld(_proj);
    _proj.project(camera);
    const inFront = _proj.z < 1;
    c.el.style.opacity = inFront ? String(clamp((p.explode - 0.12) / 0.3, 0, 1) * 0.95) : '0';
    c.el.style.left = `${(_proj.x * 0.5 + 0.5) * 100}%`;
    c.el.style.top = `${(-_proj.y * 0.5 + 0.5) * 100}%`;
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(frame);

/* ------------------------------------------------------------------ *
 * Test hooks.
 *
 * The Browser pane cannot be trusted to run a real scroll or report a stable
 * viewport, so every scroll-driven state is reachable by hand. Drive
 * __nodal.force(0..1) then __nodal.frame() and screenshot.
 * ------------------------------------------------------------------ */
window.__nodal = {
  spec,
  conductor,
  phases,
  chapters: CHAPTERS,
  parts: { glass, barrel, iris, rays, blueprint, imagePlane, scene, camera, renderer },
  /** Isolate one part of the object to work out what is lighting what.
      Draws directly, because render() rewrites visibility from the phases. */
  only(name) {
    const map = { glass: glass.root, barrel: barrel.group, iris: iris.group };
    for (const [k, obj] of Object.entries(map)) obj.visible = name == null || k === name;
    if (name == null) { render(conductor.state, 0.016); return; }
    renderer.render(scene, camera);
  },
  /** Jump to a fractional chapter and hold there. */
  hold(chapter) {
    conductor.hold = chapter;
    conductor.read(0.016);
    conductor.state.smooth = conductor.state.exact;
    render(conductor.state, 0.016);
  },
  release() { conductor.hold = null; },
  /** Scroll to a chapter for real, then draw. Verifies the actual reading of
      window.scrollY rather than a pinned override, so DOM and object agree. */
  goto(index, offset = 0) {
    const el = sections[Math.max(0, Math.min(sections.length - 1, index))];
    const rect = el.getBoundingClientRect();
    const y = rect.top + window.scrollY + rect.height * (0.5 + offset) - vh() * 0.5;
    lenis.scrollTo(y, { immediate: true, force: true });
    window.scrollTo(0, y);
    conductor.hold = null;
    const st = conductor.read(0.016);
    st.smooth = st.exact;                 // skip the damping for a still frame
    st.localSmooth = st.localExact;
    render(st, 0.016);
    return { chapter: +st.exact.toFixed(3), scrollY: Math.round(window.scrollY) };
  },
  lenis,
  frame() { render(conductor.read(0.016), 0.016); },
  get cam() { return camera.position.toArray().map((v) => +v.toFixed(3)); },
  ready: true,
};
