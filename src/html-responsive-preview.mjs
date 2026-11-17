import { HTML_STYLE_PROPERTIES } from './html-visual.mjs'

const MAX_PREVIEW_BYTES = 24 * 1024
const RULE_SELECTOR = /^[#.][A-Za-z_][A-Za-z0-9_-]{0,79}$/

/**
 * Builds a strictly allowlisted *partial* CSS preview from simple source
 * rules. This is not a CSS parser, cascade resolver or stylesheet renderer.
 * Only bytes matching the existing native manual style allowlist are emitted.
 * No original stylesheet bytes, at-rules or URLs are injected into srcDoc.
 *
 * Limits: only simple `#id`/`.class` rules with allowlisted declarations are
 * projected. Selector lists, combinators, custom properties, pseudo-classes,
 * conditional `@media`/`@supports` rules, inheritance, `!important`, external
 * or framework CSS and source maps are intentionally omitted, so the preview
 * is never a faithful computed rendering and is never presented as one.
 */
export function buildSafeLinkedPreviewCss(rules, acceptedSelectors, currentLength=0) {
  const permitted = new Set(acceptedSelectors)
  const css = []
  let omitted = 0, included = 0, truncated = false, length = currentLength
  for (const rule of rules) {
    if (!rule || !rule.editable || !RULE_SELECTOR.test(rule.selector) ||
        !permitted.has(rule.selector)) continue
    const declarations = []
    for (const item of rule.declarations || []) {
      if (!item || typeof item.property !== 'string' ||
          typeof item.value !== 'string' ||
          !Object.hasOwn(HTML_STYLE_PROPERTIES,item.property) ||
          !HTML_STYLE_PROPERTIES[item.property].test(item.value)) {
        omitted++
        continue
      }
      // Ignore properties with suspect fragments, even when the grammar
      // grows in future versions.
      if (/[{};@<>"'\\]/.test(item.value)) {
        omitted++
        continue
      }
      declarations.push(item.property+':'+item.value+';')
    }
    if (!declarations.length) continue
    const text=rule.selector+'{'+declarations.join('')+'}'
    const addition=text.length+(css.length?1:0)
    if (length+addition > MAX_PREVIEW_BYTES) {
      truncated=true
      omitted+=declarations.length
      continue
    }
    css.push(text)
    included+=declarations.length
    length+=addition
  }
  return {css:css.join('\n'),included,omitted,truncated}
}
