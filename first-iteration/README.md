# NODAL, first iteration

The state of the page at **2026-08-21 18:46 UTC**, the moment before the
creative-director pass. This is the version Sam reviewed and called "an above
average first iteration, nice concept."

Reconstructed from the session transcript, not from a backup: this folder was
never under version control, so every `Write`, `sed`, `cat >>` and inline patch
recorded before that timestamp was replayed in order into a scratch directory.
`src/conductor.js` is the exception, copied from `Random Demos/axial` at the
time and never edited since, so the current file is the original.

Open `index.html` through a local server, not `file://` (it uses ES modules).

## What it looked like

| | First iteration | Shipped |
|---|---|---|
| Headline | "Nothing in here is straight. Not even the light." | "Wide open." |
| Typeface | Instrument Serif + IBM Plex | Martian Mono throughout |
| Accent | Cyan `#5BC8E8` | Coating blue `#8cb0db`, sampled from the glass |
| Ground | One near-black plate | Black and warm paper, the object relit per plate |
| Concept | An optical design document | A product page |

## What did not change

`src/optics.js` is **byte-for-byte identical** to the shipped version. The
prescription, the ray tracer and the solvers were right in the first pass and
were never touched again. Everything after this point was presentation.

`src/conductor.js` is likewise unchanged.

## What grew

| file | then | now |
|---|---|---|
| `styles.css` | 16 KB | 59 KB |
| `src/main.js` | 26 KB | 78 KB |
| `src/lens3d.js` | 30 KB | 43 KB |
| `index.html` | 10 KB | 17 KB |

The three files that tripled are the ones carrying design decisions. The two
that carry the physics did not move at all.
