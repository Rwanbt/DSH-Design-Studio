import { applyNativePatches } from './native-patch.mjs'
import { MAX_NATIVE_FILE_BYTES } from './native-file-store.mjs'
import { cssVisualRulePatch } from './css-visual.mjs'
import { htmlVisualTextPatch } from './html-visual.mjs'
import { svgAttributePatch } from './svg-attributes.mjs'
import { svgTextPatch } from './svg-text.mjs'

export const REVIEWABLE_EDIT_KINDS = Object.freeze(['svg-text', 'svg-attribute', 'html-text', 'css-rule'])

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

export function planReviewableEdit(document, edit) {
  const { format, source } = document
  const { kind, id, value } = edit
  if (kind === 'svg-text' && format === 'svg') return [svgTextPatch(source, { id, value })]
  if (kind === 'svg-attribute' && format === 'svg') {
    return [svgAttributePatch(source, { id, attribute: edit.attribute, value })]
  }
  if (kind === 'html-text' && (format === 'html' || format === 'htm')) {
    return [htmlVisualTextPatch(source, { id, key: edit.key, path: edit.path, text: value })]
  }
  if (kind === 'css-rule' && format === 'css') {
    return [cssVisualRulePatch(source, { selector: edit.selector, property: edit.property, value })]
  }
  fail('unsupported-format', 'This edit is not supported for the document format')
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
