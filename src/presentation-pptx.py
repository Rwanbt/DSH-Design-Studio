"""Convert between HTML slides and editable PowerPoint text."""
import json
import sys
from html import escape
from html.parser import HTMLParser
from zipfile import BadZipFile, ZipFile

try:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.text import MSO_AUTO_SIZE
    from pptx.util import Inches, Pt
except ImportError:
    sys.exit(10)


class SlideText(HTMLParser):
    blocks = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "br", "div",
              "blockquote", "pre", "td", "th", "section", "figcaption"}
    inert = {"script", "style", "template", "noscript", "svg"}

    def __init__(self):
        super().__init__()
        self.omitted = []
        self.buffer = []
        self.output = []
        self.style = "body"

    def flush(self):
        text = " ".join("".join(self.buffer).split())
        if text:
            self.output.append((self.style, text))
        self.buffer.clear()
        self.style = "body"

    def handle_starttag(self, tag, attrs):
        if tag in self.inert:
            self.omitted.append(tag)
        if self.omitted:
            return
        if tag in self.blocks:
            self.flush()
            if tag in {"h1", "h2"}:
                self.style = "heading"
            elif tag == "li":
                self.style = "list"

    def handle_endtag(self, tag):
        if self.omitted:
            if tag == self.omitted[-1]:
                self.omitted.pop()
            return
        if tag in self.blocks:
            self.flush()

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and not self.omitted:
            self.flush()

    def handle_data(self, data):
        if not self.omitted:
            self.buffer.append(data)


def export_deck():
    with open("slides.json", encoding="utf-8") as file:
        fragments = json.load(file)
    deck = Presentation()
    deck.slide_width = Inches(40 / 3)
    deck.slide_height = Inches(7.5)
    for fragment in fragments:
        parser = SlideText()
        parser.feed(fragment)
        parser.close()
        parser.flush()
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        textbox = slide.shapes.add_textbox(Inches(0.7), Inches(0.64), Inches(11.9), Inches(6.2))
        frame = textbox.text_frame
        frame.word_wrap = True
        frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
        for index, (kind, text) in enumerate(parser.output):
            paragraph = frame.add_paragraph() if index else frame.paragraphs[0]
            paragraph.text = ("• " if kind == "list" else "") + text
            paragraph.font.name = "Arial"
            paragraph.font.size = Pt(36 if kind == "heading" else 22)
            paragraph.font.bold = kind == "heading"
            paragraph.font.color.rgb = RGBColor(34, 37, 42)
            paragraph.space_after = Pt(14)
    deck.save("output.pptx")


def import_deck():
    try:
        with ZipFile("input.pptx") as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries}
            if (len(entries) > 2048 or len(entries) != len(names)
                    or sum(entry.file_size for entry in entries) > 32 * 1024 * 1024
                    or "ppt/presentation.xml" not in names
                    or any(entry.flag_bits & 1 for entry in entries)):
                sys.exit(11)
        deck = Presentation("input.pptx")
        if not 1 <= len(deck.slides) <= 32:
            sys.exit(11)
        slides = []
        omitted = 0
        for number, slide in enumerate(deck.slides, 1):
            slide_id = f"slide-page-{number}"
            blocks = []
            title = slide.shapes.title
            shapes = list(slide.shapes)
            ordered = ([title] if title is not None else []) + [
                shape for shape in shapes if title is None or shape.shape_id != title.shape_id]
            for shape in ordered:
                if not shape.has_text_frame:
                    omitted += 1
                    continue
                for paragraph in shape.text_frame.paragraphs:
                    value = " ".join(paragraph.text.split())
                    if not value:
                        continue
                    tag = "h1" if shape is title and not blocks else "p"
                    block_id = f"{slide_id}-text-{len(blocks) + 1}"
                    blocks.append(f'<{tag} id="{block_id}">{escape(value)}</{tag}>')
                    if len(blocks) > 200:
                        sys.exit(11)
            slides.append(f'<section id="{slide_id}">\n' + "\n".join(blocks) + "\n</section>")
        source = ('<!doctype html>\n<html><head><meta charset="utf-8"><title>Presentation</title></head>'
                  '<body><main id="dsh-deck" data-dsh-deck="1">\n'
                  + "\n".join(slides) + '\n</main></body></html>\n')
        with open("slides.json", "w", encoding="utf-8") as file:
            json.dump({"source": source, "omitted": omitted}, file, ensure_ascii=False)
    except (BadZipFile, KeyError, ValueError, TypeError, OSError):
        sys.exit(11)


if __name__ == "__main__":
    if sys.argv[1] == "import":
        import_deck()
    else:
        export_deck()
