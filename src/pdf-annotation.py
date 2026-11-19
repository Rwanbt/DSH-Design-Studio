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
    rotation = page.rotation % 360
    display_width, display_height = (height, width) if rotation in (90, 270) else (width, height)
    size = min(18, display_width, display_height)
    x0 = min(display_width - size, x * display_width) / display_width
    y0 = min(display_height - size, y * display_height) / display_height
    x1, y1 = x0 + size / display_width, y0 + size / display_height
    directions = {
        0: lambda u, v: (u, 1 - v),
        90: lambda u, v: (v, u),
        180: lambda u, v: (1 - u, v),
        270: lambda u, v: (1 - v, 1 - u),
    }
    first = directions[rotation](x0, y0)
    second = directions[rotation](x1, y1)
    low_x, high_x = sorted((first[0], second[0]))
    low_y, high_y = sorted((first[1], second[1]))
    return (left + low_x * width, bottom + low_y * height,
            left + high_x * width, bottom + high_y * height)


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
