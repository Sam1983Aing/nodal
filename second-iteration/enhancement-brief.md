# Enhancement Brief — NODAL

Round 1 crit, binding. Every item here is specific on purpose. Vagueness is how
a build drifts back into the defaults it just rejected.

---

## Verdict Summary

NODAL is currently a technically remarkable object on a page that hasn't decided
what it is. The concept — the solid, the drawing and the physics all derive from
one prescription table and cannot disagree — is genuine and rare, but it lives
in the code and the copy rather than the design. The visual language is standard
premium-3D costume: near-black, one cyan, a default premium serif.

After this brief it becomes **an optical design document you can interrogate**.
The page alternates between black optical plates and warm paper document plates.
The lens is lit by the plate it sits on, and on paper it redraws itself as an
ink patent illustration using the same geometry. Its own aperture wipes between
chapters. Its own dispersion data splits the traced light into colour. The
document can be inspected with a loupe that is itself the lens being sold.

---

## Kill List

| Kill | Reason |
|---|---|
| IBM Plex Sans, entirely | Three families used politely. It is the weakest of the three and carries no idea. |
| Instrument Serif | The "make it premium" default of the last two years. Recognisable as a default on sight. |
| The vignette (`.vignette`) | It is subtractive: it flattens the corners and makes the void feel more void. Replaced by a ground pool, below. |
| The sine idle rotation | 3° over an 87s period reads as drift, not intention. Replaced by scroll-velocity roll. |
| Cyan `#5BC8E8` as the interface accent | Same hue family as the subject. One temperature across the whole page is why it reads monotone. |
| All html-in-canvas Canvas UI components | Gated behind `chrome://flags/#canvas-draw-element` or a domain-bound origin trial. Silent no-op for most visitors. |
| Any particle / fog / volumetric glow / lens flare "fix" for the empty background | The default answer. Noise pretending to be atmosphere. Structure fixes emptiness, not haze. |

---

## Foundation

### F1 — Plate palette

Two grounds, one accent that changes value per ground so it reads as the same
colour on both.

```css
/* optical plates */
--ink-black:   #08090a;
--on-black:    #e8e5de;
--accent-black:#ff9a3c;

/* document plates */
--paper:       #ede9e0;   /* warm bone, never white */
--on-paper:    #1c1d1f;   /* ink, never pure black */
--accent-paper:#d4620a;
```

Hierarchy on each plate comes from fractional alpha of the single foreground
colour (0.05 / 0.12 / 0.3 / 0.55 / 0.75), not from grey values. The glass in the
3D keeps its cool blues. Warm interface, cool subject: that tension is the point,
and it is what the current single-temperature page lacks.

### F2 — Type

Two families. Mono is the default face, serif is the exception and appears **at
most four times on the entire page**.

- Display: **Bodoni Moda** (variable, `opsz` axis). A didone's hairline-to-stem
  contrast reads as an optical section drawing, which no other display face does.
- Everything else: **IBM Plex Mono**, 300/400/500.

One fluid slope shared by every clamp, per the contentarchitecture DNA:

```css
--slope: calc((100vw - 375px) / (1600 - 375));

--t-display: clamp(3.5rem, 3.5rem + 9.5 * var(--slope), 13rem);  /* lh 0.86 */
--t-title:   clamp(2rem, 2rem + 2.5 * var(--slope), 4.5rem);     /* lh 0.95 */
--t-body:    clamp(0.875rem, 0.875rem + 0.125 * var(--slope), 1rem);
--t-label:   0.6875rem;   /* 11px */
--t-micro:   0.5625rem;   /*  9px */
```

208px display against 9px micro is a 23:1 ratio. Current page is 7rem against
0.66rem, which is polite. Display tracking `-0.03em`, labels `+0.18em`.

### F3 — Easing set

Three curves, not one. The current page uses `cubic-bezier(0.16,1,0.30,1)` for
all thirteen transitions, which is why nothing has body language.

```css
--ease-reveal: cubic-bezier(0.16, 1, 0.30, 1);      /* expo out, entrances */
--ease-settle: cubic-bezier(0.34, 1.42, 0.44, 1);   /* slight overshoot, UI */
--ease-plate:  cubic-bezier(0.76, 0, 0.24, 1);      /* expo in-out, ground flip */
```

---

## Fixes

### FIX 1 — Ground flip plumbing

A single `plate` value, 0 = black, 1 = paper, derived from `exact` with the same
overlapping-window technique already in `phases()`. Plate map:

```
00 hero    black     03 explode  black      06 end     black
01 object  paper     04 trace    black
02 beat    the flip  05 series   paper
```

The flip drives three things simultaneously off one number:
1. CSS custom properties on `:root` (interpolated in JS, written once per frame).
2. `scene.background` and `renderer.toneMappingExposure` (black plate 1.42,
   paper plate 1.05), plus a second PMREM environment built for the paper plate
   with a warm bounce from below.
3. The ink pass mix (see ELEVATE 1).

Flip window is 0.55 chapters wide on `--ease-plate`. The blank beat at chapter 02
is where the first flip happens, so the page's quietest moment is also its
biggest change. That is the payoff the beat is currently missing.

### FIX 2 — Camera, six items

1. **Slerp the direction.** Currently lerped-then-normalised, which is a chord
   across the sphere and gives wrong angular velocity through every swing.
   Standard slerp, with a `dot > 0.9995` lerp fallback for near-parallel cases.
2. **Damp the radius separately.** Keep `camRadius` as state; approach the solved
   target at `1 - exp(-2.2 * dt)`, slower than the position's 5.4. The camera
   currently re-solves the fit every frame from live bounds, so it dollies back
   continuously as the explode spreads and never holds still. That creeping is
   most of what reads as unpolished.
3. **Per-chapter easing.** Add `ease` to the ledger: `'reveal' | 'settle' |
   'plate'`. The 130° hero-to-profile orbit gets `settle` (3% overshoot, returns
   over the last 18% of the transition). Small push-ins get `reveal`.
4. **Dolly-zoom at the explode.** Between `exact` 2.8 and 3.15, `fov` goes 26 → 34
   while the solved distance compensates to hold element 01's projected height
   constant. One Vertigo move, on a page about focal length, at the moment the
   lens comes apart.
5. **Kill the sine idle.** Replace with scroll-velocity roll: `spin.rotation.z`
   targets `clamp(signedSpeed * 0.055, -0.09, 0.09)`, damped at `exp(-3.0*dt)`.
   This finally reads `conductor.state.signedSpeed`, which is computed every
   frame and currently used by nothing.
6. **Depth of field.** Render to a target, derive circle-of-confusion from the
   depth buffer against a `focusDistance` uniform, separable blur at half
   resolution, composite. Focus distance racks per chapter: locked on the front
   element in the hero, on the stop during the explode, and on the focal plane
   during the trace. Zero DOF on a page about a lens is the single largest
   missed opportunity in the current build.

### FIX 3 — Hero (chapter 00)

- Display to `--t-display` (208px at 1600), line-height 0.86, tracking -0.03em.
- Loader replaces the current cold pop-in. See ELEVATE 2.
- Eyebrow moves below the headline as a rule-plus-label row, so it stops
  colliding with the fixed chrome.

### FIX 4 — Series (chapter 05)

The 25mm and 75mm rows are currently fabricated ("11 elements / 9 groups"). On a
page whose entire argument is that nothing is typed in by hand, that is the one
thing that must not be fake.

Generate them for real: `solvePrescription(RAW_SURFACES)` already scales to a
target EFL, so run it at 25 and 75 and print the true derived numbers (physical
length, front diameter, BFD, T-stop all differ). Element count stays 10/8 across
all three, which is the honest and better story: one optical formula, three
focal lengths. Clicking a row lerps the live lens to that scale over 1.1s on
`--ease-settle`.

### FIX 5 — Footer (chapter 06)

The section currently does no work. It becomes the closing bracket: the iris
stops down over the frame to black as the page ends, mirroring the loader.

### FIX 6 — Micro-detail

Absent from the current build entirely, all of it:

- `::selection` — accent at 0.25 alpha on both plates.
- Thin custom scrollbar, 3px, accent thumb at 0.4 alpha.
- `:focus-visible` — 1px accent ring at 2px offset. There are currently zero
  focus styles on the page.
- Hover states on index rows, spec rows and the ghost link, on `--ease-settle`.
  There is currently one hover state on the entire page.
- Reduced-motion: plate flips become instant state changes, ink/DOF/iris hold at
  their settled values, the loupe is disabled.

---

## Elevations

### ELEVATE 1 — The ink plate (chapter 01 and 05)

Port the technique behind Canvas UI's Ink Object as a screen-space post-process.
Not an install: it ships as React TSX via shadcn and this project is vanilla with
no build step, so the technique is what transfers.

Hatching pass, operating on the rendered colour and the depth buffer:

| Uniform | Value |
|---|---|
| `lineSpacing` | 7px |
| `angle` | 32° |
| `strokeWeight` | 0.85 |
| `relief` | 0.6 — offsets the hatch coordinate by depth so strokes wrap the form |
| `dashLength` | 14px |
| `variation` | 0.55 — strokes break to dashes as tone lightens |
| `bleed` | 0.3 |
| `wobble` | 0.22 |
| `contrast` | 1.35 |
| `inkColor` | `--on-paper` |

Mixed by the same `plate` value as the ground flip, so the lens crossfades from
photoreal glass to patent illustration as the page turns to paper. Same geometry,
two representations, which is the concept stated in the README made visible for
the first time.

### ELEVATE 2 — The iris as the page's transition device

The lens's own mechanism, used as the page's wipe. A full-screen quad drawing a
regular 9-gon mask with the same blade count and the same rotation-with-closure
as the real iris in `setIris()`.

- **Loader.** Page opens fully stopped down. The iris opens to the design
  aperture over the first 900ms while a mono readout counts T22 → T1.9. No
  percentage counter: that is the default and this page has a better number to
  count.
- **Transitions.** Scroll-scrubbed, not time-based, so it can never fight the
  scroll. Fires at the two ground flips only (02→03 and 04→05), closing to fully
  covered at the boundary and opening on the other side. Two per page, not seven.
- **Closer.** Chapter 06 stops down to black. The page ends the way it opened.

### ELEVATE 3 — Chromatic aberration in the trace (chapter 04)

The Abbe numbers are already sitting in the glass table and are read by nothing.
Use them.

Derive a two-term Cauchy fit per glass from `n_d` and `V_d`:

```
B = (n_d - 1) / (V_d * (1/λ_F² - 1/λ_C²))
A = n_d - B / λ_d²
n(λ) = A + B / λ²
λ_F = 486.1nm,  λ_d = 587.6nm,  λ_C = 656.3nm
```

Trace three bundles at F, d and C. They focus at measurably different depths,
which is real longitudinal chromatic aberration, computed rather than faked. The
rays separate into blue, green and red as they converge and the ray draw resolves
into visible colour fringing at the focal plane. Print the measured F-to-C focal
shift beside it.

This is the payoff nobody else can build, because nobody else has the
prescription. It should be the most beautiful thing on the page.

### ELEVATE 4 — The loupe (chapter 01 and 05, paper plates only)

Re-scoped from an ambient page-wide cursor lens, which would have been decoration
and would have fought the hatched plates. It gets a job instead.

Built on the Vitreous recipe, not Canvas UI's flag-gated version: per-element SVG
`feDisplacementMap` via `backdrop-filter`, displacement map generated to a canvas
data-URI as a rounded-rect SDF, chromatic aberration from three displacement
passes at 0.88 / 1.0 / 1.12 channel-isolated with `feColorMatrix`. Works in every
browser that supports `backdrop-filter`, with a `blur() + saturate()` fallback.

Behaviour: drag it across the prescription table and it magnifies and refracts
the surface rows beneath it. The surface under the loupe centre highlights in the
3D simultaneously, so the document and the object are wired to each other. Its
barrel distortion is driven by the real prescription, so the thing you inspect
the document with is the lens the document describes.

### ELEVATE 5 — The interrogable spec plate (chapter 01)

Currently ten real computed numbers, completely inert. Wire each row to the object:

- `Front diameter` → element 01's rim highlights, a dimension line draws across it
- `Back focal distance` → a dimension line draws from the last vertex to the focal plane
- `Aperture` / `T-stop` → the iris ring becomes draggable; dragging closes the
  iris, updates the readout through `solveStopRadius()`, and narrows the live ray
  bundle. Physically correct, because the pupil is solved rather than illustrated.
- `Elements / groups` → all eight groups pulse once in sequence

Hover reveals on `--ease-settle`, 240ms.

---

## Sequence

Order is not arbitrary. Each stage is a stable, shippable page.

1. **Foundation** — F1 palette, F2 type, F3 easings. Everything else sits on this.
2. **Ground flip** — FIX 1. The single biggest visible change, and it validates
   the palette before any post-processing exists.
3. **Camera** — FIX 2 items 1–5. Cheap, high impact, no new pipeline needed.
4. **Post pipeline** — FIX 2 item 6 (DOF) and ELEVATE 1 (ink) together. They
   share the render-to-target and depth infrastructure, so building them apart
   would mean building it twice.
5. **Iris** — ELEVATE 2. Needs the plate flips from stage 2 to know where to fire.
6. **Chromatic trace** — ELEVATE 3. Self-contained in `optics.js` plus the ray builder.
7. **Interaction** — ELEVATE 4 and 5. Needs the paper plates to exist first.
8. **Polish** — FIX 3, 4, 5, 6.
9. **Director's pass** — re-review the changed sections cold, against this brief.

Stages 1 to 3 carry most of the visible lift and are the natural first delivery.

---

## What this page refuses

Stated so the build stays honest under pressure:

- No particle field, fog, god rays or bloom to fill the background. Structure, not haze.
- No counter-to-100 loader.
- No generic circular cursor that scales on hover.
- No horizontal-scroll section.
- No sticky stacking spec cards.
- No second display typeface. Two families, and the serif is rationed.
- No effect that is silently inert for most visitors.
- No fabricated numbers anywhere. If it is printed, it is computed.
