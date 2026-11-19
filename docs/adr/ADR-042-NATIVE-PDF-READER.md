# ADR-042 — Open conversation PDFs in the DSH reader

The conversation file picker requests PDF discovery when DSH exposes its
native right sidebar resource service. Studio constructs a file resource
address from the active session and the same listed workspace-relative path.
The DSH service owns PDF reading and page rendering.

The native source store continues to edit SVG, HTML and CSS. PDF rows do
not offer source-file rename or deletion. A global workspace panel with
no conversation keeps its existing picker.
