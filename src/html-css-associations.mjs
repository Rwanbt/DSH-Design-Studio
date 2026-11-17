import path from 'node:path'
import { listHtmlVisualElements, listHtmlStylesheetLinks } from './html-visual.mjs'
import { listCssVisualRules } from './css-visual.mjs'

const MAX_LINKS=8
const MAX_CSS_SOURCE=512*1024

/**
 * Read-only association between static HTML IDs/classes and nearby CSS files.
 * Intentionally NOT a CSS cascade resolver: these are *candidate rules*, not
 * browser computed styles and not evidence that a declaration takes effect.
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

export async function collectHtmlCssCandidates(store,htmlDocument) {
  const elements=listHtmlVisualElements(htmlDocument.source)
  const refs=listHtmlStylesheetLinks(htmlDocument.source)
  const stylesheets=[],styleMatches=elements.map(el=>({id:el.id,matches:[]}))
  const byId=new Map(styleMatches.map(entry=>[entry.id,entry]))
  const visited=new Set()
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
    const rules=listCssVisualRules(sheet.source)
    stylesheets.push({file,status:'inspected',identity:sheet.identity,
      ruleCount:rules.length})
    for(const item of elements){
      if(!item.editable)continue
      for(const rule of rules){
        if(rule.selector!=='#'+item.id &&
           !(rule.selector.startsWith('.') && item.classes.includes(rule.selector.slice(1))))continue
        byId.get(item.id).matches.push({
          file,selector:rule.selector,cssIdentity:sheet.identity,
          specificity:rule.selector.startsWith('#')?100:10,
          editable:rule.editable,reason:rule.reason,
          declarations:rule.declarations
        })
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
  return {stylesheets,styleMatches}
}
