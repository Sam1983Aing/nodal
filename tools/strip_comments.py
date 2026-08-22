"""
Comment stripping that is aware of what it is reading.

A regex cannot do this safely. `//` appears inside URLs, `/*` appears inside
shader source held in template literals, and `/` is division as often as it is
the start of a regex literal. So this walks the text as a state machine and only
removes a comment when it is genuinely in code.

License headers are kept deliberately. three.js is MIT and the notice has to
travel with it, so any block comment carrying `@license`, `Copyright` or the
`/*!` marker survives.
"""

# Slash after one of these is a regex literal, not division.
KEYWORDS_BEFORE_REGEX = {
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'case', 'do', 'else', 'yield', 'await',
}

def _is_license(body: str) -> bool:
    return '@license' in body or 'Copyright' in body or body.startswith('!')


def strip_js(src: str) -> str:
    out = []
    i, n = 0, len(src)
    # Stack of template-literal depths, so `${ `nested` }` is tracked correctly.
    tpl_stack = []
    brace_depth = 0

    def last_significant():
        """Last non-space character already emitted, plus the identifier it
        ends, so `return /x/` is not mistaken for division."""
        j = len(out) - 1
        while j >= 0 and out[j].isspace():
            j -= 1
        if j < 0:
            return '', ''
        ch = out[j]
        word = ''
        if ch.isalnum() or ch in '_$':
            k = j
            while k >= 0 and (out[k].isalnum() or out[k] in '_$'):
                k -= 1
            word = ''.join(out[k + 1:j + 1])
        return ch, word

    while i < n:
        c = src[i]

        # inside a template literal
        if tpl_stack and tpl_stack[-1] == 'tpl':
            if c == '\\':
                out.append(src[i:i + 2]); i += 2; continue
            if c == '`':
                tpl_stack.pop(); out.append(c); i += 1; continue
            if c == '$' and i + 1 < n and src[i + 1] == '{':
                tpl_stack.append('expr'); out.append('${'); i += 2; continue
            out.append(c); i += 1; continue

        if c in '"\'':
            quote = c
            out.append(c); i += 1
            while i < n:
                if src[i] == '\\':
                    out.append(src[i:i + 2]); i += 2; continue
                out.append(src[i])
                if src[i] == quote:
                    i += 1; break
                i += 1
            continue

        if c == '`':
            tpl_stack.append('tpl'); out.append(c); i += 1; continue

        if c == '}' and tpl_stack and tpl_stack[-1] == 'expr':
            tpl_stack.pop(); out.append(c); i += 1; continue

        if c == '/' and i + 1 < n:
            nxt = src[i + 1]
            if nxt == '/':
                while i < n and src[i] != '\n':
                    i += 1
                continue                                  # keep the newline
            if nxt == '*':
                end = src.find('*/', i + 2)
                end = n if end == -1 else end + 2
                body = src[i + 2:end - 2]
                if _is_license(body):
                    out.append(src[i:end])
                else:
                    # A block comment can span lines; preserve them so line
                    # numbers in any later stack trace still mean something.
                    out.append('\n' * src.count('\n', i, end))
                i = end
                continue
            # regex literal or division?
            ch, word = last_significant()
            regex_ok = (
                ch == '' or
                (not (ch.isalnum() or ch in '_$)]}')) or
                word in KEYWORDS_BEFORE_REGEX
            )
            if regex_ok:
                out.append(c); i += 1
                in_class = False
                while i < n:
                    if src[i] == '\\':
                        out.append(src[i:i + 2]); i += 2; continue
                    if src[i] == '[':
                        in_class = True
                    elif src[i] == ']':
                        in_class = False
                    elif src[i] == '/' and not in_class:
                        out.append(src[i]); i += 1; break
                    elif src[i] == '\n':
                        break                       # not a regex after all
                    out.append(src[i]); i += 1
                continue

        out.append(c); i += 1

    return ''.join(out)


def strip_css(src: str) -> str:
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in '"\'':
            quote = c
            out.append(c); i += 1
            while i < n:
                if src[i] == '\\':
                    out.append(src[i:i + 2]); i += 2; continue
                out.append(src[i])
                if src[i] == quote:
                    i += 1; break
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            end = src.find('*/', i + 2)
            end = n if end == -1 else end + 2
            if _is_license(src[i + 2:end - 2]):
                out.append(src[i:end])
            i = end
            continue
        out.append(c); i += 1
    return ''.join(out)


def strip_html(src: str) -> str:
    """Only the markup. Conditional comments and the doctype are left alone."""
    out = []
    i, n = 0, len(src)
    while i < n:
        if src.startswith('<!--', i) and not src.startswith('<!--[', i):
            end = src.find('-->', i + 4)
            i = n if end == -1 else end + 3
            continue
        out.append(src[i]); i += 1
    return ''.join(out)


def collapse_blank_lines(src: str) -> str:
    lines = src.split('\n')
    kept, blanks = [], 0
    for ln in lines:
        if ln.strip():
            kept.append(ln.rstrip()); blanks = 0
        else:
            blanks += 1
            if blanks == 1:
                kept.append('')
    return '\n'.join(kept)
