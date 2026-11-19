"""Export semantic HTML slide text as editable PowerPoint text boxes."""
import json
import sys
from html.parser import HTMLParser

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


def main():
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


if __name__ == "__main__":
    main()
