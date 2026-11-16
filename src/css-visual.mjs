/**
 * Source-preserving CSS rule inspector for standalone .css documents.
 *
 * This scanner deliberately supports only unique top-level #id or .class
 * rules with a flat, unambiguous declaration block. No CSS is executed.
 * Nested @rules, selector lists, escapes, comments inside a declaration,
 * and dynamic expressions remain source-only until a full parser is vetted.
 */
import { HTML_STYLE_PROPERTIES } from './html-visual.mjs'

const MAX_SOURCE=512*1024
const MAX_RULES=200
const SELECTOR=/^[#.][A-Za-z_][A-Za-z0-9_-]{0,79}$/
function fail(code,message){const error=new Error(message);error.code=code;throw error}
function scan(source) {
  if(typeof source!=='string' || source.length>MAX_SOURCE)return []
  const found=[]
  let depth=0,start=0,opening=0,ruleStart=0,comment=false,quote=null,escaped=false,nested=false
  for(let i=0;i<source.length;i++){
    const current=source[i],next=source[i+1]
    if(comment){
      if(current==='*'&&next==='/'){
        comment=false
        if(depth===0)start=i+2
        i++
      }
      continue
    }
    if(quote){
      if(escaped)escaped=false
      else if(current==='\\')escaped=true
      else if(current===quote)quote=null
      continue
    }
    if(current==='/'&&next==='*'){comment=true;i++;continue}
    if(current==='"'||current==="'"){quote=current;continue}
    if(current==='{'){
      if(depth===0){ruleStart=start;opening=i;nested=false}
      else nested=true
      depth++;continue
    }
    if(current==='}') {
      if(depth===0){start=i+1;continue}
      depth--
      if(depth===0) {
        const rawSelector=source.slice(ruleStart,opening)
        const selector=rawSelector.trim()
        found.push({
          selector,rawSelector,start:opening+1,end:i,
          valid:!nested && SELECTOR.test(selector) && rawSelector.indexOf('/*')<0 &&
            !selector.startsWith('@')
        })
        start=i+1
      }
      continue
    }
    if(current===';'&&depth===0)start=i+1
  }
  return found
}
function declarations(source,rule) {
  const body=source.slice(rule.start,rule.end)
  if(/[{}]/.test(body)||body.includes('/*')||/["'\\]/.test(body))
    fail('unsupported-css','Complex declarations require the source editor')
  const entries=[]
  let offset=0
  for(const section of body.split(';')) {
    const trimmed=section.trim()
    if(trimmed) {
      const match=/^\s*([a-z-]+)(\s*:\s*)([^;]*?)(\s*)$/i.exec(section)
      if(!match||!match[3].trim()||/[{}]/.test(section))
        fail('unsupported-css','Cannot safely map CSS declaration')
      const property=match[1].toLowerCase()
      const prefix=match[0].indexOf(match[1])+match[1].length+match[2].length
      const raw=match[3]
      const trimLeft=raw.length-raw.trimStart().length
      const valueStart=rule.start+offset+prefix+trimLeft
      const valueEnd=valueStart+raw.trim().length
      entries.push({property,value:raw.trim(),start:valueStart,end:valueEnd})
    }
    offset+=section.length+1
  }
  return entries
}
function indexed(source) {
  const rules=scan(source),count=new Map()
  for(const rule of rules){
    if(rule.valid)count.set(rule.selector,(count.get(rule.selector)||0)+1)
  }
  return rules.filter(rule=>rule.valid).map(rule=>{
    let entries=[],reason=null
    try{entries=declarations(source,rule)}
    catch(e){reason=e.code||'unsupported-css'}
    if(entries.some((entry,index)=>entries.findIndex(other=>other.property===entry.property)!==index)) {
      reason='duplicate-property'
    }
    if(count.get(rule.selector)!==1)reason='duplicate-selector'
    return {...rule,editable:!reason,reason,entries}
  })
}
export function listCssVisualRules(source) {
  return indexed(source).slice(0,MAX_RULES).map(rule=>({
    selector:rule.selector,editable:rule.editable,reason:rule.reason,
    declarations:rule.entries.map(({property,value})=>({property,value}))
  }))
}
export function cssVisualRulePatch(source,{selector,property,value}) {
  if(typeof selector!=='string'||!SELECTOR.test(selector) ||
     typeof property!=='string'||typeof value!=='string' ||
     !Object.hasOwn(HTML_STYLE_PROPERTIES,property) ||
     !HTML_STYLE_PROPERTIES[property].test(value)) {
    fail('invalid-value','Unsupported CSS rule selector, property or value')
  }
  const matches=indexed(source).filter(rule=>rule.selector===selector)
  if(matches.length!==1)fail('unknown-node','Unique CSS rule was not found')
  const rule=matches[0]
  if(!rule.editable)fail('unsupported-css','Ambiguous CSS rule; edit native source instead')
  const declarations=rule.entries.filter(item=>item.property===property)
  if(declarations.length>1)fail('unsupported-css','Duplicated property cannot be safely edited')
  if(declarations.length===1){
    const item=declarations[0]
    return {start:item.start,end:item.end,before:source.slice(item.start,item.end),after:value}
  }
  // Insert before existing trailing indentation; existing source bytes are unchanged.
  const existing=source.slice(rule.start,rule.end)
  const trailing=/\s*$/.exec(existing)?.[0]||''
  const position=rule.end-trailing.length
  const multiline=existing.includes('\n')
  const insert=multiline ? '\n  '+property+': '+value+';' :
    (existing.trim()? ' ' : '')+property+': '+value+';'
  return {start:position,end:position,before:'',after:insert}
}
