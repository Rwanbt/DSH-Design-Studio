"""Convert between HTML slides and editable PowerPoint text and tables."""
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


class SlideContent(SlideText):
    def __init__(self):
        super().__init__()
        self.rows = None
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if self.omitted or tag in self.inert:
            super().handle_starttag(tag, attrs)
        elif self.rows is None:
            if tag == "table":
                self.flush()
                self.rows = []
            else:
                super().handle_starttag(tag, attrs)
        elif tag == "table":
            raise ValueError("Nested tables are unsupported")
        elif tag == "tr":
            self.row = []
            self.rows.append(self.row)
        elif tag in {"th", "td"} and self.row is not None:
            attributes = dict(attrs)
            row_span = int(attributes.get("rowspan") or 1)
            column_span = int(attributes.get("colspan") or 1)
            if not (1 <= row_span <= 400 and 1 <= column_span <= 400):
                raise ValueError("Invalid table span")
            self.cell = (row_span, column_span, tag == "th", [])
            self.row.append(self.cell)
        elif self.cell is not None and tag in self.blocks:
            self.cell[3].append(" ")

    def handle_data(self, data):
        if self.rows is None:
            super().handle_data(data)
        elif self.cell is not None and not self.omitted:
            self.cell[3].append(data)

    def handle_endtag(self, tag):
        if self.omitted or self.rows is None:
            super().handle_endtag(tag)
        elif tag in {"th", "td"}:
            self.cell = None
        elif tag == "tr":
            self.cell = None
            self.row = None
        elif tag == "table":
            if any(self.rows):
                self.output.append(("table", table_grid(self.rows)))
            self.rows = None
            self.row = None
            self.cell = None
        elif self.cell is not None and tag in self.blocks:
            self.cell[3].append(" ")

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and self.rows is not None and self.cell is not None and not self.omitted:
            self.cell[3].append(" ")
        else:
            super().handle_startendtag(tag, attrs)


def table_grid(rows):
    cells = []
    occupied = set()
    width = 0
    height = len(rows)
    for y, row in enumerate(rows):
        x = 0
        for row_span, col_span, header, chunks in row:
            while (y, x) in occupied:
                x += 1
            height = max(height, y + row_span)
            width = max(width, x + col_span)
            if height * width > 400:
                raise ValueError("Table exceeds 400 cells")
            area = {(r, c) for r in range(y, y + row_span) for c in range(x, x + col_span)}
            if occupied.intersection(area):
                raise ValueError("Overlapping cells")
            occupied.update(area)
            cells.append((y, x, row_span, col_span, header, " ".join("".join(chunks).split())))
            x += col_span
    return height, width, cells


def add_text(slide, blocks, top, height):
    textbox = slide.shapes.add_textbox(Inches(0.7), Inches(top), Inches(11.9), Inches(height))
    frame = textbox.text_frame
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    for index, (kind, text) in enumerate(blocks):
        paragraph = frame.add_paragraph() if index else frame.paragraphs[0]
        paragraph.text = ("• " if kind == "list" else "") + text
        paragraph.font.name = "Arial"
        paragraph.font.size = Pt(36 if kind == "heading" else 22)
        paragraph.font.bold = kind == "heading"
        paragraph.font.color.rgb = RGBColor(34, 37, 42)
        paragraph.space_after = Pt(14)


def add_table(slide, grid, top, height):
    rows, cols, entries = grid
    table = slide.shapes.add_table(rows, cols, Inches(0.7), Inches(top),
                                   Inches(11.9), Inches(height)).table
    table.first_row = any(y == 0 and header for y, _, _, _, header, _ in entries)
    for y, x, row_span, col_span, header, text in entries:
        cell = table.cell(y, x)
        if row_span > 1 or col_span > 1:
            cell.merge(table.cell(y + row_span - 1, x + col_span - 1))
        cell.text = text
        cell.text_frame.paragraphs[0].font.bold = header
        cell.text_frame.paragraphs[0].font.size = Pt(16)


def export_deck():
    with open("slides.json", encoding="utf-8") as file:
        fragments = json.load(file)
    deck = Presentation()
    deck.slide_width = Inches(40 / 3)
    deck.slide_height = Inches(7.5)
    for fragment in fragments:
        parser = SlideContent()
        parser.feed(fragment)
        parser.close()
        parser.flush()
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        groups = []
        for kind, value in parser.output:
            if kind == "table":
                groups.append(("table", value, value[0] * 0.48 + 0.1))
            else:
                if not groups or groups[-1][0] != "text":
                    groups.append(("text", [], 0))
                _, blocks, weight = groups[-1]
                blocks.append((kind, value))
                groups[-1] = ("text", blocks, weight + (0.72 if kind == "heading" else 0.52))
        if not any(kind == "table" for kind, _, _ in groups):
            add_text(slide, parser.output, 0.64, 6.2)
            continue
        scale = min(1, 6.2 / sum(weight for _, _, weight in groups))
        top = 0.64
        for kind, value, weight in groups:
            height = weight * scale
            if kind == "table":
                add_table(slide, value, top, height)
            else:
                add_text(slide, value, top, height)
            top += height
    deck.save("output.pptx")


def table_markup(table, block_id):
    if len(table.rows) * len(table.columns) > 400:
        sys.exit(11)
    rows = []
    for row_index, row in enumerate(table.rows, 1):
        cells = []
        for column_index, cell in enumerate(row.cells, 1):
            if cell.is_spanned:
                continue
            cell_id = f"{block_id}-r{row_index}-c{column_index}"
            is_header = row_index == 1 and table.first_row
            tag = "th" if is_header else "td"
            attributes = f' id="{cell_id}"'
            if is_header:
                scope = "colgroup" if cell.span_width > 1 else "col"
                attributes += f' scope="{scope}"'
            if cell.span_height > 1:
                attributes += f' rowspan="{cell.span_height}"'
            if cell.span_width > 1:
                attributes += f' colspan="{cell.span_width}"'
            paragraphs = [" ".join(paragraph.text.split()) for paragraph in cell.text_frame.paragraphs]
            if len(paragraphs) > 32:
                sys.exit(11)
            content = "".join(
                f'<p id="{cell_id}-p{index}">{escape(value)}</p>'
                for index, value in enumerate(paragraphs, 1))
            cells.append(f"<{tag}{attributes}>{content}</{tag}>")
        rows.append(f'<tr id="{block_id}-r{row_index}">' + "".join(cells) + "</tr>")
    return f'<table id="{block_id}"><tbody>' + "\n".join(rows) + "</tbody></table>"


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
            table_count = 0
            text_count = 0
            for shape in ordered:
                if shape.has_table:
                    table_count += 1
                    if table_count > 8:
                        sys.exit(11)
                    blocks.append(table_markup(shape.table, f"{slide_id}-table-{table_count}"))
                    continue
                if not shape.has_text_frame:
                    omitted += 1
                    continue
                for paragraph in shape.text_frame.paragraphs:
                    value = " ".join(paragraph.text.split())
                    if not value:
                        continue
                    tag = "h1" if shape is title and not blocks else "p"
                    text_count += 1
                    block_id = f"{slide_id}-text-{text_count}"
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
        try:
            export_deck()
        except ValueError:
            sys.exit(12)
