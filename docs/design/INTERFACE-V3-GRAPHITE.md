# UI direction — Design Studio V3 / Graphite

Decision date: 2026-11-16. **Approved as an initial working direction, not as a finished professional interface.** The independent HTML V3 is a design prototype; the DSH plugin uses its own React client/Host and native workspace edit engine.

## Product intent

Build a professional manual-first editing workspace inside DeepSeek Harness (DSH): a compact title/file row, tool strip, hierarchical layer list, **dominant canvas**, contextual properties inspector, and source code drawer. Reference conventions: Figma, Penpot, Affinity Designer, HyCanva. **Do not copy their proprietary UI or assets.**

### Design direction

- Neutral graphite and stone gray for panels and workspace, with subtle warm champagne/copper selection/focus accent instead of blue on every control.
- The **content itself** may contain any user-chosen color (including blue); UI accent must not recolor authored designs.
- Small visual hierarchy: restrained surfaces and borders, minimal large buttons, clear active tool/selection, readable inspector values.
- DSH integration through host's existing theme tokens, with neutral fallbacks; no separate standalone desktop shell.
- Desktop workbench uses three panes. At narrow widths, stack panels; mobile ergonomics require a separate real-device evaluation.

Suggested fallback palette (must be checked for contrast in DSH):
`#202124` shell, `#232529` panels, `#191a1d` stage, `#e8e7e2` text, `#989690` muted, `#bda991` selection.
 
## Functional parity plan

| Interaction | Current implementation | Proof gate / further work |
|---|---|---|
| Manual SVG rect/circle/ellipse creation | Experimental | CI tests, DSH smoke NOT_RUN |
| Move and four-corner resize (simple SVG) | Experimental | Mocked pointer tests, real pointer smoke NOT_RUN |
| Text layer creation | Experimental | Host native source test |
| Edit plain text via inspector | Experimental | Native SVG text tests |
| Double-click inline text edit | Experimental | Mocked client event test |
| Multiline SVG text | Conservative native `tspan` support | Round-trip test; complex existing markup refused |
| Font size / family / weight / style / spacing / alignment | Existing-attribute edits | Validation + native file-save tests |
| Text group / rich text / spans / embedded fonts | NOT_IMPLEMENTED | Requires loss-conscious parser |
| Image/artwork transforms, Bézier editing and advanced components | NOT_IMPLEMENTED | Separate source-mapping milestones |
| Persist undo/redo across app restart | NOT_IMPLEMENTED | Sidecar journal/transaction design |
| Native DSH Web + Desktop operation | Verified (G0) | Real Web app and real Electron shell driven by `tests/e2e/real-dsh.mjs` + `desktop-shell.mjs`; screenshots in `docs/operations/evidence/` |
| User experience/accessibility/performance | NOT_RUN | Keyboard, screen reader and mobile scenarios |

## Implementation constraints

All saved modifications must continue through `createNativeFileStore` and the same SHA-256 revision-aware source patches as the previous editor core. SVG text editing changes only the source range of one known text node. Unknown XML entities, non-simple nested text, scripts and ambiguous structures must fail visibly rather than rewriting potentially unrelated content. `font-family` is restricted to non-executable name values.

**Important:** the web/HTML mock is not a replacement for native file persistence, and screenshots from the mock are not proof of plugin integration.

## Next UI quality pass

Evaluate toolbars, spacing, responsive overflow, layer hierarchy, typography UX, direct text edit placement, correct source-to-render selection, pan/zoom, proper iconography, color contrast and mobile adaptation in a **real DSH profile**. No release until the real integration and safety gates are met.
