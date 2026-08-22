# NODAL, second iteration

The state of the page at **2026-08-21 20:57 UTC**, the moment before Sam said
"I don't like the front face, it doesn't look premium." This is the version in
his screenshot: front-on hero, amber accent, Archivo throughout.

Reconstructed from the session transcript, the same way as `first-iteration/`.
Every `Write`, `Edit` and shell patch recorded before that timestamp was
replayed in order. Both project paths were normalised, since the folder moved
from `Random Demos/nodal` to `005 3D Model` at 20:21 UTC, part-way through the
window. 87 operations applied with zero edit misses.

Open `index.html` through a local server, not `file://` (it uses ES modules).

## Where this sits

This is one step after the creative-director pass, not the original build.

| | First iteration | **Second (this)** | Shipped |
|---|---|---|---|
| Headline | "Nothing in here is straight." | **"Nothing here is decorative."** | "Wide open." |
| Typeface | Instrument Serif + IBM Plex | **Archivo** | Martian Mono |
| Accent | Cyan `#5BC8E8` | **Amber `#ff9a3c`** | Blue `#8cb0db` |
| Hero camera | Three-quarter | **Dead-on front, `frame: 'face'`** | Three-quarter |
| Concept | Optical design document | Optical design document | Product page |

## Why the front face was abandoned

It was tried three times and dropped. The diagnosis: framing tight on the front
element excludes every part of the object that reads as expensive, which is all
manufactured detail (the knurled focus ring, the engraved scale, the machined
bezel, the anodised barrel). It leaves a procedural glass material carrying the
entire frame on its own, and it cannot. Turning the object far enough to see the
barrel receding behind the front element buys that detail back while still
leading with the glass.

That note now lives permanently in the `CHAPTERS` ledger in `src/main.js`, above
the hero row, so the idea is not retried a fourth time.

## Still unchanged

`src/optics.js` and `src/conductor.js` are byte-identical to both the first
iteration and the shipped build. Same 40.0mm T1.86, same 216k triangles across
all three versions.
