from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "res" / "vehicles"

SOURCE_BODY = Path(
    r"C:\Users\Windows11\.codex\generated_images\01a0275c-d2de-7733-b1a2-dc695d3c14bc"
    r"\exec-721ceead-b949-41a2-9bfe-d486da637836.png"
)
SOURCE_WHEEL = Path(
    r"C:\Users\Windows11\.codex\generated_images\01a0275c-d2de-7733-b1a2-dc695d3c14bc"
    r"\exec-b09262a5-068e-46ed-b4e8-27353ba22b65.png"
)
SOURCE_BASE = Path(
    r"C:\Users\Windows11\.codex\generated_images\01a0275c-d2de-7733-b1a2-dc695d3c14bc"
    r"\exec-6f856e2d-30ba-446a-934c-57cc8e898cf8.png"
)
SOURCE_FLOOR = Path(
    r"C:\Users\Windows11\.codex\generated_images\01a0275c-d2de-7733-b1a2-dc695d3c14bc"
    r"\exec-4ea59f0e-c516-40f5-930b-29b302685ecc.png"
)


def crop_to_alpha(image: Image.Image, threshold: int = 8, padding: int = 4) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.where(alpha > threshold)
    if not len(xs):
        raise ValueError("Image contains no visible pixels")

    left = max(0, int(xs.min()) - padding)
    top = max(0, int(ys.min()) - padding)
    right = min(rgba.width, int(xs.max()) + padding + 1)
    bottom = min(rgba.height, int(ys.max()) + padding + 1)
    return rgba.crop((left, top, right, bottom))


def remove_edge_connected_background(image: Image.Image) -> Image.Image:
    """Remove the generated neutral checkerboard without erasing enclosed highlights."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    high = rgb.max(axis=2).astype(np.int16)
    low = rgb.min(axis=2).astype(np.int16)
    mean = rgb.mean(axis=2)
    candidate = ((high - low) <= 28) & (mean >= 120)

    height, width = candidate.shape
    connected = np.zeros((height, width), dtype=np.bool_)
    queue: deque[tuple[int, int]] = deque()

    def add(y: int, x: int) -> None:
        if candidate[y, x] and not connected[y, x]:
            connected[y, x] = True
            queue.append((y, x))

    for x in range(width):
        add(0, x)
        add(height - 1, x)
    for y in range(height):
        add(y, 0)
        add(y, width - 1)

    while queue:
        y, x = queue.popleft()
        if y:
            add(y - 1, x)
        if y + 1 < height:
            add(y + 1, x)
        if x:
            add(y, x - 1)
        if x + 1 < width:
            add(y, x + 1)

    alpha = np.where(connected, 0, 255).astype(np.uint8)
    rgba = np.dstack((rgb, alpha))
    return Image.fromarray(rgba, "RGBA")


def resize_to_height(image: Image.Image, height: int) -> Image.Image:
    width = max(1, round(image.width * height / image.height))
    return image.resize((width, height), Image.Resampling.NEAREST)


def align_base_to_body(base: Image.Image, body: Image.Image) -> Image.Image:
    """Match the chassis axle centers and canvas exactly to the body reference.

    Landmarks are measured from the selected Liblib source and transferred to the
    processed body canvas. Keeping a shared canvas makes both sprites use the
    same renderer origin without per-asset offsets.
    """
    source_front_axle_y = 250
    source_rear_axle_y = 1512
    target_front_axle_y = 215
    target_rear_axle_y = 781

    target_width = 497  # Positions axle ends at x=15 and x=443 after center crop.
    segments = (
        (0, source_front_axle_y, 0, target_front_axle_y),
        (source_front_axle_y, source_rear_axle_y, target_front_axle_y, target_rear_axle_y),
        (source_rear_axle_y, base.height, target_rear_axle_y, body.height),
    )

    aligned_wide = Image.new("RGBA", (target_width, body.height), (0, 0, 0, 0))
    for source_top, source_bottom, target_top, target_bottom in segments:
        part = base.crop((0, source_top, base.width, source_bottom))
        part = part.resize(
            (target_width, target_bottom - target_top),
            Image.Resampling.LANCZOS,
        )
        aligned_wide.alpha_composite(part, (0, target_top))

    left = (target_width - body.width) // 2
    return aligned_wide.crop((left, 0, left + body.width, body.height))


def add_sheet_metal_floor(base: Image.Image) -> Image.Image:
    """Place an opaque dark floor pan under the locked mechanical chassis layer."""
    texture = Image.open(SOURCE_FLOOR).convert("RGBA").resize(
        base.size,
        Image.Resampling.LANCZOS,
    )

    # The floor pan stays between the two longitudinal rails. The original
    # chassis is composited last, so all calibrated mechanical pixels remain
    # unchanged and the plate can never disturb axle alignment.
    floor_mask = Image.new("L", base.size, 0)
    draw = ImageDraw.Draw(floor_mask)
    draw.rounded_rectangle((94, 46, 364, 970), radius=18, fill=255)
    texture.putalpha(floor_mask)

    filled = Image.new("RGBA", base.size, (0, 0, 0, 0))
    filled.alpha_composite(texture)
    filled.alpha_composite(base)
    return filled


def remove_baked_light_checker(image: Image.Image) -> Image.Image:
    """Clear bright neutral checker pixels trapped inside enclosed chassis gaps."""
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgb = rgba[:, :, :3].astype(np.int16)
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    baked_checker = (rgb.min(axis=2) >= 235) & (spread <= 12)
    rgba[baked_checker, 3] = 0

    # Peel off the lighter antialias/checker halo only when it is connected to
    # transparency. Dark outlines and enclosed metal highlights are retained.
    candidate = (rgb.min(axis=2) >= 180) & (spread <= 20)
    transparent = rgba[:, :, 3] == 0
    adjacent = np.zeros_like(transparent)
    adjacent[1:] |= transparent[:-1]
    adjacent[:-1] |= transparent[1:]
    adjacent[:, 1:] |= transparent[:, :-1]
    adjacent[:, :-1] |= transparent[:, 1:]
    seeds = candidate & adjacent
    queue: deque[tuple[int, int]] = deque(map(tuple, np.argwhere(seeds)))
    cleared = transparent.copy()
    cleared[seeds] = True
    height, width = candidate.shape
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and candidate[ny, nx] and not cleared[ny, nx]:
                cleared[ny, nx] = True
                queue.append((ny, nx))
    rgba[cleared, 3] = 0
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    body = remove_edge_connected_background(Image.open(SOURCE_BODY))
    body = crop_to_alpha(body, threshold=8, padding=4)
    body.save(OUT_DIR / "jeep_open_s_body_master.png")
    resize_to_height(body, 60).save(OUT_DIR / "jeep_open_s_body.png")

    wheel = Image.open(SOURCE_WHEEL).convert("RGBA")
    alpha = np.asarray(wheel.getchannel("A"))
    clean_alpha = np.where(alpha > 16, alpha, 0).astype(np.uint8)
    wheel.putalpha(Image.fromarray(clean_alpha, "L"))
    wheel = crop_to_alpha(wheel, threshold=16, padding=4)

    # Requested change: preserve wheel height and double its horizontal width.
    wheel = wheel.resize((wheel.width * 2, wheel.height), Image.Resampling.NEAREST)
    wheel.save(OUT_DIR / "jeep_open_s_wheel_master.png")
    resize_to_height(wheel, 12).save(OUT_DIR / "jeep_open_s_wheel.png")

    base = remove_edge_connected_background(Image.open(SOURCE_BASE))
    base = crop_to_alpha(base, threshold=8, padding=4)
    base.save(OUT_DIR / "jeep_open_s_base_unaligned_master.png")
    base = align_base_to_body(base, body)
    base = remove_baked_light_checker(base)
    base.save(OUT_DIR / "jeep_open_s_base_hollow_master.png")
    base = add_sheet_metal_floor(base)
    base.save(OUT_DIR / "jeep_open_s_base_master.png")
    resize_to_height(base, 60).save(OUT_DIR / "jeep_open_s_base.png")

    print(f"body master: {body.size}, runtime: {resize_to_height(body, 60).size}")
    print(f"wheel master (2x width): {wheel.size}, runtime: {resize_to_height(wheel, 12).size}")
    print(f"base master: {base.size}, runtime: {resize_to_height(base, 60).size}")


if __name__ == "__main__":
    main()
