#!/usr/bin/env python3
"""生成 PWA 图标（512/192）：磨砂石墨底 + 银白键盘 + 一颗琥珀 RGB 键。
纯标准库实现（zlib/struct），无第三方依赖。"""

import struct, sys, zlib

def rounded_rect_px(x, y, w, h, r):
    return 0 <= x < w and 0 <= y < h and (
        x < r or x >= w - r or y < r or y >= h - r
        or (r - x) ** 2 + (r - y) ** 2 <= r * r
        if (x < r and y < r) or (x >= w - r and y < r)
        or (x < r and y >= h - r) or (x >= w - r and y >= h - r)
        else True
    )

def in_rect(x, y, x0, y0, x1, y1):
    return x0 <= x < x1 and y0 <= y < y1

def in_rounded(x, y, x0, y0, x1, y1, r):
    if not in_rect(x, y, x0, y0, x1, y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def in_ring(x, y, x0, y0, x1, y1, r, t):
    inner = in_rounded(x, y, x0 + t, y0 + t, x1 - t, y1 - t, max(r - t, 1))
    return in_rounded(x, y, x0, y0, x1, y1, r) and not inner

def render(size):
    bg = (19, 19, 22, 255)        # #131316
    border = (52, 52, 60, 255)    # #34343c
    body = (26, 26, 31, 255)      # #1a1a1f
    silver = (233, 234, 239, 255) # #e9eaef
    amber = (240, 161, 60, 255)   # #f0a13c
    rows = []
    R = size
    pad = size * 0.06
    # 键盘主体
    kx0, kx1 = size * 0.17, size * 0.83
    ky0, ky1 = size * 0.30, size * 0.70
    kr = size * 0.04
    # 键阵
    cols, krows = 7, 3
    kw = (kx1 - kx0) * 0.104
    kh = (ky1 - ky0) * 0.20
    gapx = ((kx1 - kx0) - cols * kw) / (cols + 1)
    gapy = ((ky1 - ky0) - (krows + 1.6) * kh) / (krows + 1)
    amber_key = (1, cols - 2)  # 第二行倒数第二个键做 RGB 琥珀点缀
    space_w = kw * 3.2 + gapx * 2
    for y in range(R):
        row = bytearray()
        for x in range(R):
            c = (0, 0, 0, 0)
            if in_ring(x, y, pad, pad, R - pad, R - pad, size * 0.22, max(size * 0.012, 1.5)):
                c = border
            elif in_rounded(x, y, pad, pad, R - pad, R - pad, size * 0.22):
                c = bg
                if in_ring(x, y, kx0, ky0, kx1, ky1, kr, max(size * 0.012, 1.5)):
                    c = silver
                elif in_rounded(x, y, kx0, ky0, kx1, ky1, kr):
                    c = body
                    hit = False
                    for r in range(krows):
                        for col in range(cols):
                            k_x0 = kx0 + gapx + col * (kw + gapx)
                            k_y0 = ky0 + gapy + r * (kh + gapy)
                            if in_rounded(x, y, k_x0, k_y0, k_x0 + kw, k_y0 + kh, size * 0.008):
                                c = amber if (r, col) == amber_key else silver
                                hit = True
                                break
                        if hit:
                            break
                    if not hit:
                        s_x0 = (kx0 + kx1) / 2 - space_w / 2
                        s_y0 = ky0 + gapy + krows * (kh + gapy)
                        if in_rounded(x, y, s_x0, s_y0, s_x0 + space_w, s_y0 + kh, size * 0.008):
                            c = silver
            row.extend(c)
        rows.append(bytes(row))
    return rows

def write_png(path, rows, w, h):
    def chunk(tag, data):
        out = struct.pack('>I', len(data)) + tag + data
        return out + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    raw = b''.join(b'\x00' + r for r in rows)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

for size in (512, 192):
    rows = render(size)
    write_png(f'public/icon-{size}.png', rows, size, size)
    print(f'icon-{size}.png done')
