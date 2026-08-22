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

## No accent colour

The palette is a ground and a foreground, and nothing else. Emphasis is a
VALUE move rather than a hue: body copy sits at fractional alpha, anything
that matters comes up to full foreground, and the primary action is a solid
block of foreground with the ground knocked out of it.

Three accents were tried and rejected. Amber and red are both warm, so on the
bone plate the accent and the ground share a temperature and the whole
chapter goes muddy. Cyan, the original, shared a hue family with the blue
glass, which flattened the object and the interface into one thing. A coating
violet worked well and was the near-miss.

What is left is the argument the page is making anyway: **the only colour
anywhere is in the glass and in the traced light.** The interface has none.

The token is kept rather than deleted, so every rule that reads `--accent`
still works and a hue can be reintroduced in one line.

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
| Palette | `PLATE_BLACK` / `PLATE_PAPER` in `src/main.js`; `ACCENT` in `src/lens3d.js` for the 3D interface colour |
| Accent hue | `accent` on both plate objects in `src/main.js`; the blueprint and every CSS mark follow it automatically |
| The glow behind the object | `buildGlow()` in `src/lens3d.js` for colour and shape, its fade window in `render()` in `src/main.js` |
| Which chapter sits on which ground | `PLATE_OF_CHAPTER` in `src/main.js` |
| Type scale | `--t-*` in `styles.css`, all sharing one `--slope` |
| Typeface | Martian Mono, one family throughout, loaded in `index.html` and mirrored in `FACE` in `src/lens3d.js` for the canvas layers |
| Type width | `--wide` / `--semi` / `--tech` / `--read` in `styles.css` — the `wdth` axis, 75 to 112.5 |
| Closing-section prices | `.end-price` and the `.end-specs` list in `index.html` — the only invented figures on the page |
| The cursor | `drawCursor()` in `src/main.js`; sides come from `iris.blades`, styling is `.cursor` in `styles.css` |
| The element inspector | `probeHTML` in `src/main.js` for the copy, `.probe` in `styles.css`, the pick in `render()` |
| How long the exploded view holds | `hold` on the explode row of `CHAPTERS`, paired with the explode window in `phases()` |
| The chapter readout | `data-label` on each `<section>` in `index.html` |
| The two-card beat | the `ty(...)` windows in `render()` in `src/main.js`; markup is `[data-beat]` in `index.html` |
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

## Don't make the reader solve a riddle

Chapter 05 opened with "You don't buy one." It withholds its own subject and
asks the reader to work out what "one" refers to and why it matters — and the
answer only arrives three lines later, in the body. A headline that has to be
decoded is not a headline.

It now states the situation first ("Nobody shoots with one lens.") and lets the
body say what the matching actually buys on the day: the lighting holds, the
matte box stays on, the focus puller keeps their marks. The spec list under it
is the same three lenses; what changed is that the reader now knows why they are
being shown a set instead of a product.

The layout followed: the index used to run to 74rem, so its rules crossed the
whole plate and the object had to be shrunk into the bottom corner to stay clear
of them. Constraining the copy to the left half let the object nearly triple in
area and sit properly on the right.

## Two causes of a camera that "jumps"

Chapter 05 lurched on the way in, and it turned out to be two separate faults
that happened to land in the same place.

**A hard bounds change.** `frame: 'whole'` measured live bounds, and
`visibleBounds` skips hidden subtrees — but the barrel's visibility is a
boolean (`barrelFade < 0.995`). The frame it switched back on, the box grew by
the entire barrel and the solved distance jumped with it. Damping does not
remove that, it spreads it into a lurch.

The fix is a **separate frame type**, `'stable'`, which works from a box
captured once at rest and transformed by the lens's own matrix. It is used only
by the two chapters after the trace, because they are the only ones with the
barrel fading back in across their span. Applying it to every `'whole'` chapter
was the first attempt and it was wrong: the captured box frames very slightly
differently, so chapters 01 and 02 both drifted right — 01 far enough to push
the barrel off the right edge. If a fix changes chapters that were not broken,
narrow it.

Two traps in that capture, both found by measuring:

- The blueprint defaults to `visible` before the first render, and its outline
  and leader lines reach well past the barrel. Left on, it inflated the box.
- Use `lens.matrix`, **not** `matrixWorld`. Transforming an AABB by a rotation
  inflates it to contain the rotated corners, and the ancestors above `lens` are
  the idle drift, the pointer parallax and the visitor's drag — so matrixWorld
  made the framing breathe with the idle spin. The framing should follow the
  staged placement and ignore the cosmetic rotation on top of it.

**An out-curve leaving from rest.** `EASE.settle` is a back-out: its derivative
at `t = 0` is **3.55**, so the camera leaves at speed. That is right when the
previous move is still settling and the two overlap, and wrong when the camera
has been sitting still — which is the case going into the set, where it holds
for most of a chapter first. Position stayed continuous; velocity stepped from
nothing to everything, measured as a jump from `-0.002` to `-0.747` per sample
right at the boundary. A new `glide` ease (smootherstep, zero velocity at both
ends) takes it to `-0.001, -0.002, -0.006, -0.015` — a ramp.

The same fault, five times worse, was sitting in the explode: it carries a
`hold`, so it is perfectly stationary, and then departed on `reveal` (derivative
6.9 at t=0). Measured **0.000 to 3.652 in one step — 17% of the camera's entire
distance**. Now 0.000, 0.013, 0.082, 0.187.

The general rule: an out-curve is for a move that interrupts another move. Use
an in-out curve for a move that starts from stillness — and **any chapter
carrying a `hold` must use `glide` by construction**, because the hold
guarantees it is stationary. Worst velocity ratio across the whole route is now
1.92, and the only place it occurs is the intro fall, where it belongs.

## The cursor is the lens's own aperture

A circle with a dot inside it is the default custom cursor, and it says nothing
about the product. This one is a regular polygon with the same number of sides
as the lens's iris — read from `iris.blades`, not typed as 9 — so change the
blade count in the prescription and the pointer changes with it. It **stops
down** on press: scaling to 0.62 while rotating 22°, which is what the real
mechanism does when you close it.

Two elements, not one. A 3px mark sits exactly under the pointer so aiming stays
honest, and the iris lags behind it at `1 - exp(-19·dt)`. A single lagging
cursor feels imprecise; a single exact one has no weight.

The native cursor is hidden by `body.has-cursor`, a class JS adds only after the
replacement is wired and only behind `(hover: hover) and (pointer: fine)`. A
page that hides the system cursor before proving it can draw its own is a page
that can end up with no cursor at all.

## Deriving the sample frame instead of shooting one

Chapter 05 wants to answer "what can I shoot with this?" for each focal length.
The obvious vehicle is a sample photograph, and there is none to be had: every
pixel on this page comes out of the prescription, and a stock frame would be the
one thing on the plate nobody made.

So the hover panel derives the answer. Angle of view and coverage are computed
from the page's own image circle, which is why the 40mm entry reports exactly
the 31.0° the spec strip already prints — the two cannot disagree, because they
are the same number. The useful part is the diagram: a 1.70m figure with the
frame that lens actually gives you at two metres drawn over it, to scale.

| | Angle of view | At 2m it frames |
|---|---|---|
| 25mm | 47.9° | 0.87 m · chest up |
| 40mm | 31.0° | 0.54 m · head and shoulders |
| 75mm | 16.8° | 0.29 m · a face |

That is a real answer to "what does 75mm do", and unlike a photograph it stays
true if the prescription changes.

## The light has to actually leave

`raysOut` ran 4.72–5.06 and its effect was `1 - raysOut * 0.85`, so the traced
light never fell below **15% opacity** — it sat faintly over the set chapter and
the closing shot, on a lens that is supposed to be assembled and done. Two
separate bugs in one line: the window was too late, and the multiplier meant it
could never reach zero. It now runs 4.45–4.85, goes fully to 0, and the line
object is hidden outright once it does.

## Standing the object up

The closing shot has the lens upright on its mount, side-on, so the knurling and
the engraved scales carry the frame. `+Z` is the optical axis, so rotating **-90°
about X** sends `+Z` upward and the lens comes to rest on its front cap.

Both directions "stand" it. The one that matters is the engraving: the focus and
T-stop scales are wrapped around the barrel, so standing it the other way up
leaves every number legible but inverted. Direction here is a typography
decision, not a staging one.

It is driven from `e` like everything else — `win(e, 5.30, 6.00)` — so scrolling
back up lays it down again rather than leaving the page in a state that depends
on how you got there.

Note the framing consequence: `boxOf()` measures an axis-aligned box, and for an
object standing on its end that box is much larger than the visible silhouette,
so the usual `pad` values frame it far too loosely. And the pad is direction-specific: flipping
from +90° to -90° moved the object relative to its pivot enough to clip 73px off
the top at a value that had fit a moment earlier. Re-measure after any rotation
change; do not assume the framing carries over.

## The object descends into frame, unlit

The opening used to scale the object up in place. That means it has to become
visible somewhere, and with nothing lit yet, that is a dark shape appearing out
of nothing — a flash, not an entrance.

It now falls in from above the frame as an unlit silhouette, `win(intro, 0.30,
0.62)`, and the studio only starts at 0.62. The wordmark finishes at 0.33, so
the object starts moving as the last letter settles. Measured through the
travel, `scene.environmentIntensity` holds at 0.03 the whole way down and only
lifts once it has landed: 0.053 at 0.66, 0.451 at 0.75, 1.0 by 0.90. All three
interior beats were pushed back past 0.61 for the same reason — lighting it on
the way down would show a lit lens travelling, which is the opposite read.

**This does not work without compensating the camera.** `framing()` measures the
live object, so while the lens falls its centre falls too, and since the camera
AND its look-at are both placed from that centre the camera tracks it down and
the fall is completely invisible. One line fixes it:

```js
centre.y -= introFall;   // solve the shot against the resting place
```

The wordmark and the glow are parked from that same corrected centre, so they
hold still while the object travels past them — verified: the wordmark sits at
y=440 at every point of the fall.

## The trace is a diagonal section, so the sensor must be drawn as one

Every ray in the trace is pushed at `x = 0` — it is a meridional fan — so the
section on screen cuts the sensor corner to corner and the corner field lands at
the half **diagonal**. The frame was outlined at its 16:9 half-height instead,
which is a different number: with EFL 40 and a 15.5° half-field the three
bundles land at 0, 6.78 and 11.09mm while the outline stopped at 5.43mm. Two of
the three foci hung in space above the frame, and it read as a mistake because
it was one. The outline now spans the image circle, so the corner bundle lands
exactly on its edge, and two ticks mark where the 16:9 frame edge falls along
that diagonal.

## Specificity: `> *` is worth nothing

`.pad--figure > *` looks more specific than `.specs`. It is not — the universal
selector contributes zero, so both are (0,1,0) and the later rule wins. The
specs kept their 2-column, 52rem layout inside a column meant to cap them at
25rem. Name the children (`.pad--figure > .specs`) or compound the class
(`.specs.specs--stack`). This is the third time this exact trap has appeared in
this project, after `.cta--fill` and `.beat-card`.

## Flex basis `auto` measures content, `overflow: hidden` does not stop it

The hero's feed is `overflow: hidden` with a 36-line track. Given `flex: 1 1
auto` its flex base size is still the full content height, so it drove the grid
row to 1487px and the hero stopped fitting the fold. `flex: 1 1 0` takes only
the leftover height; the minimum lives on the column so it cannot collapse.

Pairing that with `align-content: center` on the grid is what makes the two hero
columns match: without it, grid stretches the auto row to fill the pad and the
feed ran to fifteen lines. With it the row keeps its content height, `align-
items: stretch` makes the right column exactly as tall as the left, and the two
blocks measure identically at any viewport.

## An arrival, not a queue

The hero's opening used to land in four announcements: headline, wait, copy,
wait, numbers, wait, buttons. Every individual move was fine; the fault was the
spacing between them.

Two numbers caused it. The three latches sat at intro 0.70 / 0.80 / 0.89, which
is 1.1s apart on a 5.8s opening, and the per-element `transition-delay`s then
ran out to 0.94s on top. Total arrival window: about 2.0 seconds, long enough to
watch each group take its turn.

The latches are now 0.70 / 0.735 / 0.765 and the delays are cut to a 0.02–0.22
range. Arrival window: **537ms**, and more importantly the groups now overlap —
the headline is still animating at 5110ms while the metrics and buttons have
already started at ~4460 and ~4500. The offsets survive, because without them it
lands as one flat block, but they are small enough to read as texture rather
than as steps.

Ordering is not the same thing as sequencing. If the viewer can count the
beats, the gaps are too big.

## "Behind the object" is a clip edge, not a z-index

The hero buttons slide down out from behind the lens. The obvious implementation
is to put them under the canvas in stacking order, and it does not work: the
canvas background is opaque, so anything beneath it vanishes completely instead
of being occluded by the object.

The working version is a wrapper pulled upward by a negative margin and pushed
back down by an equal padding, so it occupies exactly the space it did before
while its `overflow: hidden` region reaches up to the lens's lowest point. The
buttons start above that edge, fully clipped, and travel down into place.

The measurement is what makes it read: the lens bottoms out 60px above the
buttons at this viewport, so the clip edge is placed 4px below that. Any higher
and the emerging button would paint *over* the glass, since the DOM is above the
canvas — which is the opposite of the illusion.

The clip needs a soft edge. `overflow: hidden` alone gives a hard horizontal
line for the button to pop through, which announces the mask. A mask-image
gradient — transparent at the clip edge, opaque by 15% short of the resting
position — makes it arrive out of nothing and still settle solid. Both are
needed: the gradient softens the edge, the overflow clips everything above it.

Its resting place is measured against both neighbours, not just the lens: 43px
below the glass, 41px above the rule. It was 60/23 before, which read as a
button pushed down against the line rather than placed between the two.

## The chapter number is the progress readout

Every chapter used to print its name in the top bar AND its number as an eyebrow
inside the pad, while the pad also carried a headline saying roughly the same
thing. Three statements of one idea. The bar now carries `01 — Rendering` and
the eyebrows are gone, so the top of the frame reads as position-in-the-document
and the pad is free to make an argument instead of repeating a label.

The hero is the exception. It carries no number, because there is nothing to be
one-of yet, so it names what the product is instead — and it is set larger and in
the accent, the only coloured thing in the chrome. `is-lead` is toggled on the
readout at `index === 0`.

One detail there: letter-spacing adds its gap AFTER every character including the
last, so a centred, widely-tracked line sits half a tracking-unit left of true
centre. Matching that space as `padding-left` puts it back — measured offset is
0px against 10px of visible drift without it.

## A chapter does not begin at its own integer

The single most useful measurement on this page: the beat's pad stops rising and
pins at **`e = 1.857`**, not at 2.0. Sections pin roughly a seventh of a chapter
before their own index, because `e` is a continuous route position and the
sticky pad locks as soon as the section's top reaches the viewport top.

Any scroll-driven reveal written against the integer therefore lands late. The
beat headline was aimed at 2.30, then 2.04, and both were still fully hidden at
the exact moment the pad locked into place — finishing several hundred pixels
further down, which reads as text that will not turn up. Aimed at 1.76 it rises
*with* the pad and is settled before it stops.

Measure the pin point before writing the window. Do not derive it from the
chapter index:

```js
for (let y = 0; y <= max; y += 10) {
  scrollTo(0, y);
  if (section.getBoundingClientRect().top <= 0) return conductor.read(0).exact;
}
```

The time-based reveals elsewhere do not have this problem, because `.is-in`
fires 0.86 viewports before the pin and a 1.05s transition completes during the
rise. It is specific to windows written in `e`.

## The drawing and the thing it describes cannot share the frame

The barrel blueprint used to draw on during the explode. It is struck in the
same plane the separated elements occupy, so over an open stack it crossed the
glass and ran straight through the callout labels — two pieces of information
competing for the same pixels, and the labels lost.

It is now pinned at exactly zero for the whole of the open explode and draws on
across the handover into the trace, `win(e, 3.66, 4.10)`. Chapter 4 pins at
`e = 3.765`, where the blueprint is still only 6%, so it arrives as you settle
into that chapter rather than being there when you get there. By the time it is
readable at 3.90 the glass has already collapsed back to 0.016, so the outline
and the exploded stack are never on screen together.

Where it belongs is the trace: with the lens reassembled, the outline is context
for the light path instead of clutter over it.

## Hold the payoff before moving on

A camera that arrives at its best shot and immediately leaves has not really
arrived. The explode finishes opening a third of the way through its chapter,
and the ledger interpolates continuously toward the next one, so the fully-open
stack was already sliding toward the trace framing the moment it got there.

`hold` on a chapter row parks the camera on its OWN framing for the first part
of its span before the move begins:

```js
const held = A.hold ? clamp((raw - A.hold) / (1 - A.hold), 0, 1) : raw;
```

At `hold: 0.58` the exploded view is completely still from `e = 3.24` to `3.58`
— measured drift across 17 samples is exactly 0 — which is about 950px of
scrolling with the lens open and inspectable.

## The inspector, and why it does not scale anything

Hovering a group once the stack is fully open raises a card built from the same
prescription the geometry came from. It is offered only above `explode > 0.85`:
before that the elements overlap on screen and a pick would be a guess at which
one you meant. The raycast runs on pointer movement, not per frame, so holding
still costs nothing.

The obvious way to mark the hovered piece is to scale it up. That is wrong here
and the reason is worth remembering: `framing('glass')` fits **live** bounds, so
growing one element by 5% quietly pulls the entire shot back. The highlight is
emissive on the ground rim instead, which is geometrically free — and is also
how you would actually mark a lens element.

The card's note is derived rather than authored per element: it reads the Abbe
numbers and says what that combination is *for*, so it cannot drift out of step
with a prescription change.

## The beat carries the claim, the explode carries the evidence

Chapter 3 used to open with an oversized line drifting horizontally across the
exploded lens. Three things were wrong with it, and only one was taste:

- Chapter 3's camera sits at `shift: 0` with the tightest padding on the page,
  so the object fills the centre of frame. Any large line there lands on top of
  the lens. Centring it would not have helped; it would have made the collision
  stationary.
- The drift started at `e = 2.5`, halfway through the beat, so it was on screen
  while the previous chapter's headline was still up. Two display lines sharing
  one frame.
- At 144px with `white-space: nowrap` it ran off both edges and was cut by the
  pad's overflow, which reads as a bug rather than as a device.

The fix was to move the claim to the only chapter with room for it. The beat has
the object small, lifted and pushed back, so it now holds **two cards** in the
same grid cell: "Then you take it apart." rises, holds, then leaves upward
through its own mask while "This is what T1.9 costs." follows it in. Chapter 3
then opens with nothing but its `03 — Inside` tag and the callouts.

The explode was also retimed from `win(e, 2.25, 3.12)` to `win(e, 2.74, 3.26)`.
The old start meant the glass was already separating while the beat was still
making its claim. The order is now statement, statement clears, then the lens
opens into an empty frame.

The swap is scrubbed from scroll rather than run by a CSS transition, because a
transition cannot be played backwards by scrolling up, and reversibility is the
page's whole contract.

## The accent is taken from the object, not chosen against it

Sampling the rendered glass gives a dominant body colour near `#182038`, hue
220, and the AR coatings in the prescription bloom around hue 217. The accent
sits at hue 213 on both grounds: `#8cb0db` on black, `#2e4f76` on paper. It
reads as the coating on the front element rather than as a brand colour laid
over the top.

An earlier cyan failed at this, and the reason is worth keeping. It matched the
glass in **value** as well as hue, so the frame flattened to one temperature.
This one is a long way from the glass in value: the glass is a dark body around
16% lightness, the accent is a light mark at about 70%. Same family, opposite
end, so it separates instead of merging. Contrast measures 8.87:1 on black and
6.94:1 on paper.

Hue is rationed. It gets the small interface marks and exactly one line per
chapter. The hero headline carries no accent at all, because it is the sell line
and wants maximum contrast; the hero takes its colour from the glow instead.

## The glow is in the scene, not over it

The obvious way to stop a near-black ground reading as empty is a radial
gradient in a fixed overlay. It is also wrong: the overlay sits above the canvas,
so it paints across the object and reads as fog.

Parking a plane behind the lens instead keeps depth testing, so the barrel
occludes the glow and the object sits **in front of** a light source. The glass,
which samples the scene for transmission, picks it up as well.

It is a halo on the object, not a wash on the plate, and the plane is centred on
the object rather than on the frame, so a gradient centred in the texture lands
directly behind the lens. A much fainter squashed ellipse sits under it, enough
to suggest light gathering below without becoming a floor.

The honest way to tune this is a radial profile: render the frame twice, once
with the plane removed, and average the blue lift in rings around the object
while skipping any pixel the lens itself covers. The shipped version peaks at
**+15 at about 220px** from centre, is down to +3 by 400px, and reaches the
corners at **exactly 0**.

The first attempt measured +35 at the bottom of the frame with +14 still in the
top corner, which is a lit room rather than a lit object. Falloff is what
separates the two, not peak brightness: if the corners move at all, it stopped
being a glow behind something.

It fades in over `win(intro, 0.62, 0.96)`, overlapping the last of the lens
arrival so the light comes in with the object rather than switching on around
it, and it dies with the plate, because a cool bloom on warm paper is a stain.

## Why the whole page is set in one monospace

Every figure on this page is a reading: T1.86, 1.5 µm, 0.45 m, 300°, 0.8 module.
Fixed-pitch figures are what a measuring instrument prints, so the spec strip
reads as a datasheet rather than as marketing. Martian Mono carries a `wdth`
axis from 75 to 112.5, which is enough contrast to run drawn-in technical labels
against a full-width display cut without introducing a second family.

Three things do not carry over from a proportional face, and all three bit:

- **Fixed pitch is more legible small, not less.** Every glyph sits in its own
  cell, so there are no tight pairs to collapse. The first pass dropped the
  micro labels to 8px on the assumption that mono needed the room; the metrics
  strip has 270px per column for a 19-character label. They went back to 9px.
- **Display sizes need the tracking pulled hard** (-0.075em on the headline) and
  the leading opened up. Mono sets loose horizontally and tight vertically,
  which is the opposite of what a display line wants.
- **Growing a reveal mask leaks the hidden state.** Adding descender padding to
  `.line` made the mask taller than the inner box, but the hidden position was
  still `translateY(105%)` of the *inner* box — so the tops of the glyphs sat
  inside the taller mask and showed. Every masked headline on the page was
  leaking a sliver; it only became visible once two cards shared a cell. The
  hidden offset has to clear the mask, not the text: `--mask-hide: 128%`, where
  the worst case across the display sizes works out at 123%.
- **A reveal mask eats descenders.** Display lines run a line-height under 1,
  so the em box is shorter than the glyphs, and the `overflow: hidden` that
  makes a masked slide-up work will guillotine the tail of a p or a g. Grow the
  mask past the line box by the measured descender depth and take the same
  amount straight back in negative margin: the clip clears the tail and the
  vertical rhythm never moves.
- **Equal-width buttons without stretching them.** `display: grid` with
  `grid-template-columns: repeat(2, 1fr)` on a container at `width: max-content`
  resolves both columns to the wider item's max-content. Flexbox cannot do this
  without hard-coding a width.
- **Fit the ink, not the advances.** See below.

The 3D layer is set in the same face: the focus and T-stop scales engraved on
the barrel, and the wordmark. A canvas 2D context reaches a variable width axis
through `ctx.fontStretch` rather than `font-variation-settings`, and the CSS
keywords `condensed` and `semi-expanded` land exactly on 75 and 112.5.

## Things worth stealing

- **Absolute, never incremental.** Every scroll-driven value is a pure function
  of scroll position. Scrub back and the lens reassembles bit-for-bit; reload
  halfway down and it is already correct. Verified: reversibility drift is
  exactly 0.
- **Growing a reveal mask leaks the hidden state.** Adding descender padding to
  `.line` made the mask taller than the inner box, but the hidden position was
  still `translateY(105%)` of the *inner* box — so the tops of the glyphs sat
  inside the taller mask and showed. Every masked headline on the page was
  leaking a sliver; it only became visible once two cards shared a cell. The
  hidden offset has to clear the mask, not the text: `--mask-hide: 128%`, where
  the worst case across the display sizes works out at 123%.
- **A reveal mask eats descenders.** Display lines run a line-height under 1,
  so the em box is shorter than the glyphs, and the `overflow: hidden` that
  makes a masked slide-up work will guillotine the tail of a p or a g. Grow the
  mask past the line box by the measured descender depth and take the same
  amount straight back in negative margin: the clip clears the tail and the
  vertical rhythm never moves.
- **Equal-width buttons without stretching them.** `display: grid` with
  `grid-template-columns: repeat(2, 1fr)` on a container at `width: max-content`
  resolves both columns to the wider item's max-content. Flexbox cannot do this
  without hard-coding a width.
- **Fit the ink, not the advances.** A monospace pads every glyph out to a
  fixed cell, so the first and last letters of a word carry a sidebearing that
  belongs to the metrics rather than to the word. Fitting the advance run left
  the wordmark at 79% of the frame while nominally asking for 96%. Measuring
  the real ink box with `actualBoundingBoxLeft`/`Right` and trimming those two
  bearings is what makes it reach the edges. Same argument vertically:
  `textBaseline: 'middle'` centres the em box, which in an all-caps word leaves
  the caps high by the depth of an unused descender — place the baseline from
  the measured ascent and descent instead.
- **A canvas is not a stylesheet.** Canvas 2D silently substitutes a fallback
  for a webfont that has not downloaded yet, and anything you measured from it
  caches the wrong metrics. Every canvas here is built at module load, long
  before the face lands, so each registers a redraw against
  `document.fonts.load(...)`. The wordmark also drops its cached layout so it
  re-measures rather than re-rendering against fallback numbers.
- **Pass the distance you actually mean.** The backdrop plane is sized from the
  frustum at its own depth. The camera sits at `centre + dir·dist` and the plane
  at `centre − dir·back`, so the camera-to-plane distance is `dist + back` — not
  `back`. Handing it `back` solved the frustum at 64% of the true distance and
  quietly shrank the wordmark to 84% of the frame while the code read as though
  it were asking for 134%.
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
- **A lens shows you the room, not its own inside.** Looking into the assembled
  stack was reading as concentric "onion rings" because the element rims and the
  barrel bore were catching enough environment light to be visible through the
  glass. The fix is not less transmission, which turns the element into a pale
  disc; it is making the cavity behind the glass an actual light trap
  (`envMapIntensity` 0.08–0.12, roughness 1, near-black) so full transmission
  shows darkness, and letting the reflection sit on top of it.
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
