# ADR-0001 — Native file formats as source of truth

**Status:** Accepted (product constraint) — 2026-11-16.

## Decision

Canonical artifacts are **SVG** for vectors and **HTML + CSS** for prototypes. JSON may be used only for documented auxiliary metadata (editor state, stable selectors, guide positions, non-source history). JSON must not replace or silently override the source files.

The workspace renderer can use an internal AST/scene model, but save must write back minimal, validated changes to native files. A no-op open/save must be byte-stable whenever the editor claims round-trip support.

## Implications

- SVG attributes, namespaces, defs, styles and unknown nodes must survive no-op editing.
- HTML/CSS source mapping must preserve unrelated whitespace, scripts and external files.
- If an operation cannot be safely mapped to source, reject it with an explanation rather than rewrite the whole document.
- Explicit import/export adapters may be lossy; report those losses before committing.
- Add fixture-based round-trip and negative tests before feature growth.
