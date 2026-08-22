# NODAL — Series A 40mm T1.9

A product page for a cine prime lens that has no model behind it. Every curve
on screen is lathed from the sag of a spherical surface, every ray is refracted
at the boundary it actually meets, and every number printed on the page is
measured off the same table.

The page sells the lens rather than documenting it. The engineering is the
*argument* ("nothing here is decorative") rather than the format, so the
numbers appear as evidence attached to a claim instead of as a spec dump.

Vanilla HTML/CSS/JS, no build step. Three.js and Lenis are vendored.

## Run it

```bash
node .claude/static-server.mjs
```

Then open <http://localhost:4207>. There is also a `nodal` entry in
`.claude/launch.json`. Zero dependencies, but it does need a server rather than
`file://`, because it uses ES modules and an import map.

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

## The opening

The hero looks straight down the optical axis, tight enough that the front
element fills the frame. It starts black, because that is what an unlit tube
looks like, and then lights in three beats over 2.4s:

1. a coating flare catches on the front surface
2. the front group lights from within
3. the glow reaches back to the iris, which silhouettes itself against it

The image-based lighting is gated to 3% for the whole opening. That is the part
that matters: IBL ignores the directional lights entirely, so dimming only those
left the object sitting at a flat 20/255 however dark everything else went.

The interior lights sit *forward*, on the front group, not behind the stack.
Glass attenuates over 1.8 world units and the stack is eight deep, so a light
behind it never reaches the front. Real lens photography works the same way.

Copy is held back until the light-up finishes (`body.is-lit`), and scroll owns
only the pull-back. `__nodal.intro(0..1)` scrubs it.

## Two grounds

The page alternates. Optical chapters run on near-black, where glass and light
can be seen at all; document chapters run on warm paper, where a specification
can be read. One `--plate` value (0 = black, 1 = paper) drives the CSS palette,
the scene background, the tone mapping exposure and the studio environment
together, so the object is genuinely lit by the page it is standing on rather
than sitting on a swapped-out CSS theme.

```
00 hero    black     03 explode  black      06 end     black
01 object  paper     04 trace    black
02 beat    black     05 series   paper
```

Halfway through a turn the interpolated foreground and background necessarily
meet at the same luminance, because any continuous path between two inverted
palettes has to cross. Rather than fight it, the copy racks out of focus across
the crossing and resolves on the new ground. On a page about a lens that is the
right answer anyway.

## Where to adjust

| What | Where |
|---|---|
| Scroll weight | `duration` in the Lenis options, `src/main.js` |
| Easing personality | `--ease-reveal` / `--ease-settle` / `--ease-plate` in `styles.css`, mirrored as `EASE` in `src/main.js` |
| Palette | the two plate blocks at the top of `styles.css`; `ACCENT` in `src/lens3d.js` for the 3D interface colour |
| Which chapter sits on which ground | `PLATE_OF_CHAPTER` in `src/main.js` |
| Type scale | `--t-*` in `styles.css`, all sharing one `--slope` |
| Type width | `--wide` / `--semi` in `styles.css` — Archivo's width axis, one family throughout |
| The opening | `beat1` / `beat2` / `beat3` / `studio` in `render()`, plus the two interior lights |
| Progress rail | `.rail` in `styles.css`, ticks built from the sections in `src/main.js` |
| Camera choreography | the `CHAPTERS` ledger in `src/main.js` |
| When each phase fires | `phases()` in `src/main.js` — overlapping smoothstep windows |
| How far the glass separates | `GAP` and `CEMENT_GAP` in `src/main.js` |
| Studio lighting | `makeEnvironment(renderer, plate)` in `src/lens3d.js` |
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
- **Slerp view directions, never lerp-then-normalise.** A lerped direction
  traces a chord across the sphere rather than an arc, so angular velocity is
  wrong throughout and worst on the long swings, which is exactly where the eye
  is watching.
- **Damp the fit distance slower than the chapter value.** The fit is re-solved
  every frame from live bounds, so while the glass separates the target keeps
  growing. Following it directly makes the camera creep and never settle.
- **A dolly zoom needs a frozen reference.** Holding subject size means keeping
  `dist * tan(fov/2)` constant, which fails if the underlying solved distance is
  drifting. It also needs somewhere quiet to happen: over the explode it was
  invisible, because the framing was already pulling back.
- **PMREMGenerator hands back a render target, not just a texture.** Disposing
  only `.texture` leaks a target on every environment rebuild.
- **Pan, do not re-aim.** Offsetting the camera and its look-at point by the
  same vector slides the object across the frame while keeping it square to the
  lens. Offsetting only the look-at point skews it.
- **Portrait needs a different composition, not a smaller one.** Each chapter
  carries its own `liftP`, because the copy does not go to the same place in a
  portrait frame for every chapter.
- **Gate the environment map, not just the lights.** Image-based lighting is
  unaffected by light intensity, so an intro that dims only the key and fill
  never actually goes dark.
- **Light glass from the front, not from behind.** Attenuation over a deep stack
  eats anything coming from the back.
- **Translation and rotation do not need one clock.** `dirLag` delays the camera
  swing until the pull-back is underway, so a move reads as one thing then
  another rather than as two at once.
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

47–50 draw calls, ~216k triangles, worst frame under 1ms of submit time.
Steady at 39 geometries and 5 textures after repeated full sweeps of the route,
including the environment rebuilds that happen on every plate turn.

Reversibility drift across a full forward-and-back scrub is exactly 0, and
nothing in the route goes non-finite.
