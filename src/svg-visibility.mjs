/**
 * Visibility and lock state for ONE SVG element, as exact source patches.
 *
 * `display` / `visibility` are set, removed or toggled on the target element
 * only; a lock is a `data-locked="true"` marker attribute. Every mutation is a
 * `{start, end, before, after}` patch whose `before` is the exact existing
 * text, so `applyNativePatches` can build a byte-identical inverse. Setting a
 * value that did not exist inserts ` name="value"` at the end of the open tag;
 * removing one deletes the attribute plus its leading separator, so applying
 * the patch and then its inverse restores the original file exactly.
 *
 * Reads never mutate: `svgElementState` returns the current display,
 * visibility, locked and derived hidden flags.
 */
import { scanSvgDocument, svgAttributeInsertion, svgLockedAncestor } from './svg-document.mjs'

const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/
const LOCK_ATTRIBUTE = 'data-locked'
const DISPLAY_VALUES = new Set(['none', 'inline', 'block', 'inline-block', 'contents', 'inherit', 'initial', 'unset'])
const VISIBILITY_VALUES = new Set(['visible', 'hidden', 'collapse', 'inherit', 'initial', 'unset'])

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function requireNode(source, id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail('invalid-target', 'A valid SVG element id is required')
  const scan = scanSvgDocument(source)
  const node = scan.byId.get(id)
  if (!node) fail('unknown-node', 'SVG element id not found')
  if (node === scan.root) fail('unsafe-selection', 'The SVG root is not an editable layer')
  if (node.readOnly) fail('read-only', 'Referenced SVG content is read-only')
  return { scan, node }
}

function removalStart(source, node, attribute) {
  const before = source[attribute.nameStart - 1]
  return before !== undefined && /\s/.test(before) ? attribute.nameStart - 1 : attribute.nameStart
}

function attributePatch(source, node, name, value) {
  const existing = node.attributes.get(name)
  if (value === null) {
    if (!existing) fail('invalid-target', 'The ' + name + ' attribute is not present')
    const from = removalStart(source, node, existing)
    return { start: from, end: existing.end, before: source.slice(from, existing.end), after: '' }
  }
  if (existing) {
    return { start: existing.valueStart, end: existing.valueEnd, before: existing.value, after: value }
  }
  const at = svgAttributeInsertion(node)
  return { start: at, end: at, before: '', after: ' ' + name + '="' + value + '"' }
}

/** Current visibility/lock state of one element (read-only, no patch). */
export function svgElementState(source, { id } = {}) {
  const { node } = requireNode(source, id)
  const display = node.attributes.has('display') ? node.attributes.get('display').value : null
  const visibility = node.attributes.has('visibility') ? node.attributes.get('visibility').value : null
  const lock = node.attributes.get(LOCK_ATTRIBUTE)
  return {
    id,
    tag: node.tag,
    display,
    visibility,
    locked: Boolean(lock && lock.value === 'true'),
    hidden: display === 'none' || visibility === 'hidden' || visibility === 'collapse',
    start: node.start,
    end: node.end,
    openEnd: node.openEnd,
  }
}

/**
 * Set or remove one visibility property on ONE element.
 * `value: null` removes the attribute (restoring the SVG default) and is only
 * accepted when the attribute exists, so the inverse is always exact.
 */
export function svgVisibilityPatch(source, { id, property, value } = {}) {
  if (property !== 'display' && property !== 'visibility') {
    fail('invalid-target', 'Supported visibility properties are display and visibility')
  }
  const { node } = requireNode(source, id)
  if (svgLockedAncestor(node)) fail('locked', 'Element is locked; unlock it before changing visibility')
  if (value === undefined) fail('invalid-target', 'A ' + property + ' value is required')
  if (value !== null) {
    if (typeof value !== 'string') fail('invalid-value', 'Expected a string or null visibility value')
    const allowed = property === 'display' ? DISPLAY_VALUES : VISIBILITY_VALUES
    if (!allowed.has(value)) fail('invalid-value', 'Unsupported ' + property + ' value: ' + value)
  }
  return attributePatch(source, node, property, value)
}

/** Toggle one property: hide when visible, remove the override when hidden. */
export function svgToggleVisibility(source, { id, property } = {}) {
  if (property !== 'display' && property !== 'visibility') {
    fail('invalid-target', 'Supported visibility properties are display and visibility')
  }
  const state = svgElementState(source, { id })
  if (property === 'display') {
    return svgVisibilityPatch(source, { id, property, value: state.display === 'none' ? null : 'none' })
  }
  const hidden = state.visibility === 'hidden' || state.visibility === 'collapse'
  return svgVisibilityPatch(source, { id, property, value: hidden ? null : 'hidden' })
}

/**
 * Add (`data-locked="true"`) or remove the lock marker on ONE element.
 * Locking/unlocking is always allowed, including on a locked element; every
 * other mutation refuses with code `locked`.
 */
export function svgLockPatch(source, { id, locked } = {}) {
  if (typeof locked !== 'boolean') fail('invalid-target', 'Expected a boolean lock state')
  const { node } = requireNode(source, id)
  const existing = node.attributes.get(LOCK_ATTRIBUTE)
  if (locked) {
    if (existing && existing.value === 'true') fail('invalid-target', 'Element is already locked')
    if (existing) {
      return { start: existing.valueStart, end: existing.valueEnd, before: existing.value, after: 'true' }
    }
    const at = svgAttributeInsertion(node)
    return { start: at, end: at, before: '', after: ' ' + LOCK_ATTRIBUTE + '="true"' }
  }
  if (!existing || existing.value !== 'true') fail('invalid-target', 'Element is not locked')
  const from = removalStart(source, node, existing)
  return { start: from, end: existing.end, before: source.slice(from, existing.end), after: '' }
}
