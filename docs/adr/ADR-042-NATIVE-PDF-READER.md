# ADR-042 — Open conversation PDFs in the DSH reader

The conversation file picker requests PDF discovery when DSH exposes its
native right sidebar resource service. Studio constructs a file resource
address from the active session and the same listed workspace-relative path.
The DSH service owns PDF reading and page rendering.

The native source store continues to edit SVG, HTML and CSS. PDF rows do
not offer source-file rename or deletion. A global workspace panel with
no conversation keeps its existing picker.

## Download an ordered page copy

The conversation picker accepts up to 24 page positions from one PDF. The
Host takes a checked binary snapshot under the existing workspace path
rules. Optional system Poppler utilities run without a shell on private
temporary files. The application downloads the result and preserves the
source bytes. Missing tools, protected files, out-of-range pages and
processing limits are reported before any download.
The current copy preserves tested page content and selectable text.
Document outlines, forms, signatures and annotation fidelity need
separate qualification.

The assembly form accepts up to eight selections from PDFs in the same
conversation workspace and up to 24 output pages total. The controls move
whole selections up and down. Each selection preserves the entered page
order, and a repeated source is read once. The legacy single-file request
remains supported. Cross-workspace inputs are outside the PDF copy API.

## Text note annotations

The conversation picker can add a native PDF text note to a downloaded copy.
The form addresses a 1-based page and percentages from the visible crop
box's top-left corner, accounting for PDF page rotation. The Host checks
the source and clones the document in a private working directory. The
original PDF remains unchanged. The adapter refuses encrypted PDFs and
detected signed forms.

This operation needs Python with pypdf installed on the Host. It runs
`python3` by default, or the administrator's `DSH_PDF_PYTHON` interpreter
path. The Python package is neither bundled nor installed automatically.
The fixture qualifies a Unicode text note and preservation of page text.
Other markup types, interactive placement and complex document fidelity
require separate qualification.

The note form can display a page rendered with Poppler's `pdftoppm` and place
the note by click. The preview is a PNG bounded to 800 pixels and uses the
page crop box. Click placements carry the content hash and file identity
returned with the preview. If the PDF changed, the Host refuses the
annotation and asks the user to refresh the image. Manual percentage
fields remain available for keyboard entry and environments without the
preview renderer.
