from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(r"E:\末日堡垒\project\public\res\vehicles")
SHEETS = (
    ROOT / "tank_grayblue_top_separated.png",
    ROOT / "tank_brown_top_separated.png",
)


def remove_baked_checkerboard(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_light_background(x: int, y: int) -> bool:
        r, g, b, _ = pixels[x, y]
        return min(r, g, b) >= 222 and max(r, g, b) - min(r, g, b) <= 10

    for x in range(width):
        queue.append((x, 0))
        queue.append((x, height - 1))
    for y in range(height):
        queue.append((0, y))
        queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if seen[index] or not is_light_background(x, y):
            continue
        seen[index] = 1
        pixels[x, y] = (*pixels[x, y][:3], 0)
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))
    return rgba


def cropped_half(image: Image.Image, left: bool, padding: int = 12) -> Image.Image:
    width, height = image.size
    half = image.crop((0 if left else width // 2, 0, width // 2 if left else width, height))
    bbox = half.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("component is empty")
    x0, y0, x1, y1 = bbox
    x0, y0 = max(0, x0 - padding), max(0, y0 - padding)
    x1, y1 = min(half.width, x1 + padding), min(half.height, y1 + padding)
    return half.crop((x0, y0, x1, y1))


def main() -> None:
    for sheet_path in SHEETS:
        sheet = remove_baked_checkerboard(Image.open(sheet_path))
        sheet.save(sheet_path)
        stem = sheet_path.stem.removesuffix("_separated")
        cropped_half(sheet, True).save(ROOT / f"{stem}_hull.png")
        cropped_half(sheet, False).save(ROOT / f"{stem}_turret.png")
        print(sheet_path.name, sheet.mode, sheet.getchannel("A").getextrema())


if __name__ == "__main__":
    main()
