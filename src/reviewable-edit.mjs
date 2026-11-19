import { applyNativePatches } from './native-patch.mjs'
import { MAX_NATIVE_FILE_BYTES } from './native-file-store.mjs'
import { cssMediaDeclarationPatch, cssVisualRulePatch } from './css-visual.mjs'
import { appendHtmlSlide, duplicateHtmlSlide, removeHtmlSlide, reorderHtmlSlide } from './html-presentation.mjs'
import { htmlVisualAttributePatch, htmlVisualStylePatch, htmlVisualTextPatch } from './html-visual.mjs'
import { svgAttributePatch } from './svg-attributes.mjs'
import { svgGradientGeometryPatch, svgGradientStopPatch } from './svg-gradient.mjs'
import { planSvgGradientCreation } from './svg-gradient-create.mjs'
import { svgShapeInsertPatch } from './svg-shapes.mjs'
import { svgTransformPatch } from './svg-transform.mjs'
import { svgOrderPatch } from './svg-order.mjs'
import { svgVisibilityPatch } from './svg-visibility.mjs'
import { svgTextPatch } from './svg-text.mjs'

const slidePlanners = Object.freeze({
  'slide-add': appendHtmlSlide,
  'slide-reorder': reorderHtmlSlide,
  'slide-duplicate': duplicateHtmlSlide,
  'slide-remove': removeHtmlSlide,
})
export const REVIEWABLE_EDIT_KINDS = Object.freeze([
  'svg-text', 'svg-attribute', 'svg-order', 'svg-visibility', 'svg-transform', 'svg-add-shape', 'svg-gradient-create', 'svg-gradient-stop', 'svg-gradient-geometry', 'html-text', 'html-style', 'html-attribute', 'css-rule', 'css-media', ...Object.keys(slidePlanners),
])

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

export function planShapeAddition(source,edit) {
  const positioned = Object.hasOwn(edit,'x') || Object.hasOwn(edit,'y')
  return svgShapeInsertPatch(source,edit.shape,positioned?{x:edit.x,y:edit.y}:null,edit.text)
}

export function planReviewableEdit(document, edit) {
  const { format, source } = document
  const { kind, id, value } = edit
  if (kind === 'svg-text' && format === 'svg') return [svgTextPatch(source, { id, value })]
  if (kind === 'svg-attribute' && format === 'svg') {
    return [svgAttributePatch(source, { id, attribute: edit.attribute, value })]
  }
  if (format === 'svg') {
    if (kind === 'svg-gradient-stop') return [svgGradientStopPatch(source,edit)]
    if (kind === 'svg-gradient-geometry') return [svgGradientGeometryPatch(source,edit)]
    if (kind === 'svg-gradient-create') return planSvgGradientCreation(source,edit).patches
    if (kind === 'svg-add-shape') return [planShapeAddition(source,edit).patch]
    if (kind === 'svg-transform') return [svgTransformPatch(source,{id,operation:edit.operation}).patch]
    if (kind === 'svg-order') return [svgOrderPatch(source,{id,direction:edit.direction}).patch]
    if (kind === 'svg-visibility') return [svgVisibilityPatch(source,{id,property:edit.property,value:value??null})]
  }
  if (Object.hasOwn(slidePlanners,kind) && (format === 'html' || format === 'htm')) {
    return [slidePlanners[kind](source, edit)]
  }
  if (format === 'html' || format === 'htm') {
    const target = {id,key:edit.key,path:edit.path}
    if (kind === 'html-text') return [htmlVisualTextPatch(source,{...target,text:value})]
    if (kind === 'html-style') return [htmlVisualStylePatch(source,{id,property:edit.property,value})]
    if (kind === 'html-attribute') {
      return [htmlVisualAttributePatch(source,{...target,name:edit.attribute,value:value??null})]
    }
  }
  if (kind === 'css-media' && format === 'css') return [cssMediaDeclarationPatch(source,edit)]
  if (kind === 'css-rule' && format === 'css') {
    return [cssVisualRulePatch(source, { selector: edit.selector, property: edit.property, value })]
  }
  fail('unsupported-format', 'This edit is not supported for the document format')
}

export function planReviewableBatch(document,edits) {
  return edits.map(edit=>planReviewableEdit(document,edit))
}

export function previewNativeEdit(document, patches) {
  const { source, format, hash, identity } = document
  const result = applyNativePatches({ source, format, baseHash: hash, patches })
  if (!result.ok) fail(result.code, result.message)
  if (Buffer.byteLength(result.source) > MAX_NATIVE_FILE_BYTES) {
    fail('too-large', 'Edited file exceeds 8 MiB')
  }
  return { patches, baseHash: hash, baseIdentity: identity, proposedHash: result.hash, changed: result.changed }
}
