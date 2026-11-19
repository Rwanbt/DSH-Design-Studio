# ADR-041 — Native HTML presentation source

Presentation v1 is a normal HTML document. The root is
`<main id="dsh-deck" data-dsh-deck="1">`. Ordered, directly nested
`section` elements with unique `slide-…` identifiers are slides.
Keep only whitespace between slide sections. Ordinary native HTML and CSS
inside a section remain the editable source.

The Host validates source spans with the HTML source mapper. On append it
validates the assembled result before issuing the patch. Reordering swaps two
adjacent complete sections and preserves the bytes between them. Both
operations use the existing revision-checked store and inverse patches.
The first implementation supports up to 32 slides within the HTML mapping
limit. Unsupported structures remain editable through the source editor.

The preview uses the existing inert HTML iframe and displays the selected
section. While a source draft is dirty, the preview shows the draft without
the saved slide filter and slide actions cannot write. Text edits and
proposals use the normal HTML command path.

## Print to PDF

Export PDF opens an inert, separate print frame for the saved deck. It reuses
the HTML preview isolation and local CSS projection, allows the print modal
and gives each slide a fixed 320 × 180 mm print box. The user selects PDF in
the browser or desktop print dialog. The active slide filter is excluded so
all slides print in document order. Content beyond the fixed slide box is
clipped. Browser print settings and unavailable fonts can affect fidelity.
The exported PDF is independent of the editable HTML source.

## Slide duplication

A duplicate is inserted directly after its source slide in a single native
patch. The source mapper resolves attribute spans, allocates new unique IDs
and rewrites local fragment links, ARIA references and supported SVG
`url(#id)` attributes inside the copy. References to targets outside the
slide stay intact. Text and unrelated bytes are preserved. Ambiguous or
inert markup inside a slide can be copied manually in the source editor.
Stylesheets that select by ID may need a shared class to style both slides.

## Editable text export to PPTX

The saved presentation can also export to PPTX. Each HTML slide becomes a
PowerPoint slide containing editable text with headings and list items.
The exporter uses a standard 16:9 layout. It rebuilds text layout, so CSS
design, SVG, images, embedded media and animation need separate export
support. HTML remains the source of truth and the PDF path retains the
existing visual rendering flow.

This option uses Python with python-pptx installed on the Host. The
administrator can select an interpreter with `DSH_PPTX_PYTHON`. No Python
packages are bundled or installed automatically.
