# Build brief: NODAL from scratch

A rebuild brief, written so a fresh session can build this page from zero in a
teachable order. It is not a description of the finished repo. It is the order I
wish I had built it in, with the traps marked before you walk into them.

**Do not copy the existing files.** Build each stage fresh. The shipped repo is
the reference implementation, there to check yourself against when a stage will
not come out right, not to paste from.

---

## What you are building

A scroll-driven landing page for a 40mm T1.9 cine prime, where the lens is
**not a model file**. No GLB, no OBJ, nothing exported from Blender, no
reference image. The object is generated at runtime from an 18-row optical
prescription, the same kind of table a lens designer writes before anything gets
ground.

Finished size, for scale: about 5,400 lines across 6 files, 7 scroll chapters.

## The one idea the whole series hangs on

Everything downstream comes from the table. Change one radius and the glass
relathes, the barrel refits around it, the ray trace re-solves and the printed
copy updates. Nothing on the page can contradict anything else, because it is
all the same calculation.

That is the reason this is worth teaching rather than just watching. A viewer can
edit one number and see the object change, which no model-file tutorial can
offer.

## Stack

| what | why |
|---|---|
| Vanilla JS, ES modules, no build step | Every file stays readable on camera. No tooling detour in episode one. |
| three.js r185, vendored in `vendor/` | No `npm install` on screen, no version drift between the video and the viewer. |
| Lenis 1.3.26, vendored | Scroll weight is most of the mood. |
| Martian Mono, Google Fonts | One typeface for the whole page. |
| `python3 -m http.server` | ES modules need a server. That is the only tooling. |

## The four rules

State these on camera before writing code. Every later decision is downstream of
them, and each one has a failure you can demonstrate.

**1. Absolute, never incremental.** Every scroll-driven value is a pure function
of scroll position. Nothing accumulates, nothing gets "undone." Scroll back up
and the lens reassembles bit for bit. Demonstrate the failure by writing one
incremental line and scrolling up and down ten times until it drifts.

**2. A chapter states what it wants to see, never where the camera is.** A
chapter declares a direction, a focal length, how much air to leave and what to
frame. The camera solves its own distance every frame by fitting the object's
real bounding box to the real window. That is why it reframes correctly when the
lens explodes to three times its length, and why it needs no tuning at any
window size.

**3. One rAF loop.** Lenis and the render loop share a single clock. Two loops is
the classic stutter and it is worth showing.

**4. Layers point one way.** `main.js` uses `lens3d.js` uses `optics.js`.
`conductor.js` knows nothing about lenses. Nothing points back up. `optics.js`
has no three.js import at all, which is what lets stage 1 run in Node.

---

## Stages

Nine stages. Each is a self-contained lesson with something working at the end.

### Stage 1: The lens on paper

**No three.js. No browser.** Pure JavaScript that runs in Node.

Build the glass catalogue (6 types, real refractive indices), the 18-row
prescription, a meridional ray tracer that refracts by Snell's law at every
sphere, and the solvers for focal length, back focus, focus distance and stop
radius.

**Verify:** print the spec sheet and check it against the design targets. It
should solve to 40.0mm and T1.86. Then trace a 10 degree field ray through the
stop. It lands at 7.031mm, where a perfect lens would put it at `40 * tan(10)`
= 7.053mm. That 0.3% gap is the lens's own distortion, and neither number was
entered anywhere. It arriving on its own is the moment the series earns
attention.

Do not collapse the two figures into one. An earlier draft of this brief said
the ray lands at 7.04mm "which is exactly `40 * tan(10)`", and both halves are
wrong: the traced value is 7.031 and the ideal is 7.053. The difference between
them is the whole point, so stating them as the same number throws the beat
away. Verified against this repo's own `optics.js` run under Node.

**Why first:** it is the only stage with an objectively right answer, and it
proves the premise before a single pixel is drawn.

### Stage 2: First glass

One element, lathed and rendered. `LatheGeometry` from the surface profile,
`MeshPhysicalMaterial` with transmission, an orbit control, no scroll.

**Trap:** transmission needs an environment to refract, or the glass renders as
a grey blob. Build the environment before you blame the material.

### Stage 3: The whole object

All 10 elements in 8 groups, the barrel fitted around them, the 9-blade iris, the
focus and aperture rings, the gear teeth as an `InstancedMesh`.

Still static. Still no scroll. If the object is not beautiful sitting still,
scroll will not save it.

### Stage 4: The scroll spine

Lenis in, and a conductor that turns `scrollY` into **one number**: position
along the route. It returns two versions, an exact one for UI and a smoothed one
for the camera.

**Verify:** print the number on screen and scroll. Nothing else is wired yet.
This stage looks like nothing and is the most important one in the series.

**Trap:** a chapter does **not** begin at its own integer. Chapter 2 pins at
`e = 1.857`, not 2.0, because of how the pads resolve. Every timing window
written against the round number lands late. This cost real time and it is a
great teaching beat, because the bug looks like a broken observer and is not.

### Stage 5: The camera that solves itself

The chapter ledger, and the box-corner fit that turns a declaration into a
distance.

**Trap, and the best single lesson in the build:** two different causes make a
camera "jump," and only one of them is about position.

- Flipping `visible` on a mesh changes the bounding box in one frame, so the
  solved distance steps. Fix by framing a stable box, not the live one.
- An out-curve leaving from a standstill has a huge derivative at t=0. Position
  is continuous, velocity is not, and velocity is what the eye reads. The worst
  case here went 0.000 to 3.652 in one step. The fix is an ease with zero
  velocity at **both** ends (smootherstep) for any chapter that holds before it
  departs.

### Stage 6: Taking it apart

Overlapping smootherstep windows drive explode, the ray bundle, the blueprint
overlay and the barrel dissolve. All absolute functions of position.

**Verify:** the reversibility test. Sample 61 positions going down, then the same
61 going up, and require the difference to be exactly zero. Run it on every
change from here on.

### Stage 7: The page around it

The DOM layer: 7 chapters, the two-plate light/dark ground system driven from one
value, masked line reveals, the type scale.

**Trap:** CSS specificity will bite at least twice. `> *` contributes nothing to
specificity, so `.pad > *` loses to `.specs`. Compound the selector rather than
reaching for `!important`.

**Trap:** in a monospace face, `measureText` gives you advances, not ink. Fitting
a wordmark to a frame needs `actualBoundingBoxLeft/Right` or it comes out at 79%
of the width you asked for.

### Stage 8: The finish

The in-scene glow, the aperture-iris cursor, the loader where the lens descends
unlit and then lights, the hover inspector on each element.

**Trap:** the inspector must not scale anything. Scaling changes the bounds, and
the camera is solving from the bounds, so hovering a part would move the camera.
Use an emissive rim instead.

### Stage 9: Ship it

`prefers-reduced-motion`, the mobile pass, then the standalone single-file build.

**Trap:** `file://` refuses to fetch ES modules, so a standalone build cannot
just concatenate. Rewrite each module as an IIFE and turn imports into registry
lookups, producing one classic script. Verify with `node --check`.

---

## If the series needs to be shorter

Cut in this order, and say on camera that you are cutting them:

1. The blueprint overlay (stage 6), self-contained and skippable
2. The set chapter with its hover frames (stage 7)
3. The loader (stage 8)
4. The standalone build (stage 9)

Do **not** cut stage 1 or stage 5. Stage 1 is the premise and stage 5 is the
craft. Everything else is decoration on top of those two.

## Reference implementation

- Repo: https://github.com/Sam1983Aing/nodal
- Live: https://sam1983aing.github.io/nodal/
- `NOTES.md` in that repo is the engineering journal: every non-obvious decision
  and, more usefully, every trap with the measurement that caught it. Mine it for
  episode material.

## Starting the new session

Open a fresh session in an empty folder and paste something like this:

> I'm rebuilding a scroll-driven cine lens landing page from scratch, on camera,
> as a teaching series. Read TEACHING-BRIEF.md. We start at Stage 1 and I want to
> understand every line, so explain before you write and stop at the end of each
> stage. Do not skip ahead and do not copy from the reference repo.

Copy this file into that folder first. Vendor three.js and Lenis at the start of
stage 2, not before, so stage 1 stays dependency-free.
