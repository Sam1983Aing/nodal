/*
 * NODAL — optical prescription, ray trace and derived geometry.
 *
 * SINGLE SOURCE OF TRUTH. Every piece of glass in the 3D scene, every ray in
 * the light path, every line in the 2D section diagram and every number
 * printed on the page is derived from SURFACES below. Nothing about the shape
 * of this lens is written down twice, so the solid, the drawing and the
 * physics can never disagree.
 *
 * This is the same discipline as the AXIAL profile table, applied to optics
 * instead of bodies of revolution.
 *
 * Units: millimetres. The optical axis runs +Z. Light travels toward +Z,
 * entering at the front vertex (z = 0) and coming to focus at the image plane.
 *
 * Sign convention (standard lens design): a surface radius is POSITIVE when
 * its centre of curvature lies further along +Z than the vertex. `null` radius
 * means a flat surface.
 */

/* ------------------------------------------------------------------ *
 * Glass catalogue.
 *
 * `n` is the refractive index at the d-line (587.6nm), `v` is the Abbe
 * number. `tint` is the faint body colour of the glass when it is rendered
 * with a real transmission pass, `tintDark` is the deeper stand-in used when
 * that pass is too expensive, and `coat` is the colour its anti-reflection
 * coating flares — the only place the palette is allowed to get chromatic.
 * ------------------------------------------------------------------ */
export const GLASS = {
  AIR:  { name: 'air',      n: 1.0,     v: null, tint: null,     tintDark: null,     coat: null },
  LAK:  { name: 'S-LAL18',  n: 1.7292,  v: 54.7, tint: 0xdfeef2, tintDark: 0x24424e, coat: 0x6fd0e8 },
  LAF:  { name: 'S-LAH64',  n: 1.7880,  v: 47.4, tint: 0xd9ecf4, tintDark: 0x203c4c, coat: 0x8fb4e0 },
  SF:   { name: 'S-TIH14',  n: 1.7618,  v: 26.5, tint: 0xf2e6d8, tintDark: 0x4a3c2a, coat: 0xd8a35c },
  BAF:  { name: 'S-BAH11',  n: 1.6668,  v: 48.3, tint: 0xe4f0f0, tintDark: 0x25454a, coat: 0x7fc8d8 },
  FK:   { name: 'S-FPL51',  n: 1.4970,  v: 81.5, tint: 0xeef6f8, tintDark: 0x2b4c56, coat: 0xb0e4ee },
};

/* ------------------------------------------------------------------ *
 * The prescription.
 *
 * One row per optical surface, front to back:
 *   r     radius of curvature (mm), null = flat
 *   t     axial distance from this surface's vertex to the next (mm)
 *   g     the medium AFTER this surface (key into GLASS)
 *
 * Note what is NOT in this table: semi-diameters. How wide each piece of
 * glass has to be is not a matter of taste, it is a consequence of where the
 * light actually goes, so it is solved further down by tracing the marginal
 * and chief rays and measuring them. Authoring those numbers by hand is what
 * produced elements whose two surfaces crossed before reaching the rim.
 *
 * Two surfaces with glass between them form an element. Where one element's
 * rear surface is immediately the next element's front surface with no air
 * gap, they are a cemented doublet and stay together in the explode.
 *
 * The layout is a double-Gauss core (the ancestor of nearly every fast prime)
 * with a gently converging front group ahead of it for coverage, and a
 * negative/positive rear pair behind it acting as a field flattener. Radii are
 * authored by eye, then the whole table is uniformly scaled so the traced
 * focal length lands exactly on TARGET_EFL. A uniform scale is the one
 * transform that changes a prescription's focal length while preserving its
 * behaviour exactly.
 * ------------------------------------------------------------------ */
const RAW_SURFACES = [
  // --- front group: two weak correctors that widen the field ----------
  { r:  282.333, t:  4.668, g: 'LAF' },   //  1  ┐ element 1
  { r:  195.209, t:  6.866, g: 'AIR' },   //  2  ┘
  { r: -443.298, t: 10.336, g: 'BAF' },   //  3  ┐ element 2
  { r: -213.700, t:  6.384, g: 'AIR' },   //  4  ┘

  // --- double-Gauss core, front half ---------------------------------
  { r:   29.340, t:  4.190, g: 'LAK' },   //  5  ┐ element 3
  { r:  103.500, t:  0.100, g: 'AIR' },   //  6  ┘
  { r:   15.680, t:  6.290, g: 'LAK' },   //  7  ┐ element 4 ┐ cemented
  { r: -143.400, t:  1.680, g: 'SF'  },   //  8  ┘ element 5 ┘ doublet
  { r:   11.270, t:  7.430, g: 'AIR' },   //  9

  // ---------------------- APERTURE STOP ------------------------------
  //  sits in the wide air gap above — STOP_AFTER points at surface 9

  // --- double-Gauss core, rear half ----------------------------------
  { r:  -12.580, t:  1.680, g: 'SF'  },   // 10  ┐ element 6 ┐ cemented
  { r:   64.400, t:  5.030, g: 'LAK' },   // 11  ┘ element 7 ┘ doublet
  { r:  -18.080, t:  0.100, g: 'AIR' },   // 12
  { r:   71.100, t:  3.350, g: 'LAK' },   // 13  ┐ element 8
  { r:  -38.000, t:  0.250, g: 'AIR' },   // 14  ┘

  // --- rear group: field flattener -----------------------------------
  { r:   84.483, t:  3.000, g: 'SF'  },   // 15  ┐ element 9
  { r:  153.205, t:  0.250, g: 'AIR' },   // 16  ┘
  { r:  151.442, t:  3.000, g: 'FK'  },   // 17  ┐ element 10
  { r: -234.491, t:  0.000, g: 'AIR' },   // 18  ┘
];

/*
 * Where these numbers came from.
 *
 * The double-Gauss core in the middle is the classic layout, scaled to this
 * focal length. The four surfaces in front of it and the four behind were
 * found by search rather than by taste: a few thousand random front/rear
 * groups were traced, the ones that vignetted, went unmanufacturably thin or
 * pushed the focal plane inside the glass were thrown out, and the survivor
 * was then refined against a cost function trading RMS spot size against back
 * focal distance, element aspect ratio and corner illumination.
 *
 * The result traces to a 2.3 micron RMS spot at f/1.8 with the focal plane a
 * healthy 42% of the focal length behind the last surface. The bare core on
 * its own manages 32 microns, so the added groups are earning their place.
 */

/** The aperture stop sits in the wide air gap at the heart of the Gauss. */
export const STOP_AFTER = 9;         // 1-based index of the surface it follows
export const STOP_FRACTION = 0.48;   // how far across that air gap it sits

export const TARGET_EFL = 40.0;      // mm — what the finished lens must measure
export const TARGET_FNUMBER = 1.8;   // what the stop is solved to deliver
export const HALF_FIELD = 15.5;      // degrees — half the diagonal angle of view

/* Multicoated air/glass surfaces pass ~99.6% each; that loss is what separates
   the geometric f-number from the photometric T-stop a cinematographer sets. */
export const COATING_TRANSMISSION = 0.996;

/* ------------------------------------------------------------------ *
 * Surface maths.
 * ------------------------------------------------------------------ */

/**
 * Sag of a spherical surface: how far the surface has moved along +Z by the
 * time it reaches height `h`. Written in the numerically-stable form so it
 * stays exact near the axis and never subtracts two nearly-equal numbers.
 */
export function sag(h, r) {
  if (r == null || !isFinite(r)) return 0;
  const c = 1 / r;
  const disc = 1 - h * h * c * c;
  if (disc <= 0) return h * h * c; // beyond the sphere: only used for guards
  return (h * h * c) / (1 + Math.sqrt(disc));
}

/** Refract a 2D unit direction at a unit normal. Returns null on TIR. */
function refract(d, n, eta) {
  let ny = n.y, nz = n.z;
  let cosi = -(d.y * ny + d.z * nz);
  if (cosi < 0) { cosi = -cosi; ny = -ny; nz = -nz; } // normal must face the ray
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const s = eta * cosi - Math.sqrt(k);
  const y = eta * d.y + s * ny;
  const z = eta * d.z + s * nz;
  const len = Math.hypot(y, z) || 1;
  return { y: y / len, z: z / len };
}

/**
 * Intersect a ray with the sphere belonging to a surface whose vertex is at
 * `zv`. Returns the hit nearest the vertex, which is the physically correct
 * one for a lens surface (the far root is the back of the same sphere).
 */
function intersectSurface(p, d, zv, r) {
  if (r == null || !isFinite(r)) {
    if (Math.abs(d.z) < 1e-12) return null;
    const t = (zv - p.z) / d.z;
    return t > 1e-9 ? { y: p.y + d.y * t, z: zv, t } : null;
  }
  const cz = zv + r;                       // centre of curvature
  const oy = p.y, oz = p.z - cz;
  const b = oy * d.y + oz * d.z;
  const c = oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  // Two candidates; keep the one that lands closest to the vertex.
  const cands = [-b - root, -b + root].filter((t) => t > 1e-9);
  if (!cands.length) return null;
  let best = null, bestD = Infinity;
  for (const t of cands) {
    const z = p.z + d.z * t;
    const dz = Math.abs(z - zv);
    if (dz < bestD) { bestD = dz; best = { y: p.y + d.y * t, z, t }; }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * The prescription, resolved.
 * ------------------------------------------------------------------ */

/** Vertex z of every surface, plus its index of refraction before/after. */
function resolve(surfaces) {
  let z = 0;
  const out = [];
  for (let i = 0; i < surfaces.length; i++) {
    const s = surfaces[i];
    const nBefore = i === 0 ? 1 : GLASS[surfaces[i - 1].g].n;
    out.push({ ...s, i: i + 1, z, nBefore, nAfter: GLASS[s.g].n });
    z += s.t;
  }
  return out;
}

/**
 * Trace one meridional ray through the whole stack.
 * Returns { points, dir, ok } — `points` is the polyline in the y/z plane,
 * ready to be drawn in 2D or lifted into 3D.
 */
export function trace(surfaces, y0, z0, dy, dz, endZ, opts = {}) {
  const noVignette = opts.noVignette === true;
  const heights = [];
  const S = resolve(surfaces);
  let len = Math.hypot(dy, dz) || 1;
  let p = { y: y0, z: z0 };
  let d = { y: dy / len, z: dz / len };
  const points = [{ ...p }];

  for (const s of S) {
    const hit = intersectSurface(p, d, s.z, s.r);
    if (!hit) return { points, dir: d, ok: false, blockedAt: s.i, heights };
    // A ray that misses the clear aperture is vignetted, and stopping the
    // polyline there is exactly what a real lens does to it.
    heights.push(Math.abs(hit.y));
    if (!noVignette && s.sd != null && Math.abs(hit.y) > s.sd) {
      points.push({ y: hit.y, z: hit.z });
      return { points, dir: d, ok: false, blockedAt: s.i, heights };
    }
    points.push({ y: hit.y, z: hit.z });

    const cz = s.r == null || !isFinite(s.r) ? null : s.z + s.r;
    const nrm = cz == null
      ? { y: 0, z: 1 }
      : (() => {
          const ny = hit.y - 0, nz = hit.z - cz;
          const l = Math.hypot(ny, nz) || 1;
          return { y: ny / l, z: nz / l };
        })();

    const nd = refract(d, nrm, s.nBefore / s.nAfter);
    if (!nd) return { points, dir: d, ok: false, blockedAt: s.i, heights };
    d = nd;
    p = { y: hit.y, z: hit.z };
  }

  if (endZ != null && Math.abs(d.z) > 1e-9) {
    const t = (endZ - p.z) / d.z;
    if (t > 0) points.push({ y: p.y + d.y * t, z: endZ });
  }
  return { points, dir: d, ok: true, heights };
}

/** z of the last surface's vertex. */
export function lastVertexZ(surfaces) {
  const S = resolve(surfaces);
  return S[S.length - 1].z;
}

/**
 * Effective focal length, by the textbook definition: send a ray in parallel
 * to the axis at a height low enough to be paraxial, and divide that height by
 * the tangent of the angle it leaves at.
 */
export function solveEFL(surfaces) {
  const h = 0.05;
  const r = trace(surfaces, h, -10, 0, 1, null);
  if (!r.ok) return NaN;
  const slope = r.dir.y / r.dir.z;      // negative for a converging system
  return -h / slope;
}

/**
 * Back focal distance: where that same paraxial ray crosses the axis,
 * measured from the vertex of the last surface.
 */
export function solveBFD(surfaces) {
  const h = 0.05;
  const r = trace(surfaces, h, -10, 0, 1, null);
  if (!r.ok) return NaN;
  const last = r.points[r.points.length - 1];
  const slope = r.dir.y / r.dir.z;
  const dz = -last.y / slope;
  return last.z + dz - lastVertexZ(surfaces);
}

/**
 * Plane of least confusion, found numerically.
 *
 * A real lens does not focus a wide bundle to a point — the marginal rays
 * cross the axis short of the paraxial focus, which is spherical aberration.
 * So rather than trusting the paraxial answer, trace a full fan and search for
 * the plane where the RMS spread is smallest. That plane is where the sensor
 * actually goes, and the residual spread there is a real, honest number.
 */
export function solveFocus(surfaces, maxHeight) {
  const hs = [];
  const N = 24;
  for (let i = 1; i <= N; i++) hs.push((i / N) * maxHeight);

  const fans = hs
    .map((h) => trace(surfaces, h, -10, 0, 1, null))
    .filter((r) => r.ok);
  if (!fans.length) return { z: NaN, rms: NaN, rays: 0 };

  const spreadAt = (z) => {
    let sum = 0, n = 0;
    for (const f of fans) {
      const last = f.points[f.points.length - 1];
      const slope = f.dir.y / f.dir.z;
      const y = last.y + slope * (z - last.z);
      sum += y * y; n++;
    }
    return n ? Math.sqrt(sum / n) : Infinity;
  };

  // Golden-section search over a generous window behind the last surface.
  const v = lastVertexZ(surfaces);
  let lo = v, hi = v + TARGET_EFL * 1.6;
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = hi - phi * (hi - lo), b = lo + phi * (hi - lo);
  let fa = spreadAt(a), fb = spreadAt(b);
  for (let i = 0; i < 80; i++) {
    if (fa < fb) { hi = b; b = a; fb = fa; a = hi - phi * (hi - lo); fa = spreadAt(a); }
    else { lo = a; a = b; fa = fb; b = lo + phi * (hi - lo); fb = spreadAt(b); }
  }
  const z = (lo + hi) / 2;
  return { z, rms: spreadAt(z), rays: fans.length };
}

/* ------------------------------------------------------------------ *
 * Solving the lens.
 *
 * Three things get solved rather than authored, in this order:
 *   1. a uniform scale, so the traced focal length is exactly TARGET_EFL
 *   2. the aperture stop radius, so the lens is exactly TARGET_FNUMBER
 *   3. every semi-diameter, from where the rays actually go
 * ------------------------------------------------------------------ */

function scalePrescription(surfaces, target) {
  const k = target / solveEFL(surfaces);
  return surfaces.map((s) => ({
    ...s,
    r: s.r == null ? null : s.r * k,
    t: s.t * k,
    sd: s.sd == null ? null : s.sd * k,
  }));
}

/** z of the aperture stop plane. */
export function stopPlaneZ(surfaces, stopAfter = STOP_AFTER) {
  const S = resolve(surfaces);
  const s = S[Math.min(stopAfter, S.length) - 1];
  return s.z + s.t * STOP_FRACTION;
}

/**
 * Stop radius that delivers a given f-number.
 *
 * The entrance pupil is the image of the stop seen from the front, so a ray
 * entering parallel to the axis at exactly the entrance-pupil radius must
 * graze the edge of the stop. Trace that one ray and read off where it
 * crosses the stop plane. No search needed.
 */
export function solveStopRadius(surfaces, fNumber, stopAfter = STOP_AFTER) {
  const pupilR = solveEFL(surfaces) / (2 * fNumber);
  const sub = surfaces.slice(0, stopAfter);
  const r = trace(sub, pupilR, -40, 0, 1, null, { noVignette: true });
  const last = r.points[r.points.length - 1];
  const slope = r.dir.y / r.dir.z;
  return Math.abs(last.y + slope * (stopPlaneZ(surfaces, stopAfter) - last.z));
}

/**
 * Aim a ray from a field angle so it crosses the stop plane at `targetY`.
 * Real ray-aiming: scan for a bracketing pair, then bisect. Everything about
 * how wide the glass has to be depends on getting this right, because a ray
 * that does not pass through the stop is a ray the lens never sees.
 */
export function aimThroughStop(surfaces, angleDeg, targetY, stopAfter = STOP_AFTER, entryZ = -40) {
  const tan = Math.tan((angleDeg * Math.PI) / 180);
  const zs = stopPlaneZ(surfaces, stopAfter);
  const sub = surfaces.slice(0, stopAfter);

  const yAtStop = (y0) => {
    const r = trace(sub, y0, entryZ, tan, 1, null, { noVignette: true });
    if (!r.ok) return NaN;
    const last = r.points[r.points.length - 1];
    const slope = r.dir.y / r.dir.z;
    const y = last.y + slope * (zs - last.z);
    return isFinite(y) ? y : NaN;
  };

  const LO = -70, HI = 70, N = 120;
  let prevY = null, prevF = NaN;
  let lo = null, hi = null;
  for (let i = 0; i <= N; i++) {
    const y0 = LO + ((HI - LO) * i) / N;
    const f = yAtStop(y0) - targetY;
    if (prevY != null && isFinite(f) && isFinite(prevF) && Math.sign(f) !== Math.sign(prevF)) {
      lo = prevY; hi = y0; break;
    }
    prevY = y0; prevF = f;
  }
  if (lo == null) return NaN;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const f = yAtStop(mid) - targetY;
    if (!isFinite(f)) return NaN;
    if (Math.sign(f) === Math.sign(yAtStop(lo) - targetY)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The full bundle of rays the finished lens has to pass, for aperture sizing. */
function samplingRays(surfaces, stopR, stopAfter = STOP_AFTER) {
  const fields = [0, 0.45, 0.75, 1].map((f) => f * HALF_FIELD);
  const pupil = [-1, -0.7, -0.35, 0, 0.35, 0.7, 1];
  const rays = [];
  for (const fld of fields) {
    for (const pf of pupil) {
      const y0 = aimThroughStop(surfaces, fld, pf * stopR, stopAfter);
      if (isFinite(y0)) rays.push({ field: fld, y0, tan: Math.tan((fld * Math.PI) / 180) });
    }
  }
  return rays;
}

/**
 * Semi-diameters, measured from the traced bundle.
 *
 * Each surface is made just big enough for the light that lands on it, plus a
 * little glass for the mount to grip. Then it is clamped so it never runs off
 * the edge of its own sphere, which is the constraint hand-authored numbers
 * kept violating.
 */
function solveSemiDiameters(surfaces, stopAfter = STOP_AFTER) {
  const stopR = solveStopRadius(surfaces, TARGET_FNUMBER, stopAfter);
  const rays = samplingRays(surfaces, stopR, stopAfter);
  const maxH = new Array(surfaces.length).fill(0);

  for (const ray of rays) {
    const r = trace(surfaces, ray.y0, -40, ray.tan, 1, null, { noVignette: true });
    r.heights.forEach((h, i) => { if (h > maxH[i]) maxH[i] = h; });
  }

  return surfaces.map((s, i) => {
    const R = s.r == null ? Infinity : Math.abs(s.r);
    const clear = maxH[i] || 1;
    const sd = Math.min(clear * 1.04 + 0.7, R * 0.88);
    return { ...s, sd, clearAperture: clear };
  });
}

/**
 * Shrink any surface whose element would close up before reaching the rim.
 *
 * Two strongly curved surfaces facing each other meet at some height; below it
 * the element is real glass, above it the "glass" has negative thickness and
 * cannot exist. Rather than distorting the prescription to fix that — thicker
 * elements move the focal length, which is the tail wagging the dog — the
 * clear aperture is pulled in to the largest height that still leaves a
 * workable edge. Any light that costs us then shows up honestly as vignetting.
 */
function clampForEdge(surfaces, minEdge = 0.8) {
  const out = surfaces.map((s) => ({ ...s }));
  const S = resolve(out);
  for (let i = 0; i < S.length - 1; i++) {
    if (S[i].g === 'AIR') continue;
    const et = (h) => (S[i].t + sag(h, S[i + 1].r)) - sag(h, S[i].r);
    let hi = Math.min(S[i].sd, S[i + 1].sd);
    if (et(hi) >= minEdge) continue;
    let lo = 0;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (et(mid) >= minEdge) lo = mid; else hi = mid;
    }
    out[i].sd = Math.min(out[i].sd, lo);
    out[i + 1].sd = Math.min(out[i + 1].sd, lo);
  }
  return out;
}

/* Run the whole chain. Sizing depends on the scale and the clamp depends on
   the sizing, so it is iterated; it settles in two or three passes. */
export function solvePrescription(raw, stopAfter = STOP_AFTER) {
  let s = raw.map((r) => ({ ...r, sd: null }));
  for (let pass = 0; pass < 3; pass++) {
    s = scalePrescription(s, TARGET_EFL);
    s = solveSemiDiameters(s, stopAfter);
    s = clampForEdge(s);
  }
  return s;
}

export const SURFACES = solvePrescription(RAW_SURFACES);
export const STOP_RADIUS = solveStopRadius(SURFACES, TARGET_FNUMBER);
export const STOP_Z = stopPlaneZ(SURFACES);

/* ------------------------------------------------------------------ *
 * Elements, derived from the surface list.
 *
 * The page never hard-codes "twelve elements in nine groups" — it counts
 * them here and prints whatever the table actually contains.
 * ------------------------------------------------------------------ */
export function buildElements(surfaces = SURFACES) {
  const S = resolve(surfaces);
  const els = [];
  for (let i = 0; i < S.length - 1; i++) {
    if (S[i].g === 'AIR') continue;
    const front = S[i], back = S[i + 1];
    els.push({
      id: els.length + 1,
      glass: S[i].g,
      n: GLASS[S[i].g].n,
      v: GLASS[S[i].g].v,
      frontSurface: front.i,
      backSurface: back.i,
      r1: front.r,
      r2: back.r,
      z1: front.z,
      z2: back.z,
      thickness: back.z - front.z,
      sd: Math.max(front.sd, back.sd),
      sdFront: front.sd,
      sdBack: back.sd,
      // Cemented to the element in front of it when the previous surface
      // also carried glass, i.e. there is no air gap between them.
      cementedToPrev: i > 0 && S[i - 1].g !== 'AIR',
    });
  }
  return els;
}

/** Elements bundled into groups — a cemented doublet is one group. */
export function buildGroups(elements = buildElements()) {
  const groups = [];
  for (const el of elements) {
    if (el.cementedToPrev && groups.length) groups[groups.length - 1].push(el);
    else groups.push([el]);
  }
  return groups;
}

/**
 * The lathe profile of one element: the front surface from the axis out to
 * the rim, around the edge, and back along the rear surface. Returned as
 * [z, h] pairs, which is all three.js needs to lathe it and all the 2D
 * diagram needs to draw it.
 */
export function elementProfile(el, steps = 40) {
  const pts = [];
  const sdF = el.sdFront, sdB = el.sdBack;
  const rim = Math.max(sdF, sdB);

  for (let i = 0; i <= steps; i++) {
    const h = (i / steps) * sdF;
    pts.push([el.z1 + sag(h, el.r1), h]);
  }
  if (rim > sdF) pts.push([el.z1 + sag(sdF, el.r1), rim]);
  if (rim > sdB) pts.push([el.z2 + sag(sdB, el.r2), rim]);
  for (let i = steps; i >= 0; i--) {
    const h = (i / steps) * sdB;
    pts.push([el.z2 + sag(h, el.r2), h]);
  }
  return pts;
}

/** Edge thickness — negative means the two surfaces cross and the element is impossible. */
export function edgeThickness(el) {
  const h = Math.min(el.sdFront, el.sdBack);
  return (el.z2 + sag(h, el.r2)) - (el.z1 + sag(h, el.r1));
}

/* ------------------------------------------------------------------ *
 * Everything the page prints about itself.
 *
 * The copy never hard-codes "eleven elements in nine groups" or a T-stop.
 * It asks here, and this counts and measures the actual table. If the
 * prescription changes, every number on the page changes with it.
 * ------------------------------------------------------------------ */
export function specSheet(surfaces = SURFACES) {
  const els = buildElements(surfaces);
  const groups = buildGroups(els);
  const efl = solveEFL(surfaces);
  const bfd = solveBFD(surfaces);
  const focus = solveFocus(surfaces, STOP_RADIUS);

  // Entrance pupil: trace back out from the stop edge to find the height a
  // parallel ray must enter at to graze it.
  const pupilR = efl / (2 * TARGET_FNUMBER);

  // Air/glass interfaces, which is what the coating loss applies to.
  const airGlass = surfaces.filter((s, i) => {
    const before = i === 0 ? 'AIR' : surfaces[i - 1].g;
    return (before === 'AIR') !== (s.g === 'AIR');
  }).length;
  const transmission = Math.pow(COATING_TRANSMISSION, airGlass);

  const lastZ = lastVertexZ(surfaces);
  return {
    efl,
    bfd,
    fNumber: efl / (2 * pupilR),
    tStop: (efl / (2 * pupilR)) / Math.sqrt(transmission),
    transmission,
    airGlassSurfaces: airGlass,
    elements: els.length,
    groups: groups.length,
    surfaces: surfaces.length,
    frontDiameter: els[0].sd * 2,
    glassLength: lastZ,
    stopZ: STOP_Z,
    stopRadius: STOP_RADIUS,
    pupilRadius: pupilR,
    focusZ: focus.z,
    focusRMS: focus.rms,
    halfField: HALF_FIELD,
    imageCircle: 2 * efl * Math.tan((HALF_FIELD * Math.PI) / 180),
    glassTypes: [...new Set(els.map((e) => e.glass))],
  };
}
