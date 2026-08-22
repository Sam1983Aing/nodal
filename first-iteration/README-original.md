# NODAL — Series A 40mm

A scroll-driven landing page for a cine prime lens that has no model behind it.
Every curve on screen is lathed from the sag of a spherical surface, every ray
is refracted at the boundary it actually meets, and every number printed on the
page is measured off the same table.

Vanilla HTML/CSS/JS, no build step. Three.js and Lenis are vendored.

## Run it

```bash
node .claude/static-server-4207.mjs
```

Then open <http://localhost:4207/nodal/>. There is also a `nodal` entry in
`.claude/launch.json`. It needs a server rather than `file://` because it uses
ES modules.

## The idea

One optical prescription drives everything. `src/optics.js` holds a table of
18 surfaces — radius, thickness, glass — and from it comes:

- the **solid**: each element lathed from the sag of its own two spheres
- the **barrel**: fitted around whatever the glass envelope turns out to be
- the **light path**: real rays, aimed through the stop and refracted at every
  surface with Snell's law
- the **drawing**: the blueprint elevation in the explode chapter
- the **copy**: "10 elements, 8 groups", T1.86, 93.8% transmission, the RMS spot
  size — none of it typed in, all of it counted or measured

Change one radius and the solid, the tube that has to contain it, the rays
through it and the numbers beside it all move together, because none of them
are written down separately. This is the same discipline as the `axial` demo's
profile table, applied to optics.

## What is solved rather than authored

Three things are computed, not chosen:

1. **A uniform scale**, so the traced focal length is exactly 40.0mm.
2. **The aperture stop radius**, so the lens is exactly f/1.8.
3. **Every semi-diameter**, from where the rays actually go — plus a clamp so
   no element's two surfaces cross before reaching its rim.

The double-Gauss core in the middle is the classic layout. The four surfaces in
front of it and the four behind were found by search: a few thousand random
front/rear groups were traced, the ones that vignetted, went unmanufacturably
thin or pushed the focal plane inside the glass were discarded, and the
survivor was refined against a cost function trading RMS spot size against back
focal distance, element aspect ratio and corner illumination.

It traces to a **2.3 µm RMS spot at f/1.8** with the focal plane a healthy 42%
of the focal length behind the last surface. The bare core manages 32 µm, so
the added groups earn their place. A 10° field lands at 7.04mm, which is
`40·tan10°` to three figures — the tracer agrees with the textbook.

## Where to adjust

| What | Where |
|---|---|
| Scroll weight | `duration` in the Lenis options, `src/main.js` |
| Easing personality | `--ease` in `styles.css` (and the matching Lenis `easing`) |
| Accent colour | `--accent` in `styles.css`, `ACCENT` in `src/lens3d.js` |
| Camera choreography | the `CHAPTERS` ledger in `src/main.js` |
| When each phase fires | `phases()` in `src/main.js` — overlapping smoothstep windows |
| How far the glass separates | `GAP` and `CEMENT_GAP` in `src/main.js` |
| Studio lighting | `makeEnvironment()` in `src/lens3d.js` |
| The lens itself | `RAW_SURFACES` in `src/optics.js` |

The chapter ledger states a viewing *direction*, a field of view and how much
air to leave — never a camera position. The distance is solved every frame from
the bounding box of what that chapter is framing, so nothing overflows on a
short window or a phone, and there is not one magic number per breakpoint.

## Things worth stealing

- **Absolute, never incremental.** Every scroll-driven value is a pure function
  of scroll position. Scrub back and the lens reassembles bit-for-bit; reload
  halfway down and it is already correct. Verified: reversibility drift is
  exactly 0.
- **Fit a box, not a sphere.** A bounding sphere around a long thin optical
  layout is dominated by its diagonal and over-scales everything. Fitting the
  eight box corners with `|o·right|/tan(hFov/2) + o·dir` is closed-form and
  exact for any view direction.
- **Pan, do not re-aim.** Offsetting the camera and its look-at point by the
  same vector slides the object across the frame while keeping it square to the
  lens. Offsetting only the look-at point skews it.
- **Portrait needs a different composition, not a smaller one.** Each chapter
  carries its own `liftP`, because the copy does not go to the same place in a
  portrait frame for every chapter.
- **A dark room with a few crisp sources.** Broad soft environment gradients
  make glass look like milk, because a gently curved surface then reflects one
  large even patch. Black anodised aluminium is roughness ~0.5 and metalness
  ~0.6, not a mirror.

## Test hooks

The page exposes `window.__nodal` because the scroll cannot always be driven
for real in an embedded viewer:

```js
__nodal.hold(3.4)    // pin to a fractional chapter and draw
__nodal.goto(4)      // scroll to a chapter for real, then draw
__nodal.release()    // back to live scroll
__nodal.only('glass')// isolate glass / barrel / iris, or null for everything
__nodal.phases(3.4)  // what every phase is doing at that chapter
__nodal.spec         // the computed spec sheet
__nodal.cam          // current camera position
```

## Degradation

- `prefers-reduced-motion`: drift, grain, idle rotation and pointer parallax
  stop; reveals become arrived states. The scroll-driven optics stay, because
  that is the content rather than decoration.
- Screens whose smaller dimension is under 700px drop the transmission pass
  (the expensive one) for a darker tinted glass, halve the lathe resolution and
  thin the ray fans.
- Narrow frames swap the pinned element callouts for a legend carrying the same
  numbers, since a label cannot land cleanly beside its glass at that width.

## Performance

At 1756×1874 drawing buffer: 47–50 draw calls, ~216k triangles, worst frame
4.8ms. 39 geometries, 5 textures.
