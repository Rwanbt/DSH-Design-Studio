import { listEditableSvgNodes, svgRootAttributes } from './svg-attributes.mjs'

const MOVABLE = new Set(['rect', 'circle', 'ellipse'])
const MAX_COORD = 1_000_000

function finiteCoord(value) {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= MAX_COORD ? number : null
}

export function svgGeometry(source) {
  // Conservative subset: no transformed/nested groups or non-standard aspect ratios.
  // The SVG source is NOT parsed through a browser or executed.
  if (/<g(?:\\s|>)/i.test(source) || /<foreignObject(?:\\s|>)/i.test(source) || /\\btransform\\s*=/i.test(source)) {
    return { artboard: null, handles: [], warning: 'Drag editing requires an untransformed SVG with no groups or foreignObject' }
  }
  let root
  try { root = svgRootAttributes(source) }
  catch (error) { return { artboard: null, handles: [], warning: error.code || 'invalid-svg' } }
  const ratio = root.preserveAspectRatio
  if (typeof root.viewBox !== 'string' || (ratio && !/^xMidYMid\\s+meet$/.test(ratio.trim()))) {
    return { artboard: null, handles: [], warning: 'SVG drag requires a viewBox and default preserveAspectRatio' }
  }
  const parts = root.viewBox.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_COORD) ||
      parts[2] <= 0 || parts[3] <= 0) {
    return { artboard: null, handles: [], warning: 'Invalid or unsupported viewBox' }
  }
  const artboard = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
  let nodes
  try { nodes = listEditableSvgNodes(source) }
  catch (error) { return { artboard, handles: [], warning: error.code || 'invalid-svg' } }
  const handles = []
  for (const node of nodes) {
    if (!MOVABLE.has(node.tag) || node.attributes.transform) continue
    const a = node.attributes
    let x, y, width, height, move
    if (node.tag === 'rect') {
      const values = [a.x, a.y, a.width, a.height].map(finiteCoord)
      if (values.some(value => value === null)) continue
      ;[x,y,width,height] = values
      move = { x: 'x', y: 'y', initialX: x, initialY: y }
    } else {
      const values = [a.cx, a.cy, ...(node.tag === 'circle' ? [a.r, a.r] : [a.rx, a.ry])].map(finiteCoord)
      if (values.some(value => value === null)) continue
      const [cx,cy,rx,ry] = values
      x = cx - rx; y = cy - ry; width = rx * 2; height = ry * 2
      move = { x: 'cx', y: 'cy', initialX: cx, initialY: cy }
    }
    if (width <= 0 || height <= 0) continue
    handles.push({ id: node.id, tag: node.tag, x, y, width, height, move })
  }
  return { artboard, handles, warning: null }
}

function rounded(value) {
  const safe = Math.round((value + Number.EPSILON) * 1000) / 1000
  return String(Object.is(safe, -0) ? 0 : safe)
}

export function svgMoveEdits(handle, deltaX, deltaY) {
  if (!handle || !handle.move || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new TypeError('Invalid SVG move')
  }
  const { x, y, initialX, initialY } = handle.move
  if (![initialX, initialY].every(Number.isFinite)) throw new TypeError('Invalid SVG move origin')
  return [
    { id: handle.id, attribute: x, value: rounded(initialX + deltaX) },
    { id: handle.id, attribute: y, value: rounded(initialY + deltaY) }
  ]
}
