# Third-party code

Both libraries are vendored in `vendor/` rather than installed with a package
manager. That is what lets this project run with no build step, and it means
their licences have to travel with the repo.

| library | version | licence | source |
|---|---|---|---|
| three.js | r185 | MIT, Copyright (c) 2010-2026 three.js authors | https://github.com/mrdoob/three.js |
| Lenis | 1.3.26 | MIT, Copyright (c) 2024 darkroom.engineering | https://github.com/darkroomengineering/lenis |

`vendor/three.module.js` and `vendor/three.core.js` carry their own `@license`
header. The Lenis dist build does not ship one, so its notice is reproduced
here instead. Both are MIT:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Martian Mono is loaded from Google Fonts and is not redistributed here. It is
licensed under the SIL Open Font License 1.1.

The three sample photographs in `frames/` are **not** covered by the project
licence and are not cleared for reuse. Swap in your own before publishing a
fork, or delete them, the page falls back to a generated placeholder on its
own. See `frames/README.md`.

Everything else is MIT, see [LICENSE](LICENSE).
