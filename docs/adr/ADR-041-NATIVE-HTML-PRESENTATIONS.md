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
