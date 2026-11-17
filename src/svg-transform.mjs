/**
 * Source-accurate SVG transform engine (no DOM, no serialisation).
 *
 * Parses an existing `transform` attribute strictly (translate/scale/rotate/
 * matrix/skewX/skewY, space or comma separated, several functions), refuses
 * unknown functions, units, percentages and malformed syntax with typed error
 * codes, then composes one new operation in the user's coordinate space and
 * writes back ONE normalised `matrix(a,b,c,d,e,f)` that preserves the previous
 * effective transform.
 *
 * Matrices are the SVG 2-D affine convention [a, b, c, d, e, f]:
 *   x' = a·x + c·y + e      y' = b·x + d·y + f
 * A transform list `A B` applies A first, so it composes as A·B. A new
 * user-space operation is therefore applied on the LEFT: M' = Op·M.
 */
import { scanSvgDocument, svgAttributeInsertion, svgLockedAncestor } from './svg-document.mjs'

const MAX_VALUE_LENGTH = 4096
const MAX_COMPONENT = 1_000_000
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const FUNCTION = /^[A-Za-z][A-Za-z0-9_]*/
const ARITY = new Map([
  ['matrix', [6]],
  ['translate', [1, 2]],
  ['scale', [1, 2]],
  ['rotate', [1, 3]],
  ['skewX', [1]],
  ['skewY', [1]],
])
const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function component(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COMPONENT) {
    fail('invalid-transform', 'Invalid ' + label)
  }
  return value
}

function radians(degrees, label) {
  return component(degrees, label) * Math.PI / 180
}

/** Identity affine matrix; frozen so callers cannot mutate shared state. */
export const SVG_IDENTITY_MATRIX = Object.freeze([1, 0, 0, 1, 0, 0])

function assertMatrix(matrix, label) {
  if (!Array.isArray(matrix) || matrix.length !== 6) {
    fail('invalid-transform', label + ' must be a 6-component matrix')
  }
  for (const value of matrix) component(value, label)
  return matrix
}

/** Matrix product A·B (B applies first when mapping a point). */
export function multiplySvgMatrices(left, right) {
  assertMatrix(left, 'left matrix')
  assertMatrix(right, 'right matrix')
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

export function applySvgMatrix(matrix, point) {
  assertMatrix(matrix, 'matrix')
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number' ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    fail('invalid-transform', 'Expected a finite point')
  }
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  }
}

/**
 * Linear part of the inverse as [ia, ib, ic, id] (translation is not needed to
 * map a parent-space *delta* into local space), or null for a degenerate
 * matrix. Callers must refuse rather than emit wrong coordinates.
 */
/**
 * Full affine inverse `[a,b,c,d,e,f]` of a 2x3 matrix, or null when singular.
 * Used to map a pivot expressed in artboard space into an element's parent space.
 */
export function invertSvgMatrix(matrix) {
  const [a, b, c, d, e, f] = assertMatrix(matrix, 'matrix')
  const det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const ia = d / det
  const ib = -b / det
  const ic = -c / det
  const id = a / det
  // Normalise negative zero: it is mathematically equivalent but would make
  // identity comparisons (and JSON snapshots) unstable.
  const clean = (value) => (Object.is(value, -0) ? 0 : value)
  return [clean(ia), clean(ib), clean(ic), clean(id),
    clean(-(ia * e + ic * f)), clean(-(ib * e + id * f))]
}

export function invertSvgMatrixLinear(matrix) {
  assertMatrix(matrix, 'matrix')
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2]
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null
  const sign = (value) => (Object.is(value, -0) ? 0 : value)
  return [
    sign(matrix[3] / determinant),
    sign(-matrix[1] / determinant),
    sign(-matrix[2] / determinant),
    sign(matrix[0] / determinant),
  ]
}

function functionMatrix(name, args) {
  if (name === 'translate') return [1, 0, 0, 1, args[0], args.length > 1 ? args[1] : 0]
  if (name === 'scale') {
    const sx = args[0]
    const sy = args.length > 1 ? args[1] : sx
    return [sx, 0, 0, sy, 0, 0]
  }
  if (name === 'matrix') return args.slice(0, 6)
  if (name === 'rotate') {
    const angle = radians(args[0], 'rotation angle')
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotation = [cos, sin, -sin, cos, 0, 0]
    if (args.length < 3) return rotation
    const cx = args[1]
    const cy = args[2]
    return multiplySvgMatrices(multiplySvgMatrices([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy])
  }
  if (name === 'skewX') return [1, 0, Math.tan(radians(args[0], 'skew angle')), 1, 0, 0]
  if (name === 'skewY') return [1, Math.tan(radians(args[0], 'skew angle')), 0, 1, 0, 0]
  fail('unsupported-transform', 'Unknown transform function: ' + name)
}

/**
 * Strict parser. Returns {operations, matrix, text} or throws a typed error.
 * Every number must be a plain unit-less number: `10px`, `45deg` and `50%`
 * are refused instead of silently coerced.
 */
export function parseSvgTransform(value) {
  if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH || !value.trim()) {
    fail('invalid-transform', 'Expected a non-empty SVG transform value')
  }
  const operations = []
  let matrix = SVG_IDENTITY_MATRIX.slice()
  let at = 0
  let needFunction = false
  const skip = () => { while (at < value.length && /\s/.test(value[at])) at += 1 }
  while (true) {
    skip()
    if (at >= value.length) {
      if (needFunction) fail('invalid-transform', 'Trailing separator in transform value')
      break
    }
    needFunction = false
    const match = FUNCTION.exec(value.slice(at))
    if (!match) fail('invalid-transform', 'Expected a transform function name')
    const name = match[0]
    const arity = ARITY.get(name)
    if (!arity) fail('unsupported-transform', 'Unknown transform function: ' + name)
    at += name.length
    skip()
    if (value[at] !== '(') fail('invalid-transform', 'Expected "(" after ' + name)
    at += 1
    const args = []
    let commaPending = false
    while (true) {
      skip()
      if (at >= value.length) fail('invalid-transform', 'Unclosed ' + name + '() function')
      if (value[at] === ')') {
        if (commaPending) fail('invalid-transform', 'Trailing comma in ' + name + '()')
        at += 1
        break
      }
      const numberMatch = NUMBER.exec(value.slice(at))
      if (!numberMatch) {
        if (value[at] === '%') fail('unsupported-transform', 'Percentages are not supported in transform values')
        fail('invalid-transform', 'Expected a number in ' + name + '()')
      }
      const number = Number(numberMatch[0])
      at += numberMatch[0].length
      args.push(component(number, 'transform component'))
      commaPending = false
      skip()
      if (value[at] === ',') { at += 1; commaPending = true; continue }
      if (value[at] === ')' || at >= value.length) continue
      if (/[+\-.\d]/.test(value[at])) continue
      if (value[at] === '%') fail('unsupported-transform', 'Percentages are not supported in transform values')
      if (/[A-Za-z]/.test(value[at])) {
        const unit = /^[A-Za-z][A-Za-z0-9]*/.exec(value.slice(at))[0]
        fail('unsupported-transform', 'Units are not supported in transform values: ' + unit)
      }
      fail('invalid-transform', 'Unexpected character in ' + name + '()')
    }
    if (!arity.includes(args.length)) {
      fail('invalid-transform', 'Wrong number of arguments for ' + name + '()')
    }
    operations.push({ name, args })
    matrix = multiplySvgMatrices(matrix, functionMatrix(name, args))
    skip()
    if (value[at] === ',') { at += 1; needFunction = true }
  }
  return { operations, matrix, text: formatSvgMatrix(matrix) }
}

/**
 * Matrix of one semantic operation, in the parent/user coordinate space.
 * Supported: translate {dx,dy?}, scale {sx,sy?,pivot?}, rotate {angle,pivot?},
 * skewX/skewY {angle} and matrix {matrix:[6]}. A pivot is expressed in the
 * coordinate space where the transform already acts.
 */
export function transformOperationMatrix(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    fail('invalid-transform', 'Expected a transform operation object')
  }
  const type = operation.type
  let pivot = null
  if (operation.pivot !== undefined && operation.pivot !== null) {
    const point = operation.pivot
    if (typeof point !== 'object' || Array.isArray(point)) fail('invalid-transform', 'Expected a pivot point')
    pivot = { x: component(point.x, 'pivot x'), y: component(point.y, 'pivot y') }
  }
  let core
  if (type === 'translate') {
    if (pivot) fail('invalid-transform', 'Translation does not accept a pivot')
    const dx = component(operation.dx, 'translate dx')
    const dy = operation.dy === undefined ? 0 : component(operation.dy, 'translate dy')
    core = [1, 0, 0, 1, dx, dy]
  } else if (type === 'scale') {
    const sx = component(operation.sx, 'scale sx')
    const sy = operation.sy === undefined ? sx : component(operation.sy, 'scale sy')
    core = [sx, 0, 0, sy, 0, 0]
  } else if (type === 'rotate') {
    core = functionMatrix('rotate', [component(operation.angle, 'rotation angle')])
  } else if (type === 'skewX' || type === 'skewY') {
    core = functionMatrix(type, [component(operation.angle, 'skew angle')])
  } else if (type === 'matrix') {
    if (operation.matrix === undefined) fail('invalid-transform', 'A matrix operation requires 6 components')
    core = assertMatrix(operation.matrix, 'operation matrix').slice()
    if (pivot) fail('invalid-transform', 'A matrix operation does not accept a pivot')
  } else {
    fail('unsupported-transform', 'Unsupported transform operation: ' + String(type))
  }
  if (!pivot) return core
  return multiplySvgMatrices(multiplySvgMatrices([1, 0, 0, 1, pivot.x, pivot.y], core), [1, 0, 0, 1, -pivot.x, -pivot.y])
}

function formatComponent(value) {
  const rounded = Math.round(value * 1e6) / 1e6
  const safe = Object.is(rounded, -0) ? 0 : rounded
  return String(Math.abs(safe) < 1e-9 ? 0 : safe)
}

/** One normalised, unit-less `matrix(a,b,c,d,e,f)` string. */
export function formatSvgMatrix(matrix) {
  assertMatrix(matrix, 'matrix')
  return 'matrix(' + matrix.map(formatComponent).join(',') + ')'
}

/**
 * Compose one operation on top of an existing transform value.
 * Returns {matrix, text, previous: {operations, matrix, text}}.
 */
export function composeSvgTransform(value, operation) {
  const previous = parseSvgTransform(value)
  const matrix = multiplySvgMatrices(transformOperationMatrix(operation), previous.matrix)
  return { matrix, text: formatSvgMatrix(matrix), previous }
}

function requireEditableNode(source, id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail('invalid-target', 'A valid SVG element id is required')
  const scan = scanSvgDocument(source)
  const node = scan.byId.get(id)
  if (!node) fail('unknown-node', 'SVG element id not found')
  if (node === scan.root) fail('unsafe-selection', 'The SVG root cannot be transformed in place')
  if (node.readOnly) fail('read-only', 'Referenced SVG content is read-only')
  if (svgLockedAncestor(node)) fail('locked', 'Element is locked')
  return { scan, node }
}

/** Current effective transform of one node: {value, matrix, text} or identity. */
export function svgTransformValue(source, { id } = {}) {
  const { node } = requireEditableNode(source, id)
  const attribute = node.attributes.get('transform')
  if (!attribute) return { id, value: null, matrix: SVG_IDENTITY_MATRIX.slice(), text: formatSvgMatrix(SVG_IDENTITY_MATRIX) }
  const parsed = parseSvgTransform(attribute.value)
  return { id, value: attribute.value, matrix: parsed.matrix, text: parsed.text, operations: parsed.operations }
}

/**
 * Patch that replaces (or creates) one element's `transform` attribute with a
 * single normalised matrix preserving the previous effective transform.
 * Writing back only the attribute value keeps every other byte untouched.
 */
export function svgTransformPatch(source, { id, operation } = {}) {
  const { node } = requireEditableNode(source, id)
  const attribute = node.attributes.get('transform')
  const previous = attribute ? parseSvgTransform(attribute.value) : { operations: [], matrix: SVG_IDENTITY_MATRIX.slice(), text: formatSvgMatrix(SVG_IDENTITY_MATRIX) }
  const matrix = multiplySvgMatrices(transformOperationMatrix(operation), previous.matrix)
  const text = formatSvgMatrix(matrix)
  if (attribute) {
    return {
      patch: { start: attribute.valueStart, end: attribute.valueEnd, before: attribute.value, after: text },
      matrix,
      text,
      previous: previous.text,
      created: false,
    }
  }
  const at = svgAttributeInsertion(node)
  return {
    patch: { start: at, end: at, before: '', after: ' transform="' + text + '"' },
    matrix,
    text,
    previous: null,
    created: true,
  }
}
