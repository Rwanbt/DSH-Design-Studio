"""Write annotations to a private working copy using pypdf."""
import json
import math
import sys

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.annotations import Highlight, Text
    from pypdf.generic import ArrayObject, FloatObject, NameObject, TextStringObject
except ImportError:
    sys.exit(10)


def annotation_geometry(page, note):
    box = page.cropbox
    left, bottom, right, top = map(float, box)
    width, height = right - left, top - bottom
    if not all(map(math.isfinite, (left, bottom, right, top))) or min(width, height) <= 0:
        raise ValueError("invalid page box")
    rotation = page.rotation % 360
    display_width, display_height = (height, width) if rotation in (90, 270) else (width, height)
    if note["kind"] == "highlight":
        x0, y0 = note["x"], note["y"]
        x1 = min(1, x0 + note["width"])
        y1 = min(1, y0 + note["height"])
    else:
        size = min(18, display_width, display_height)
        x0 = min(display_width - size, note["x"] * display_width) / display_width
        y0 = min(display_height - size, note["y"] * display_height) / display_height
        x1, y1 = x0 + size / display_width, y0 + size / display_height
    directions = {
        0: lambda u, v: (u, 1 - v),
        90: lambda u, v: (v, u),
        180: lambda u, v: (1 - u, v),
        270: lambda u, v: (1 - v, 1 - u),
    }
    corners = [(left + u * width, bottom + v * height)
               for u, v in (directions[rotation](u, v)
                            for u, v in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)))]
    xs, ys = zip(*corners)
    return (min(xs), min(ys), max(xs), max(ys)), corners


def create_annotation(page, note):
    rect, corners = annotation_geometry(page, note)
    if note["kind"] == "note":
        return Text(rect=rect, text=note["text"])
    quad = ArrayObject([FloatObject(value) for point in corners for value in point])
    mark = Highlight(rect=rect, quad_points=quad, highlight_color="ffe052", printing=True)
    if note["text"]:
        mark[NameObject("/Contents")] = TextStringObject(note["text"])
    return mark


def main():
    with open("annotation.json", encoding="utf-8") as request:
        notes = json.load(request)
    reader = PdfReader("input.pdf")
    if reader.is_encrypted:
        return 11
    if any(field.get("/FT") == "/Sig" and field.get("/V")
           for field in (reader.get_fields() or {}).values()):
        return 11
    writer = PdfWriter(clone_from=reader)
    for note in notes:
        index = note["page"] - 1
        if not 0 <= index < len(reader.pages):
            return 12
        annotation = create_annotation(reader.pages[index], note)
        writer.add_annotation(index, annotation)
    writer.write("output.pdf")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(13)
