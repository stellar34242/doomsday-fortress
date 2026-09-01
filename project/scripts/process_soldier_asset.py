from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "res" / "units"
SOURCE = Path(
    r"C:\Users\Windows11\.codex\generated_images\01a0275c-d2de-7733-b1a2-dc695d3c14bc"
    r"\exec-03e70650-abe5-42aa-a03e-57dd506698b6.png"
)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    image = Image.open(SOURCE).convert("RGBA")
    alpha = image.getchannel("A").point(lambda value: value if value > 16 else 0)
    image.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("Generated soldier has no visible pixels")

    master = image.crop(bbox)
    master.save(OUT_DIR / "soldier_rifle_top_master.png")

    target_w, target_h = 24, 16
    scale = min(target_w / master.width, target_h / master.height)
    width = max(1, round(master.width * scale))
    height = max(1, round(master.height * scale))
    sprite = master.resize((width, height), Image.Resampling.NEAREST)

    runtime = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    runtime.alpha_composite(sprite, ((target_w - width) // 2, (target_h - height) // 2))
    runtime.save(OUT_DIR / "soldier_rifle_top.png")

    print(f"master: {master.size}; runtime content: {sprite.size}; canvas: {runtime.size}")


if __name__ == "__main__":
    main()
