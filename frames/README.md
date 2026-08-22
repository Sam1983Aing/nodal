# Sample frames

Drop a photograph here for each focal length and it takes over the hover panel
in chapter 05 automatically, no code change.

| File | Aspect | Notes |
|---|---|---|
| `25mm.jpg` | 3:2 | shown when hovering row 01 |
| `40mm.jpg` | 3:2 | row 02 |
| `75mm.jpg` | 3:2 | row 03 |

The panel is `object-fit: cover`, so anything close to 3:2 works; it crops from
the centre. At a 1500px viewport the box renders about **705 × 470**, so
1600 × 1067 or larger keeps it sharp on a 2x display.

All three are in place at 1536 x 1024, which is exactly 3:2, so `object-fit:
cover` crops nothing.

Until a file exists, the panel falls back to a generated placeholder: the frame
that lens actually gives at two metres, drawn to scale over a 1.70m figure. The
`<img>` hides itself on error, so a missing file costs nothing.

The three supplied frames hold the subject, the location and the light constant
and change only the focal length, which is the one comparison that makes a
matched set legible. Replacing them with three unrelated scenes would break
that, however good each one looked on its own.

## Hosted copies

The same three files also live in `Sam1983Aing/aura-assets` under `nodal/`, and
are served through jsDelivr:

    https://cdn.jsdelivr.net/gh/Sam1983Aing/aura-assets@1.3.0/nodal/25mm.jpg

`nodal-standalone.html` uses those rather than inlining them, which keeps that
file about 1.3 MB smaller. The local site keeps using the copies in this folder.

If you replace a frame: push the new file to the assets repo, tag it, and bump
`ASSETS` in `tools/build-standalone.py`. The URL is pinned to a tag on purpose,
so a later push to the assets repo cannot silently change a standalone file that
is already out in the world.
