import { listEditableSvgNodes, svgRootAttributes } from './svg-attributes.mjs'
import { listSvgTextNodes } from './svg-text.mjs'
import { scanSvgDocument } from './svg-document.mjs'
import {
  SVG_IDENTITY_MATRIX,
  applySvgMatrix,
  invertSvgMatrixLinear,
  multiplySvgMatrices,
  parseSvgTransform,
} from './svg-transform.mjs'

const MOVABLE = new Set(['rect', 'circle', 'ellipse'])
const MAX_COORD = 1_000_000

function finiteCoord(value) {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= MAX_COORD ? number : null
}

function resolveArtboard(source) {
  let root
  try { root = svgRootAttributes(source) }
  catch (error) { return { root: null, artboard: null, warning: error.code || 'invalid-svg' } }
  const ratio = root.preserveAspectRatio
  if (typeof root.viewBox !== 'string' || (ratio && !/^xMidYMid\s+meet$/.test(ratio.trim()))) {
    return { root, artboard: null, warning: 'SVG drag requires a viewBox and default preserveAspectRatio' }
  }
  const parts = root.viewBox.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_COORD) ||
      parts[2] <= 0 || parts[3] <= 0) {
    return { root, artboard: null, warning: 'Invalid or unsupported viewBox' }
  }
  return { root, artboard: { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }, warning: null }
}

/**
 * Handles for a flat, untransformed SVG (historical conservative contract).
 * An opt-in absolute mode is available with `{transforms:true}` and applies the
 * ancestor + self transform chain instead of refusing nested/transformed
 * documents; see `svgAbsoluteGeometry`.
 */
export function svgGeometry(source, options = {}) {
  if (options && options.transforms === true) return absoluteGeometry(source)
  // Conservative subset: no transformed/nested groups or non-standard aspect ratios.
  // The SVG source is NOT parsed through a browser or executed.
  if (/<g(?:\s|>)/i.test(source) || /<foreignObject(?:\s|>)/i.test(source) || /\btransform\s*=/i.test(source)) {
    return { artboard: null, handles: [], warning: 'Drag editing requires an untransformed SVG with no groups or foreignObject' }
  }
  const { artboard, warning } = resolveArtboard(source)
  if (!artboard) return { artboard: null, handles: [], warning }
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
    handles.push({ id: node.id, tag: node.tag, x, y, width, height, move, resizable: node.tag === 'rect' || node.tag === 'ellipse' })
  }
  // Text hit areas are an estimate rather than glyph-perfect hit testing.
  for(const textNode of listSvgTextNodes(source)) {
    if(!textNode.editable)continue
    const a=textNode.attributes
    const x=finiteCoord(a.x), baseline=finiteCoord(a.y)
    const size=a['font-size']===undefined?16:finiteCoord(a['font-size'])
    if(x===null || baseline===null || size===null || size<=0)continue
    const lines=textNode.text.split('\n')
    const longest=Math.max(1,...lines.map(line=>Array.from(line).length))
    const width=Math.max(8,Math.min(artboard.width*2,longest*size*0.58))
    const height=size*Math.max(1,lines.length)*1.2
    const alignment=a['text-anchor']
    const left=alignment==='middle'?x-width/2:alignment==='end'?x-width:x
    handles.push({
      id:textNode.id, tag:'text',x:left,y:baseline-size,width,height,
      move:{x:'x',y:'y',initialX:x,initialY:baseline},
      resizable:false,text:true,
    })
  }
  return { artboard, handles, warning: null }
}

function absoluteMatrix(node) {
  const chain = []
  for (let current = node; current && current.parent; current = current.parent) chain.push(current)
  chain.reverse()
  let matrix = SVG_IDENTITY_MATRIX.slice()
  for (const element of chain) {
    const attribute = element.attributes.get('transform')
    if (!attribute) continue
    try { matrix = multiplySvgMatrices(matrix, parseSvgTransform(attribute.value).matrix) }
    catch (error) { return { error } }
  }
  return { matrix }
}

function localBox(node) {
  const numeric = (name) => {
    const attribute = node.attributes.get(name)
    return attribute ? finiteCoord(attribute.value) : null
  }
  let x, y, width, height
  if (node.tag === 'rect') {
    x = numeric('x'); y = numeric('y'); width = numeric('width'); height = numeric('height')
  } else {
    const cx = numeric('cx'); const cy = numeric('cy')
    const rx = node.tag === 'circle' ? numeric('r') : numeric('rx')
    const ry = node.tag === 'circle' ? numeric('r') : numeric('ry')
    if ([cx, cy, rx, ry].some(value => value === null)) return null
    x = cx - rx; y = cy - ry; width = rx * 2; height = ry * 2
  }
  if ([x, y, width, height].some(value => value === null) || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function absoluteBox(matrix, box) {
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].map(([x, y]) => applySvgMatrix(matrix, { x, y }))
  const xs = corners.map(point => point.x)
  const ys = corners.map(point => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function isIdentity(matrix) {
  return matrix.every((value, index) => Math.abs(value - SVG_IDENTITY_MATRIX[index]) <= 1e-9)
}

function isRotated(matrix) {
  return Math.abs(matrix[1]) > 1e-9 || Math.abs(matrix[2]) > 1e-9
}

function refusal(node, error) {
  return {
    id: node.id,
    tag: node.tag,
    reason: (error && error.code) || 'unsupported-transform',
    message: String((error && error.message) || 'Unsupported transform chain').slice(0, 200),
  }
}

/**
 * Absolute geometry for handles: each element's box is mapped through its
 * ancestor + own transform chain, so a handle reflects the visible position
 * and nested transforms compose correctly. Ambiguous cases are refused with a
 * typed reason in `refusals` instead of emitting wrong coordinates:
 * `<use>` instances, unknown/malformed transform functions, non-numeric or
 * percentage geometry, degenerate (non-invertible) matrices, and read-only
 * `<defs>` content (never listed).
 *
 * Handles also expose `local`, `matrix`, `rotated` and `move.inverse` so a
 * parent-space drag delta can be mapped back into the element's local
 * coordinates; resize stays disabled once a transform is involved because
 * `svgResizeEdits` writes local coordinates.
 */
export function svgAbsoluteGeometry(source) {
  return absoluteGeometry(source)
}

function absoluteGeometry(source) {
  const { root, artboard, warning } = resolveArtboard(source)
  if (!artboard) return { artboard: null, handles: [], warning, refusals: [], mode: 'absolute' }
  if (root.transform !== undefined) {
    return {
      artboard, handles: [], warning: 'unsupported-transform', mode: 'absolute',
      refusals: [{ id: null, tag: 'svg', reason: 'unsupported-transform', message: 'Root transform is not supported' }],
    }
  }
  let scan
  try { scan = scanSvgDocument(source) }
  catch (error) { return { artboard, handles: [], warning: error.code || 'invalid-svg', refusals: [], mode: 'absolute' } }
  const handles = []
  const refusals = []
  for (const node of scan.nodes) {
    if (node === scan.root || node.readOnly) continue
    if (node.tag === 'use') {
      refusals.push({
        id: node.id, tag: 'use', reason: 'unsupported-use',
        message: '<use> instance geometry requires resolving a referenced element',
      })
      continue
    }
    if (!MOVABLE.has(node.tag)) continue
    const chain = absoluteMatrix(node)
    if (chain.error) { refusals.push(refusal(node, chain.error)); continue }
    const local = localBox(node)
    if (!local) {
      refusals.push({
        id: node.id, tag: node.tag, reason: 'unsupported-geometry',
        message: 'Explicit numeric ' + (node.tag === 'rect' ? 'x/y/width/height' : 'cx/cy radius') + ' attributes are required',
      })
      continue
    }
    const inverse = invertSvgMatrixLinear(chain.matrix)
    if (!inverse) {
      refusals.push({
        id: node.id, tag: node.tag, reason: 'degenerate-transform',
        message: 'Transform is not invertible',
      })
      continue
    }
    const box = absoluteBox(chain.matrix, local)
    const identity = isIdentity(chain.matrix)
    const move = node.tag === 'rect'
      ? { x: 'x', y: 'y', initialX: local.x, initialY: local.y, inverse }
      : { x: 'cx', y: 'cy', initialX: local.x + local.width / 2, initialY: local.y + local.height / 2, inverse }
    handles.push({
      id: node.id, tag: node.tag,
      x: box.x, y: box.y, width: box.width, height: box.height,
      local, matrix: chain.matrix.slice(), rotated: isRotated(chain.matrix),
      move, resizable: identity && (node.tag === 'rect' || node.tag === 'ellipse'),
      absolute: true,
    })
  }
  // Text hit areas stay an estimate; they are transformed like any other box.
  for (const textNode of listSvgTextNodes(source)) {
    if (!textNode.editable) continue
    const node = scan.byId.get(textNode.id)
    if (!node || node.readOnly) continue
    const chain = absoluteMatrix(node)
    if (chain.error) { refusals.push(refusal(node, chain.error)); continue }
    const inverse = invertSvgMatrixLinear(chain.matrix)
    if (!inverse) {
      refusals.push({ id: node.id, tag: 'text', reason: 'degenerate-transform', message: 'Transform is not invertible' })
      continue
    }
    const a = textNode.attributes
    const x = finiteCoord(a.x), baseline = finiteCoord(a.y)
    const size = a['font-size'] === undefined ? 16 : finiteCoord(a['font-size'])
    if (x === null || baseline === null || size === null || size <= 0) {
      refusals.push({
        id: textNode.id, tag: 'text', reason: 'unsupported-geometry',
        message: 'Explicit numeric x/y and a positive font-size are required',
      })
      continue
    }
    const lines = textNode.text.split('\n')
    const longest = Math.max(1, ...lines.map(line => Array.from(line).length))
    const width = Math.max(8, Math.min(artboard.width * 2, longest * size * 0.58))
    const height = size * Math.max(1, lines.length) * 1.2
    const alignment = a['text-anchor']
    const left = alignment === 'middle' ? x - width / 2 : alignment === 'end' ? x - width : x
    const local = { x: left, y: baseline - size, width, height }
    const box = absoluteBox(chain.matrix, local)
    handles.push({
      id: textNode.id, tag: 'text',
      x: box.x, y: box.y, width: box.width, height: box.height,
      local, matrix: chain.matrix.slice(), rotated: isRotated(chain.matrix),
      move: { x: 'x', y: 'y', initialX: x, initialY: baseline, inverse },
      resizable: false, text: true, absolute: true, approximate: true,
    })
  }
  // Group handles: a group is not directly drawable, but a user who grouped
  // shapes must still be able to move the group. Its box is the union of its
  // addressable descendants, and a drag becomes one translate transform applied
  // in the PARENT coordinate space (so the parent's inverse maps the visible
  // delta back to local units).
  const handleById = new Map(handles.map((handle) => [handle.id, handle]))
  for (const node of scan.nodes) {
    if (node.tag !== 'g' || node === scan.root || node.readOnly) continue
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let children = 0
    const stack = [...node.children]
    while (stack.length) {
      const child = stack.pop()
      const handle = child.id ? handleById.get(child.id) : null
      if (handle) {
        children += 1
        minX = Math.min(minX, handle.x)
        minY = Math.min(minY, handle.y)
        maxX = Math.max(maxX, handle.x + handle.width)
        maxY = Math.max(maxY, handle.y + handle.height)
      }
      stack.push(...child.children)
    }
    if (children === 0 || !Number.isFinite(minX)) continue
    const parentChain = node.parent ? absoluteMatrix(node.parent) : { matrix: [1, 0, 0, 1, 0, 0] }
    if (parentChain.error) { refusals.push(refusal(node, parentChain.error)); continue }
    const inverse = invertSvgMatrixLinear(parentChain.matrix)
    if (!inverse) {
      refusals.push({ id: node.id, tag: 'g', reason: 'degenerate-transform', message: 'Parent transform is not invertible' })
      continue
    }
    handles.push({
      id: node.id,
      tag: 'g',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      move: { kind: 'translate', inverse },
      resizable: false,
      absolute: true,
      group: true,
      children,
    })
  }
  return { artboard, handles, warning: null, refusals, mode: 'absolute' }
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
  const inverse = handle.move.inverse
  if (Array.isArray(inverse)) {
    // A pointer delta is expressed in the parent/user space: map it back into
    // the element's local coordinate system so the source edit stays correct.
    const localX = inverse[0] * deltaX + inverse[2] * deltaY
    const localY = inverse[1] * deltaX + inverse[3] * deltaY
    if (![localX, localY].every(Number.isFinite)) throw new TypeError('Invalid SVG move transform')
    return [
      { id: handle.id, attribute: x, value: rounded(initialX + localX) },
      { id: handle.id, attribute: y, value: rounded(initialY + localY) }
    ]
  }
  return [
    { id: handle.id, attribute: x, value: rounded(initialX + deltaX) },
    { id: handle.id, attribute: y, value: rounded(initialY + deltaY) }
  ]
}

/** South-east handle resize in SVG user units. Opposite corner stays fixed.
 * Rect updates width/height; ellipse updates cx/cy/rx/ry. Circles are not
 * resized until an aspect-ratio constrained interaction is implemented.
 */
export function svgResizeEdits(handle, deltaX, deltaY) {
  if (!handle || handle.resizable !== true || !['rect','ellipse'].includes(handle.tag) ||
      !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new TypeError('Unsupported SVG resize')
  }
  if (![handle.x,handle.y,handle.width,handle.height].every(Number.isFinite) ||
      handle.width <= 0 || handle.height <= 0) {
    throw new TypeError('Invalid SVG dimensions')
  }
  const width = Math.max(1, handle.width + deltaX)
  const height = Math.max(1, handle.height + deltaY)
  if (handle.tag === 'rect') {
    return [
      { id: handle.id, attribute: 'width', value: rounded(width) },
      { id: handle.id, attribute: 'height', value: rounded(height) },
    ]
  }
  return [
    { id: handle.id, attribute: 'cx', value: rounded(handle.x + width / 2) },
    { id: handle.id, attribute: 'cy', value: rounded(handle.y + height / 2) },
    { id: handle.id, attribute: 'rx', value: rounded(width / 2) },
    { id: handle.id, attribute: 'ry', value: rounded(height / 2) },
  ]
}

/**
 * Four-corner resize for untransformed rectangles/ellipses, in SVG user units.
 * With lockAspect=true, preserve original width/height; the opposing corner
 * stays anchored. The minimum width/height is 1 SVG unit. Crossovers clamp.
 */
export function svgResizeCornerGeometry(handle, corner, dx, dy, lockAspect = false) {
  if (!handle || !handle.resizable || !['rect','ellipse'].includes(handle.tag) ||
      !['nw','ne','sw','se'].includes(corner) ||
      ![dx,dy,handle.x,handle.y,handle.width,handle.height].every(Number.isFinite) ||
      handle.width <= 0 || handle.height <= 0) {
    throw new TypeError('Unsupported SVG corner resize')
  }
  const leftSide=corner.includes('w'), topSide=corner.includes('n')
  const anchorX=leftSide?handle.x+handle.width:handle.x
  const anchorY=topSide?handle.y+handle.height:handle.y
  let width=Math.max(1,handle.width + (leftSide?-dx:dx))
  let height=Math.max(1,handle.height + (topSide?-dy:dy))
  if(lockAspect) {
    // Choose the axis with the largest proportional movement; clamp once.
    const scale=Math.max(Math.max(1/handle.width,1/handle.height),
      Math.abs(width/handle.width-1)>=Math.abs(height/handle.height-1)?
        width/handle.width:height/handle.height)
    width=Math.max(1,handle.width*scale)
    height=Math.max(1,handle.height*scale)
  }
  const x=leftSide?anchorX-width:anchorX
  const y=topSide?anchorY-height:anchorY
  return {x,y,width,height}
}

export function svgResizeCornerEdits(handle,corner,dx,dy,lockAspect=false) {
  const rect=svgResizeCornerGeometry(handle,corner,dx,dy,lockAspect)
  if(handle.tag==='rect')return [
    {id:handle.id,attribute:'x',value:rounded(rect.x)},
    {id:handle.id,attribute:'y',value:rounded(rect.y)},
    {id:handle.id,attribute:'width',value:rounded(rect.width)},
    {id:handle.id,attribute:'height',value:rounded(rect.height)},
  ]
  return [
    {id:handle.id,attribute:'cx',value:rounded(rect.x+rect.width/2)},
    {id:handle.id,attribute:'cy',value:rounded(rect.y+rect.height/2)},
    {id:handle.id,attribute:'rx',value:rounded(rect.width/2)},
    {id:handle.id,attribute:'ry',value:rounded(rect.height/2)},
  ]
}
