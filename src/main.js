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

import * as THREE from '../vendor/three.module.js';
import Lenis from '../vendor/lenis.mjs';
import { Conductor, clamp, lerp, smootherstep, vw, vh } from './conductor.js';
import {
  SURFACES, GLASS, STOP_Z, HALF_FIELD, TARGET_FNUMBER,
  specSheet, buildElements, lastVertexZ,
} from './optics.js';
import {
  U, makeEnvironment, buildGlassStack, buildBarrel, buildIris, setIris,
  buildRays, buildImagePlane, buildBarrelBlueprint, visibleBounds, RAY_START,
  buildWordmark,
  buildGlow,
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
  /* Front-led three-quarter, not dead-on.
   *
   * A full-frame close-up of the front element was tried and abandoned. Every
   * bit of this object that reads as expensive is manufactured detail: the
   * knurled focus ring, the engraved scale, the machined bezel, the anodised
   * barrel. Framing tight on the glass excludes all of it and asks a
   * procedural material to carry the whole frame on its own, which it cannot.
   * Turning the object far enough to see the barrel receding behind the front
   * element buys that detail back while still leading with the glass. */
  { id: 'hero',    dir: [ 0.46,  0.28, -0.84], fov: 26, pad: 1.24, frame: 'front', shift:  0.12, lift:  0.06, liftP:  0.50, padP: 2.10, ease: 'settle', dirLag: 0.40 },
  /* From here the camera sits on -X. That is not a taste call: with the camera
     on -X the optical axis (+Z) runs left-to-right across the screen, so the
     light in the trace chapter travels the way a reader expects a diagram to
     be read. On +X the whole sequence runs backwards. */
  { id: 'object',  dir: [-0.97,  0.20,  0.14], fov: 30, pad: 1.52, frame: 'whole', shift:  0.42, lift:  0.05, liftP:  0.74, padP: 2.35, ease: 'plate'  },
  { id: 'beat',    dir: [-0.82,  0.13, -0.56], fov: 26, pad: 2.05, frame: 'whole', shift:  0.00, lift:  0.34, liftP:  0.34, ease: 'reveal' },
  { id: 'explode', dir: [-1.00,  0.09,  0.00], fov: 26, pad: 1.14, frame: 'glass', shift:  0.00, lift: -0.02, liftP: -0.16, ease: 'glide',  hold: 0.58 },
  { id: 'trace',   dir: [-1.00,  0.00,  0.00], fov: 25, pad: 1.74, frame: 'trace', shift:  0.36, lift:  0.10, liftP: -0.52, ease: 'plate'  },
  { id: 'series',  dir: [-0.70,  0.30, -0.65], fov: 30, pad: 1.22, frame: 'stable', shift:  0.38, lift:  0.00, liftP: -0.70, padP: 2.35, ease: 'glide'  },
  /* The closing shot: the lens STANDING on its mount, seen side-on from a
     shallow three-quarter so the knurling and the engraved scales read. The
     object is rotated upright by the `stand` phase — see render() — which is
     why this frames 'whole' and sits hard left with the copy beside it. */
  { id: 'end',     dir: [-0.92,  0.05, -0.39], fov: 30, pad: 1.22, frame: 'stable', shift:  0.00, lift: -0.49, liftP: -0.66, ease: 'reveal' },
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
const sceneBg = new THREE.Color();
scene.background = sceneBg;

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);

/* A whisper of direct light on top of the environment, purely to put a hard
   highlight on the barrel edge that an environment map alone cannot give. */
const key = new THREE.DirectionalLight(0xffffff, 1.9);
key.position.set(6, 7, -4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xc3d4e2, 0.5);
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
const KEY_BASE = 1.9, FILL_BASE = 0.50;

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
const wordmark = buildWordmark('NODAL', QUALITY);
const glow = buildGlow();

lens.add(glass.root, barrel.group, iris.group, rays.lines, imagePlane, blueprint.lines);
rays.lines.visible = false;
imagePlane.visible = false;
/* Off before the box below is captured. It defaults to visible, and its
   outline and leader lines reach well past the barrel — left on, it inflated
   the 'whole' box enough to push chapter 01 off the right edge. render()
   manages it from here. */
blueprint.lines.visible = false;

/* Nested transform groups, so scroll, pointer and idle drift each own exactly
   one of them and can never overwrite each other. */
const spin = new THREE.Group();     // idle cinematic drift
const drag = new THREE.Group();     // what the visitor turns by hand
const tilt = new THREE.Group();     // pointer parallax
tilt.add(drag);
drag.add(spin);
spin.add(lens);
scene.add(tilt);

/* Outside tilt and drag on purpose: it is a backdrop, so it must not swing
   when the visitor turns the object or when the pointer parallax moves. */
scene.add(wordmark.mesh);
scene.add(glow.mesh);

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

/* The 'whole' framing measures a box captured ONCE, at rest, with everything
 * visible — then transformed by the lens's live matrix.
 *
 * Live bounds cannot be used for it. `visibleBounds` skips hidden subtrees and
 * the barrel's visibility is a hard boolean (`barrelFade < 0.995`), so the
 * frame the barrel switches back on the box grows by the entire barrel and the
 * solved distance jumps with it. The damping does not remove that, it just
 * spreads it into a lurch — which is exactly what it looked like on the way
 * into chapter 05.
 *
 * A captured box also survives the closing rotation, because `applyMatrix4`
 * re-fits the AABB around the transformed corners. */
const WHOLE_LOCAL = new THREE.Box3();
const _wholeBox = new THREE.Box3();
const _wholeC = new THREE.Vector3();
const _wholeH = new THREE.Vector3();
/* Captured at rest, with the barrel on and the rays already hidden. Must run
   before the first render, which is the only moment all of that is true. */
lens.updateWorldMatrix(true, true);
visibleBounds(lens, WHOLE_LOCAL);

function wholeFraming() {
  /* `lens.matrix`, deliberately, not `matrixWorld`.
   *
   * The ancestors above `lens` are the idle drift, the pointer parallax and
   * whatever the visitor has dragged. Transforming an AABB by a rotation
   * inflates it — the box grows to contain the rotated corners — so feeding
   * matrixWorld in here made the framing breathe with the idle spin, and blew
   * chapter 01 off the right edge. The framing should follow the object's
   * staged placement and ignore the cosmetic rotation on top of it, which is
   * exactly what the local matrix is. */
  lens.updateMatrix();
  _wholeBox.copy(WHOLE_LOCAL).applyMatrix4(lens.matrix);
  _wholeBox.getCenter(_wholeC);
  _wholeBox.getSize(_wholeH).multiplyScalar(0.5);
  return { c: _wholeC, half: _wholeH };
}

const frontRadius = glass.elements[0].sd * U * 1.5;

/* How far above its resting place the object starts the opening. Measured from
   the front element, which is what the hero frames, so it clears the top of the
   frame at any viewport rather than being a magic number in world units. */
const DROP_SPAN = glass.elements[0].sd * U * 3.4;

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
    /* The captured box. Only the chapters after the trace need it, because
       only they have the barrel fading back IN across their span — and that
       flips `visible`, which steps the live bounds. Everything before the
       trace stays on live bounds: the captured box frames very slightly
       differently, and those chapters were already right. */
    case 'stable': return wholeFraming();
    /* Live bounds. Accurate, and correct for every chapter where nothing
       toggles visibility mid-span. */
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
  /* Zero velocity at BOTH ends.
   *
   * `reveal` and `settle` are out-curves: their derivative at t=0 is 6.9 and
   * 3.55 respectively, so the camera leaves at full speed. That is right when
   * the previous move is still settling and the two overlap, and wrong when the
   * camera has been sitting still — which is the case going into the set, where
   * it holds for most of a chapter and then departs. Same position, but the
   * velocity steps from nothing to everything, and that is what reads as a
   * jump. Smootherstep leaves from rest. */
  glide: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10)),
  /* Rule of thumb: any chapter carrying a `hold` must use `glide` to leave.
     The hold guarantees the camera is stationary, and an out-curve departing
     from stationary is the jolt. The explode was the worst case on the page —
     0.000 to 3.652 in one step, 17% of the camera's whole distance. */
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

/* The accent is taken FROM the object rather than chosen against it.
 *
 * Sampling the rendered glass gives a dominant body colour around #182038, hue
 * 220, and the AR coatings in the prescription bloom near hue 217. The accent
 * sits at hue 213 on both plates, so it reads as the coating on the front
 * element rather than as a brand colour laid on top.
 *
 * The earlier cyan failed because it was bright and saturated enough to match
 * the glass in VALUE as well as hue, which flattened the whole frame to one
 * temperature. This one is a long way from the glass in value: the glass is a
 * dark body at ~16% lightness, this is a light mark at ~70%. Same family,
 * opposite end, so it separates instead of merging.
 *
 * Emphasis is still carried mostly by value. The hue is rationed to small
 * interface marks and one word per chapter; the hero headline stays at full
 * foreground because it is the sell line. */
const PLATE_BLACK = { bg: [8, 9, 10],      fg: [232, 229, 222], accent: [140, 176, 219] };
const PLATE_PAPER = { bg: [237, 233, 224], fg: [28, 29, 31],    accent: [46, 79, 118]   };

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
  /* Rises out of the blank beat, holds open, then collapses before the trace —
     because the traced rays are only truthful when the glass is assembled.

     It starts at 2.74, not 2.25. The earlier value meant the glass was already
     separating while the beat was still making its claim, so the line landed on
     top of the evidence instead of ahead of it. The order is now: statement,
     statement clears, THEN the lens opens into an empty frame. */
  const explode = win(e, 2.82, 3.24) * (1 - win(e, 3.62, 3.94));
  return {
    explode,
    /* The barrel stays dissolved from the explode all the way through the
       trace and only returns for the series. The rays are inside the lens, so
       putting the metal back before they have been drawn would hide the one
       thing that chapter exists to show. */
    /* Held at zero through the whole of the explode. The barrel outline is
       drawn in the same plane the separated elements occupy, so over an open
       stack it crosses the glass and runs straight through the callout labels
       — the drawing and the thing it describes were competing for the same
       pixels. It belongs to the trace, where the glass is reassembled and the
       outline is context for the light path rather than clutter over it. It
       now draws on across the handover into 04. */
    blueprint: win(e, 3.66, 4.10) * (1 - win(e, 4.74, 5.12)),
    /* Returns over 4.30–4.72, not 4.70–5.08. Chapter 05 pins at ~4.86, so the
       old window had the barrel still half-dissolved when the set arrived —
       the exterior was translucent in the very shot that is meant to show it
       finished. Solid by 4.72, and the closing rotation does not start until
       5.30, which leaves a real beat of the assembled object holding still. */
    barrelFade: win(e, 2.86, 3.20) * (1 - win(e, 4.30, 4.72)),
    rays: win(e, 3.80, 4.12),
    /* Was 4.72–5.06 and only ever reached 0.85, so the trace sat at 15%
       opacity across the set AND the closing shot — faint lines over a lens
       that is supposed to be assembled. It now goes fully to zero, and early
       enough that chapter 05 is clean when it pins (~4.86). */
    raysOut: win(e, 4.45, 4.85),
    iris: win(e, 0.55, 1.35) * (1 - win(e, 1.62, 2.15)),
    focusRing: win(e, 0.6, 1.9),
    /* The closing move: the object rises onto its mount. +Z is the optical
       axis, so rotating -90° about X sends +Z upward: mount to the sky, front
       element down, the way a lens sits on its cap. That is the direction that
       leaves the engraved scales the right way up — the other way stands it on
       its mount but reads every number upside down. Driven from `e` like
       everything else, so scrolling back up lays it down again. */
    stand: win(e, 5.30, 6.00),
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
  eflMm: `${spec.efl.toFixed(0)}mm`,
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
  // Fires more than a viewport before the pad pins. The pad rises a full
  // viewport on its own, so the words must already be up by the time it does.
  { rootMargin: '0px 0px 28% 0px' }
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

/* The inspector.
 *
 * One card per group, built once at startup from the same prescription the
 * geometry came from, so it cannot drift out of step with what is on screen.
 * Hovering is only offered when the stack is fully open — before that the
 * elements overlap on screen and a pick would be a guess. */
const probeEl = document.querySelector('[data-probe]');
const RADIUS = (r) => (Math.abs(r) > 1e5 ? '∞' : `${r.toFixed(1)} mm`);
const probeHTML = glass.groups.map((g) => {
  const els = g.elements;
  const ids = els.map((el) => String(el.id).padStart(2, '0')).join(' · ');
  const names = [...new Set(els.map((el) => GLASS[el.glass].name))].join(' + ');
  const role = g.cemented
    ? (els.length >= 3 ? 'Cemented triplet' : 'Cemented doublet')
    : 'Singlet';
  const thick = els.reduce((a, el) => a + el.thickness, 0);
  const lowDisp = els.some((el) => GLASS[el.glass].v >= 70);
  const highDisp = els.some((el) => GLASS[el.glass].v <= 30);
  /* The note is derived, not written per element: it reads the Abbe numbers
     and says what that combination is FOR. */
  const note = g.cemented
    ? 'Cemented so the pair acts as one surface. High and low dispersion bonded together is how the colour one introduces gets cancelled by the other.'
    : lowDisp
      ? 'Anomalous dispersion. Expensive, slow to grind, and the reason the colour fringing stays under four microns wide open.'
      : highDisp
        ? 'Dense flint. It bends light hard in a short distance, which is what keeps the barrel this length at this aperture.'
        : 'Crown. It carries the power without adding colour of its own.';
  return `<div class="probe-head"><span class="probe-id">${ids}</span>` +
    `<span class="probe-role">${role}</span></div>` +
    `<h3 class="probe-name">${names}</h3>` +
    `<dl>` +
      `<dt>Index n</dt><dd>${els[0].n.toFixed(4)}</dd>` +
      `<dt>Abbe v</dt><dd>${GLASS[els[0].glass].v.toFixed(1)}</dd>` +
      `<dt>Diameter</dt><dd>⌀ ${(g.sd * 2).toFixed(1)} mm</dd>` +
      `<dt>Thickness</dt><dd>${thick.toFixed(2)} mm</dd>` +
      `<dt>Front radius</dt><dd>${RADIUS(els[0].r1)}</dd>` +
      `<dt>Rear radius</dt><dd>${RADIUS(els[els.length - 1].r2)}</dd>` +
    `</dl><p class="probe-note">${note}</p>`;
});

/* Every mesh maps back to the group it belongs to, so a raycast hit on a rim
   or a surface resolves without walking the tree by hand. */
const groupOfObject = new Map();
glass.groups.forEach((g) => {
  g.rims = [];
  g.group.traverse((o) => {
    groupOfObject.set(o, g);
    /* The ground edge is what gets lit, not the glass. Highlighting by SCALE
       would have been the obvious move and is wrong here: the explode camera
       frames live bounds, so growing an element by 5% quietly pulls the whole
       shot back. Emissive costs nothing geometrically. */
    if (o.isMesh && o.userData.rim) {
      o.material.emissive.setHex(0x8cb0db);
      o.material.emissiveIntensity = 0;
      g.rims.push(o.material);
    }
  });
});
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
let hoverIndex = -1;
const hoverAmt = glass.groups.map(() => 0);

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

/* ------------------------------------------------------------------ *
 * The set, and what each focal length actually does.
 *
 * There is no photography on this page and there is not going to be: every
 * pixel is generated from the prescription, and a stock frame dropped in here
 * would be the one thing on the plate that nobody made. So the hover panel
 * answers the same question a sample frame would — what can I shoot with this?
 * — by DERIVING it.
 *
 * Angle of view and coverage come from the page's own image circle, so the
 * 40mm entry reports exactly the 31.0° the spec strip already prints. The
 * diagram is the useful part: a 1.70m figure with the frame this lens actually
 * gives you at two metres drawn over it, to scale. That is a real answer to
 * "what does 75mm do" in a way a caption is not.
 * ------------------------------------------------------------------ */
/* The notes are written to the caption band's measure — 85 characters a line —
   so each one sets as two near-even lines. Left to run their natural length
   they came out 88/33, 88/10 and a single line, which made the panel change
   height as you moved down the list. */
const FIGURE_M = 1.70;                       // a person, for scale
const SET = [
  { mm: 25, t: 'T1.9', close: '0.28 m', role: 'Wide',
    note: 'Wide enough to hold the room, and long enough that a face keeps the shape it started with. The one you reach for when there is nowhere left to step back to.' },
  { mm: 40, t: `T${spec.tStop.toFixed(1)}`, close: '0.45 m', role: 'Normal',
    note: 'The one that disappears. Near enough to how you actually see that nobody in the room ever reads it as a lens choice, which is exactly what it is there to do.' },
  { mm: 75, t: 'T2.1', close: '0.75 m', role: 'Portrait',
    note: 'Separation without compression. It steps back off the subject, keeps the face honest, and lets everything standing behind it fall quietly out of the way.' },
];

/* Every derived number here comes off the page's own image circle, so the 40mm
   entry reports exactly the angle of view the spec strip already prints. */
const setData = SET.map((L) => {
  const frameMM = spec.imageCircle * 0.49;              // 16:9 height in the circle
  const aov = 2 * Math.atan((spec.imageCircle / 2) / L.mm) * 180 / Math.PI;
  const coversM = 2 * frameMM / L.mm;                   // metres of subject, at 2m
  const covers = coversM >= 1.5 ? 'head to foot'
    : coversM >= 0.8 ? 'chest up'
    : coversM >= 0.45 ? 'head and shoulders'
    : 'a face';
  return { ...L, aov, coversM, covers };
});

/* The rows report the derived figures too, so the list and the panel can never
   disagree — they are the same computation. */
for (const li of document.querySelectorAll('[data-set]')) {
  const d = setData[Number(li.dataset.set)];
  const meta = li.querySelector('.idx-meta');
  if (meta) {
    meta.innerHTML =
      `${d.t} &middot; ${d.close} close focus &middot; 95mm front` +
      `<span class="idx-aov">${d.aov.toFixed(1)}&deg; &middot; ${d.covers} at 2&thinsp;m</span>`;
  }
}

/* The hover panel.
 *
 * There is no photography on this page and there is not going to be by
 * default: every pixel is generated from the prescription, and a stock frame
 * would be the one thing on the plate nobody made. So the placeholder IS the
 * derived answer — a 1.70m figure with the frame that lens gives at two metres
 * drawn over it, to scale.
 *
 * Drop a real frame at `frames/25mm.jpg` (3:2) and it takes over on its own;
 * the placeholder stays behind it as the fallback. No code change needed. */
const setCard = document.querySelector('[data-setcard]');

/* All three are built ONCE and stacked in one grid cell; hovering swaps which
 * is opaque. Rebuilding `innerHTML` per hover recreated the <img> every time,
 * so the browser re-decoded it and the placeholder flashed through on the way
 * — cached or not, a fresh element still has to decode before it paints. */
const setFigures = setData.map((d) => {
  const fh = clamp(d.coversM / FIGURE_M, 0.04, 1) * 150;
  const fw = fh * (16 / 9);
  const fig = document.createElement('figure');
  fig.className = 'setshot';
  fig.innerHTML = `
    <div class="setshot-frame">
      <svg class="setshot-ph" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g class="fig">
          <circle cx="150" cy="34" r="16"/>
          <path d="M150 52 C 126 52 118 70 118 92 L118 190 M150 52 C 174 52 182 70 182 92 L182 190"/>
          <path d="M118 106 L104 150 M182 106 L196 150"/>
        </g>
        <rect class="frm" x="${(150 - fw / 2).toFixed(1)}" y="16"
              width="${fw.toFixed(1)}" height="${fh.toFixed(1)}"/>
        <text class="ph" x="150" y="196">FRAME AT 2 M &middot; PLACEHOLDER</text>
      </svg>
      <img class="setshot-img" src="frames/${d.mm}mm.jpg" alt="" decoding="async">
    </div>
    <figcaption class="setshot-cap">
      <div class="setshot-head">
        <p class="setshot-mm">${d.mm}<span>mm &middot; ${d.role}</span></p>
        <p class="setshot-num">${d.aov.toFixed(1)}&deg; &middot; ${d.coversM.toFixed(2)} m at 2 m</p>
      </div>
      <p class="setshot-note">${d.note}</p>
    </figcaption>`;
  // A missing frame must not leave a broken-image glyph over the diagram.
  const img = fig.querySelector('.setshot-img');
  img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
  setCard.appendChild(fig);
  return fig;
});

let setShown = -1;
function showSet(i, li) {
  if (setShown === i) return;
  setShown = i;
  setFigures.forEach((f, k) => f.classList.toggle('is-active', k === i));
  setCard.classList.add('is-on');
  for (const other of document.querySelectorAll('[data-set]')) {
    other.classList.toggle('is-probed', other === li);
  }
}
for (const li of document.querySelectorAll('[data-set]')) {
  const i = Number(li.dataset.set);
  li.addEventListener('pointerenter', () => showSet(i, li));
  li.addEventListener('pointermove', () => showSet(i, li));
}
document.querySelector('.index')?.addEventListener('pointerleave', () => {
  setShown = -1;
  setCard.classList.remove('is-on');
  setFigures.forEach((f) => f.classList.remove('is-active'));
  for (const other of document.querySelectorAll('[data-set]')) other.classList.remove('is-probed');
});

/* The progress rail: a bar across the top edge with one tick per chapter and a
   fill that grows with the scroll. Ticks are placed from the sections
   themselves, so adding a chapter adds a tick without anyone remembering to.
   The chapter name lives in the bottom-left corner, clear of the top band. */
const railTicks = document.querySelector('[data-rail-ticks]');
const railIndex = document.querySelector('[data-rail-index]');
const railNow = document.querySelector('[data-rail-now]');
const tickEls = sections.map((sec, i) => {
  const li = document.createElement('li');
  li.style.left = `${(i / Math.max(1, sections.length - 1)) * 100}%`;
  railTicks.appendChild(li);
  return li;
});

/* The feed loops by translating exactly -50%, which only reads as seamless if
   the list contains the same run of lines twice. Duplicating in JS keeps the
   markup honest: the copy is written once. */
const tickerTrack = document.querySelector('[data-ticker]');
if (tickerTrack) {
  tickerTrack.append(...[...tickerTrack.children].map((li) => li.cloneNode(true)));
}

const heroRuleEl = document.querySelector('[data-hero-rule]');
const beatA = document.querySelector('[data-beat="a"]');
const beatB = document.querySelector('[data-beat="b"]');
let lastRailIndex = -1;

/* ------------------------------------------------------------------ *
 * Pointer and hand.
 *
 * Scroll owns the route. The pointer owns the light and a little parallax, and
 * the hand owns rotation. Three inputs, three transform groups, so none of them
 * can overwrite another.
 * ------------------------------------------------------------------ */
const pointer = { x: 0, y: 0, tx: 0, ty: 0, moved: 0, cx: -1, cy: -1, dirty: false };
const hand = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, down: false, lx: 0, ly: 0, active: 0 };

if (!REDUCED) {
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / vw()) * 2 - 1;
    pointer.ty = (e.clientY / vh()) * 2 - 1;
    pointer.cx = e.clientX; pointer.cy = e.clientY;
    pointer.dirty = true;          // only re-pick when the pointer actually moves
    pointer.moved = 1;
    if (hand.down) {
      hand.tYaw += ((e.clientX - hand.lx) / vw()) * 3.4;
      hand.tPitch = clamp(hand.tPitch + ((e.clientY - hand.ly) / vh()) * 1.9, -0.5, 0.5);
      hand.lx = e.clientX; hand.ly = e.clientY;
    }
  }, { passive: true });

  /* Grab and turn. A product you cannot pick up does not feel like a product,
     and a 3D hero that ignores the mouse reads as a video. */
  canvas.style.pointerEvents = 'auto';
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', (e) => {
    hand.down = true; hand.lx = e.clientX; hand.ly = e.clientY;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture?.(e.pointerId);
  });
  const release = () => { hand.down = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}

/* ------------------------------------------------------------------ *
 * The cursor.
 *
 * A regular polygon with the same number of sides as the lens's own iris —
 * `iris.blades`, not a hard-coded 9 — so the thing following the pointer IS
 * the aperture of the object being sold. It stops down and turns a little on
 * press, the way the real one does when you close it, and opens up over
 * anything you can act on.
 *
 * Two elements, not one. The 3px mark sits exactly under the pointer so aiming
 * stays honest; the iris lags behind it. A single lagging cursor feels
 * imprecise, and a single exact one has no weight.
 *
 * The native cursor is only hidden once this is actually running (`has-cursor`
 * on the body), so a failure here leaves a normal pointer rather than none.
 * ------------------------------------------------------------------ */
const cursorEl = document.querySelector('[data-cursor]');
const cursorMark = document.querySelector('[data-cursor-mark]');
const cursorPoly = document.querySelector('[data-cursor-iris]');
const cursor = { x: -100, y: -100, rx: -100, ry: -100, open: 0, down: 0 };

const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
if (cursorEl && cursorPoly && FINE_POINTER) {
  const R = 12;
  cursorPoly.setAttribute('points', Array.from({ length: iris.blades }, (_, i) => {
    const a = -Math.PI / 2 + (i / iris.blades) * Math.PI * 2;
    return `${(Math.cos(a) * R).toFixed(2)},${(Math.sin(a) * R).toFixed(2)}`;
  }).join(' '));
  document.body.classList.add('has-cursor');

  const ACTIONABLE = 'a, button, [data-set], .cta, .social a, .end-mail';
  window.addEventListener('pointermove', (e) => {
    cursor.x = e.clientX; cursor.y = e.clientY;
    const hot = !!(e.target instanceof Element && e.target.closest(ACTIONABLE));
    document.body.classList.toggle('cursor-open', hot);
  }, { passive: true });
  window.addEventListener('pointerdown', () => document.body.classList.add('cursor-down'));
  const up = () => document.body.classList.remove('cursor-down');
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Called from the one rAF loop; nothing here owns a timer of its own. */
function drawCursor(dt) {
  if (!cursorEl || !FINE_POINTER) return;
  // The mark is exact. The iris chases it — fast enough to feel attached.
  const k = REDUCED ? 1 : 1 - Math.exp(-19 * dt);
  cursor.rx += (cursor.x - cursor.rx) * k;
  cursor.ry += (cursor.y - cursor.ry) * k;

  const hot = document.body.classList.contains('cursor-open');
  const down = document.body.classList.contains('cursor-down');
  const target = down ? 0.62 : hot ? 1.75 : 1;
  const spinTo = down ? 22 : 0;                    // stopping down turns the blades
  cursor.open += (target - cursor.open) * (REDUCED ? 1 : 1 - Math.exp(-13 * dt));
  cursor.down += (spinTo - cursor.down) * (REDUCED ? 1 : 1 - Math.exp(-13 * dt));

  cursorEl.style.transform =
    `translate3d(${cursor.rx.toFixed(1)}px, ${cursor.ry.toFixed(1)}px, 0) ` +
    `scale(${cursor.open.toFixed(3)}) rotate(${cursor.down.toFixed(2)}deg)`;
  cursorMark.style.transform =
    `translate3d(${cursor.x.toFixed(1)}px, ${cursor.y.toFixed(1)}px, 0)`;
}

/* ------------------------------------------------------------------ *
 * Applying the plate.
 *
 * One value, four consumers: the CSS palette, the scene background, the tone
 * mapping exposure and the studio environment. They are written together so
 * the page and the object can never disagree about which ground they are on.
 * ------------------------------------------------------------------ */
const rootStyle = document.documentElement.style;
let lastPlateWritten = -1;
let envStep = -1;
let envTarget = null;
let introGate = 1;       // dims the whole studio while the opening plays
let introFlagged = false;
let detailFlagged = false;
let arrivedFlagged = false;
let listFlagged = false;
let wordmarkSettled = false;

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

  // Paper is a bright ground and needs far less exposure than a dark studio.
  renderer.toneMappingExposure = lerp(1.18, 1.05, p) * introGate;
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
const _rim = new THREE.Vector3();
const probeBox = { w: 280, h: 220 };
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

/* The opening runs in three acts:
 *
 *   ACT 1  0.00 – 0.42   the wordmark rises, one letter at a time
 *   ACT 2  0.38 – 0.80   the lens materialises over it and lights from within
 *   ACT 3  0.78 – 1.00   the copy, then the metrics
 *
 * Nothing overlaps by accident: each act is a window on the same clock, and
 * the object is not even in the scene until its act begins, so the first thing
 * on screen is the name and nothing else.
 */
const INTRO_MS = 5800;

/* -1 = not started, -2 = forced complete (test hooks and reduced motion). */
let introStart = -1;

function introAt(now) {
  if (introStart === -2) return 1;
  // Landing part-way down the page means the opening has already been missed.
  if (introStart < 0 && window.scrollY > 40) { introStart = -2; return 1; }
  if (introStart < 0) introStart = now;
  return clamp((now - introStart) / INTRO_MS, 0, 1);
}

let camDist = -1;        // damped camera distance, -1 until the first solve
let snapCamera = false;  // test hooks jump rather than ease
let roll = 0;            // scroll-momentum roll, radians
let dollyRef = -1;       // distance frozen at the start of the dolly zoom
let introFall = 0;       // the opening's vertical offset, undone in the camera

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
  drawCursor(dt);
  requestAnimationFrame(frame);
}

function render(s, dt) {
  const e = s.exact;
  const p = phases(e);

  /* --- the opening --------------------------------------------------- */
  const intro = REDUCED ? 1 : introAt(performance.now());
  const introEase = smootherstep(intro);
  /* Every one of these now fires AFTER the object has landed (the fall ends at
     0.62). Lighting it on the way down would have shown a lit lens travelling,
     which is the opposite of the intended read: a silhouette that arrives, and
     then lights. */
  const beat1 = win(intro, 0.61, 0.74);   // coating flare on the front surface
  const beat2 = win(intro, 0.65, 0.82);   // the front group lights from within
  const beat3 = win(intro, 0.71, 0.89);   // the glow reaches back to the iris
  /* The studio deliberately arrives LAST. Ramping the key at the same rate as
     the interior makes the whole frame fade up together, which reads as a page
     transition rather than as a lens lighting from within. Holding the studio
     back means the first two things you see are the coating flare and the glow
     down the barrel, and the barrel itself only resolves around them at the
     end. */
  const studio = win(intro, 0.62, 0.90);
  frontFlare.intensity = beat1 * 22 * (1 - win(intro, 0.80, 1.0) * 0.6);
  interior.intensity = beat2 * 52 * (1 - studio);
  deep.intensity = beat3 * 44 * (1 - studio);
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
  /* Act three. The three latches are deliberately CLOSE together — 0.70, 0.735,
     0.765 rather than 0.70 / 0.80 / 0.89.
     
     Spread wide they read as a queue: headline, wait, copy, wait, numbers,
     wait, buttons. Four announcements instead of one arrival. Bunched, with the
     per-element delays in the stylesheet shortened to match, the groups overlap
     and the frame simply fills in. The offsets are still there — they are what
     stop it landing as one flat block — they are just small enough to read as
     texture rather than as steps.
     
     Latches, so scrubbing backwards will not replay them. */
  if (intro > 0.70 && !introFlagged) {
    introFlagged = true;
    document.body.classList.add('is-lit');
  }
  if (intro > 0.735 && !detailFlagged) {
    detailFlagged = true;
    document.body.classList.add('is-detailed');
  }
  if (intro > 0.765 && !listFlagged) {
    listFlagged = true;
    document.body.classList.add('is-listed');
  }

  /* --- the wordmark behind the object -------------------------------
     Its entrance is redrawn only while it is moving; once the word has landed
     the canvas is left alone rather than being repainted every frame. */
  const wmIn = REDUCED ? 1 : win(intro, 0.02, 0.33);
  if (wmIn < 0.999 || !wordmarkSettled) {
    wordmark.draw(wmIn);
    wordmarkSettled = wmIn >= 0.999;
  }
  if (heroRuleEl) {
    const r = REDUCED ? 1 : win(intro, 0.08, 0.48);
    heroRuleEl.style.transform = `scaleX(${r.toFixed(4)})`;
  }

  /* The hero's backdrop, not the page's: once the first chapter has something
     to say, a giant word behind everything is just noise. */
  /* Bright while it is alone on screen, dimming as the object arrives over it,
     then clearing away entirely once the lens has fully landed. It was the
     opening title, and a title that stays up is a watermark. */
  const wmSolo = 1 - win(intro, 0.34, 0.64) * 0.55;
  const wmExit = 1 - win(intro, 0.64, 0.88);
  wordmark.material.opacity =
    (1 - win(e, 0.10, 0.70)) * 0.22 * wmSolo * wmExit * win(intro, 0.02, 0.20);
  wordmark.mesh.visible = wordmark.material.opacity > 0.002;

  /* The glow arrives only once the lens has fully landed (arrive completes at
     intro 0.68), so the opening still starts on true black and the light reads
     as the object bringing it with it rather than as a lit set. It stays up
     through every black chapter — the complaint it answers is that the ground
     reads as empty, and that is true past the hero as well — and dies with the
     plate, because a cool bloom on warm paper is a stain. */
  glow.material.opacity = (REDUCED ? 1 : win(intro, 0.62, 0.96)) * (1 - p.plate);
  glow.mesh.visible = glow.material.opacity > 0.002;

  /* ACT 2. The object is genuinely absent during act 1 rather than merely
     unlit, because a black silhouette sitting over the wordmark would take a
     lens-shaped bite out of it while the letters were still arriving. */
  const arrive = REDUCED ? 1 : win(intro, 0.32, 0.70);
  tilt.visible = arrive > 0.001;

  /* It descends into frame as an unlit silhouette and only then lights.
   *
   * Scaling it up in place meant it had to become visible somewhere, and with
   * nothing lit yet that is a dark shape appearing out of nothing — a flash,
   * not an entrance. Falling in from above the frame means the first frame it
   * exists in is off-screen, so there is nothing to see appear: it simply
   * arrives, and the studio comes up under it once it has landed.
   *
   * `fall` finishes at 0.60, comfortably before the studio starts at 0.62, so
   * the travel really is dark. The camera compensation for this lives in the
   * camera block — see the note there, it does not work without it. */
  introFall = REDUCED ? 0 : (1 - win(intro, 0.30, 0.62)) * DROP_SPAN;
  lens.position.y = introFall;

  /* A little scale and turn still ride along, so it reads as approaching
     rather than as a card sliding down a slot. Both are much smaller than they
     were, because the fall is now carrying the entrance. */
  lens.scale.setScalar(0.965 + 0.035 * arrive);
  lens.rotation.y = (1 - arrive) * 0.07;
  lens.rotation.x = (1 - arrive) * -0.03 - p.stand * (Math.PI / 2);

  if (arrive > 0.55 && !arrivedFlagged) {
    arrivedFlagged = true;
    document.body.classList.add('is-arrived');   // masthead and progress bar
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

  rays.lines.visible = p.rays > 0.004 && p.raysOut < 0.999;
  rays.material.uniforms.uDraw.value = p.rays;
  rays.material.uniforms.uOpacity.value = 1 - p.raysOut;
  imagePlane.visible = p.rays > 0.55 && p.raysOut < 0.999;

  // Focus ring turns as the chapter about the barrel plays.
  if (barrel.focusRing) barrel.focusRing.group.rotation.z = -p.focusRing * 1.1;
  if (barrel.irisRing) barrel.irisRing.group.rotation.z = -p.iris * 0.85;

  /* --- momentum, hand, light ---------------------------------------- */
  if (!REDUCED) {
    const now = performance.now();

    // Scroll velocity rolls the lens and lets it settle when you stop.
    const targetRoll = clamp(s.signedSpeed * 0.055, -0.09, 0.09);
    roll += (targetRoll - roll) * (1 - Math.exp(-3.0 * dt));
    spin.rotation.z = roll;

    /* An object that is perfectly still reads as a photograph. A slow drift
       reads as a camera running. It is strongest on the hero and hands over to
       the chapter choreography as soon as the page starts telling you things. */
    const idle = 1 - win(e, 0.2, 0.95);
    spin.rotation.y = Math.sin(now * 0.00019) * 0.13 * idle;
    spin.rotation.x = Math.sin(now * 0.00013 + 1.2) * 0.05 * idle;

    // The hand. Its authority fades where the diagrams need to stay readable.
    const grip = lerp(1, 0.12, win(e, 2.2, 3.0));
    if (!hand.down) {
      hand.tYaw *= Math.exp(-0.55 * dt);      // let go and it drifts back
      hand.tPitch *= Math.exp(-0.9 * dt);
    }
    hand.yaw += (hand.tYaw - hand.yaw) * (1 - Math.exp(-6.0 * dt));
    hand.pitch += (hand.tPitch - hand.pitch) * (1 - Math.exp(-6.0 * dt));
    drag.rotation.y = hand.yaw * grip;
    drag.rotation.x = hand.pitch * grip;

    // Pointer parallax, unchanged in role but with more presence than before.
    pointer.x = lerp(pointer.x, pointer.tx, 1 - Math.exp(-3.2 * dt));
    pointer.y = lerp(pointer.y, pointer.ty, 1 - Math.exp(-3.2 * dt));
    tilt.rotation.y = pointer.x * 0.085;
    tilt.rotation.x = pointer.y * 0.05;

    /* The pointer is the light, and when nobody touches it the same light
       rakes on its own: a LOW arc travelling left to right, which is the move
       that reveals machining. Held low deliberately — a light coming across
       the barrel catches every ridge of the knurling, where the same light
       from above just washes the top of it.
     *
     * One light, not two. A separate sweeping spotlight would be a fourth
     * simultaneous motion on top of the drift, the environment rotation and
     * this, and a three.js SpotLight cannot draw a visible beam anyway without
     * volumetrics: with no fog and no floor to catch it, it is a point light
     * with a cone cutoff. The rake is the part that was actually wanted. */
    const sweep = now * 0.000075;                 // a full pass takes ~40s
    const lx = pointer.moved ? pointer.x : Math.sin(sweep);
    const ly = pointer.moved ? pointer.y : 0.74 + Math.sin(sweep * 0.6) * 0.16;
    key.position.set(lerp(-3, 11, lx * 0.5 + 0.5), lerp(9.5, 1.5, ly * 0.5 + 0.5), -5.5);
    frontFlare.position.set(lx * 5.5 - 1.0, -ly * 4.0 + 1.2, -9.5);

    /* Rotating the environment sweeps every reflection at once, which is what a
       lighting rig moving around a product actually does. Kept on its own clock
       so slowing the rake does not slow the reflections with it. */
    if (scene.environmentRotation) scene.environmentRotation.y = now * 0.00011;
  }

  /* --- camera ------------------------------------------------------
     Read the damped chapter, interpolate the ledger, then solve the
     distance from what is actually on screen right now. */
  const sm = clamp(s.smooth, 0, CHAPTERS.length - 1);
  const i = Math.min(CHAPTERS.length - 2, Math.floor(sm));
  const A = CHAPTERS[i], B = CHAPTERS[i + 1];
  // Each chapter states the body language of its own outgoing move, so a long
  // orbit and a small push-in no longer share one characterless curve.
  /* `hold` parks the camera on THIS chapter's framing for the first part of
     its span before the move to the next one begins. The explode needs it: the
     stack finishes opening a third of the way through the chapter, and without
     a hold the camera immediately starts travelling to the trace framing, so
     the fully-open view is never actually still. */
  const held = A.hold
    ? clamp((clamp(sm - i, 0, 1) - A.hold) / (1 - A.hold), 0, 1)
    : clamp(sm - i, 0, 1);
  const f = EASE[A.ease](held);

  const fa = framing(A.frame), fb = framing(B.frame);
  const centre = _centre.copy(fa.c).lerp(fb.c, f);

  /* Undo the opening's vertical offset before the camera is solved.
   *
   * `framing()` measures the live object, so while the lens is falling its
   * centre falls too — and since the camera and its look-at are BOTH placed
   * from that centre, the camera would track it down and the fall would be
   * completely invisible. Subtracting the offset here solves the shot against
   * the object's resting place, which is what lets it travel through frame.
   * The wordmark and the glow are parked from this same corrected centre, so
   * they stay put while the object moves past them. */
  centre.y -= introFall;
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
  const raw = held;
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

  // Park the backdrop behind the object, square to the camera, sized to fill.
  if (wordmark.mesh.visible) {
    /* Dead centre of the FRAME, horizontally and vertically. The camera's
       optical axis runs through `centre + pan`, so that is the point to push
       straight back from; anything else drifts off to one side as it recedes. */
    const back = dist * 1.75;
    wordmark.mesh.position.copy(centre).add(pan).addScaledVector(dir, -back);
    wordmark.mesh.quaternion.copy(camera.quaternion);
    wordmark.fit(camera, aspect, dist + back);   // camera-to-plane, not object-to-plane
  }

  if (glow.mesh.visible) {
    // Nearer than the wordmark so it stays a light behind THIS object rather
    // than a wash on the far wall, and square to the camera like everything
    // else that lives in screen space.
    const gback = dist * 0.55;
    glow.mesh.position.copy(centre).add(pan).addScaledVector(dir, -gback);
    glow.mesh.quaternion.copy(camera.quaternion);
    glow.fit(camera, aspect, dist + gback);
  }

  /* --- interface reads `exact`, never `smooth` --------------------- */
  const p01 = clamp(s.progress, 0, 1);
  railIndex.style.transform = `scaleX(${p01.toFixed(4)})`;
  if (s.index !== lastRailIndex) {
    for (let k = 0; k < tickEls.length; k++) {
      tickEls[k].classList.toggle('is-on', k === s.index);
    }
    const label = sections[s.index]?.dataset.label || '';
    railNow.innerHTML = label;
    railNow.classList.toggle('is-lead', s.index === 0);   // the hero's mark, not a number
    railNow.parentElement.style.opacity = label.trim() ? '1' : '0';
    lastRailIndex = s.index;
  }

  /* --- the two-card beat ---------------------------------------------
     Card A rises into frame, holds, then leaves UPWARD through its own mask
     while card B follows it in from below. Both are pure functions of `e`, so
     the swap scrubs backwards as cleanly as it plays forwards, which a CSS
     transition could not do.

     The line-2 windows are offset by 0.05 of a chapter, which is the scroll
     equivalent of the transition-delay that staggers every other headline. */
  if (beatA && beatB) {
    const H = 128;   // keep in step with --mask-hide in styles.css
    const ty = (i0, i1, o0, o1, d) =>
      `${((1 - win(e, i0 + d, i1 + d)) * H - win(e, o0 + d, o1 + d) * H).toFixed(2)}%`;
    /* Card A completes at 1.81, and the number that matters is 1.857: that is
       the measured `e` at which the beat's pad stops rising and pins. A chapter
       does NOT begin at its own integer — this one pins about a seventh of a
       chapter early — so a window written against the integer lands late.
       Aimed at 2.30 the words were still fully hidden at the moment the pad
       locked into place and only finished several hundred px further down. They
       now rise WITH the pad and are settled before it stops. */
    beatA.style.setProperty('--ty1', ty(1.50, 1.76, 2.24, 2.42, 0));
    beatA.style.setProperty('--ty2', ty(1.50, 1.76, 2.24, 2.42, 0.05));
    beatB.style.setProperty('--ty1', ty(2.32, 2.52, 2.74, 2.92, 0));
    beatB.style.setProperty('--ty2', ty(2.32, 2.52, 2.74, 2.92, 0.05));
    // The supporting line follows its headline in and leaves with it.
    const subA = win(e, 1.66, 1.84) * (1 - win(e, 2.24, 2.42));
    const subB = win(e, 2.46, 2.64) * (1 - win(e, 2.74, 2.92));
    beatA.style.setProperty('--sub', subA.toFixed(3));
    beatB.style.setProperty('--sub', subB.toFixed(3));
    // Only read under prefers-reduced-motion, where transforms are forced off.
    beatA.style.setProperty('--op', (1 - win(e, 2.24, 2.42)).toFixed(3));
    beatB.style.setProperty('--op', (win(e, 2.32, 2.52) * (1 - win(e, 2.74, 2.92))).toFixed(3));
  }

  /* --- the inspector --------------------------------------------------
     Offered only once the stack is FULLY open. Before that the elements
     overlap on screen and a pick would be a guess at which one you meant.
     The raycast runs on pointer movement rather than every frame, so holding
     still costs nothing. */
  const pickable = !REDUCED && p.explode > 0.85 && aspect >= 1.15 && !hand.down;
  if (!pickable) {
    if (hoverIndex !== -1) {
      hoverIndex = -1;
      probeEl.classList.remove('is-on');
      canvas.style.cursor = hand.down ? 'grabbing' : 'grab';
    }
  } else if (pointer.dirty) {
    pointer.dirty = false;
    _ndc.set((pointer.cx / vw()) * 2 - 1, -(pointer.cy / vh()) * 2 + 1);
    raycaster.setFromCamera(_ndc, camera);
    const hit = raycaster.intersectObject(glass.root, true)[0];
    const g = hit ? groupOfObject.get(hit.object) : null;
    const idx = g ? g.index : -1;
    if (idx !== hoverIndex) {
      hoverIndex = idx;
      if (idx >= 0) {
        probeEl.innerHTML = probeHTML[idx];
        probeEl.classList.add('is-on');
        probeBox.w = probeEl.offsetWidth;   // measured on change, not per frame
        probeBox.h = probeEl.offsetHeight;
      } else {
        probeEl.classList.remove('is-on');
      }
      canvas.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    }
  }

  if (hoverIndex >= 0) {
    // Under the element it describes, clear of its rim, clamped to the frame.
    const g = glass.groups[hoverIndex];
    _proj.set(0, 0, g.centreZ * U); g.group.localToWorld(_proj); _proj.project(camera);
    _rim.set(0, g.sd * U, g.centreZ * U); g.group.localToWorld(_rim); _rim.project(camera);
    const px = (_proj.x * 0.5 + 0.5) * vw();
    const py = (-_proj.y * 0.5 + 0.5) * vh();
    const ry = Math.abs((-_rim.y * 0.5 + 0.5) * vh() - py);
    probeEl.style.left = `${clamp(px, probeBox.w / 2 + 14, vw() - probeBox.w / 2 - 14).toFixed(1)}px`;
    probeEl.style.top = `${clamp(py + ry + 28, 14, vh() - probeBox.h - 14).toFixed(1)}px`;
  }

  for (let i = 0; i < glass.groups.length; i++) {
    const target = i === hoverIndex ? 1 : 0;
    if (hoverAmt[i] !== target) {
      hoverAmt[i] += (target - hoverAmt[i]) * (1 - Math.exp(-10 * dt));
      if (Math.abs(target - hoverAmt[i]) < 0.002) hoverAmt[i] = target;
      for (const m of glass.groups[i].rims) m.emissiveIntensity = hoverAmt[i] * 0.85;
    }
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
    // The rest stand down while one is being inspected.
    const dim = hoverIndex < 0 || c.group.index === hoverIndex ? 1 : 0.26;
    c.el.style.opacity = inFront ? String(clamp((p.explode - 0.12) / 0.3, 0, 1) * 0.95 * dim) : '0';
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
    introStart = frac >= 1 ? -2 : performance.now() - clamp(frac, 0, 1) * INTRO_MS;
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
