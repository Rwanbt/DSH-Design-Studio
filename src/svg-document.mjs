/**
 * Byte-exact SVG structure scanner for the native Design Studio editor.
 *
 * It never executes SVG, never builds a DOM and never re-serialises: every
 * node keeps the exact UTF-16 span of its open tag, content and close tag, so
 * callers can build precondition-checked patches `{start, end, before, after}`
 * consumed by src/native-patch.mjs.
 *
 * The scanner is deliberately stricter than a browser: executable content
 * (script/foreignObject/on* handlers), DTDs, mismatched tags and duplicate ids
 * are rejected with typed error codes instead of guessed. Comments, CDATA
 * sections and processing instructions are skipped, and quoted attribute
 * values are honoured, so fake markup inside a comment or an attribute value
 * is never reported as a real element.
 *
 * Quoted attribute values may contain a raw `<` here (invalid XML, but present
 * in the wild): honouring the quotes is what keeps a fake `<g id="x">` inside
 * a value from being mistaken for a real node. Nothing is ever re-serialised,
 * so tolerating it cannot change a byte we did not mean to touch.
 */
const MAX_SOURCE = 8 * 1024 * 1024
const SCRIPT_TAGS = new Set(['script', 'foreignObject'])
const RAW_TEXT_TAGS = new Set(['style'])
/**
 * Content of these containers is referenced rather than drawn at that
 * position: it is listed for hierarchy completeness but marked read-only and
 * refused by direct-editing operations.
 */
const READ_ONLY_CONTAINERS = new Set([
  'defs', 'clipPath', 'mask', 'marker', 'pattern', 'symbol',
  'linearGradient', 'radialGradient', 'filter', 'style', 'title', 'desc', 'metadata',
])
const NAME_START = /[A-Za-z_]/
const NAME_CHAR = /[A-Za-z0-9_.:-]/
const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function isSpace(character) {
  return character !== undefined && /\s/.test(character)
}

function isNameStart(character) {
  return character !== undefined && NAME_START.test(character)
}

function isNameChar(character) {
  return character !== undefined && NAME_CHAR.test(character)
}

/** Whitespace, comments and processing instructions only. */
function onlyTrivia(text) {
  let at = 0
  while (at < text.length) {
    if (/\s/.test(text[at])) { at += 1; continue }
    if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4)
      if (end < 0) return false
      at = end + 3
      continue
    }
    if (text.startsWith('<?', at)) {
      const end = text.indexOf('?>', at + 2)
      if (end < 0) return false
      at = end + 2
      continue
    }
    return false
  }
  return true
}

/**
 * Parse the whole document into a source-span tree.
 * Returns {root, nodes, byId} where `byId` only maps syntactically valid,
 * unique ids. `nodes` is in document order.
 */
export function scanSvgDocument(source) {
  if (typeof source !== 'string' || source.length > MAX_SOURCE) {
    fail('invalid-source', 'Expected bounded SVG text')
  }
  const nodes = []
  const byId = new Map()
  const stack = []
  let root = null
  let at = 0
  while (at < source.length) {
    const lt = source.indexOf('<', at)
    if (lt < 0) break
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      if (end < 0) fail('invalid-svg', 'Unclosed XML comment')
      at = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9)
      if (end < 0) fail('invalid-svg', 'Unclosed CDATA section')
      at = end + 3
      continue
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2)
      if (end < 0) fail('invalid-svg', 'Unclosed processing instruction')
      at = end + 2
      continue
    }
    if (source.startsWith('<!', lt)) {
      fail('unsupported-svg', 'DTD and markup declarations are unsupported')
    }
    let cursor = lt + 1
    const closing = source[cursor] === '/'
    if (closing) cursor += 1
    if (!isNameStart(source[cursor])) fail('invalid-svg', 'Invalid XML tag name')
    const nameStart = cursor
    while (cursor < source.length && isNameChar(source[cursor])) cursor += 1
    const tag = source.slice(nameStart, cursor)
    if (closing) {
      while (isSpace(source[cursor])) cursor += 1
      if (source[cursor] !== '>') fail('invalid-svg', 'Malformed closing tag')
      const node = stack.pop()
      if (!node || node.tag !== tag) fail('invalid-svg', 'Mismatched XML closing tag')
      node.contentEnd = lt
      node.closeStart = lt
      node.end = cursor + 1
      at = node.end
      continue
    }
    const attributeList = []
    const attributeMap = new Map()
    let selfClosing = false
    let closed = false
    let tagEnd = -1
    while (cursor < source.length) {
      while (isSpace(source[cursor])) cursor += 1
      if (source[cursor] === '>') { closed = true; tagEnd = cursor + 1; break }
      if (source[cursor] === '/' && source[cursor + 1] === '>') {
        selfClosing = true
        closed = true
        tagEnd = cursor + 2
        break
      }
      if (!isNameStart(source[cursor])) fail('invalid-svg', 'Malformed XML attribute name')
      const attributeNameStart = cursor
      while (cursor < source.length && isNameChar(source[cursor])) cursor += 1
      const name = source.slice(attributeNameStart, cursor)
      if (attributeMap.has(name)) fail('ambiguous-svg', 'Repeated attribute: ' + name)
      while (isSpace(source[cursor])) cursor += 1
      if (source[cursor] !== '=') fail('invalid-svg', 'SVG attributes must have values')
      cursor += 1
      while (isSpace(source[cursor])) cursor += 1
      const quote = source[cursor]
      if (quote !== '"' && quote !== "'") fail('invalid-svg', 'Attribute values must be quoted')
      cursor += 1
      const valueStart = cursor
      while (cursor < source.length && source[cursor] !== quote) cursor += 1
      if (cursor >= source.length) fail('invalid-svg', 'Unclosed attribute')
      const attribute = { name, nameStart: attributeNameStart, valueStart, valueEnd: cursor, end: cursor + 1, value: source.slice(valueStart, cursor) }
      attributeList.push(attribute)
      attributeMap.set(name, attribute)
      cursor += 1
    }
    if (!closed) fail('invalid-svg', 'Unclosed XML tag')
    if (SCRIPT_TAGS.has(tag)) fail('unsupported-svg', 'Executable and foreign SVG nodes are not supported')
    for (const attribute of attributeList) {
      if (/^on[a-z]/i.test(attribute.name)) fail('unsupported-svg', 'SVG event-handler attributes are not supported')
    }
    const parent = stack[stack.length - 1] || null
    const node = {
      tag,
      start: lt,
      nameEnd: nameStart + tag.length,
      openEnd: tagEnd,
      contentStart: tagEnd,
      contentEnd: null,
      closeStart: null,
      end: null,
      selfClosing,
      attributeList,
      attributes: attributeMap,
      id: attributeMap.has('id') ? attributeMap.get('id').value : null,
      parent,
      children: [],
      siblingIndex: parent ? parent.children.length : 0,
      depth: parent ? parent.depth + 1 : 0,
      order: nodes.length,
      readOnly: (parent ? parent.readOnly : false) || READ_ONLY_CONTAINERS.has(tag),
    }
    if (node.id !== null && ID_PATTERN.test(node.id)) {
      if (byId.has(node.id)) fail('ambiguous-svg', 'Duplicate XML id: ' + node.id)
      byId.set(node.id, node)
    }
    if (parent) parent.children.push(node)
    else {
      if (root) fail('unsupported-svg', 'Expected one SVG root element')
      root = node
    }
    nodes.push(node)
    if (selfClosing) {
      node.contentEnd = tagEnd
      node.closeStart = tagEnd
      node.end = tagEnd
      at = tagEnd
      continue
    }
    if (RAW_TEXT_TAGS.has(tag)) {
      const closeAt = source.indexOf('</' + tag, node.openEnd)
      if (closeAt < 0) fail('invalid-svg', 'Unclosed ' + tag + ' element')
      let end = closeAt + 2 + tag.length
      while (isSpace(source[end])) end += 1
      if (source[end] !== '>') fail('invalid-svg', 'Malformed ' + tag + ' closing tag')
      node.contentEnd = closeAt
      node.closeStart = closeAt
      node.end = end + 1
      at = node.end
      continue
    }
    stack.push(node)
    at = tagEnd
  }
  if (stack.length) fail('invalid-svg', 'Unclosed XML element')
  if (!root) fail('invalid-svg', 'Expected one SVG root element')
  if (root.tag !== 'svg') fail('unsupported-svg', 'Expected an SVG root element')
  if (root.end == null) fail('invalid-svg', 'SVG root must be closed')
  if (!onlyTrivia(source.slice(0, root.start))) {
    fail('unsupported-svg', 'Content before the SVG root is not supported')
  }
  if (!onlyTrivia(source.slice(root.end))) {
    fail('unsupported-svg', 'Content after the SVG root is not supported')
  }
  return { root, nodes, byId }
}

/** Exact insertion offset for a new attribute (after the last one, before `>`). */
export function svgAttributeInsertion(node) {
  if (!node || !Array.isArray(node.attributeList)) throw new TypeError('Expected an SVG node')
  return node.attributeList.length ? node.attributeList[node.attributeList.length - 1].end : node.nameEnd
}

/** Nearest ancestor (or self) carrying the `data-locked="true"` marker. */
export function svgLockedAncestor(node) {
  for (let current = node; current; current = current.parent) {
    const marker = current.attributes.get('data-locked')
    if (marker && marker.value === 'true') return current
  }
  return null
}
