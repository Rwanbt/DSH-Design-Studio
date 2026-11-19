"""Write one text annotation to a private working copy using pypdf."""
import json
import math
import sys

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.annotations import Text
except ImportError:
    sys.exit(10)


def annotation_rectangle(page, x, y):
    box = page.cropbox
    left, bottom, right, top = map(float, box)
    width, height = right - left, top - bottom
    if not all(map(math.isfinite, (left, bottom, right, top))) or min(width, height) <= 0:
        raise ValueError("invalid page box")
    positions = {
        0: (x, 1 - y),
        90: (y, x),
        180: (1 - x, y),
        270: (1 - y, 1 - x),
    }
    u, v = positions[page.rotation % 360]
    size = min(18, width, height)
    start_x = min(right - size, left + u * width)
    start_y = max(bottom, bottom + v * height - size)
    return start_x, start_y, start_x + size, start_y + size


def main():
    with open("annotation.json", encoding="utf-8") as request:
        note = json.load(request)
    reader = PdfReader("input.pdf")
    if reader.is_encrypted:
        return 11
    if any(field.get("/FT") == "/Sig" and field.get("/V")
           for field in (reader.get_fields() or {}).values()):
        return 11
    index = note["page"] - 1
    if not 0 <= index < len(reader.pages):
        return 12
    rect = annotation_rectangle(reader.pages[index], note["x"], note["y"])
    writer = PdfWriter(clone_from=reader)
    writer.add_annotation(index, Text(rect=rect, text=note["text"]))
    writer.write("output.pdf")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(13)
