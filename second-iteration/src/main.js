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
 * `padP` is the portrait framing scale. A document plate carries far more copy
 * than it does in landscape, because the columns collapse, so the object has to
 * be both smaller and pushed further out of the way rather than just nudged.
 *
 * `liftP` is the portrait equivalent of lift, and it is a separate number rather than
 * a global nudge because the copy does not go to the same place in a portrait
 * frame for every chapter: most move it to the lower third, the trace and the
 * explode keep it at the top, and the series index sits across the middle. One
 * blanket portrait offset put the object on top of the copy in half of them. */
const CHAPTERS = [
  /* The hero looks straight down the optical axis, tight enough that the front
     element fills the frame. `dirLag` holds the swing back until the pull-out
     is underway, so the shot reads as one move then another rather than as a
     camera doing two things at once. */
  { id: 'hero',    dir: [ 0.00,  0.00, -1.00], fov: 26, pad: 1.35, frame: 'face',  shift:  0.00, lift:  0.36, liftP:  0.47, padP: 1.52, ease: 'settle', dirLag: 0.40 },
  /* From here the camera sits on -X. That is not a taste call: with the camera
     on -X the optical axis (+Z) runs left-to-right across the screen, so the
     light in the trace chapter travels the way a reader expects a diagram to
     be read. On +X the whole sequence runs backwards. */
  { id: 'object',  dir: [-0.97,  0.20,  0.14], fov: 30, pad: 1.52, frame: 'whole', shift:  0.34, lift:  0.05, liftP:  0.74, padP: 2.35, ease: 'plate'  },
  { id: 'beat',    dir: [-0.82,  0.13, -0.56], fov: 26, pad: 2.05, frame: 'whole', shift:  0.00, lift:  0.34, liftP:  0.34, ease: 'reveal' },
  { id: 'explode', dir: [-1.00,  0.09,  0.00], fov: 26, pad: 1.14, frame: 'glass', shift:  0.00, lift: -0.02, liftP: -0.16, ease: 'reveal' },
  { id: 'trace',   dir: [-1.00,  0.00,  0.00], fov: 25, pad: 1.45, frame: 'trace', shift:  0.02, lift: -0.52, liftP: -0.52, ease: 'plate'  },
  { id: 'series',  dir: [-0.70,  0.32, -0.64], fov: 30, pad: 2.45, frame: 'whole', shift:  0.34, lift: -0.60, liftP: -0.70, padP: 2.35, ease: 'settle' },
  { id: 'end',     dir: [ 0.10,  0.03, -0.99], fov: 32, pad: 1.52, frame: 'front', shift:  0.00, lift: -0.62, liftP: -0.58, ease: 'reveal' },
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

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);

/* A whisper of direct light on top of the environment, purely to put a hard
   highlight on the barrel edge that an environment map alone cannot give. */
const key = new THREE.DirectionalLight(0xffffff, 1.9);
key.position.set(6, 7, -4);
scene.add(key);
const fill = new THREE.DirectionalLight(0x8fc6e0, 0.65);
fill.position.set(-7, -2, 5);
scene.add(fill);

/* Light coming back up off the page. Near zero on the black plates, strong on
   paper, which is what actually happens to an object lying on warm stock. */
const bounce = new THREE.DirectionalLight(0xffe4c0, 0.15);
bounce.position.set(0, -8, 2);
scene.add(bounce);

/* ------------------------------------------------------------------ *
 * The opening.
 *
 * Looking straight into an unlit lens gives you black, because that is what
 * an unlit tube looks like. So the page does not fade in from a black
 * rectangle; it lights the object from the inside, in three beats:
 *
 *   1. a coating flare catches on the front surface
 *   2. light rakes back down the barrel and the element rims ignite in depth
 *   3. the iris resolves last, dead centre, as a nine-sided silhouette
 *
 * Beat 3 needs no light of its own: once the interior is lit, the blades
 * silhouette themselves against it.
 * ------------------------------------------------------------------ */
const KEY_BASE = 1.9, FILL_BASE = 0.65;

const frontFlare = new THREE.PointLight(0xcfe2f5, 0, 60, 2);
frontFlare.position.set(-2.4, 1.7, -9.5);   // ahead of the front vertex, off axis
scene.add(frontFlare);

/* Two interior lights, both well forward. A light behind the whole stack
   cannot be seen: the glass attenuates over 1.8 world units and the stack is
   eight deep, so nothing survives the trip. Real lens photography works the
   same way, lighting the front group and letting the internal reflections
   between element surfaces do the rest. */
const interior = new THREE.PointLight(0xffd2a0, 0, 26, 2);
interior.position.set(0.9, 0.6, -1.6);      // just inside, on the front group
scene.add(interior);

const deep = new THREE.PointLight(0xffc98c, 0, 30, 2);
deep.position.set(-0.7, -0.5, 2.0);         // down by the stop, for depth
scene.add(deep);

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
    case 'face': {
      // The face of the front element, with almost no margin. `front` leaves
      // half a radius of air, which is right for a three-quarter view and far
      // too loose for looking straight into the glass.
      const c = new THREE.Vector3();
      glass.groups[0].group.getWorldPosition(c);
      c.z += glass.elements[0].thickness * U * 0.5;
      const r = glass.elements[0].sd * U * 1.02;
      return { c, half: new THREE.Vector3(r, r, glass.elements[0].thickness * U * 0.6) };
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

/* ------------------------------------------------------------------ *
 * Easing set.
 *
 * Three curves with different body language, matching the three in the CSS.
 * A page where every transition shares one easing has no personality,
 * whichever easing it happens to be.
 * ------------------------------------------------------------------ */
const EASE = {
  reveal: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  plate: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1
      : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2,
  // Back-out tuned to roughly 3% overshoot: enough for a heavy camera to
  // arrive and settle, not enough to read as a bounce.
  settle: (t) => {
    if (t >= 1) return 1;
    const s = 0.55, u = t - 1;
    return 1 + (s + 1) * u * u * u + s * u * u;
  },
};

/* ------------------------------------------------------------------ *
 * The plate.
 *
 * 0 = black optical ground, 1 = warm paper document ground. Optical chapters
 * need black so glass and light can be seen at all; the specification and the
 * series are documents and belong on paper. One value drives the CSS palette,
 * the scene background, the exposure and the studio environment together, so
 * the page turns as a single object rather than as a themed component set.
 * ------------------------------------------------------------------ */
const PLATE_OF_CHAPTER = [0, 1, 0, 0, 0, 1, 0];

const PLATE_BLACK = { bg: [8, 9, 10],      fg: [232, 229, 222], accent: [255, 154, 60] };
const PLATE_PAPER = { bg: [237, 233, 224], fg: [28, 29, 31],    accent: [212, 98, 10]  };

/** The turn happens over the middle 55% of the span between two chapters. */
function plateAt(e) {
  const n = PLATE_OF_CHAPTER.length;
  const i = Math.min(n - 2, Math.max(0, Math.floor(e)));
  const a = PLATE_OF_CHAPTER[i], b = PLATE_OF_CHAPTER[i + 1];
  if (a === b) return a;
  const t = clamp((clamp(e, 0, n - 1) - i - 0.225) / 0.55, 0, 1);
  return lerp(a, b, EASE.plate(t));
}

const mixRGB = (a, b, t) => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
];

/**
 * Spherical interpolation between two view directions.
 *
 * Lerping two unit vectors and renormalising traces a chord across the sphere,
 * not an arc, so angular velocity is wrong throughout and worst on the long
 * swings — which is exactly where the eye notices. Falls back to lerp when the
 * two directions are nearly parallel and the arc is numerically unstable.
 */
function slerpDir(a, b, t, out) {
  const dot = clamp(a.dot(b), -1, 1);
  if (dot > 0.9995) return out.copy(a).lerp(b, t).normalize();
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / sin;
  const w2 = Math.sin(t * theta) / sin;
  return out.copy(a).multiplyScalar(w1).addScaledVector(b, w2).normalize();
}

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
    plate: plateAt(e),
    dolly: win(e, 1.72, 2.00) * (1 - win(e, 2.04, 2.24)),
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
  elements: `${spec.elements} in ${spec.groups} groups`,
  elementsShort: `${spec.elements} elements / ${spec.groups} groups`,
  airglass: String(spec.airGlassSurfaces),
  transmission: `${(spec.transmission * 100).toFixed(1)} %`,
  frontdia: `${spec.frontDiameter.toFixed(1)} mm`,
  bfd: `${spec.bfd.toFixed(1)} mm`,
  circle: `Full frame · ${spec.imageCircle.toFixed(1)} mm`,
  aov: `${(spec.halfField * 2).toFixed(1)}°`,
  rms: `${(spec.focusRMS * 1000).toFixed(1)} µm`,
  focus: `${spec.focusZ.toFixed(1)} mm behind the front`,
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

/* The progress rail: one tick per chapter down a vertical scale, an index mark
   that travels with the scroll and the name of wherever you currently are.
   Ticks are placed from the sections themselves, so adding a chapter adds a
   tick without anyone remembering to. */
const railTicks = document.querySelector('[data-rail-ticks]');
const railIndex = document.querySelector('[data-rail-index]');
const railNow = document.querySelector('[data-rail-now]');
const tickEls = sections.map((sec, i) => {
  const li = document.createElement('li');
  li.style.top = `${(i / Math.max(1, sections.length - 1)) * 100}%`;
  railTicks.appendChild(li);
  return li;
});

const driftEl = document.querySelector('[data-drift]');
let lastRailIndex = -1;

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
 * Applying the plate.
 *
 * One value, four consumers: the CSS palette, the scene background, the tone
 * mapping exposure and the studio environment. They are written together so
 * the page and the object can never disagree about which ground they are on.
 * ------------------------------------------------------------------ */
const rootStyle = document.documentElement.style;
const sceneBg = new THREE.Color();
let lastPlateWritten = -1;
let envStep = -1;
let envTarget = null;
let introGate = 1;       // dims the whole studio while the opening plays
let introFlagged = false;

/* Rebuilding a PMREM every frame is far too expensive, and swapping between
   two prebuilt ones pops at the halfway point. Six quantised steps across the
   turn is smooth enough that the material response reads as continuous, and
   each rebuild lands on a different frame of a slow scroll. */
function ensureEnvironment(plate) {
  const step = Math.round(clamp(plate, 0, 1) * 5);
  if (step === envStep) return;
  envStep = step;
  const next = makeEnvironment(renderer, step / 5);
  if (envTarget) envTarget.dispose();
  envTarget = next;
  scene.environment = next.texture;
}

function applyPlate(p) {
  ensureEnvironment(p);

  const bg = mixRGB(PLATE_BLACK.bg, PLATE_PAPER.bg, p);
  sceneBg.setRGB(bg[0] / 255, bg[1] / 255, bg[2] / 255, THREE.SRGBColorSpace);
  scene.background = sceneBg;

  // Paper is a bright ground and needs far less exposure than a dark studio.
  renderer.toneMappingExposure = lerp(1.42, 1.05, p) * introGate;
  bounce.intensity = 0.15 + p * 1.25;

  // Writing custom properties forces a style recalculation, so only write when
  // the value has actually moved. The plate is static for most of the page.
  const q = Math.round(p * 1000) / 1000;
  if (q === lastPlateWritten) return;
  lastPlateWritten = q;

  const fg = mixRGB(PLATE_BLACK.fg, PLATE_PAPER.fg, p);
  const ac = mixRGB(PLATE_BLACK.accent, PLATE_PAPER.accent, p);
  /* Halfway through a turn the interpolated background and foreground meet at
     the same luminance and the copy vanishes. Any continuous path between two
     inverted palettes has to cross, so rather than fight it the copy racks out
     of focus across the crossing and resolves on the new ground. On a page
     about a lens, the type going soft as the page turns is the right answer
     anyway. `turn` peaks at 1 in the middle and is 0 at either end. */
  const turn = 4 * p * (1 - p);
  rootStyle.setProperty('--turn', turn.toFixed(4));
  rootStyle.setProperty('--plate', String(q));
  rootStyle.setProperty('--bg-rgb', bg.join(', '));
  rootStyle.setProperty('--fg-rgb', fg.join(', '));
  rootStyle.setProperty('--accent-rgb', ac.join(', '));

  // The drawing is interface and follows the accent; the rays are light and
  // do not, because light is not a brand colour.
  blueprint.material.uniforms.uColor.value.setRGB(
    ac[0] / 255, ac[1] / 255, ac[2] / 255, THREE.SRGBColorSpace
  );
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
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
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

/* -1 = not started, -2 = forced complete (test hooks and reduced motion). */
let introStart = -1;

function introAt(now) {
  if (introStart === -2) return 1;
  // Landing part-way down the page means the opening has already been missed.
  if (introStart < 0 && window.scrollY > 40) { introStart = -2; return 1; }
  if (introStart < 0) introStart = now;
  return clamp((now - introStart) / 2400, 0, 1);
}

let camDist = -1;        // damped camera distance, -1 until the first solve
let snapCamera = false;  // test hooks jump rather than ease
let roll = 0;            // scroll-momentum roll, radians
let dollyRef = -1;       // distance frozen at the start of the dolly zoom

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

  /* --- the opening --------------------------------------------------- */
  const intro = REDUCED ? 1 : introAt(performance.now());
  const introEase = smootherstep(intro);
  const beat1 = win(intro, 0.00, 0.24);   // coating flare on the front surface
  const beat2 = win(intro, 0.10, 0.46);   // the front group lights from within
  const beat3 = win(intro, 0.28, 0.66);   // the glow reaches back to the iris
  /* The studio deliberately arrives LAST. Ramping the key at the same rate as
     the interior makes the whole frame fade up together, which reads as a page
     transition rather than as a lens lighting from within. Holding the studio
     back means the first two things you see are the coating flare and the glow
     down the barrel, and the barrel itself only resolves around them at the
     end. */
  const studio = win(intro, 0.60, 1.0);
  frontFlare.intensity = beat1 * 22 * (1 - win(intro, 0.74, 1.0) * 0.6);
  interior.intensity = beat2 * 52 * (1 - studio * 0.55);
  deep.intensity = beat3 * 44 * (1 - studio * 0.45);
  key.intensity = KEY_BASE * lerp(0.02, 1, studio);
  fill.intensity = FILL_BASE * lerp(0.02, 1, studio);

  /* The environment map has to be gated too, and it is the one that matters.
     Image-based lighting ignores the directional lights entirely, so dimming
     only those left the whole object floating at a flat 20/255 no matter how
     dark everything else went. With the IBL down, the only light in the scene
     during the opening is the flare and the glow inside the barrel, which is
     the entire point of the shot. */
  scene.environmentIntensity = lerp(0.03, 1, studio);
  introGate = lerp(0.55, 1, studio);
  if (intro > 0.82 && !introFlagged) {
    introFlagged = true;
    document.body.classList.add('is-lit');
  }

  /* --- the ground ---------------------------------------------------- */
  applyPlate(plateAt(e));

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

  /* --- momentum and pointer ----------------------------------------
     Scroll velocity, finally read. The conductor has computed signed speed and
     jolt every frame since the first build and nothing consumed them. A lens
     that rolls with the momentum of the scroll and settles when you stop has
     intention. The three-degree sine sway it replaces read as drift. */
  if (!REDUCED) {
    const targetRoll = clamp(s.signedSpeed * 0.055, -0.09, 0.09);
    roll += (targetRoll - roll) * (1 - Math.exp(-3.0 * dt));
    spin.rotation.z = roll;
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
  const A = CHAPTERS[i], B = CHAPTERS[i + 1];
  // Each chapter states the body language of its own outgoing move, so a long
  // orbit and a small push-in no longer share one characterless curve.
  const f = EASE[A.ease](clamp(sm - i, 0, 1));

  const fa = framing(A.frame), fb = framing(B.frame);
  const centre = _centre.copy(fa.c).lerp(fb.c, f);
  const half = _half.copy(fa.half).lerp(fb.half, f);
  const fovBase = lerp(A.fov, B.fov, f);
  const portraitLayout0 = aspect < 1.15;
  const pad = lerp(
    portraitLayout0 ? (A.padP ?? A.pad) : A.pad,
    portraitLayout0 ? (B.padP ?? B.pad) : B.pad,
    f
  );

  /* Translation and rotation do not have to share a clock. Delaying the swing
     lets the hero pull straight back off the front element before the camera
     starts travelling around the barrel. */
  const raw = clamp(sm - i, 0, 1);
  const dirT = A.dirLag
    ? EASE[A.ease](clamp((raw - A.dirLag) / (1 - A.dirLag), 0, 1))
    : f;
  const dir = slerpDir(
    _a.fromArray(A.dir).normalize(),
    _b.fromArray(B.dir).normalize(),
    dirT,
    _dir
  );

  /* `dir` points from the object TO the camera, so the camera's own right
     vector comes from the view direction, which is its negation. Crossing with
     `dir` instead gives camera-left and silently mirrors every shift. */
  const viewDir = _view.copy(dir).negate();
  const right = _right.crossVectors(viewDir, camera.up).normalize();
  const up = _up.crossVectors(right, viewDir).normalize();

  // A portrait frame steps back rather than cropping sideways.
  const portrait = aspect < 1.15 ? clamp(1.15 / aspect, 1, 1.5) : 1;
  const solved = distanceForBox(half, dir, right, up, fovBase, aspect, pad * portrait);

  /* The fit is re-solved every frame from live bounds, so while the glass is
     separating the target distance grows continuously. Following it directly
     makes the camera creep and never hold still, which is most of what reads
     as unpolished. Damped slower than the chapter value so it arrives after
     the move rather than chasing it. */
  if (camDist < 0 || snapCamera) camDist = solved;
  else camDist += (solved - camDist) * (1 - Math.exp(-2.2 * dt));
  snapCamera = false;

  /* Dolly zoom, fired once, during the blank beat.
   *
   * It was originally written over the explode, which was the wrong place
   * twice over: the framing is already pulling back there to fit the
   * separating glass, so the two fought for the same distance and the subject
   * shrank by a quarter instead of holding, and the explode is quite dramatic
   * enough without a second effect on top of it. The blank beat is the one
   * moment on the page where nothing else is moving, which is exactly where a
   * move like this can be seen.
   *
   * Holding the subject requires dist * tan(fov/2) to stay constant, so the
   * reference distance is frozen on entry. Reading the live damped distance
   * instead would let the fit drift out from under the compensation. */
  const dolly = win(e, 1.72, 2.00) * (1 - win(e, 2.04, 2.24));
  if (dolly > 0.001) { if (dollyRef < 0) dollyRef = camDist; }
  else dollyRef = -1;

  const base = dollyRef > 0 ? lerp(camDist, dollyRef, dolly) : camDist;
  const fov = fovBase + dolly * 8;
  const dist = base * (
    Math.tan((fovBase * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360)
  );

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
  const p01 = clamp(s.progress, 0, 1);
  const pct = `${(p01 * 100).toFixed(3)}%`;
  railIndex.style.top = pct;
  railNow.style.top = pct;
  if (s.index !== lastRailIndex) {
    for (let k = 0; k < tickEls.length; k++) {
      tickEls[k].classList.toggle('is-on', k === s.index);
    }
    railNow.innerHTML = sections[s.index]?.dataset.label || '';
    lastRailIndex = s.index;
  }

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
    introStart = -2;      // test frames show the lit, arrived state
    snapCamera = true;
    conductor.hold = chapter;
    conductor.read(0.016);
    conductor.state.smooth = conductor.state.exact;
    render(conductor.state, 0.016);
  },
  release() { conductor.hold = null; },
  /** Scrub the opening. 0 = unlit tube, 1 = fully lit. */
  intro(frac) {
    introStart = frac >= 1 ? -2 : performance.now() - clamp(frac, 0, 1) * 2400;
    render(conductor.state, 0.016);
    return frac;
  },
  /** Scroll to a chapter for real, then draw. Verifies the actual reading of
      window.scrollY rather than a pinned override, so DOM and object agree. */
  goto(index, offset = 0) {
    introStart = -2;
    const el = sections[Math.max(0, Math.min(sections.length - 1, index))];
    const rect = el.getBoundingClientRect();
    const y = rect.top + window.scrollY + rect.height * (0.5 + offset) - vh() * 0.5;
    snapCamera = true;
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
