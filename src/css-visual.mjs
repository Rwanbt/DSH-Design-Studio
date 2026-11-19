/**
 * Source-preserving CSS rule inspector/patcher for standalone .css documents.
 *
 * Supported for visual editing: unique top-level rules whose selector list
 * uses only type, `#id`, `.class`, `*` and the descendant/child/adjacent/
 * sibling combinators, with a flat, unambiguous declaration block. Selector
 * lists (`h1, .a > .b`) and custom properties (`--my-var: ...`) are editable;
 * only the targeted declaration bytes change and inverse patches are exact.
 *
 * Refused with typed error codes: at-rule selectors (`at-rule-selector`),
 * declarations nested inside `@media`, `@supports`, `@keyframes`, `@layer`
 * or any other at-rule (`inside-at-rule`), selectors that match more than one
 * rule or selector list (`ambiguous-selector`), unsupported selector syntax
 * such as pseudo-classes or attribute selectors, escaped/commented/quoted
 * declaration bodies, duplicate declarations and unsafe values.
 *
 * The historical `listCssVisualRules(source)` / `cssVisualRulePatch(source,
 * {selector,property,value})` pair keeps its single-rule observable shape and
 * error codes for existing callers; `listCssVisualRuleDetails` and
 * `cssVisualDeclarationPatch` expose typed at-rule scope and ambiguity.
 *
 * Deliberate limits: this is not a browser CSS engine. There is no cascade,
 * no computed style, no inheritance, no `@import` resolution, no external or
 * framework/preprocessor CSS, no CSS nesting support, no source maps and no
 * script/JS execution. Conditional rules are never exposed as unconditional
 * `editable` rules: a declaration inside exactly one simple `(min|max)-width`
 * `@media` block can only be edited through `cssMediaDeclarationPatch`, which
 * addresses the block by its exact offset and re-validates the condition.
 */
import { HTML_STYLE_PROPERTIES } from './html-visual.mjs'

const MAX_SOURCE=512*1024
const MAX_RULES=200
const MAX_SELECTOR_LENGTH=512
const MAX_SELECTOR_MEMBERS=8
const LEGACY_SELECTOR=/^[#.][A-Za-z_][A-Za-z0-9_-]{0,79}$/
const IDENT=/^-?[A-Za-z_][A-Za-z0-9_-]*$/
const CUSTOM_PROPERTY=/^--[A-Za-z0-9_-]{1,64}$/
// Exactly one width feature in parentheses. `screen and (...)`, comma lists,
// range syntax and any other feature stay refused: this is not a media engine.
const SIMPLE_MEDIA=/^\(\s*(min|max)-width\s*:\s*(\d{1,5}(?:\.\d{1,4})?)px\s*\)$/i
const CUSTOM_VALUE=/^[A-Za-z0-9#%.,()\-+*/_\s]+$/
function fail(code,message,details={}){
  const error=new Error(message)
  error.code=code
  Object.assign(error,details)
  throw error
}

function splitSelectorList(raw) {
  if(typeof raw!=='string'||!raw||raw.length>MAX_SELECTOR_LENGTH)return null
  const parts=[]
  let buffer=''
  let quote=null,escaped=false,paren=0,bracket=0
  for(let index=0;index<raw.length;index+=1){
    const character=raw[index]
    if(quote){
      if(escaped)escaped=false
      else if(character==='\\')escaped=true
      else if(character===quote)quote=null
      buffer+=character
      continue
    }
    if(character==='\\')return null
    if(character==='"'||character==="'"){quote=character;buffer+=character;continue}
    if(character==='(')paren+=1
    else if(character===')'){if(paren===0)return null;paren-=1}
    else if(character==='[')bracket+=1
    else if(character===']'){if(bracket===0)return null;bracket-=1}
    if(character===','&&paren===0&&bracket===0){parts.push(buffer);buffer='';continue}
    buffer+=character
  }
  if(quote||escaped||paren!==0||bracket!==0)return null
  parts.push(buffer)
  if(parts.length>MAX_SELECTOR_MEMBERS)return null
  const trimmed=parts.map(part=>part.trim())
  if(trimmed.some(part=>!part))return null
  return trimmed
}

function parseCompound(text) {
  if(!text||text.length>256)return null
  let index=0
  let universal=false
  let specificity=0
  const tokens=[]
  if(text[index]==='*'){universal=true;index+=1}
  else{
    const match=/^-?[A-Za-z_][A-Za-z0-9_-]*/.exec(text)
    if(match){
      tokens.push({kind:'tag',name:match[0].toLowerCase()})
      specificity+=1
      index+=match[0].length
    }else if(text[index]!=='#'&&text[index]!=='.')return null
  }
  while(index<text.length){
    const marker=text[index]
    if(marker!=='#'&&marker!=='.')return null
    const match=IDENT.exec(text.slice(index+1))
    if(!match)return null
    tokens.push({kind:marker==='#'?'id':'class',name:match[0]})
    specificity+=marker==='#'?100:10
    index+=1+match[0].length
  }
  if(!tokens.length&&!universal)return null
  return {tokens,universal,specificity}
}

/**
 * Parses a comma-separated selector list that only uses structural CSS:
 * type/`#id`/`.class`/`*` compounds joined by whitespace, `>`, `+` or `~`.
 * Pseudo-classes, attribute selectors, escapes, namespaces and CSS nesting
 * are refused instead of being approximated. Exported so callers can prove
 * exactly which members are structural before matching them.
 */
export function parseCssSelectorList(selector) {
  const parts=splitSelectorList(selector)
  if(!parts)return {ok:false,reason:'unsupported-selector-syntax'}
  const members=[]
  for(const part of parts){
    let index=0,buffer=''
    const sequence=[]
    const pushCompound=()=>{
      if(!buffer)return false
      const compound=parseCompound(buffer)
      if(!compound)return false
      sequence.push({kind:'compound',compound})
      buffer=''
      return true
    }
    while(index<part.length){
      const character=part[index]
      if(/\s/.test(character)){
        if(buffer&&!pushCompound())return {ok:false,reason:'unsupported-compound'}
        index+=1
        continue
      }
      if(character==='>'||character==='+'||character==='~'){
        if(buffer&&!pushCompound())return {ok:false,reason:'unsupported-compound'}
        if(!sequence.length||sequence[sequence.length-1].kind!=='compound')
          return {ok:false,reason:'invalid-combinator'}
        sequence.push({kind:'combinator',combinator:character})
        index+=1
        continue
      }
      if(/[\[\]():@=|\/'"\\!$%^&,;{}]/.test(character))
        return {ok:false,reason:'unsupported-selector-syntax'}
      buffer+=character
      index+=1
    }
    if(buffer&&!pushCompound())return {ok:false,reason:'unsupported-compound'}
    // Normalize implicit descendant combinators.
    const normalized=[]
    for(const item of sequence){
      if(item.kind==='combinator'){
        normalized.push(item)
      }else{
        if(normalized.length&&normalized[normalized.length-1].kind==='compound')
          normalized.push({kind:'combinator',combinator:' '})
        normalized.push(item)
      }
    }
    if(!normalized.length||normalized[normalized.length-1].kind!=='compound')
      return {ok:false,reason:'incomplete-selector'}
    const compounds=[]
    const combinators=[]
    for(const item of normalized){
      if(item.kind==='compound')compounds.push(item.compound)
      else combinators.push(item.combinator)
    }
    const specificity=compounds.reduce((sum,compound)=>sum+compound.specificity,0)
    const universalOnly=compounds.length===1&&compounds[0].universal&&
      compounds[0].tokens.length===0
    members.push({
      selector:part,
      compounds,
      combinators,
      hasCombinators:combinators.length>0,
      universalOnly,
      specificity,
      simple:compounds.length===1,
    })
  }
  return {ok:true,members}
}

function isSupportedSelector(selector) {
  if(typeof selector!=='string'||!selector||selector.length>MAX_SELECTOR_LENGTH)return false
  if(selector.startsWith('@')||selector.includes('/*'))return false
  return parseCssSelectorList(selector).ok
}

function validCustomPropertyValue(value) {
  if(typeof value!=='string'||!value||value.length>256)return false
  if(value.trim()!==value||/[\r\n]/.test(value))return false
  if(!CUSTOM_VALUE.test(value))return false
  if(/[{};@<>"'\\]/.test(value))return false
  if(/\/\*|\*\//.test(value))return false
  if(/\b(?:url|expression|javascript|data|import)\s*\(/i.test(value))return false
  return true
}

function validCssPropertyValue(property,value) {
  if(typeof property!=='string'||typeof value!=='string')return false
  if(Object.hasOwn(HTML_STYLE_PROPERTIES,property))
    return HTML_STYLE_PROPERTIES[property].test(value)
  if(CUSTOM_PROPERTY.test(property))return validCustomPropertyValue(value)
  return false
}

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
          valid:!nested && isSupportedSelector(selector) && rawSelector.indexOf('/*')<0 &&
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
      // Custom property names are case-sensitive; standard properties are not.
      const property=match[1].startsWith('--')?match[1]:match[1].toLowerCase()
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
/**
 * Builds the exact source patch for one declaration. Existing declaration
 * bytes are replaced in place; a missing declaration is inserted before the
 * trailing indentation so all other bytes stay untouched.
 */
function declarationValuePatch(source,bodyStart,bodyEnd,entries,property,value) {
  const declarations=entries.filter(item=>item.property===property)
  if(declarations.length>1)fail('unsupported-css','Duplicated property cannot be safely edited')
  if(declarations.length===1){
    const item=declarations[0]
    return {start:item.start,end:item.end,before:source.slice(item.start,item.end),after:value}
  }
  // Insert before existing trailing indentation; existing source bytes are unchanged.
  const existing=source.slice(bodyStart,bodyEnd)
  const trailing=/\s*$/.exec(existing)?.[0]||''
  const position=bodyEnd-trailing.length
  const multiline=existing.includes('\n')
  const insert=multiline ? '\n  '+property+': '+value+';' :
    (existing.trim()? ' ' : '')+property+': '+value+';'
  return {start:position,end:position,before:'',after:insert}
}

/**
 * Historical entry point, kept source-compatible. It now accepts existing
 * top-level type/selector-list/combinator rules (exact rule selector) and
 * custom properties, but still refuses selector lists that do not identify a
 * single existing top-level rule with `invalid-value`, exactly like the
 * previous unsupported-selector contract.
 */
export function cssVisualRulePatch(source,{selector,property,value}) {
  if(typeof selector!=='string'||selector.length>MAX_SELECTOR_LENGTH||
     !isSupportedSelector(selector) ||
     typeof property!=='string'||typeof value!=='string' ||
     !validCssPropertyValue(property,value)) {
    fail('invalid-value','Unsupported CSS rule selector, property or value')
  }
  const matches=indexed(source).filter(rule=>rule.selector===selector)
  if(matches.length!==1){
    const nested=listCssVisualRuleDetails(source).find(rule=>
      rule.scope!=='top-level'&&
      (rule.selector===selector||rule.selectors.includes(selector)))
    const nestedDetails=nested?{
      reasonCode:'inside-at-rule',
      atRule:nested.atRule||'unknown',
      reason:`declaration is nested inside @${nested.atRule||'unknown'}`,
    }:{}
    if(LEGACY_SELECTOR.test(selector))
      fail('unknown-node','Unique CSS rule was not found',nestedDetails)
    fail('invalid-value','Complex selector does not identify exactly one top-level rule',
      nestedDetails)
  }
  const rule=matches[0]
  if(!rule.editable)fail('unsupported-css','Ambiguous CSS rule; edit native source instead')
  return declarationValuePatch(source,rule.start,rule.end,rule.entries,property,value)
}

/* -------------------------------------------------------------------------
 * Detailed rule model (G2 Host side)
 * ---------------------------------------------------------------------- */

/**
 * Tokenises top-level and nested blocks without executing or normalising CSS.
 * At-rule ancestry is recorded so conditional declarations can be refused
 * with their real scope instead of being silently treated as top-level.
 */
function scanCssStructure(source) {
  const rules=[]
  const atRules=[]
  if(typeof source!=='string'||source.length>MAX_SOURCE)return {rules,atRules}
  const stack=[]
  let statementStart=0
  let index=0
  let commentStart=-1
  let comment=false,quote=null,escaped=false,paren=0,bracket=0
  const ancestors=()=>stack.filter(block=>block.kind==='at')
    .map(block=>({name:block.name,prelude:block.prelude}))
  while(index<source.length){
    const character=source[index]
    const next=source[index+1]
    if(comment){
      if(character==='*'&&next==='/'){
        comment=false
        index+=2
        // A comment that only precedes a statement is trivia, not selector
        // syntax; skip it. Comments inside a prelude stay and are refused.
        if(source.slice(statementStart,commentStart).trim()==='')statementStart=index
      }else index+=1
      continue
    }
    if(quote){
      if(escaped)escaped=false
      else if(character==='\\')escaped=true
      else if(character===quote)quote=null
      index+=1
      continue
    }
    if(character==='/'&&next==='*'){comment=true;commentStart=index;index+=2;continue}
    if(character==='"'||character==="'"){quote=character;index+=1;continue}
    if(character==='\\'){escaped=true;index+=1;continue}
    if(character==='('){paren+=1;index+=1;continue}
    if(character===')'){if(paren>0)paren-=1;index+=1;continue}
    if(character==='['){bracket+=1;index+=1;continue}
    if(character===']'){if(bracket>0)bracket-=1;index+=1;continue}
    if(paren>0||bracket>0){index+=1;continue}
    if(character==='{'){
      const preludeRaw=source.slice(statementStart,index)
      const prelude=preludeRaw.trim()
      const leading=preludeRaw.length-preludeRaw.trimStart().length
      const selectorStart=statementStart+leading
      const selectorEnd=selectorStart+prelude.length
      if(prelude.startsWith('@')){
        const nameMatch=/^@([A-Za-z-]+)/.exec(prelude)
        stack.push({
          kind:'at',name:nameMatch?nameMatch[1].toLowerCase():'unknown',
          prelude,rawPrelude:preludeRaw,start:statementStart,
          selectorStart,selectorEnd,open:index,bodyStart:index+1,parents:ancestors(),
        })
      }else if(stack.some(block=>block.kind==='rule')){
        stack.push({
          kind:'nested-rule',prelude,rawPrelude:preludeRaw,start:statementStart,
          selectorStart,selectorEnd,open:index,bodyStart:index+1,parents:ancestors(),
        })
      }else{
        stack.push({
          kind:'rule',selector:prelude,rawSelector:preludeRaw,start:statementStart,
          selectorStart,selectorEnd,open:index,bodyStart:index+1,parents:ancestors(),
        })
      }
      statementStart=index+1
      index+=1
      continue
    }
    if(character==='}'){
      const block=stack.pop()
      if(block){
        if(block.kind==='rule'){
          rules.push({
            ...block,bodyEnd:index,end:index+1,
            scope:block.parents.length?'inside-at-rule':'top-level',
            atRules:block.parents,
          })
        }else if(block.kind==='nested-rule'){
          rules.push({
            ...block,selector:block.prelude,rawSelector:block.rawPrelude,
            bodyEnd:index,end:index+1,scope:'nested-rule',atRules:block.parents,
          })
        }else{
          atRules.push({
            name:block.name,prelude:block.prelude,start:block.start,
            open:block.open,bodyStart:block.bodyStart,bodyEnd:index,end:index+1,
            parents:block.parents,
          })
        }
      }
      statementStart=index+1
      index+=1
      continue
    }
    if(character===';'&&stack.length===0){statementStart=index+1;index+=1;continue}
    index+=1
  }
  return {rules,atRules}
}

/**
 * Normalises an at-rule ancestry into a simple media condition, or null.
 * Only a single `@media` ancestor whose prelude is one `(min|max)-width: Npx`
 * feature qualifies; everything else is refused rather than approximated.
 */
export function simpleMediaCondition(atRules) {
  if(!Array.isArray(atRules)||atRules.length!==1)return null
  const ancestor=atRules[0]
  if(!ancestor||ancestor.name!=='media')return null
  // The scanner keeps the whole prelude, at-keyword included.
  const condition=String(ancestor.prelude||'').trim().replace(/^@media\b/i,'').trim()
  const match=SIMPLE_MEDIA.exec(condition)
  if(!match)return null
  return '('+match[1].toLowerCase()+'-width: '+match[2]+'px)'
}

/**
 * Lists every rule the conservative scanner can see, including rules nested
 * inside at-rules. Nested rules are always read-only and carry the typed
 * `inside-at-rule` refusal plus the at-rule name; unsupported selector
 * syntax, duplicated selectors/properties and complex declaration bodies are
 * reported with typed `reasonCode`s. This is still not a CSS parser: no
 * cascade, computed style, inheritance or @import resolution is performed.
 */
export function listCssVisualRuleDetails(source) {
  const {rules}=scanCssStructure(source)
  const topLevelCounts=new Map()
  for(const rule of rules){
    if(rule.scope!=='top-level'||rule.selector.startsWith('@'))continue
    topLevelCounts.set(rule.selector,(topLevelCounts.get(rule.selector)||0)+1)
  }
  return rules.slice(0,MAX_RULES*2).map(rule=>{
    const atRule=rule.atRules.length?rule.atRules[rule.atRules.length-1].name:null
    let entries=[],declarationError=null
    try{entries=declarations(source,{start:rule.bodyStart,end:rule.bodyEnd})}
    catch(error){declarationError=error.code||'unsupported-css'}
    let reasonCode=null,reason=null
    if(rule.scope!=='top-level'){
      reasonCode='inside-at-rule'
      reason=atRule
        ? `Rule is nested inside @${atRule}; conditional declarations are not editable`
        : 'Rule is nested inside another style rule; CSS nesting is not editable'
    }else if(declarationError){
      reasonCode=declarationError
      reason='Declaration block contains quoted, commented or braced content'
    }else{
      const parsed=parseCssSelectorList(rule.selector)
      if(!parsed.ok){
        reasonCode='unsupported-selector'
        reason='Selector syntax cannot be mapped safely: '+(parsed.reason||'unsupported')
      }else if(entries.some((entry,at)=>entries.findIndex(other=>
        other.property===entry.property)!==at)){
        reasonCode='duplicate-property'
        reason='Duplicated declaration cannot be edited unambiguously'
      }else if((topLevelCounts.get(rule.selector)||0)!==1){
        reasonCode='duplicate-selector'
        reason='Selector appears more than once; the target block is ambiguous'
      }
    }
    const parsed=parseCssSelectorList(rule.selector)
    // Conditional editing is a separate, narrower contract: the historical
    // `editable` flag stays false so the HTML preview projection (which guards
    // on it) can never flatten an @media block into the page.
    const mediaCondition=rule.scope==='inside-at-rule'?simpleMediaCondition(rule.atRules):null
    let mediaReason=null
    if(mediaCondition){
      if(declarationError)mediaReason=declarationError
      else if(!parsed.ok)mediaReason='unsupported-selector'
      else if(!entries.length)mediaReason='empty-block'
      else if(entries.some((entry,at)=>entries.findIndex(other=>
        other.property===entry.property)!==at))mediaReason='duplicate-property'
    }
    return {
      selector:rule.selector,
      rawSelector:rule.rawSelector,
      selectors:parsed.ok?parsed.members.map(member=>member.selector):[],
      selectorSyntax:parsed.ok?'structural':'unsupported',
      start:rule.start,
      end:rule.end,
      selectorStart:rule.selectorStart,
      selectorEnd:rule.selectorEnd,
      bodyStart:rule.bodyStart,
      bodyEnd:rule.bodyEnd,
      scope:rule.scope,
      atRules:rule.atRules.map(entry=>entry.name),
      atRule,
      mediaCondition,
      mediaEditable:mediaCondition!==null&&mediaReason===null,
      mediaReason,
      editable:reasonCode===null,
      reason:reason,
      reasonCode,
      declarations:entries.map(entry=>({
        property:entry.property,value:entry.value,
        start:entry.start,end:entry.end,
        customProperty:entry.property.startsWith('--'),
      })),
    }
  })
}

/**
 * Patches one declaration of a uniquely identified top-level rule. Selector
 * lists and combinators are accepted when they identify exactly one rule;
 * a member of a selector list may also be used when it is unique. Rules that
 * only exist inside an at-rule are refused with `inside-at-rule` (and the
 * at-rule name) rather than being edited as if they were unconditional.
 */
export function cssVisualDeclarationPatch(source,{selector,property,value}={}) {
  if(typeof selector!=='string'||!selector||selector.length>MAX_SELECTOR_LENGTH||
     selector.trim()!==selector){
    fail('invalid-value','Selector must be a non-empty, trimmed string')
  }
  if(selector.startsWith('@')){
    const name=/^@([A-Za-z-]+)/.exec(selector)?.[1]?.toLowerCase()||'unknown'
    fail('at-rule-selector','At-rule selectors cannot be patched visually',{
      atRule:name,reasonCode:'at-rule-selector',
      reason:'at-rule selectors do not identify a style-rule declaration block',
    })
  }
  const parsed=parseCssSelectorList(selector)
  let details=null
  if(!parsed.ok){
    // A keyframe/at-rule frame such as `50%` is not a structural element
    // selector, but if it exists inside an at-rule the refusal must still
    // identify that scope instead of pretending the selector is missing.
    details=listCssVisualRuleDetails(source)
    const nested=details.filter(rule=>rule.scope!=='top-level'&&rule.selector===selector)
    if(nested.length===1){
      const atRule=nested[0].atRule||'unknown'
      fail('inside-at-rule',
        `Selector exists only inside @${atRule}; conditional declarations are not editable`,{
          atRule,reasonCode:'inside-at-rule',
          reason:`declaration is nested inside @${atRule}`,
        })
    }
    if(nested.length>1){
      fail('ambiguous-selector','Selector is ambiguous across nested at-rule scopes',{
        reasonCode:'ambiguous-selector',matches:nested.length,
        reason:'selector matches more than one at-rule-scoped declaration block',
      })
    }
    fail('invalid-value','Unsupported selector syntax',{
      reasonCode:'unsupported-selector',reason:parsed.reason,
    })
  }
  if(typeof property!=='string'||typeof value!=='string'||
     !validCssPropertyValue(property,value)){
    fail('invalid-value','Unsupported CSS property or value')
  }
  details ??= listCssVisualRuleDetails(source)
  const topLevel=details.filter(rule=>rule.scope==='top-level')
  let matches=topLevel.filter(rule=>rule.selector===selector)
  if(matches.length===0)
    matches=topLevel.filter(rule=>rule.selectors.includes(selector))
  if(matches.length>1){
    fail('ambiguous-selector',
      `Selector identifies ${matches.length} top-level rules; refuse to choose one`,{
        reasonCode:'ambiguous-selector',matches:matches.length,
        reason:'selector matches more than one declaration block',
      })
  }
  if(matches.length===0){
    const nested=details.filter(rule=>rule.scope!=='top-level'&&
      (rule.selector===selector||rule.selectors.includes(selector)))
    if(nested.length===1){
      const atRule=nested[0].atRule||'unknown'
      fail('inside-at-rule',
        `Selector exists only inside @${atRule}; conditional declarations are not editable`,{
          atRule,reasonCode:'inside-at-rule',
          reason:`declaration is nested inside @${atRule}`,
        })
    }
    if(nested.length>1){
      fail('ambiguous-selector',
        'Selector is ambiguous across nested at-rule scopes',{
          reasonCode:'ambiguous-selector',matches:nested.length,
          reason:'selector matches more than one at-rule-scoped declaration block',
        })
    }
    fail('unknown-node','Selector was not found in a top-level rule')
  }
  const rule=matches[0]
  if(!rule.editable){
    if(rule.reasonCode==='duplicate-selector'||rule.reasonCode==='ambiguous-selector'){
      fail('ambiguous-selector',rule.reason||'Ambiguous selector',{
        reasonCode:rule.reasonCode,reason:rule.reason,
      })
    }
    fail('unsupported-css',rule.reason||'Rule cannot be edited safely',{
      reasonCode:rule.reasonCode,reason:rule.reason,
    })
  }
  return declarationValuePatch(source,rule.bodyStart,rule.bodyEnd,
    rule.declarations,property,value)
}

/**
 * Patches one declaration of a rule inside a single simple `@media` block.
 *
 * The inspector uses an exact start offset and its displayed condition.
 * Proposals can use the condition and an exact selector when the pair is unique.
 * Only declaration bytes change, with no cascade or media evaluation.
 */
export function cssMediaDeclarationPatch(source,{start,selector,condition,property,value}={}) {
  const bySelector=start===undefined&&typeof selector==='string'&&Boolean(selector.trim())
  if(!bySelector&&(!Number.isInteger(start)||start<0))
    fail('invalid-target','A CSS rule start offset or exact selector is required')
  if(typeof condition!=='string'||!condition.trim())
    fail('invalid-target','The media condition shown to the user is required')
  if(typeof property!=='string'||typeof value!=='string'||
     !validCssPropertyValue(property,value)){
    fail('invalid-value','Unsupported CSS property or value')
  }
  const normalized=simpleMediaCondition([{name:'media',prelude:condition}])
  const rules=listCssVisualRuleDetails(source)
  let rule
  if(bySelector){
    if(!normalized)fail('inside-at-rule','Only simple width media conditions can be edited')
    const matches=rules.filter(entry=>entry.mediaCondition===normalized&&entry.selector===selector.trim())
    if(matches.length>1)fail('ambiguous-selector','Multiple CSS rules match this selector and media condition')
    rule=matches[0]
  }else{
    rule=rules.find(entry=>entry.start===start)
  }
  if(!rule)fail('unknown-node','No CSS rule matches the target')
  if(rule.scope!=='inside-at-rule'||!rule.mediaCondition){
    fail('inside-at-rule',
      'Only a rule inside one simple (min|max)-width @media block can be edited this way',{
        atRule:rule.atRule||null,reasonCode:'inside-at-rule',
        reason:'the addressed rule is not inside a single simple @media block',
      })
  }
  if(rule.mediaCondition!==normalized){
    fail('stale-reference',
      'The media condition no longer matches the addressed rule; reload before editing',{
        reasonCode:'stale-reference',reason:'media condition mismatch',
      })
  }
  if(!rule.mediaEditable){
    const code=rule.mediaReason==='duplicate-property'?'duplicate-property'
      :rule.mediaReason==='empty-block'?'unsupported-css'
        :rule.mediaReason||'unsupported-css'
    fail(code,'Conditional rule cannot be edited safely: '+(rule.mediaReason||'unsupported-css'),{
      reasonCode:code,reason:rule.mediaReason||'unsupported-css',
    })
  }
  return declarationValuePatch(source,rule.bodyStart,rule.bodyEnd,
    rule.declarations,property,value)
}
