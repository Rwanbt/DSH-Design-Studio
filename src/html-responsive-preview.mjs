import { HTML_STYLE_PROPERTIES } from './html-visual.mjs'
import { parseCssSelectorList, simpleMediaCondition } from './css-visual.mjs'

const MAX_PREVIEW_BYTES = 24 * 1024
const SELECTOR_CHARACTERS = /^[A-Za-z0-9_#.*,+>~\s-]+$/
const tokenPrefix = {tag:'',id:'#',class:'.'}

function projectedSelector(selector, permitted) {
  if (typeof selector!=='string' || !SELECTOR_CHARACTERS.test(selector)) return ''
  const parsed = parseCssSelectorList(selector)
  if (!parsed.ok) return ''
  return parsed.members.filter(member=>{
    const subject = member.compounds.at(-1)
    return subject.tokens.length>0 &&
      subject.tokens.every(token=>permitted.has(tokenPrefix[token.kind]+token.name))
  }).map(member=>member.selector).join(',')
}

/**
 * Builds a strictly allowlisted *partial* CSS preview from simple source
 * rules. This is not a CSS parser, cascade resolver or stylesheet renderer.
 * Only bytes matching the existing native manual style allowlist are emitted.
 * Simple width media queries are rebuilt from validated conditions and rules.
 * Original stylesheet bytes, URLs, other at-rules, and unsupported selectors
 * are omitted. The resulting stylesheet is a partial preview.
 */
export function buildSafeLinkedPreviewCss(rules, acceptedSelectors, currentLength=0) {
  const permitted = new Set(acceptedSelectors)
  const css = []
  let omitted = 0, included = 0, truncated = false, length = currentLength
  for (const rule of rules) {
    if (!rule) continue
    const media = rule.scope==='inside-at-rule' && rule.mediaEditable
      ? simpleMediaCondition([{name:'media',prelude:rule.mediaCondition}]) : null
    if (!media && (!rule.editable || (rule.scope && rule.scope!=='top-level'))) continue
    const selector = projectedSelector(rule.selector,permitted)
    if (!selector) continue
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
    const block=selector+'{'+declarations.join('')+'}'
    const text=media?'@media '+media+'{'+block+'}':block
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
