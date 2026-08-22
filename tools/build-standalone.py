#!/usr/bin/env python3
"""
Fold the whole site into one double-clickable HTML file.

The obstacle is `file://`. A browser refuses to fetch an ES module over that
protocol, so anything that keeps `import` statements alive will fail the moment
you open the file from the desktop rather than a server. Blob URLs are the usual
dodge and they are not dependable enough to ship.

So this removes modules altogether. Every file is rewritten into an IIFE that
returns its exports, and imports become plain lookups on a registry object. The
result is one classic <script>, which every browser has always run from file://.
It is only safe because this codebase has a simple module surface: no
`export default`, no `export *`, no dynamic import, and no top-level await
(every `await` here sits inside an async function). Check those before trusting
it on another project.

Font and stylesheet are inlined as data URIs. The photographs are NOT: they are
pulled from jsDelivr off Sam1983Aing/aura-assets, pinned to a tag, which is the
same arrangement as vesna-hosted.html. That keeps the file about 1.3 MB lighter
and means a new frame is a repo push rather than a rebuild.

It degrades sensibly without a network: the <img> error handler hides a frame
that fails to load and the generated placeholder behind it shows through, so the
panel still says something useful offline.

    python3 tools/build-standalone.py            -> nodal-standalone.html
    python3 tools/build-standalone.py --strip    -> nodal-standalone-clean.html

`--strip` removes every comment from the JS, CSS and markup. License headers
survive: three.js is MIT and the notice has to travel with the code.
"""
import base64, pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from strip_comments import strip_js, strip_css, strip_html, collapse_blank_lines

STRIP = '--strip' in sys.argv

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT  = ROOT / ('nodal-standalone-clean.html' if STRIP else 'nodal-standalone.html')
FONT = pathlib.Path('/tmp/mm-latin.woff2')

# Bump the tag after pushing new frames to the assets repo. Pinning to a tag
# rather than a branch means a later push cannot silently change this file.
ASSETS = 'https://cdn.jsdelivr.net/gh/Sam1983Aing/aura-assets@1.3.0/nodal'

# name -> (path, {specifier as written in source: registry key})
MODULES = [
    ('core',      'vendor/three.core.js',   {}),
    ('three',     'vendor/three.module.js', {'./three.core.js': 'core'}),
    ('lenis',     'vendor/lenis.mjs',       {}),
    ('conductor', 'src/conductor.js',       {}),
    ('optics',    'src/optics.js',          {}),
    ('lens3d',    'src/lens3d.js',          {'../vendor/three.module.js': 'three',
                                             './optics.js': 'optics'}),
    ('main',      'src/main.js',            {'../vendor/three.module.js': 'three',
                                             '../vendor/lenis.mjs': 'lenis',
                                             './conductor.js': 'conductor',
                                             './optics.js': 'optics',
                                             './lens3d.js': 'lens3d'}),
]

IMPORT = re.compile(r"^import\s+([^;]*?)\bfrom\s+'([^']+)'[ \t]*;?[ \t]*$", re.M)
# `export { ... } from './x.js'` — a re-export. Must be tried BEFORE the plain
# block form, and the brace class must exclude braces so it cannot run past the
# end of the statement: with `[\s\S]*?` plus `\s*` it happily crossed sixteen
# lines and ate the top of three.module.js.
REEXPORT = re.compile(r"^export\s*\{([^{}]*)\}\s*from\s+'([^']+)'[ \t]*;?[ \t]*$", re.M)
EXPORT_BLOCK = re.compile(r"^export\s*\{([^{}]*)\}[ \t]*;?[ \t]*$", re.M)
EXPORT_DECL = re.compile(r"^export\s+(const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)", re.M)

def transform(src, deps, name):
    exports = {}          # exported name -> local name

    def do_import(m):
        clause, spec = m.group(1).strip(), m.group(2)
        if spec not in deps:
            sys.exit(f'{name}: unmapped import specifier {spec!r}')
        reg = f'__m["{deps[spec]}"]'
        if clause.startswith('*'):                       # import * as NS
            return f'const {clause.split(" as ")[1].strip()} = {reg};'
        if clause.startswith('{'):                       # import { a, b as c }
            inner = clause.strip('{} \n')
            parts = []
            for piece in (p.strip() for p in inner.split(',') if p.strip()):
                if ' as ' in piece:
                    a, b = (x.strip() for x in piece.split(' as '))
                    parts.append(f'{a}: {b}')
                else:
                    parts.append(piece)
            return 'const { ' + ', '.join(parts) + f' }} = {reg};'
        return f'const {clause} = {reg}["default"];'     # import Default

    src = IMPORT.sub(do_import, src)

    def do_reexport(m):
        spec = m.group(2)
        if spec not in deps:
            sys.exit(f'{name}: unmapped re-export specifier {spec!r}')
        for piece in (p.strip() for p in m.group(1).split(',') if p.strip()):
            local, ext = (x.strip() for x in piece.split(' as ')) if ' as ' in piece else (piece, piece)
            exports[ext] = f'__m["{deps[spec]}"]["{local}"]'
        return ''
    src = REEXPORT.sub(do_reexport, src)

    def do_export_block(m):
        for piece in (p.strip() for p in m.group(1).split(',') if p.strip()):
            if ' as ' in piece:
                local, ext = (x.strip() for x in piece.split(' as '))
            else:
                local = ext = piece
            exports[ext] = local
        return ''
    src = EXPORT_BLOCK.sub(do_export_block, src)

    for m in EXPORT_DECL.finditer(src):
        exports[m.group(2)] = m.group(2)
    src = EXPORT_DECL.sub(lambda m: f'{m.group(1)} {m.group(2)}', src)

    ret = 'return { ' + ', '.join(f'"{k}": {v}' for k, v in sorted(exports.items())) + ' };'
    return f'__m["{name}"] = (function () {{\n"use strict";\n{src}\n{ret}\n}})();'

def b64(path, mime):
    p = path if isinstance(path, pathlib.Path) else ROOT / path
    return f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode('ascii')

# ---------------------------------------------------------------- assets ----
if not FONT.exists():
    sys.exit(f'missing {FONT}: fetch the Martian Mono latin woff2 first')
font_css = ("@font-face{font-family:'Martian Mono';font-style:normal;"
            "font-weight:100 800;font-stretch:75% 112.5%;font-display:swap;"
            f"src:url({b64(FONT, 'font/woff2')}) format('woff2');}}")
frames = {mm: f'{ASSETS}/{mm}mm.jpg' for mm in (25, 40, 75)}

# ------------------------------------------------------------------ code ----
bundle = ['var __m = {};']
for name, path, deps in MODULES:
    src = (ROOT / path).read_text(encoding='utf-8')
    if name == 'main':   # the photographs are inline now, not files on disk
        src = src.replace('src="frames/${d.mm}mm.jpg"', 'src="${__FRAMES[d.mm]}"')
    bundle.append(transform(src, deps, name))
code = '\n'.join(bundle)
if STRIP:
    code = collapse_blank_lines(strip_js(code))

# `</script` is only ever inside a string or comment in JS, and `<\/script`
# parses identically, so this can never change behaviour.
code = code.replace('</script', r'<\/script')

# ------------------------------------------------------------------ html ----
html = (ROOT / 'index.html').read_text(encoding='utf-8')
css  = (ROOT / 'styles.css').read_text(encoding='utf-8')
html = re.sub(r'\n<link rel="preconnect"[^>]*>', '', html)
html = re.sub(r'\n<link href="https://fonts\.googleapis[^>]*>', '', html)
if STRIP:
    html, css = strip_html(html), collapse_blank_lines(strip_css(css))
html = html.replace('<link rel="stylesheet" href="styles.css">',
                    f'<style>{font_css}\n{css}</style>')
html = re.sub(r'<script type="importmap">.*?</script>', '', html, flags=re.S)
html = html.replace('<script type="module" src="./src/main.js"></script>', '')

frames_js = 'var __FRAMES = {' + ','.join(f'"{k}":"{v}"' for k, v in frames.items()) + '};'
html = html.replace('</body>', f'<script>\n{frames_js}\n{code}\n</script>\n</body>')

OUT.write_text(html, encoding='utf-8')
print(f'{OUT.name}  {OUT.stat().st_size/1024/1024:.2f} MB'
      + ('  (comments stripped)' if STRIP else ''))
