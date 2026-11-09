#!/usr/bin/env python3
"""Extract M7W defaults from Driver 500.1.101 and rectangles from Driver v4.

Usage: python3 tools/extract-m7w-layout.py /path/to/main_b8c599f5.js /path/to/v4/dist/js
The script parses data literals; it does not execute either vendor application.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
old_js = Path(sys.argv[1])
old = old_js.read_text()
js = Path(sys.argv[2])
index = (js / 'index.1970d80c.js').read_text()
classes = (js / 'b7c9f14f.js').read_text()
svg = (js / '64837d43.js').read_text()
assert 'case"yc500_m7wnosled_soc":return new pLt(e)' in old
old_class = old[old.index('pLt=function(e)'):][:1200]
assert 'a=gPt' in old_class and '}(bHe)' in old_class
assert 'id:1215,vid:12625,pid:16405,keyLayout:h.Common68_MK902_2,name:"yc500_m7wnosled_soc"' in index
assert 'case h.Common68_MK902_2:return e(t1)' in index
body = classes[classes.index('class z extends s{'):]
assert 'case"yc500_m7wnosled_soc":return new z(a)' in body

def array(name):
    match = re.search(name + r'=\[([0-9,]+)\]', body)
    if not match:
        raise ValueError(f'missing {name}')
    values = [int(x) for x in match.group(1).split(',')]
    assert len(values) == 512
    return values

v4_matrix, fn = array('defaultMatrix'), array('defaultFnMatrix')
# The older driver's own M7W class supplies this 68-key matrix. It also matches
# the real 1215 / 1.00 device; v4 assigns this model a different default matrix.
literal = re.search(r'(?<!\w)gPt=\[([0-9,]+)\]', old)
assert literal
matrix = [int(x) for x in literal.group(1).split(',')]
assert len(matrix) == 512
# The v4 Fn literal is retained as mock data only. M7W's runtime Fn labels
# come from the keyboard, not this unrelated v4 default table.
assert sum(a != b for a, b in zip(matrix, v4_matrix)) == 37
# Match every physical key against the older driver's M7W layout as well as
# the v4 picture; the records are not inferred from an unrelated model.
old_layout = re.search(r'\bBg=\{deltX:0,deltY:0,layout:\[(.*?)\]\}', old)
assert old_layout
entry = r'\{keyName:"((?:\\.|[^"\\])*)",value:(\d+),x:[\d.-]+,y:[\d.-]+,w:[\d.]+,h:[\d.]+\}'
old_keys = {}
for match in re.finditer(entry, old_layout.group(1)):
    name, value = json.loads('"' + match.group(1) + '"'), int(match.group(2))
    assert name not in old_keys
    old_keys[name] = [0, 0, value, 0] if value < 256 else list(value.to_bytes(4, 'big'))
assert len(old_keys) == 68
layout_names = json.loads('[' + re.search(r'\bt1=\[([^]]+)\]', index).group(1) + ']')
assert len(layout_names) == 68 and len(set(layout_names)) == 68
rectangles = {}
pattern = r'<g id="#([^"<]+)">\s*<g[^>]*>\s*<rect\s+([^>]+)>'
for match in re.finditer(pattern, svg):
    name = match.group(1)
    if name not in rectangles:
        rectangles[name] = {key: float(value) for key, value in re.findall(r'\b(x|y|width|height)="([^"]+)"', match.group(2))}
assert set(layout_names) <= rectangles.keys()

symbols = {
    'Escape': ('Esc', 41), 'Backspace': ('BackSpace', 42), 'Tab': ('Tab', 43),
    'CapsLock': ('Caps Lock', 57), 'Enter': ('Enter', 40), 'ShiftLeft': ('Shift', 225),
    'ShiftRight': ('r_Shift', 229), 'ControlLeft': ('Ctrl', 224), 'ControlRight': ('r_Ctrl', 228),
    'MetaLeft': ('Win', 227), 'AltLeft': ('Alt', 226), 'AltRight': ('r_Alt', 230),
    'Space': ('(space)', 44), 'Fn': ('FN', [10, 1, 0, 0]), 'Backslash': ('\\', 49),
    'Minus': ('-', 45), 'Equal': ('=', 46), 'BracketLeft': ('[', 47), 'BracketRight': (']', 48),
    'Semicolon': (';', 51), 'Quote': ("'", 52), 'Comma': (',', 54), 'Period': ('.', 55),
    'Slash': ('/', 56), 'Insert': ('Insert', 73), 'Delete': ('Delete', 76),
    'PageUp': ('Page\nUp', 75), 'PageDown': ('Page\nDown', 78),
    'ArrowLeft': ('←', 80), 'ArrowRight': ('→', 79), 'ArrowDown': ('↓', 81), 'ArrowUp': ('↑', 82),
}
for number in range(10):
    symbols[f'Digit{number}'] = (str(number), 39 if number == 0 else 29 + number)
for n in range(26):
    symbols[f'Key{chr(65+n)}'] = (chr(65+n), 4+n)

keys = []
for code in layout_names:
    name, raw = symbols[code]
    record = raw if isinstance(raw, list) else [0, 0, raw, 0]
    assert old_keys.get(name) == record, (code, name, record, old_keys.get(name))
    matches = [i // 4 for i in range(0, 504, 4) if matrix[i:i+4] == record]
    assert len(matches) == 1, (code, record, matches)
    key_index = matches[0]
    expected = {'Escape': 1, 'Insert': 85, 'Delete': 86, 'PageUp': 87, 'PageDown': 88}
    if code in expected:
        assert key_index == expected[code]
    r = rectangles[code]
    scale = .76
    # Normalize the vendor's SVG rectangles into the existing 638×288 canvas.
    left, top = 18 + r['x'] * scale, 52 + r['y'] * scale
    keys.append({'name': name, 'index': key_index, 'record': record,
                 'x': round(left + 121, 2), 'y': round(-top - 2, 2),
                 'width': round(r['width'] * scale - 10, 2),
                 'height': round(r['height'] * scale - 4, 2)})
keys.sort(key=lambda k: (-k['y'], k['x']))
output = {'model': 'yc500_m7wnosled_soc', 'vendorID': 0x3151, 'productID': 0x4015,
          'keys': keys, 'defaultMatrix': matrix, 'defaultFnMatrix': fn}
out = Path(__file__).resolve().parent.parent / 'src/lib/assets/m7w.json'
out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
print(old_js.name, hashlib.sha256(old_js.read_bytes()).hexdigest())
for name in ['index.1970d80c.js', 'b7c9f14f.js', '64837d43.js']:
    print(name, hashlib.sha256((js / name).read_bytes()).hexdigest())
print(f'Wrote {len(keys)} keys to {out}; defaults and all key records match the older M7W driver')
