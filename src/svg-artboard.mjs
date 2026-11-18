/**
 * Artboard (planche) resizing for the native SVG editor.
 *
 * The artboard is the coordinate space the editor draws in: the root `viewBox`
 * when it exists, otherwise an absolute root `width`/`height`. Resizing it is
 * deliberately restricted to the three attributes that define it — `width`,
 * `height` and `viewBox` — and every operation is one transactional patch set,
 * so Undo restores the exact bytes.
 *
 * Two coherent modes only:
 *  - display resize (default): the document has a `viewBox`, and only
 *    `width`/`height` change. The viewBox is untouched, so every shape keeps
 *    its user coordinates; the declared board size changes.
 *  - explicit content resize: `viewBox` and `width`/`height` change together in
 *    ONE patch set, so the new board has a matching coordinate system
 *    (1 unit = 1 px) and the shapes keep their absolute size instead of being
 *    silently stretched.
 *
 * Writing `width`/`height` without a coherent `viewBox` is refused: a document
 * with no viewBox and no absolute size has no resolvable artboard at all, and a
 * viewBox-based document must never be resized as if it had no viewBox.
 */
import { scanSvgDocument } from './svg-document.mjs'
import { svgRootAttributePatch } from './svg-attributes.mjs'

export const ARTBOARD_MIN = 1
export const ARTBOARD_MAX = 20000
const MAX_COORD = 1_000_000
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
const LENGTH = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px)?$/

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

/** Format a computed number without trailing zeroes and without -0. */
function numberText(value) {
  const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function parseViewBox(raw) {
  if (typeof raw !== 'string') return null
  const parts = raw.trim().split(/[\s,]+/)
  if (parts.length !== 4 || parts.some((part) => !NUMBER.test(part))) return null
  const values = parts.map(Number)
  if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > MAX_COORD)) return null
  if (values[2] <= 0 || values[3] <= 0) return null
  return { x: values[0], y: values[1], width: values[2], height: values[3] }
}

/** Absolute root length in user units: a plain number or an explicit `px`. */
function absoluteLength(raw) {
  if (typeof raw !== 'string') return null
  const match = LENGTH.exec(raw.trim())
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0 || Math.abs(value) > MAX_COORD) return null
  return { value, px: match[2] === 'px' }
}

/**
 * Read the artboard as it actually exists in the file. This never throws:
 * every refusal is a typed `{ok:false, reason, message}` so the inspector can
 * explain why the controls are inactive instead of showing invented numbers.
 */
export function inspectSvgArtboard(source, { scan = null } = {}) {
  let root
  try { root = (scan || scanSvgDocument(source)).root }
  catch (error) {
    return { ok: false, reason: error.code || 'invalid-svg',
      message: String(error.message || 'Invalid SVG').slice(0, 200) }
  }
  const attribute = (name) => root.attributes.get(name)?.value ?? null
  const preserveAspectRatio = attribute('preserveAspectRatio')
  // The editor only maps coordinates through the default aspect mapping. A
  // non-standard preserveAspectRatio would letterbox/crop differently, so the
  // size is refused rather than silently misrepresented (same rule as geometry).
  if (preserveAspectRatio && !/^xMidYMid\s+meet$/.test(preserveAspectRatio.trim())) {
    return { ok: false, reason: 'unsupported-aspect-ratio',
      message: 'preserveAspectRatio non standard : le redimensionnement serait trompeur.' }
  }
  const viewBoxRaw = attribute('viewBox')
  const widthRaw = attribute('width')
  const heightRaw = attribute('height')
  if (viewBoxRaw !== null) {
    const viewBox = parseViewBox(viewBoxRaw)
    if (!viewBox) {
      return { ok: false, reason: 'invalid-viewbox',
        message: 'viewBox invalide : 4 nombres finis, largeur et hauteur strictement positives.' }
    }
    // `width`/`height` are the size the board is declared at, not the viewBox
    // extent: the inspector must show the root size even when it differs from
    // the coordinate system (the canvas letterboxes the content).
    const declaredWidth = absoluteLength(widthRaw)
    const declaredHeight = absoluteLength(heightRaw)
    return {
      ok: true,
      source: 'viewBox',
      width: declaredWidth && declaredHeight ? declaredWidth.value : viewBox.width,
      height: declaredWidth && declaredHeight ? declaredHeight.value : viewBox.height,
      viewBoxX: viewBox.x,
      viewBoxY: viewBox.y,
      viewBoxWidth: viewBox.width,
      viewBoxHeight: viewBox.height,
      viewBox: viewBoxRaw,
      widthAttribute: widthRaw,
      heightAttribute: heightRaw,
      preserveAspectRatio,
      displayResize: true,
      contentResize: true,
    }
  }
  const width = absoluteLength(widthRaw)
  const height = absoluteLength(heightRaw)
  if (width && height) {
    return {
      ok: true,
      source: 'size',
      width: width.value,
      height: height.value,
      viewBoxX: 0,
      viewBoxY: 0,
      viewBoxWidth: width.value,
      viewBoxHeight: height.value,
      viewBox: null,
      widthAttribute: widthRaw,
      heightAttribute: heightRaw,
      preserveAspectRatio,
      // Without a viewBox there is nothing to keep intact: only the explicit
      // content-resize mode can produce a coherent document (it inserts one).
      displayResize: false,
      contentResize: true,
    }
  }
  return { ok: false, reason: 'unresolvable-artboard',
    message: 'Planche non résoluble : aucun viewBox et aucune taille absolue (width/height).' }
}

/** Keep the unit style of an existing attribute (`240px` stays `300px`). */
function formatDimension(raw, value) {
  const px = typeof raw === 'string' && /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*px\s*$/.test(raw)
  return numberText(value) + (px ? 'px' : '')
}

function requestedDimension(value, label) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && NUMBER.test(value.trim())) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  fail('invalid-dimensions', 'La ' + label + ' doit être un nombre fini (px).')
}

/**
 * Plan one artboard resize. Returns the exact patches to apply in ONE write;
 * `scaleContent` selects the explicit `viewBox` + `width` + `height` batch.
 *
 * Refusals (no patch at all): non-SVG/unparsable source, missing viewBox for a
 * display-only resize, unresolvable artboard, malformed viewBox, non-standard
 * preserveAspectRatio, non-numeric/out-of-range dimensions, and an identical
 * size that would write nothing.
 */
export function planSvgArtboard(source, { width, height, scaleContent = false } = {}) {
  const info = inspectSvgArtboard(source)
  if (!info.ok) fail(info.reason, info.message)
  const content = scaleContent === true
  const nextWidth = requestedDimension(width, 'largeur')
  const nextHeight = requestedDimension(height, 'hauteur')
  if (nextWidth < ARTBOARD_MIN || nextHeight < ARTBOARD_MIN ||
      nextWidth > ARTBOARD_MAX || nextHeight > ARTBOARD_MAX) {
    fail('out-of-range', 'La taille de la planche doit rester entre ' + ARTBOARD_MIN + ' et ' + ARTBOARD_MAX + ' px.')
  }
  if (!content && !info.displayResize) {
    fail('missing-viewbox',
      'viewBox absent : cochez « Redimensionner le contenu » pour écrire viewBox, width et height ensemble.')
  }

  // Desired attribute values, in a stable order. All insertions share the same
  // precise offset (the end of the root open tag), so they are merged below:
  // applyNativePatches refuses two patches that share an insertion position.
  const desired = [
    ['width', formatDimension(info.widthAttribute, nextWidth)],
    ['height', formatDimension(info.heightAttribute, nextHeight)],
  ]
  if (content) {
    desired.push(['viewBox', numberText(info.viewBoxX) + ' ' + numberText(info.viewBoxY) + ' ' +
      numberText(nextWidth) + ' ' + numberText(nextHeight)])
  }

  const values = []
  const insertions = []
  for (const [attribute, value] of desired) {
    const current = attribute === 'width' ? info.widthAttribute
      : attribute === 'height' ? info.heightAttribute : info.viewBox
    if (current === value) continue
    const patch = svgRootAttributePatch(source, { attribute, value })
    const at = patch.start
    if (patch.start === patch.end && patch.before === '') {
      const existing = insertions.find((entry) => entry.start === at)
      if (existing) existing.after += patch.after
      else insertions.push({ start: at, end: at, before: '', after: patch.after })
    } else values.push(patch)
  }
  const patches = [...values, ...insertions]
  if (patches.length === 0) {
    fail('no-change', 'La taille demandée est identique à celle du fichier : aucune écriture.')
  }
  return {
    patches,
    width: nextWidth,
    height: nextHeight,
    scaleContent: content,
    source: info.source,
  }
}
