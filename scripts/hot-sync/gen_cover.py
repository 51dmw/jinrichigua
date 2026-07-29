#!/usr/bin/env python3
"""
文章无封面时的品牌标题卡生成器。

背景：60s API 的微博端点只返回 title/hot_value/link，**没有图片字段**，
所以纯微博来源的选题从一开始就无图可采——已发布文章里 25.5% 无封面，其中 90% 出自微博。

刻意不做的事：不去图库/图搜抓真人照片。本站写的是真实人物，
随手配一张来源不明的图既有版权风险，也有张冠李戴的风险。
标题卡是自有内容，零风险且每篇都不一样。

尺寸 1200×675（16:9）——满足 Google Discover 对封面宽度 ≥1200px 的要求。

用法：python3 gen_cover.py "标题" 输出路径.jpg [频道名]
"""
import sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 675
RED = (193, 39, 45)
RED_DARK = (150, 27, 33)
WHITE = (255, 255, 255)
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

MAX_LINES = 4


def wrap(text, font, draw, max_w):
    """按像素宽度断行（中文没有空格，只能逐字量）。"""
    lines, cur = [], ""
    for ch in text:
        probe = cur + ch
        if draw.textlength(probe, font=font) <= max_w:
            cur = probe
        else:
            lines.append(cur)
            cur = ch
            if len(lines) >= MAX_LINES:
                break
    if cur and len(lines) < MAX_LINES:
        lines.append(cur)
    if len(lines) == MAX_LINES and len(''.join(lines)) < len(text):
        lines[-1] = lines[-1][:-1] + "…"
    return lines


def watermelon(d, cx, cy, r):
    """与 app/icon.svg 同款：白瓤 + 红籽的下半圆。"""
    d.pieslice([cx - r, cy - r, cx + r, cy + r], start=0, end=180, fill=WHITE)
    for dx, dy in ((-0.47, 0.39), (0, 0.58), (0.47, 0.39)):
        ex, ey = cx + dx * r, cy + dy * r
        rx, ry = 0.105 * r, 0.15 * r
        d.ellipse([ex - rx, ey - ry, ex + rx, ey + ry], fill=RED)


def build(title, out, channel=""):
    img = Image.new("RGB", (W, H), RED)
    d = ImageDraw.Draw(img)

    # 竖向渐变，避免大面积纯色显得廉价
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(
            int(RED[i] + (RED_DARK[i] - RED[i]) * t) for i in range(3)))

    # 左上角品牌条
    d.rectangle([0, 0, 10, H], fill=(255, 255, 255, 40))

    pad = 80
    max_w = W - pad * 2

    # 标题字号自适应：先大后小，直到能在 MAX_LINES 行内放下
    for size in (76, 68, 60, 54, 48):
        font = ImageFont.truetype(FONT_BOLD, size)
        lines = wrap(title, font, d, max_w)
        if len(''.join(lines)) >= len(title) or size == 48:
            break

    lh = int(size * 1.42)
    block_h = lh * len(lines)
    y = (H - block_h) // 2 - 30
    for ln in lines:
        d.text((pad, y), ln, font=font, fill=WHITE)
        y += lh

    # 底部：西瓜标 + 字标 +（可选）频道名
    by = H - 78
    watermelon(d, pad + 22, by, 22)
    f_mark = ImageFont.truetype(FONT_BOLD, 34)
    d.text((pad + 60, by - 22), "今日吃瓜", font=f_mark, fill=WHITE)
    if channel:
        f_ch = ImageFont.truetype(FONT_BOLD, 26)
        tw = d.textlength(channel, font=f_ch)
        d.rounded_rectangle([W - pad - tw - 32, by - 22, W - pad, by + 22],
                            radius=22, fill=(255, 255, 255, 255))
        d.text((W - pad - tw - 16, by - 16), channel, font=f_ch, fill=RED)

    img.save(out, "JPEG", quality=86, optimize=True)
    return out


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    print(build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""))
