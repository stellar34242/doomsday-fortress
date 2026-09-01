from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SOURCE = Path(r"C:\Users\Windows11\.codex\generated_images\01a0275c-d2de-7733-b1a2-dc695d3c14bc\exec-7c43a1da-f9de-4d8c-a569-00ffcfbfc5ee.png")
OUTPUT = Path(__file__).resolve().parents[1] / "output" / "previews" / "water_autotile_connection_test.png"


def font(size: int):
    for candidate in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


atlas = Image.open(SOURCE).convert("RGBA")
cols, rows = 6, 8
cell_w, cell_h = atlas.width // cols, atlas.height // rows


def tile(row: int, col: int, size: int = 132) -> Image.Image:
    crop = atlas.crop((col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h))
    return crop.resize((size, size), Image.Resampling.NEAREST)


def checker(width: int, height: int, block: int = 16) -> Image.Image:
    image = Image.new("RGBA", (width, height), "white")
    draw = ImageDraw.Draw(image)
    colors = ((225, 228, 228, 255), (247, 248, 248, 255))
    for y in range(0, height, block):
        for x in range(0, width, block):
            draw.rectangle((x, y, x + block - 1, y + block - 1), fill=colors[(x // block + y // block) % 2])
    return image


canvas = checker(1500, 1120, 20)
draw = ImageDraw.Draw(canvas)
title_font = font(34)
label_font = font(23)
small_font = font(18)
draw.text((40, 24), "水坑 Autotile 连接测试预览", fill=(25, 35, 38, 255), font=title_font)
draw.text((40, 70), "红线为实际切片边界；透明格用于检查断口与杂点", fill=(95, 43, 39, 255), font=small_font)

# Test A: repeated straight edges. Alternating two candidates makes edge mismatches obvious.
draw.text((40, 116), "A. 直边连续铺设", fill=(25, 35, 38, 255), font=label_font)
size = 132
origin_x, origin_y = 40, 154
straight = [(0, 2), (0, 3), (0, 2), (0, 3), (0, 2), (0, 3), (0, 2), (0, 3)]
for index, (row, col) in enumerate(straight):
    x = origin_x + index * size
    canvas.alpha_composite(tile(row, col, size), (x, origin_y))
    draw.rectangle((x, origin_y, x + size, origin_y + size), outline=(205, 49, 45, 220), width=2)

# Test B: rectangular connected puddle, assembled from corner/edge/center candidates.
draw.text((40, 326), "B. 矩形水坑：外角、直边与中心连接", fill=(25, 35, 38, 255), font=label_font)
origin_x, origin_y = 40, 366
layout = [
    [(0, 1), (0, 2), (0, 3), (0, 2), (0, 0)],
    [(1, 0), (1, 2), (1, 3), (1, 2), (1, 5)],
    [(1, 1), (1, 3), (1, 2), (1, 3), (1, 4)],
    [(1, 0), (1, 2), (1, 3), (1, 2), (1, 5)],
    [(2, 1), (4, 1), (4, 5), (4, 1), (2, 0)],
]
for row_index, row_data in enumerate(layout):
    for col_index, source in enumerate(row_data):
        x, y = origin_x + col_index * size, origin_y + row_index * size
        canvas.alpha_composite(tile(*source, size), (x, y))
        draw.rectangle((x, y, x + size, y + size), outline=(205, 49, 45, 190), width=2)

# Test C: all inner-corner candidates side by side for direction inspection.
draw.text((760, 326), "C. 90° 内包转角方向检查", fill=(25, 35, 38, 255), font=label_font)
draw.text((760, 358), "尖端应朝水面内部，岸线不可向外鼓", fill=(95, 43, 39, 255), font=small_font)
origin_x, origin_y = 760, 397
inner_candidates = [(3, 1), (3, 2), (3, 3), (3, 4), (6, 1), (6, 2), (6, 3), (6, 4)]
for index, source in enumerate(inner_candidates):
    col_index, row_index = index % 2, index // 2
    x, y = origin_x + col_index * size, origin_y + row_index * size
    canvas.alpha_composite(tile(*source, size), (x, y))
    draw.rectangle((x, y, x + size, y + size), outline=(205, 49, 45, 220), width=2)
    draw.text((x + 7, y + 6), f"{source[0] + 1},{source[1] + 1}", fill=(160, 32, 30, 255), font=small_font)

draw.rounded_rectangle((1038, 397, 1450, 720), radius=16, fill=(244, 245, 239, 235), outline=(45, 52, 52, 255), width=2)
notes = [
    "测试判读：",
    "1. 红线处水色应连续。",
    "2. 透明缝表示切片无法直连。",
    "3. 蓝色散点表示素材需清理。",
    "4. 内角必须凹向水面内部。",
    "5. 本图不含泥土材质。",
]
for index, line in enumerate(notes):
    draw.text((1062, 420 + index * 46), line, fill=(32, 43, 44, 255), font=label_font if index == 0 else small_font)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas.convert("RGBA").save(OUTPUT)
print(OUTPUT)
