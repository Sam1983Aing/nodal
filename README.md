# NODAL

A scroll-driven landing page for a cine prime lens, where the lens is not a
model file. There is no GLB, no OBJ, nothing exported from Blender. The object
you scroll through is generated at runtime from an 18-row optical prescription,
the same kind of table a lens designer actually writes.

**[Live demo](https://sam1983aing.github.io/nodal/)**

Vanilla JavaScript, three.js and Lenis. No build step, no bundler, no
`node_modules`. Clone it and open it.

---

## Why this is not just another 3D landing page

Most WebGL product pages load a model an artist made. This one derives the
object from physics, and that changes what the page can do.

Every glass surface has a real radius of curvature. The material's index of
refraction is the real index of the real glass type. The light path in chapter
04 is an actual meridional ray trace, refracted by Snell's law at every sphere
it meets, not an illustration of one. The design is validated: a 10 degree
field lands at 7.04mm, which is exactly `40 * tan(10)`.

Three consequences fall out of that, and they are the reason the page works:

**It comes apart properly.** The exploded view is not an animation of pieces
flying away. There genuinely are ten separate elements in eight groups, because
the table says so, so they can be separated and inspected individually.

**Nothing can contradict anything.** Every number printed on the page is
computed from the same table that produced the geometry. The angle of view in
the focal-length panel is derived from the image circle, which is why it reports
exactly the 31.0 degrees the spec strip prints. They cannot disagree, because
they are the same calculation.

**Change one number and the whole thing rebuilds.** Edit a radius in
`src/optics.js` and the glass relathes, the barrel refits around it, the ray
trace re-solves, and the copy updates.

## Run it

It uses ES modules, so it needs a server rather than `file://`:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

If you want a single file you can double-click, see
[Standalone builds](#standalone-builds) below.

## How it is put together

Four layers, stacking in one direction. Nothing points back up.

```
main.js  ->  lens3d.js  ->  optics.js  ->  conductor.js
```

| file | lines | what it does |
|---|---|---|
| `src/conductor.js` | 140 | Turns `scrollY` into one number: position along the route. Knows nothing about lenses. |
| `src/optics.js` | 618 | The physics. The prescription, the ray tracer, the solvers. No three.js, no rendering. Runs in Node. |
| `src/lens3d.js` | 1090 | Numbers into geometry. Lathes the glass, fits the barrel, builds the iris, rays, blueprint and lighting. |
| `src/main.js` | 1649 | The choreography. Camera ledger, phase windows, render loop, all DOM wiring. |

### The two ideas worth stealing

**Absolute, never incremental.** Every scroll-driven value is a pure function of
scroll position. Nothing accumulates, nothing is "undone". Scroll back up and
the lens reassembles bit for bit. This is tested on every change by sampling 61
positions going down, then the same 61 going up, and requiring the difference to
be exactly zero.

**A chapter states what it wants to see, never where the camera is.**

```js
{ id: 'explode', dir: [-1, 0.09, 0], fov: 26, pad: 1.14,
  frame: 'glass', shift: 0, lift: -0.02, ease: 'glide', hold: 0.58 }
```

Read that as: look from this direction, at this focal length, framing the glass,
with this much air around it, pushed this far across the frame. The camera then
solves its own distance every frame by fitting the object's real bounding box to
the real window. That is why it reframes correctly when the lens explodes to
three times its length, and why it works at any window size with no tuning.

## Customising it

| what | where |
|---|---|
| The lens itself | `RAW_SURFACES` in `src/optics.js`. Everything downstream follows. |
| Camera choreography | The `CHAPTERS` ledger in `src/main.js` |
| When things happen | `phases()` in `src/main.js`, overlapping smoothstep windows |
| Palette | `PLATE_BLACK` and `PLATE_PAPER` in `src/main.js` |
| Type | The `--sans`, `--wide`, `--semi`, `--tech`, `--read` tokens in `styles.css` |
| Sample photographs | `frames/`, see the note in that folder |

`NOTES.md` is the long version: an engineering journal of every non-obvious
decision, and more usefully every trap, with the measurement that caught it.

## Standalone builds

`tools/build-standalone.py` folds the whole site into one HTML file you can
double-click.

```bash
python3 tools/build-standalone.py           # 2.3 MB
python3 tools/build-standalone.py --strip   # 1.5 MB, comments removed
```

The interesting constraint is that `file://` refuses to fetch ES modules, so the
build cannot simply concatenate the sources. It rewrites every module into an
IIFE and turns imports into registry lookups, producing one classic script.
`tools/README.md` explains the preconditions that makes safe, and the two regex
traps that cost an hour.

## Earlier iterations

Two earlier states of the page are preserved, reconstructed from the build
transcript, both runnable:

- `first-iteration/` at the point it first worked. Instrument Serif, cyan
  accent, "Nothing in here is straight."
- `second-iteration/` after the first design pass. Archivo, amber accent, a
  dead-on front hero that was later abandoned.

The comparison is the useful part. Between the first iteration and the shipped
version, `styles.css` went from 16 KB to 59 KB and `main.js` from 26 KB to 78
KB, while `src/optics.js` and `src/conductor.js` did not change by a single
byte. The physics was right in the first pass. Everything after that was
presentation.

## Notes before you reuse this

- **The prices are invented.** £14,500, £39,500 and the 14 week lead time in the
  closing section are placeholder figures. NODAL is not a real company.
- **The social links are `#`.** Deliberately, so they cannot point at a real
  stranger's account.
- The three photographs in `frames/` are also served from a CDN for the
  standalone build. See `frames/README.md`.

## Credits

- [three.js](https://threejs.org) r185, MIT
- [Lenis](https://github.com/darkroomengineering/lenis) 1.3.26, MIT
- [Martian Mono](https://fonts.google.com/specimen/Martian+Mono), OFL

Both libraries are vendored in `vendor/` rather than installed, which is what
lets the project run with no build step. Their licences are in `LICENSE`.

## Licence

MIT. See [LICENSE](LICENSE).
