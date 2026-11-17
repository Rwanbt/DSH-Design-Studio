/**
 * Source-accurate SVG element operations for the conservative alpha editor.
 * Never executes SVG, reconstructs a DOM, or rewrites unrelated markup.
 * This is NOT a general-purpose XML parser; reject constructs we cannot map.
 */
import { scanSvgDocument, svgLockedAncestor } from './svg-document.mjs'

const EDITABLE = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text'])
const NESTED_EDITABLE = new Set([...EDITABLE, 'g'])
const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/
const MAX_SOURCE = 8 * 1024 * 1024

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function attributes(raw, base) {
  const result = new Map()
  let i = 0
  while (i < raw.length) {
    while (/\s/.test(raw[i] ?? '')) i++
    if (i === raw.length) break
    const name = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*/.exec(raw.slice(i))
    if (!name) fail('unsupported-svg', 'Unrecognized attribute syntax')
    i += name[0].length
    while (/\s/.test(raw[i] ?? '')) i++
    if (raw[i] !== '=') fail('unsupported-svg', 'SVG attributes must have values')
    i++
    while (/\s/.test(raw[i] ?? '')) i++
    const quote = raw[i]
    if (quote !== '"' && quote !== "'") fail('unsupported-svg', 'Attribute values must be quoted')
    const start = ++i
    while (i < raw.length && raw[i] !== quote) i++
    if (i >= raw.length) fail('invalid-svg', 'Unclosed attribute')
    const value = raw.slice(start, i)
    if (value.includes('<')) fail('invalid-svg', 'Raw angle bracket in attribute')
    if (result.has(name[0])) fail('ambiguous-svg', 'Repeated attribute: ' + name[0])
    result.set(name[0], { value, start: base + start, end: base + i })
    i++
  }
  return result
}

function scannedElements(source) {
  if (typeof source !== 'string' || source.length > MAX_SOURCE) fail('invalid-source', 'Expected bounded SVG text')
  const stack = []
  const nodes = []
  const used = new Set()
  let root = null
  let at = 0
  while (at < source.length) {
    const start = source.indexOf('<', at)
    if (start < 0) break
    if (source.startsWith('<!--', start)) {
      const end = source.indexOf('-->', start + 4)
      if (end < 0) fail('invalid-svg', 'Unclosed XML comment')
      at = end + 3
      continue
    }
    if (source.startsWith('<?', start)) {
      const end = source.indexOf('?>', start + 2)
      if (end < 0) fail('invalid-svg', 'Unclosed processing instruction')
      at = end + 2
      continue
    }
    if (source.startsWith('<![CDATA[', start)) {
      const end = source.indexOf(']]>', start + 9)
      if (end < 0) fail('invalid-svg', 'Unclosed CDATA')
      at = end + 3
      continue
    }
    if (source[start + 1] === '!') fail('unsupported-svg', 'DTD and XML declarations are unsupported')
    let pos = start + 1
    const closing = source[pos] === '/'
    if (closing) pos++
    const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(pos))
    if (!match) fail('invalid-svg', 'Invalid XML tag')
    const tag = match[0]
    pos += tag.length
    const attrStart = pos
    let quote = ''
    while (pos < source.length) {
      const c = source[pos]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      pos++
    }
    if (pos >= source.length) fail('invalid-svg', 'Unclosed XML tag')
    const end = pos + 1
    const tail = source.slice(attrStart, pos)
    const selfClosing = !closing && /\/\s*$/.test(tail)
    if (closing) {
      if (tail.trim()) fail('invalid-svg', 'Malformed closing tag')
      const node = stack.pop()
      if (!node || node.tag !== tag) fail('invalid-svg', 'Mismatched XML closing tag')
      node.end = end
    } else {
      if (tag === 'script' || tag === 'foreignObject') {
        fail('unsupported-svg', 'Executable and foreign SVG nodes are not supported')
      }
      const raw = selfClosing ? tail.replace(/\/\s*$/, '') : tail
      const attrs = attributes(raw, attrStart)
      if ([...attrs.keys()].some(name => /^on[a-z]/i.test(name))) {
        fail('unsupported-svg', 'SVG event-handler attributes are not supported')
      }
      const id = attrs.get('id')?.value
      if (id !== undefined) {
        if (used.has(id)) fail('ambiguous-svg', 'Duplicate XML id: ' + id)
        used.add(id)
      }
      const parent = stack[stack.length - 1] || null
      const node = { tag, start, end: selfClosing ? end : null, openEnd: end, attrs, id, parent,
        children: [], selfClosing }
      if (parent) parent.children.push(node)
      else {
        if (root || tag !== 'svg') fail('unsupported-svg', 'Expected one SVG root')
        root = node
      }
      nodes.push(node)
      if (!selfClosing) stack.push(node)
    }
    at = end
  }
  if (stack.length || !root || root.end == null) fail('invalid-svg', 'SVG root must be well-formed and closed')
  if (source.slice(root.end).trim()) fail('unsupported-svg', 'Content after the SVG root is not supported')
  return { nodes, root, ids: used }
}

/** Return one precise source-span patch for deleting or duplicating a simple element. */
export function svgElementPatch(source, { id, operation, nested = false }) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id) ||
      !['duplicate', 'delete'].includes(operation)) {
    fail('invalid-target', 'Select an SVG element and a supported operation')
  }
  if (nested === true) return nestedElementPatch(source, { id, operation })
  const {nodes, ids} = scannedElements(source)
  const node = nodes.find(node => node.id === id && EDITABLE.has(node.tag))
  if (!node) fail('unknown-node', 'SVG layer not found')
  // This alpha does not yet rewrite nested/linked graphics: leave them untouched.
  if (node.children.length !== 0) fail('unsupported-svg', 'Cannot yet duplicate or delete a nested SVG layer')
  if (node.end == null || node.parent?.tag !== 'svg') {
    fail('unsupported-svg', 'Only direct SVG leaf layers are supported')
  }
  const before = source.slice(node.start, node.end)
  if (operation === 'delete') {
    return { patch: { start: node.start, end: node.end, before, after: '' }, selectedId: null }
  }
  if (!node.attrs.has('id')) fail('invalid-target', 'Layer requires an explicit ID')
  let newId = id + '-copy'
  for (let suffix = 2; ids.has(newId); suffix++) {
    if (suffix > 10000) fail('too-many-shapes', 'Cannot allocate unique SVG ID')
    newId = id + '-copy-' + suffix
  }
  const old = node.attrs.get('id')
  const from = old.start - node.start
  const until = old.end - node.start
  const clone = before.slice(0, from) + newId + before.slice(until)
  return {
    patch: { start: node.end, end: node.end, before: '', after: clone },
    selectedId: newId,
  }
}

function subtreeOf(node) {
  const members = []
  const walk = (current) => {
    members.push(current)
    for (const child of current.children) walk(child)
  }
  walk(node)
  return members
}

/**
 * Nested/grouped duplicate and delete, enabled explicitly with
 * `{nested:true}` so the historical conservative leaf-only contract of
 * `svgElementPatch` is preserved for existing callers.
 *
 * - delete removes the exact source span (children included);
 * - duplicate copies the exact source span and rewrites every element id in
 *   the clone to a fresh unique id (`<id>-copy`, `<id>-copy-2`, …), so a
 *   duplicated group never produces duplicate ids.
 * Bytes outside the selected span are never rewritten.
 */
function nestedElementPatch(source, { id, operation }) {
  const scan = scanSvgDocument(source)
  const node = scan.byId.get(id)
  if (!node) fail('unknown-node', 'SVG layer not found')
  if (node === scan.root || !NESTED_EDITABLE.has(node.tag)) {
    fail('unsupported-svg', 'Only editable SVG layers and groups can be changed here')
  }
  if (node.readOnly) fail('read-only', 'Referenced SVG content is read-only')
  if (svgLockedAncestor(node)) fail('locked', 'SVG layer is locked')
  if (node.end == null) fail('invalid-svg', 'SVG layer must be well-formed and closed')
  const before = source.slice(node.start, node.end)
  if (operation === 'delete') {
    return {
      patch: { start: node.start, end: node.end, before, after: '' },
      selectedId: null,
      nested: true,
    }
  }
  if (!node.attributes.has('id')) fail('invalid-target', 'Layer requires an explicit ID')
  const used = new Set(scan.byId.keys())
  const allocated = new Map()
  const allocate = (original) => {
    if (allocated.has(original)) return allocated.get(original)
    let candidate = original + '-copy'
    if (used.has(candidate)) {
      let suffix = 2
      while (used.has(original + '-copy-' + suffix)) {
        suffix += 1
        if (suffix > 10000) fail('too-many-shapes', 'Cannot allocate unique SVG ID')
      }
      candidate = original + '-copy-' + suffix
    }
    used.add(candidate)
    allocated.set(original, candidate)
    return candidate
  }
  const edits = []
  for (const member of subtreeOf(node)) {
    const attribute = member.attributes.get('id')
    if (!attribute) continue
    if (!ID_PATTERN.test(attribute.value)) fail('ambiguous-svg', 'Cannot duplicate an unaddressable SVG id')
    edits.push({
      start: attribute.valueStart - node.start,
      end: attribute.valueEnd - node.start,
      after: allocate(attribute.value),
    })
  }
  edits.sort((left, right) => left.start - right.start)
  let clone = ''
  let cursor = 0
  for (const edit of edits) {
    clone += before.slice(cursor, edit.start) + edit.after
    cursor = edit.end
  }
  clone += before.slice(cursor)
  return {
    patch: { start: node.end, end: node.end, before: '', after: clone },
    selectedId: allocated.get(id),
    idMap: Object.fromEntries(allocated),
    nested: true,
  }
}
