import argparse
import shutil
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
TILES = ROOT / "tiles"
BACKUP = ROOT.parent / (ROOT.name + "_recolor_backup") / "tiles"

# Your chosen replacement color: #b8cbb0
TARGET_RGB = (184, 203, 176)

# Any pixel this bright or brighter counts as "white enough"
THRESHOLD = 215


def is_near_white(pixel):
    r, g, b = pixel
    return r >= THRESHOLD and g >= THRESHOLD and b >= THRESHOLD


def recolor_edge_whitespace(img):
    """
    Recolors near-white areas that are connected to the OUTER EDGES of the tile.
    This avoids recoloring white details inside the map itself.
    Returns (new_image, changed)
    """
    img = img.convert("RGB")
    width, height = img.size
    pixels = img.load()

    visited = set()
    q = deque()

    # Seed queue with near-white pixels on outer borders
    for x in range(width):
        for y in (0, height - 1):
            if (x, y) not in visited and is_near_white(pixels[x, y]):
                visited.add((x, y))
                q.append((x, y))

    for y in range(height):
        for x in (0, width - 1):
            if (x, y) not in visited and is_near_white(pixels[x, y]):
                visited.add((x, y))
                q.append((x, y))

    if not q:
        return img, False

    changed = False

    while q:
        x, y = q.popleft()

        if pixels[x, y] != TARGET_RGB:
            pixels[x, y] = TARGET_RGB
            changed = True

        for nx, ny in (
            (x - 1, y), (x + 1, y),
            (x, y - 1), (x, y + 1)
        ):
            if 0 <= nx < width and 0 <= ny < height:
                if (nx, ny) not in visited and is_near_white(pixels[nx, ny]):
                    visited.add((nx, ny))
                    q.append((nx, ny))

    return img, changed


def restore():
    if not BACKUP.exists():
        print("No backup folder found to restore from.")
        return

    restored = 0
    for src in BACKUP.glob("*/*/*.jpg"):
        rel = src.relative_to(BACKUP)
        dst = TILES / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        restored += 1

    print(f"Restored {restored:,} file(s) from backup:")
    print(BACKUP)


def apply_changes():
    if not TILES.exists():
        print(f"Tiles folder not found: {TILES}")
        return

    changed_files = 0
    scanned_files = 0

    for tile in TILES.glob("*/*/*.jpg"):
        scanned_files += 1

        with Image.open(tile) as img:
            new_img, changed = recolor_edge_whitespace(img)

        if changed:
            backup_path = BACKUP / tile.relative_to(TILES)
            backup_path.parent.mkdir(parents=True, exist_ok=True)

            if not backup_path.exists():
                shutil.copy2(tile, backup_path)

            temp = tile.with_suffix(".tmp.jpg")
            new_img.save(temp, format="JPEG", quality=97, subsampling=0)
            temp.replace(tile)
            changed_files += 1

    print(f"Scanned {scanned_files:,} tile(s).")
    print(f"Recolored {changed_files:,} tile(s).")
    print("Done.")
    print(f"Backup location: {BACKUP}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply recoloring")
    parser.add_argument("--restore", action="store_true", help="Restore from backup")
    args = parser.parse_args()

    if args.restore:
        restore()
        return

    if args.apply:
        apply_changes()
        return

    print("Preview mode only.")
    print("This script recolors edge-connected white trimmed areas to:", TARGET_RGB)
    print("Run one of the following:")
    print("  py recolor_trimmed_edges.py --apply")
    print("  py recolor_trimmed_edges.py --restore")


if __name__ == "__main__":
    main()