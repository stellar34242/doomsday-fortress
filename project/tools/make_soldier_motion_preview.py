from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw


SOURCE = Path(r"C:\Users\Windows11\Desktop\jr.png")
OUTPUT = Path(r"E:\末日堡垒\project\docs\previews\soldier_procedural_motion_v2.gif")


def cutout(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    crop = image.crop(box).convert("RGBA")
    pixels = crop.load()
    width, height = crop.size
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        r, g, b, _ = pixels[x, y]
        bright = min(r, g, b) > 238
        neutral_gray = max(r, g, b) - min(r, g, b) <= 7 and 50 < (r + g + b) / 3 < 235
        return bright or neutral_gray

    for x in range(width):
        for y in (0, height - 1):
            if is_background(x, y):
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_background(x, y):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        idx = y * width + x
        if visited[idx] or not is_background(x, y):
            continue
        visited[idx] = 1
        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        if x:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))

    bbox = crop.getbbox()
    return crop.crop(bbox) if bbox else crop


def add_shadow(canvas: Image.Image, center: tuple[int, int], size: tuple[int, int], squash: float) -> None:
    layer = Image.new("RGBA", canvas.size)
    draw = ImageDraw.Draw(layer)
    cx, cy = center
    sw = int(size[0] * squash)
    sh = int(size[1] * squash)
    draw.ellipse((cx - sw // 2, cy - sh // 2, cx + sw // 2, cy + sh // 2), fill=(17, 21, 18, 70))
    canvas.alpha_composite(layer)


def paste_center(canvas: Image.Image, sprite: Image.Image, center: tuple[int, int], offset: tuple[int, int]) -> tuple[int, int]:
    x = center[0] - sprite.width // 2 + offset[0]
    y = center[1] - sprite.height // 2 + offset[1]
    canvas.alpha_composite(sprite, (x, y))
    return x, y


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    walk = cutout(source, (58, 88, 449, 350))
    shoot = cutout(source, (487, 89, 746, 626))

    scale = 0.66
    walk = walk.resize((round(walk.width * scale), round(walk.height * scale)), Image.Resampling.NEAREST)
    shoot = shoot.resize((round(shoot.width * scale), round(shoot.height * scale)), Image.Resampling.NEAREST)

    width, height = 760, 430
    walk_center = (220, 218)
    shoot_center = (545, 218)
    frames: list[Image.Image] = []
    durations: list[int] = []

    # Two-beat procedural gait: lift -> lean -> impact -> rebound, twice per loop.
    walk_x = (0, 1, 3, 4, 3, 1, 0, -1, -3, -4, -3, -1) * 2
    walk_y = (3, 1, -2, -5, -3, 0, 3, 1, -2, -5, -3, 0) * 2
    walk_angle = (0, 1, 2, 2, 1, 0, 0, -1, -2, -2, -1, 0) * 2
    recoil_y = (0, -7, -5, -3, -1, 0, 0, 0, 0, 0, 0, 0,
                 0, -7, -5, -3, -1, 0, 0, 0, 0, 0, 0, 0)

    for i in range(24):
        frame = Image.new("RGBA", (width, height), (225, 227, 225, 255))
        gait_phase = i % 6
        shadow_scale = (1.08, 1.02, 0.94, 0.88, 0.94, 1.01)[gait_phase]
        add_shadow(frame, (walk_center[0], 309), (184, 32), shadow_scale)
        add_shadow(frame, (shoot_center[0], 379), (126, 27), 1.0)

        if gait_phase == 0:
            gait_sprite = walk.resize((round(walk.width * 1.025), round(walk.height * 0.975)), Image.Resampling.NEAREST)
        elif gait_phase == 3:
            gait_sprite = walk.resize((round(walk.width * 0.985), round(walk.height * 1.02)), Image.Resampling.NEAREST)
        else:
            gait_sprite = walk
        rotated_walk = gait_sprite.rotate(walk_angle[i], resample=Image.Resampling.NEAREST, expand=True)
        paste_center(frame, rotated_walk, walk_center, (walk_x[i], walk_y[i]))

        if gait_phase == 0:
            dust = Image.new("RGBA", frame.size)
            dust_draw = ImageDraw.Draw(dust)
            dust_draw.rectangle((walk_center[0] - 47, 304, walk_center[0] - 42, 307), fill=(119, 111, 88, 105))
            dust_draw.rectangle((walk_center[0] + 38, 306, walk_center[0] + 42, 309), fill=(119, 111, 88, 80))
            frame.alpha_composite(dust)
        sx, sy = paste_center(frame, shoot, shoot_center, (0, recoil_y[i]))

        if i in (1, 2, 13, 14):
            flash = Image.new("RGBA", frame.size)
            draw = ImageDraw.Draw(flash)
            muzzle_x = sx + shoot.width // 2 - 1
            muzzle_y = sy + shoot.height - 3
            length = 24 if i in (1, 13) else 15
            draw.polygon(
                ((muzzle_x, muzzle_y), (muzzle_x - 9, muzzle_y + length // 2),
                 (muzzle_x - 3, muzzle_y + length), (muzzle_x, muzzle_y + length + 8),
                 (muzzle_x + 4, muzzle_y + length), (muzzle_x + 10, muzzle_y + length // 2)),
                fill=(255, 140, 25, 235),
            )
            draw.polygon(
                ((muzzle_x, muzzle_y + 2), (muzzle_x - 4, muzzle_y + length // 2),
                 (muzzle_x, muzzle_y + length + 2), (muzzle_x + 5, muzzle_y + length // 2)),
                fill=(255, 245, 130, 255),
            )
            frame.alpha_composite(flash)

        frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
        durations.append(70)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUTPUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=False,
    )
    print(OUTPUT)


if __name__ == "__main__":
    main()
