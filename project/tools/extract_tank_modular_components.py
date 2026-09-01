from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(r"E:\末日堡垒\project\public\res\vehicles")
SHEETS = (
    ROOT / "tank_grayblue_top_modular_v2.png",
    ROOT / "tank_brown_top_modular_v2.png",
)
PART_NAMES = ("track_left", "hull", "track_right", "turret")


def clear_checkerboard(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    px = rgba.load()
    width, height = rgba.size
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def candidate(x: int, y: int) -> bool:
        r, g, b, _ = px[x, y]
        return min(r, g, b) >= 220 and max(r, g, b) - min(r, g, b) <= 12

    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if seen[index] or not candidate(x, y):
            continue
        seen[index] = 1
        px[x, y] = (*px[x, y][:3], 0)
        if x:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))
    return rgba


def component_boxes(image: Image.Image) -> list[tuple[int, int, int, int]]:
    alpha = image.getchannel("A")
    width, height = image.size
    apx = alpha.load()
    seen = bytearray(width * height)
    boxes: list[tuple[int, int, int, int, int]] = []
    for y0 in range(height):
        for x0 in range(width):
            start = y0 * width + x0
            if seen[start] or apx[x0, y0] == 0:
                continue
            queue = deque([(x0, y0)])
            seen[start] = 1
            min_x = max_x = x0
            min_y = max_y = y0
            area = 0
            while queue:
                x, y = queue.popleft()
                area += 1
                min_x, max_x = min(min_x, x), max(max_x, x)
                min_y, max_y = min(min_y, y), max(max_y, y)
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < width and 0 <= ny < height):
                        continue
                    index = ny * width + nx
                    if seen[index] or apx[nx, ny] == 0:
                        continue
                    seen[index] = 1
                    queue.append((nx, ny))
            if area >= 1000:
                boxes.append((min_x, min_y, max_x + 1, max_y + 1, area))
    return [(x0, y0, x1, y1) for x0, y0, x1, y1, _ in sorted(boxes, key=lambda b: b[0])]


def padded_crop(image: Image.Image, box: tuple[int, int, int, int], padding: int = 12) -> Image.Image:
    x0, y0, x1, y1 = box
    return image.crop((max(0, x0 - padding), max(0, y0 - padding), min(image.width, x1 + padding), min(image.height, y1 + padding)))


def main() -> None:
    for sheet_path in SHEETS:
        sheet = clear_checkerboard(Image.open(sheet_path))
        boxes = component_boxes(sheet)
        if len(boxes) != 4:
            raise RuntimeError(f"{sheet_path.name}: expected 4 components, found {len(boxes)}")
        sheet.save(sheet_path)
        base = sheet_path.stem
        for name, box in zip(PART_NAMES, boxes):
            part_path = ROOT / f"{base}_{name}.png"
            padded_crop(sheet, box).save(part_path)
            print(part_path.name, Image.open(part_path).size)
        print(sheet_path.name, sheet.mode, sheet.getchannel("A").getextrema())


if __name__ == "__main__":
    main()
