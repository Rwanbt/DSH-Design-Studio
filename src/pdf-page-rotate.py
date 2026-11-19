"""Rotate assembled PDF pages in place in the output page tree."""
import json
import sys

try:
    from pypdf import PdfWriter
except ImportError:
    sys.exit(10)

input_file, rotations_json = sys.argv[1:]
rotations = json.loads(rotations_json)
writer = PdfWriter(clone_from=input_file)
if len(writer.pages) != len(rotations):
    sys.exit(11)
for page, degrees in zip(writer.pages, rotations):
    if degrees:
        page.rotate(degrees)
with open("rotated.pdf", "wb") as output:
    writer.write(output)
