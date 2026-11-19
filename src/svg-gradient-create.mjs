/**
 * Create a simple linear/radial SVG gradient and assign it to one layer.
 *
 * One Host transaction contains two nonoverlapping source patches: the new
 * native SVG definition and the selected layer's exact fill attribute span.
 * No serialization of unrelated SVG bytes, no rewriting inherited styles.
 */
import { scanSvgDocument, svgLockedAncestor } from './svg-document.mjs'

const TARGET_TAGS = new Set(['rect','circle','ellipse','path','polygon','polyline','text'])
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const ID = /^[A-Za-z_][\w.:-]*$/
function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

export function planSvgGradientCreation(source, { id, type = 'linear', fromColor, toColor } = {}) {
  if (typeof source !== 'string') fail('invalid-source','SVG source is required')
  if (typeof id !== 'string' || !ID.test(id)) fail('invalid-target','Select a named SVG shape')
  if (type !== 'linear' && type !== 'radial') fail('invalid-target','Expected a linear or radial gradient')
  if ([fromColor,toColor].some(color=>color!==undefined && (typeof color!=='string'||!HEX_COLOR.test(color)))) {
    fail('invalid-value','Gradient colours must use three or six hexadecimal digits')
  }
  let scan
  try { scan = scanSvgDocument(source) }
  catch (error) { fail(error?.code === 'ambiguous-svg' ? 'ambiguous-svg' : 'structure-unavailable',
    'Cannot safely inspect this SVG document') }
  const root = scan.root
  if (!root || root.tag !== 'svg' || root.selfClosing) fail('unsupported-svg','Expected a nonempty SVG root')
  const layer = scan.byId.get(id)
  if (!layer || !TARGET_TAGS.has(layer.tag) || layer.readOnly) {
    fail('unknown-node','Select an editable SVG shape with a unique id')
  }
  if (svgLockedAncestor(layer)) fail('locked','Unlock the selected layer and its ancestors')
  if (layer.attributes.has('style') || scan.nodes.some(node => node.tag === 'style') ||
      /<\?xml-stylesheet\b/i.test(source)) {
    fail('ambiguous-style','Stylesheets or inline styles may override the generated fill')
  }
  const currentFill = layer.attributes.get('fill')
  if (currentFill?.value.includes('&')) fail('encoded-attribute','The fill contains an XML entity')
  // Preserve the designer's selected solid colour as the first stop. Unknown
  // or non-solid paints remain untouched until the explicit action; only safe
  // native hex values become editable gradient stops.
  const baseColour=HEX_COLOR.test(currentFill?.value||'')
    ?currentFill.value:'#000000'
  const definitions = root.children.filter(node => node.tag === 'defs')
  if (definitions.length > 1 || definitions.some(node => node.selfClosing)) {
    fail('unsupported-defs','Expected at most one expanded top-level defs element')
  }
  const defs = definitions[0] || null
  const allIds = new Set(scan.nodes.map(node => node.attributes.get('id')?.value).filter(Boolean))
  let gradientId = null
  for (let counter = 1; counter <= 10000; counter++) {
    const candidate = 'dsh_gradient_' + counter
    if (!allIds.has(candidate)) { gradientId = candidate; break }
  }
  if (!gradientId) fail('id-exhausted','No free gradient identifier exists')
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const tag = type === 'linear' ? 'linearGradient' : 'radialGradient'
  const geometry = type === 'linear' ? ' x1="0" y1="0" x2="1" y2="0"'
    : ' cx="50%" cy="50%" r="50%"'
  const gradient = (indent) => indent + '<' + tag + ' id="' + gradientId + '"' + geometry + '>' + eol +
    indent + '  <stop offset="0" stop-color="' + (fromColor??baseColour) + '"/>' + eol +
    indent + '  <stop offset="1" stop-color="' + (toColor??'#ffffff') + '"/>' + eol +
    indent + '</' + tag + '>'
  let where
  let definitionText
  if (defs) {
    const line = source.lastIndexOf('\n', defs.closeStart - 1) + 1
    const beforeClose = source.slice(line, defs.closeStart)
    if (line > defs.openEnd && /^[ \t]*$/.test(beforeClose)) {
      where = line
      definitionText = gradient(beforeClose + '  ') + eol
    } else {
      where = defs.contentEnd
      definitionText = eol + gradient('    ') + eol + '  '
    }
  } else {
    where = root.contentStart
    definitionText = eol + '  <defs>' + eol + gradient('    ') + eol + '  </defs>'
  }
  const fill = 'url(#' + gradientId + ')'
  const fillPatch = currentFill
    ? { start: currentFill.valueStart, end: currentFill.valueEnd, before: currentFill.value, after: fill }
    : (() => { const at=layer.openEnd-(layer.selfClosing?2:1)
      return { start:at, end:at, before:'', after:' fill="'+fill+'"' } })()
  const patches = [
    { start: where, end: where, before:'', after: definitionText },
    fillPatch,
  ]
  // Validation must use original-coordinate patches, applied in reverse order.
  let result = source
  for (const patch of [...patches].sort((a,b)=>b.start-a.start)) {
    if (result.slice(patch.start,patch.end) !== patch.before) {
      fail('precondition-failed','The original SVG spans changed')
    }
    result=result.slice(0,patch.start)+patch.after+result.slice(patch.end)
  }
  try {
    const checked=scanSvgDocument(result)
    if (!checked.byId.has(gradientId) ||
        checked.byId.get(id)?.attributes.get('fill')?.value !== fill) {
      fail('invalid-result','The generated gradient could not be resolved')
    }
  } catch (error) {
    fail('invalid-result','The generated SVG cannot be safely parsed: '+(error?.code||'invalid'))
  }
  return { patches, gradientId, selectedId:id }
}
