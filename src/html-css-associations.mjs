import path from 'node:path'
import { listHtmlVisualElements, listHtmlStylesheetLinks } from './html-visual.mjs'
import { listCssVisualRuleDetails, parseCssSelectorList } from './css-visual.mjs'
import { buildSafeLinkedPreviewCss } from './html-responsive-preview.mjs'

const MAX_LINKS=8
const MAX_CSS_SOURCE=512*1024

/**
 * Read-only association between static HTML elements and nearby local CSS files.
 *
 * This is deliberately NOT a CSS cascade resolver and NOT a computed-style
 * engine. Matches are labelled `certainty: 'possible'`: a structurally
 * matching top-level rule in a local stylesheet, with an indicative static
 * specificity. Inline styles, inheritance, `!important`, stylesheet order,
 * conditional/at-rule rules, pseudo-classes and framework CSS can all change
 * the value a browser finally applies; nothing here claims otherwise.
 *
 * Only structural selectors (type, `#id`, `.class`, compounds of those) are
 * matched. Descendant/child/adjacent/sibling combinators, universal
 * selectors, unsupported selector syntax and rules nested inside at-rules
 * are refused with typed `ambiguousSelectors` entries instead of being
 * guessed. External stylesheets, `@import` resolution, framework/preprocessor
 * CSS and source maps are out of scope.
 */
export function resolveStylesheetPath(htmlFile,href) {
  if(typeof htmlFile!=='string'||typeof href!=='string'||!href||href.length>256 ||
     !/^[A-Za-z0-9._/-]+\.css$/i.test(href) ||
     href.startsWith('/')||href.includes('//')||href.includes('\\') ||
     href.split('/').some(part=>!part||part==='..'||(part==='.'&&href[0]!=='.')))return null
  // A single leading "./" is permitted, but parent-directory traversal,
  // URI schemes, query/fragment and percent escapes are always refused.
  const normalizedHref=href.startsWith('./')?href.slice(2):href
  if(!normalizedHref || normalizedHref.split('/').some(part=>!part||part.startsWith('.')))return null
  const resolved=path.posix.join(path.posix.dirname(htmlFile),normalizedHref)
  if(resolved.startsWith('/') || resolved.split('/').some(part=>part==='..'||!part) ||
     path.posix.extname(resolved).toLowerCase()!=='.css')return null
  return resolved
}

function memberMatchesElement(member,element) {
  if(member.hasCombinators||member.universalOnly)return false
  const compound=member.compounds[0]
  for(const token of compound.tokens){
    if(token.kind==='tag'&&token.name!==element.tag)return false
    if(token.kind==='id'&&token.name!==element.id)return false
    if(token.kind==='class'&&!element.classes.includes(token.name))return false
  }
  return true
}

function memberIsApproximate(member) {
  return !member.simple||member.compounds[0].tokens.length>1
}

function sheetAmbiguities(details) {
  const found=[],seen=new Set()
  const add=(selector,reason,extra={})=>{
    const key=selector+'|'+reason
    if(seen.has(key))return
    seen.add(key)
    found.push({selector,reason,...extra})
  }
  for(const rule of details){
    if(rule.scope!=='top-level'){
      add(rule.selector,'inside-at-rule',{atRule:rule.atRule||'unknown'})
      continue
    }
    const parsed=parseCssSelectorList(rule.selector)
    if(!parsed.ok){add(rule.selector,'unsupported-selector');continue}
    for(const member of parsed.members){
      if(member.hasCombinators)add(member.selector,'combinator-not-evaluated')
      else if(member.universalOnly)add(member.selector,'universal-selector-not-evaluated')
    }
  }
  return found
}

export async function collectHtmlCssCandidates(store,htmlDocument) {
  const elements=listHtmlVisualElements(htmlDocument.source)
  const refs=listHtmlStylesheetLinks(htmlDocument.source)
  const stylesheets=[]
  const styleMatches=elements.map(element=>({
    id:element.id,key:element.key,path:element.path,matches:[],
  }))
  const visited=new Set()
  const permittedSelectors=new Set()
  const previewParts=[]
  let previewLength=0,previewDeclarations=0,previewOmitted=0,previewTruncated=false
  for(const item of elements) {
    if(!item.editable)continue
    permittedSelectors.add('#'+item.id)
    for(const name of item.classes)permittedSelectors.add('.'+name)
  }
  for(let index=0;index<refs.length;index++){
    const ref=refs[index]
    if(index>=MAX_LINKS) {
      stylesheets.push({status:'limit-exceeded',reason:'Only eight static stylesheet links are inspected'})
      break
    }
    if(!ref.valid){
      stylesheets.push({status:'unsupported-link',reason:ref.reason})
      continue
    }
    const file=resolveStylesheetPath(htmlDocument.file,ref.href)
    if(!file){
      stylesheets.push({status:'unsupported-link',reason:'Only safe relative .css paths are supported'})
      continue
    }
    if(visited.has(file)){
      stylesheets.push({file,status:'duplicate-link'})
      continue
    }
    visited.add(file)
    let sheet
    try{sheet=await store.read(file)}
    catch(_){
      stylesheets.push({file,status:'unavailable'})
      continue
    }
    if(sheet.source.length>MAX_CSS_SOURCE){
      stylesheets.push({file,status:'too-large'})
      continue
    }
    const details=listCssVisualRuleDetails(sheet.source)
    const parsedRules=details.map(rule=>({
      rule,parsed:rule.scope==='top-level'?parseCssSelectorList(rule.selector):null,
    }))
    // Account for the newline that joins successive linked sheets as well.
    const separator=previewParts.length?1:0
    const safePreview=buildSafeLinkedPreviewCss(details,permittedSelectors,previewLength+separator)
    if(safePreview.css) {
      previewParts.push(safePreview.css)
      previewLength+=safePreview.css.length+separator
    }
    previewDeclarations+=safePreview.included
    previewOmitted+=safePreview.omitted
    previewTruncated ||= safePreview.truncated
    const ambiguousSelectors=sheetAmbiguities(details)
    const summary={file,status:'inspected',identity:sheet.identity,
      ruleCount:details.filter(rule=>rule.scope==='top-level').length}
    if(ambiguousSelectors.length)summary.ambiguousSelectors=ambiguousSelectors
    stylesheets.push(summary)
    for(let elementIndex=0;elementIndex<elements.length;elementIndex+=1){
      const element=elements[elementIndex]
      if(!element.editable)continue
      for(const {rule,parsed} of parsedRules){
        if(rule.scope!=='top-level'||!parsed?.ok)continue
        const matched=parsed.members.filter(member=>memberMatchesElement(member,element))
        if(!matched.length)continue
        const candidate={
          file,selector:rule.selector,cssIdentity:sheet.identity,
          matchedSelector:matched[0].selector,
          specificity:Math.max(...matched.map(member=>member.specificity)),
          specificityApproximate:matched.length>1||
            matched.some(member=>memberIsApproximate(member)),
          // A duplicated selector cannot be presented as one possible rule:
          // the target declaration block is ambiguous, so it is refused.
          certainty:rule.reasonCode==='duplicate-selector'?'ambiguous':'possible',
          editable:rule.editable,reason:rule.reason,reasonCode:rule.reasonCode,
          declarations:rule.declarations.map(({property,value})=>({property,value})),
        }
        if(matched.length>1)
          candidate.matchedSelectors=matched.map(member=>member.selector)
        const unresolved=parsed.members.filter(member=>
          member.hasCombinators||member.universalOnly)
        if(unresolved.length)
          candidate.unresolvedSelectors=unresolved.map(member=>member.selector)
        styleMatches[elementIndex].matches.push(candidate)
      }
    }
  }
  for(const association of styleMatches){
    const duplicates=new Set()
    for(const match of association.matches){
      const key=match.selector
      if(duplicates.has(key))match.duplicateAcrossFiles=true
      duplicates.add(key)
    }
  }
  return {stylesheets,styleMatches,
    previewCss:previewParts.join('\n'),
    previewCoverage:{status:'partial',includedDeclarations:previewDeclarations,
      omittedDeclarations:previewOmitted,truncated:previewTruncated}}
}
