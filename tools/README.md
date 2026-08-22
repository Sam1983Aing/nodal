# tools

## build-standalone.py

Folds the whole site into one double-clickable `nodal-standalone.html` at the
repo root. Run it again after any change to the source:

```bash
python3 tools/build-standalone.py
```

It needs the Martian Mono latin `woff2` at `/tmp/mm-latin.woff2`. Fetch it with:

```bash
curl -sS "https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75..112.5,100..800&display=swap" -o /tmp/mm.css
curl -sS "$(grep -o 'https://[^)]*woff2' /tmp/mm.css | tail -1)" -o /tmp/mm-latin.woff2
```

### Why it does not just paste the files together

`file://` refuses to fetch ES modules, so anything that leaves an `import`
statement alive breaks the moment the file is opened from the desktop instead of
a server. Blob URLs are the usual workaround and are not dependable enough to
ship.

So the build removes modules entirely: each file becomes an IIFE that returns
its exports, and imports become lookups on a registry object. The output is one
classic `<script>`, which every browser has always run from `file://`.

That is only safe because this codebase has a simple module surface. Before
reusing this on another project, check it has:

- no `export default` (this one uses `export { X as default }`, handled)
- no `export *`
- no dynamic `import()`
- no top-level `await` (every `await` here is inside an async function)

### The trap worth remembering

`export { A, B } from './x.js'` is a **re-export**, not a plain export block,
and it must be matched first. Also, a regex ending `\}\s*;?$` will happily cross
newlines and swallow the rest of the file: `three.module.js` opens with a 4,035
character re-export on line 7, and a sloppy pattern ate sixteen lines after it.
Use `[^{}]*` inside the braces and `[ \t]*` outside.

## strip_comments.py

`build-standalone.py --strip` writes `nodal-standalone-clean.html` with every
comment removed. 2.31 MB down to 1.45 MB, about 37% smaller.

A regex cannot do this safely, so `strip_comments.py` walks the text as a state
machine. The cases that break naive strippers, all covered by tests at the top
of the module:

| input | why it is hard |
|---|---|
| `"https://x.com//path"` | `//` inside a string |
| `` `\n// not a comment` `` | shader source in a template literal |
| `x.replace(/a\/b/g, "")` | escaped slash in a regex literal |
| `return /ab+c/.test(s)` | regex after a keyword, not division |
| `a / b / c` | actual division |
| `var re = /[/]/` | slash inside a character class |

Two deliberate exceptions:

- **License headers survive.** Any block comment carrying `@license`,
  `Copyright` or the `/*!` marker is kept. three.js is MIT and the notice has to
  travel with the code.
- **GLSL comments survive.** Roughly twenty `//` lines remain in the output.
  They are shader source held inside template literals, so they are string
  contents rather than JavaScript comments. Removing them would mean editing
  string data, which is a different and riskier job for no real gain.

Verify after any change to the stripper: `node --check` the emitted bundle, then
load it and confirm the triangle count, draw calls, spec figures and
reversibility drift match the unstripped build exactly.
