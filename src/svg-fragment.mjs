/**
 * Paste a copied SVG element into the current document.
 *
 * The clipboard payload is untrusted input even though it came from this
 * editor: it crosses a renderer boundary, so it is re-parsed here with the same
 * scanner that validates every document. The scanner runs on a throwaway
 * wrapper, and only the exact span of the single element it parsed is copied —
 * so anything smuggled around that element (a second root, a closing tag, a
 * declaration) is dropped instead of reaching the file. Every id in the copy is
 * rewritten to an id that is free in the target document, and elements that carry an unfollowed
 * reference (`href`/`src`) are refused rather than duplicated into a document
 * where the reference no longer means what it did.
 */
import { scanSvgDocument } from './svg-document.mjs'

const COPYABLE = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'g'])
// Attributes that cannot be pasted: the editor does not rewrite references, so a
// copy would silently point at the original target (or at an external origin).
const REFERENCE_ATTRIBUTES = ['href', 'xlink:href', 'src']
const MAX_FRAGMENT = 1024 * 1024
const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function subtree(node) {
  const members = []
  const walk = (current) => {
    members.push(current)
    for (const child of current.children) walk(child)
  }
  walk(node)
  return members
}

/**
 * Return the insert patch for one pasted element, or throw a typed error.
 * `source` is the target document; it must already be a scanned SVG document.
 */
export function svgFragmentInsertPatch(source, { fragment }) {
  if (typeof fragment !== 'string' || !fragment.trim()) {
    fail('invalid-source', 'A copied element is required')
  }
  if (fragment.length > MAX_FRAGMENT) fail('too-large', 'Copied element exceeds 1 MiB')
  const document = scanSvgDocument(source)
  // byId contains only literal, syntactically valid ids. An XML entity can
  // conceal an id that would collide with a newly allocated literal name.
  for (const member of document.nodes) {
    if (member.attributes.get('id')?.value.includes('&')) {
      fail('ambiguous-svg', 'The destination carries an encoded id; paste cannot allocate ids safely')
    }
  }
  const wrapped = '<svg xmlns="http://www.w3.org/2000/svg">' + fragment + '</svg>'
  let scanned
  try {
    scanned = scanSvgDocument(wrapped)
  } catch (error) {
    fail('invalid-fragment', 'The copied element is not valid SVG: ' + error.message)
  }
  if (scanned.root.children.length !== 1) {
    fail('invalid-fragment', 'A paste must contain exactly one element')
  }
  const node = scanned.root.children[0]
  const members = subtree(node)
  for (const member of members) {
    if (!COPYABLE.has(member.tag) || member.readOnly) {
      // In particular tspan is not silently flattened: simple text remains
      // supported, but structured text requires a separately supported contract.
      fail('invalid-fragment', 'This element cannot be pasted: ' + member.tag)
    }
    if (member.attributes.get('id')?.value.includes('&')) {
      fail('invalid-fragment', 'The copied element carries an encoded id')
    }
    for (const attribute of member.attributeList) {
      // Do not pretend to parse CSS. Refuse encoded/indirect forms as ambiguous,
      // including XML numeric/predefined entities and CSS escapes/comments.
      // This is deliberately conservative even for non-presentation attributes.
      if (/[&\\]/.test(attribute.value) || /\/\*|\*\//.test(attribute.value)) {
        fail('invalid-fragment', 'Encoded or ambiguous attribute values cannot be pasted: ' + attribute.name)
      }
      if (/(?:url|var|env|attr)\s*\(/i.test(attribute.value)) {
        fail('invalid-fragment', 'URL or indirect attribute references cannot be pasted: ' + attribute.name)
      }
    }
    for (const name of REFERENCE_ATTRIBUTES) {
      if (member.attributes.has(name)) {
        fail('invalid-fragment', 'A copied element that carries a reference cannot be pasted yet')
      }
    }
  }
  const original = wrapped.slice(node.start, node.end)
  // Fresh ids: the copy must never collide with an id already in the target.
  const used = new Set(document.byId.keys())
  const allocated = new Map()
  const allocate = (id) => {
    if (allocated.has(id)) return allocated.get(id)
    // A paste into another document keeps the original name while it is free;
    // the `-copy` suffix only appears when the target already uses that id.
    let candidate = used.has(id) ? id + '-copy' : id
    if (used.has(candidate)) {
      let suffix = 2
      while (used.has(id + '-copy-' + suffix)) {
        suffix += 1
        if (suffix > 10000) fail('too-many-shapes', 'Cannot allocate unique SVG ID')
      }
      candidate = id + '-copy-' + suffix
    }
    used.add(candidate)
    allocated.set(id, candidate)
    return candidate
  }
  const edits = []
  for (const member of members) {
    const attribute = member.attributes.get('id')
    if (!attribute) continue
    if (!ID_PATTERN.test(attribute.value)) {
      fail('invalid-fragment', 'The copied element carries an unusable id')
    }
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
    clone += original.slice(cursor, edit.start) + edit.after
    cursor = edit.end
  }
  clone += original.slice(cursor)
  // Insert after the last root child, never outside the SVG root.
  const insertAt = document.root.children.at(-1)?.end ?? document.root.openEnd
  if (!(insertAt >= document.root.openEnd && insertAt <= document.root.contentEnd)) {
    fail('unsupported-svg', 'Cannot find a safe insertion point inside the SVG root')
  }
  return {
    patch: { start: insertAt, end: insertAt, before: '', after: clone },
    id: node.id === null ? null : allocated.get(node.id),
    idMap: Object.fromEntries(allocated),
  }
}
