/**
 * Conservative HTML source mapping for the manual visual inspector.
 *
 * Every mapping entry points at the ORIGINAL source bytes: `start`/`end`
 * delimit the matched element (open tag through close tag when it is
 * balanced), `openStart`/`openEnd` the start tag and `textStart`/`textEnd`
 * the raw text range. Nothing is re-serialised and no DOM object is created.
 *
 * `listHtmlVisualElements` keeps its historical contract: only HTML elements
 * carrying an `id` are listed. Each entry additionally exposes a stable
 * structural `key`, an element-child `path` rooted at `<html>` (or at the
 * document root for fragments), and typed `reasonCode` refusals. Duplicate
 * ids, malformed/unbalanced nesting and inert regions are reported read-only
 * instead of guessing a target; the historical id-based status of unquoted
 * or invalid ids is preserved in `editable`/`reasonCode` as well.
 *
 * Edits are restricted to element text content and a STRICT attribute
 * allowlist (`class`, `title`, `alt`, `hidden`, `lang`, `dir`, `data-*`).
 * URL-, script-, style- and document-embedding attributes (`src`, `href`,
 * `action`, `on*`, `style`, `srcdoc`, `formaction`, `xlink:href`, ...) are
 * refused with a typed error and a documented reason. `htmlVisualStylePatch`
 * retains its pre-existing behaviour and allowlist unchanged.
 *
 * Deliberate limits: this is not a full HTML5 parser. Optional end tags
 * (`<li>`, `<p>`, ...) are not inferred, so such documents are reported as
 * unbalanced/read-only. There is no DOM, no script execution, no CSS cascade,
 * no computed style, no external/framework HTML and no source-map support.
 */
const TAGS=new Set(['div','main','header','footer','section','article','aside','nav','p','span',
  'h1','h2','h3','h4','h5','h6','button','a','ul','ol','li','label','figure','figcaption',
  'form','input','textarea','img','picture','strong','em'])
const RAW=new Set(['script','style','textarea','template'])
/** HTML void elements never have a closing tag and therefore no text range. */
const VOID_TAGS=new Set(['area','base','br','col','embed','hr','img','input','link','meta',
  'param','source','track','wbr'])
/** Elements whose content is raw text: markup inside is not parsed as HTML. */
const RAW_TEXT_TAGS=new Set(['script','style','textarea','title'])
/**
 * Regions that must never be edited through the visual mapper. `<script>`
 * and `<style>` contents are raw text; `<template>` contents are parsed but
 * inert, so all descendants are marked read-only as well.
 */
const INERT_TAGS=new Set(['script','style','template'])
const MAX_MAPPED_ELEMENTS=200
const MAX_STRUCTURE_ELEMENTS=20000
const MAX_STRUCTURE_DEPTH=256
const MAX_TEXT_LENGTH=4096
const MAX_ATTRIBUTE_VALUE_LENGTH=512
const SAFE_TEXT_ATTRIBUTE=/^[^<>"'&\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\r\n]*$/u
const SAFE_DATA_ATTRIBUTE=/^[^<>"'&\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\r\n]*$/u
const ATTRIBUTE_NAME=/^data-[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Attributes that may be edited; everything else is refused by omission. */
const EDITABLE_ATTRIBUTES=new Set(['class','title','alt','hidden','lang','dir'])
/** Attributes that can load resources or execute code and are always refused. */
const REFUSED_ATTRIBUTES=new Map([
  ['src','it can load an external resource'],
  ['srcset','it can load external responsive resources'],
  ['href','it can navigate or load an external resource'],
  ['xlink:href','it can navigate or load an external resource'],
  ['action','it can submit data to an external endpoint'],
  ['formaction','it can submit data to an external endpoint'],
  ['srcdoc','it can inject a full nested document'],
  ['style','it is an unvalidated CSS surface; use htmlVisualStylePatch instead'],
  ['background','it can load an external resource'],
  ['cite','it can reference an external resource'],
  ['data','it can load an external resource'],
  ['poster','it can load an external resource'],
  ['longdesc','it can reference an external resource'],
  ['usemap','it can reference an external resource'],
  ['manifest','it can load an external manifest'],
  ['ping','it can notify external endpoints'],
  ['nonce','it is a security token'],
  ['integrity','it is a subresource integrity token'],
  ['http-equiv','it can alter document behaviour'],
  ['content','it can alter document behaviour'],
])
export const HTML_STYLE_PROPERTIES={
  color:/^(?:#[0-9a-f]{3,8}|[a-z]{3,24})$/i,
  'background-color':/^(?:#[0-9a-f]{3,8}|[a-z]{3,24})$/i,
  display:/^(?:none|block|inline|inline-block|flex|inline-flex|grid)$/i,
  width:/^(?:auto|fit-content|\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh))$/i,
  height:/^(?:auto|fit-content|\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh))$/i,
  padding:/^\d+(?:\.\d+)?(?:px|rem|em|%)$/i,
  margin:/^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|%))$/i,
  gap:/^\d+(?:\.\d+)?(?:px|rem|em|%)$/i,
  'font-size':/^\d+(?:\.\d+)?(?:px|rem|em|%)$/i,
  'border-radius':/^\d+(?:\.\d+)?(?:px|rem|em|%)$/i,
  'font-weight':/^(?:normal|bold|[1-9]00)$/i,
  'text-align':/^(?:left|right|center|justify|start|end)$/i,
  'grid-template-columns':/^(?:1fr|repeat\((?:2|3|4),\s*minmax\(0,\s*1fr\)\))$/i,
  'grid-auto-flow':/^(?:row|column)$/i,
  'flex-direction':/^(?:row|column|row-reverse|column-reverse)$/i,
  'justify-content':/^(?:start|end|center|space-between|space-around|space-evenly|flex-start|flex-end)$/i,
  'align-items':/^(?:start|end|center|stretch|baseline|flex-start|flex-end)$/i,
  opacity:/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/,
  // Layout controls required by G2: flex wrapping/alignment, sizing, gaps and
  // simple grid tracks. Every entry is a strict allowlist of literal tokens; no
  // value can reference a resource, a function call or another selector.
  'flex-wrap':/^(?:nowrap|wrap|wrap-reverse)$/i,
  'align-content':/^(?:normal|start|end|center|stretch|space-between|space-around|space-evenly|flex-start|flex-end)$/i,
  'align-self':/^(?:auto|start|end|center|stretch|baseline|flex-start|flex-end)$/i,
  'flex-grow':/^(?:0|1|2|3|4|5|6|8|10|12)$/,
  'flex-shrink':/^(?:0|1|2|3|4|5|6|8|10)$/,
  'flex-basis':/^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|%))$/i,
  'grid-template-rows':/^(?:1fr|repeat\((?:2|3|4),\s*minmax\(0,\s*1fr\)\))$/i,
  'row-gap':/^\d+(?:\.\d+)?(?:px|rem|em|%)$/i,
  'column-gap':/^\d+(?:\.\d+)?(?:px|rem|em|%)$/i,
  'justify-items':/^(?:start|end|center|stretch)$/i,
  'place-items':/^(?:start|end|center|stretch|center center|start center|center start)$/i,
  'max-width':/^(?:none|100%|\d+(?:\.\d+)?(?:px|rem|em|%|vw))$/i,
  'min-width':/^(?:auto|0|\d+(?:\.\d+)?(?:px|rem|em|%|vw))$/i,
  'text-wrap':/^(?:wrap|nowrap|balance|pretty)$/i,
  'line-height':/^(?:normal|1(?:\.\d+)?|[1-9](?:\.\d+)?)$/,
  'object-fit':/^(?:fill|contain|cover|none|scale-down)$/i,
  'overflow':/^(?:visible|hidden|auto|scroll)$/i,
  'z-index':/^(?:auto|-?\d{1,3})$/,
  // `position` stays refused on purpose (see tests/css-visual.test.mjs): without
  // offset support a lone `position: absolute` is a half-feature that can wreck
  // a layout, so it remains out of scope until offsets are validated too.
}
function fail(code,message){const e=new Error(message);e.code=code;throw e}
function attributes(source,begin,end) {
  let i=begin
  const found={}
  while(i<end) {
    while(i<end&&/\s/.test(source[i]))i++
    if(i>=end || source[i]==='/')break
    const match=/^[A-Za-z_:][\w:.-]*/.exec(source.slice(i,end))
    if(!match)return null
    const key=match[0].toLowerCase()
    i+=match[0].length
    while(i<end&&/\s/.test(source[i]))i++
    let value=null,span=null
    if(source[i]==='='){
      i++
      while(i<end&&/\s/.test(source[i]))i++
      const quote=source[i]
      if(quote==='"'||quote==="'"){
        const start=++i
        while(i<end&&source[i]!==quote)i++
        if(i>=end)return null
        value=source.slice(start,i);span={start,end:i,quote}
        i++
      }else{
        const start=i
        while(i<end&&!/[\s/>]/.test(source[i]))i++
        if(i===start)return null
        value=source.slice(start,i);span={start,end:i,quote:null}
      }
    }
    if(['id','style','class','href','rel','media','disabled','type'].includes(key)){
      if(Object.hasOwn(found,key))return null
      found[key]={value,span}
    }
  }
  return found
}
function openingTags(source) {
  const tags=[]
  let i=0
  while(i<source.length) {
    const start=source.indexOf('<',i)
    if(start<0)break
    if(source.startsWith('<!--',start)){
      const close=source.indexOf('-->',start+4)
      if(close<0)break
      i=close+3;continue
    }
    if(/^<!|^<\?/.test(source.slice(start,start+2))) {
      const close=source.indexOf('>',start+2)
      if(close<0)break
      i=close+1;continue
    }
    const name=/^<([a-z][\w:-]*)\b/i.exec(source.slice(start,start+130))
    if(!name) {i=start+1;continue}
    const tag=name[1].toLowerCase()
    let quote=null,j=start+name[0].length
    for(;j<source.length;j++){
      const ch=source[j]
      if(quote){if(ch===quote)quote=null}
      else if(ch==='"'||ch==="'")quote=ch
      else if(ch==='>')break
    }
    if(j>=source.length)break
    const attrs=attributes(source,start+name[0].length,j)
    if(attrs)tags.push({tag,start,end:j+1,attrStart:start+name[0].length,attrEnd:j,attrs})
    i=j+1
    if(RAW.has(tag)){
      const closing=new RegExp('</'+tag+'\\s*>','ig')
      closing.lastIndex=i
      const found=closing.exec(source)
      i=found?closing.lastIndex:source.length
    }
  }
  return tags
}
function indexed(source) {
  if(typeof source!=='string'||source.length>512*1024)return []
  const tags=openingTags(source),count=new Map()
  for(const entry of tags){
    const id=entry.attrs.id?.value
    if(id)count.set(id,(count.get(id)||0)+1)
  }
  return tags.filter(entry=>TAGS.has(entry.tag)&&entry.attrs.id?.value).map(entry=>{
    const id=entry.attrs.id.value
    const valid=/^[A-Za-z][\w:.-]{0,79}$/.test(id) &&
      entry.attrs.id.span?.quote!==null && count.get(id)===1
    const style=entry.attrs.style
    const safeStyle=!style || (style.span?.quote!==null &&
      !/["'<>&\\]/.test(style.value||''))
    return {...entry,id,editable:!!valid&&!!safeStyle,
      reason:!valid?'duplicate-or-invalid-id':!safeStyle?'complex-style':null}
  })
}
/**
 * Lists id-bearing HTML elements with source spans. The historical fields
 * (`id`, `tag`, `editable`, `reason`, `style`, `classes`) keep their exact
 * meaning; `key`, `path`, spans and `reasonCode` are additive.
 * `options.includeReadOnlyRegions` additionally exposes id-bearing elements
 * that live inside `<template>` or in malformed markup, always read-only.
 */
export function listHtmlVisualElements(source, options={}) {
  const structure=typeof source==='string'&&source.length<=512*1024
    ? scanHtmlStructure(source) : null
  const byStart=new Map((structure?.elements||[]).map(element=>[element.start,element]))
  const legacy=indexed(source)
  const idCounts=new Map()
  for(const entry of legacy){
    const id=entry.attrs.id?.value
    if(id)idCounts.set(id,(idCounts.get(id)||0)+1)
  }
  const listed=[]
  for(const entry of legacy.slice(0,MAX_MAPPED_ELEMENTS)){
    const raw=entry.attrs.class
    const valid=raw?.span?.quote &&
      typeof raw.value==='string' && raw.value.length<=256 &&
      /^[A-Za-z0-9_\s-]*$/.test(raw.value)
    const classes=valid?Array.from(new Set(raw.value.split(/\s+/).filter(Boolean)
      .filter(token=>/^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(token)))).slice(0,16):[]
    const column=byStart.get(entry.start)
    const reasonCode=sourceReasonCode(column,entry,idCounts) ||
      (entry.editable?null:'unmapped-source')
    const reason=entry.reason || (reasonCode&&reasonCode!=='duplicate-id'&&
      reasonCode!=='invalid-id'&&reasonCode!=='unquoted-id'&&reasonCode!=='complex-style'
      ? reasonCode : null)
    listed.push({
      id:entry.id,tag:entry.tag,editable:entry.editable&&!reasonCode,reason,
      reasonCode,style:entry.attrs.style?.value||'',classes,
      key:column?.key||`${entry.tag}#${entry.id}@unmapped`,
      path:column?.path??null,pathString:column?.pathString??null,
      start:column?.start??entry.start,end:column?.end??entry.end,
      openStart:column?.start??entry.start,openEnd:column?.openEnd??entry.end,
      textStart:column?.textStart??entry.end,textEnd:column?.textEnd??entry.end,
      closeStart:column?.closeStart??null,closeEnd:column?.closeEnd??null,
      balanced:column?column.balanced:false,
    })
  }
  if(options&&options.includeReadOnlyRegions&&structure){
    const starts=new Set(listed.map(item=>item.start))
    let additions=0
    for(const element of structure.elements){
      if(additions>=MAX_MAPPED_ELEMENTS)break
      if(starts.has(element.start)||!TAGS.has(element.tag)||!element.id)continue
      const reasonCode=elementReadonlyReason(element)
      if(!reasonCode)continue
      additions+=1
      const classes=elementClassTokens(element)
      const styleAttribute=elementAttribute(element,'style')
      listed.push({
        id:element.id,tag:element.tag,editable:false,reason:reasonCode,reasonCode,
        style:styleAttribute?.value||'',classes,
        key:element.key,path:element.path,pathString:element.pathString,
        start:element.start,end:element.end,
        openStart:element.start,openEnd:element.openEnd,
        textStart:element.textStart,textEnd:element.textEnd,
        closeStart:element.closeStart,closeEnd:element.closeEnd,
        balanced:element.balanced,
      })
    }
    listed.sort((left,right)=>left.start-right.start)
  }
  return listed
}
export function htmlVisualStylePatch(source,{id,property,value}) {
  if(typeof id!=='string'||!id||typeof property!=='string'||
     typeof value!=='string'||!Object.hasOwn(HTML_STYLE_PROPERTIES,property) ||
     !HTML_STYLE_PROPERTIES[property].test(value)) {
    fail('invalid-value','Unsupported HTML style property or value')
  }
  const matches=indexed(source).filter(entry=>entry.id===id)
  if(matches.length!==1)fail('unknown-node','Unique HTML id was not found')
  const item=matches[0]
  if(!item.editable)fail('unsupported-html','Only unambiguous quoted HTML ids/styles are supported')
  const style=item.attrs.style
  if(!style) {
    const start=item.attrEnd-(source[item.attrEnd-1]==='/'?1:0)
    const after=' style="'+property+': '+value+';"'
    return {start,end:start,before:'',after}
  }
  const parts=(style.value||'').split(';')
  const existing=[]
  for(let idx=0;idx<parts.length;idx++){
    const chunk=parts[idx]
    if(!chunk.trim())continue
    const parsed=/^\s*([a-z-]+)\s*:\s*([^;]*?)\s*$/i.exec(chunk)
    if(!parsed || /[{}]/.test(chunk))fail('unsupported-html','Complex inline styles cannot be edited visually')
    if(parsed[1].toLowerCase()===property)existing.push(idx)
  }
  if(existing.length>1)fail('unsupported-html','Duplicate inline property cannot be edited unambiguously')
  let after
  if(existing.length===1) {
    const idx=existing[0]
    parts[idx]=parts[idx].replace(/(:\s*)([^;]*?)(\s*)$/,(_match,colon,_old,whitespace)=>colon+value+whitespace)
    after=parts.join(';')
  }else{
    after=style.value+(style.value.trim()&&!style.value.trimEnd().endsWith(';')?';':'')+
      (style.value.trim()?' ':'')+property+': '+value+';'
  }
  return {start:style.span.start,end:style.span.end,before:style.value,after}
}


/** Lists only static, explicit stylesheet references. No fetches or URL parsing. */
export function listHtmlStylesheetLinks(source) {
  if(typeof source!=='string'||source.length>512*1024)return []
  const links=openingTags(source).filter(entry=>entry.tag==='link')
  return links.slice(0,9).map(entry=>{
    const rel=entry.attrs.rel,href=entry.attrs.href
    const relValue=typeof rel?.value==='string'?rel.value.toLowerCase().trim():''
    if(relValue!=='stylesheet')return null
    if(entry.attrs.disabled) return {href:'',valid:false,reason:'disabled-stylesheet'}
    const media=entry.attrs.media?.value
    if(media!==undefined && (typeof media!=='string'||media.toLowerCase().trim()!=='all')) {
      return {href:'',valid:false,reason:'conditional-media-not-evaluated'}
    }
    const type=entry.attrs.type?.value
    if(type!==undefined && (typeof type!=='string'||type.toLowerCase().trim()!=='text/css')) {
      return {href:'',valid:false,reason:'unsupported-stylesheet-type'}
    }
    const valid=href?.span?.quote && rel?.span?.quote &&
      typeof href.value==='string' && href.value.length>0 && href.value.length<=256
    return {href:valid?href.value:'',valid:!!valid,
      reason:valid?null:'unquoted-or-invalid-stylesheet-link'}
  }).filter(Boolean)
}

/* -------------------------------------------------------------------------
 * Structural source map (G2 Host side)
 * ---------------------------------------------------------------------- */

function attributeList(source,begin,end) {
  if(!Number.isSafeInteger(begin)||!Number.isSafeInteger(end)||begin<0||end<begin||
     end>source.length)return {ok:false,reason:'malformed-attribute'}
  const attributes=[]
  let i=begin
  while(i<end){
    const whitespaceStart=i
    while(i<end&&/\s/.test(source[i]))i++
    if(i>=end)break
    if(source[i]==='/')return {ok:false,reason:'malformed-attribute'}
    const nameMatch=/^[A-Za-z_:][A-Za-z0-9_:.-]*/.exec(source.slice(i,end))
    if(!nameMatch)return {ok:false,reason:'malformed-attribute'}
    const name=nameMatch[0]
    const nameStart=i
    i+=name.length
    let cursor=i
    while(cursor<end&&/\s/.test(source[cursor]))cursor++
    let value=null,valueStart=null,valueEnd=null,quote=null,attributeEnd=i
    if(cursor<end&&source[cursor]==='='){
      cursor++
      while(cursor<end&&/\s/.test(source[cursor]))cursor++
      if(cursor>=end)return {ok:false,reason:'malformed-attribute'}
      const marker=source[cursor]
      if(marker==='"'||marker==="'"){
        const start=cursor+1
        let close=start
        while(close<end&&source[close]!==marker)close++
        if(close>=end)return {ok:false,reason:'unterminated-attribute'}
        value=source.slice(start,close)
        valueStart=start
        valueEnd=close
        quote=marker
        attributeEnd=close+1
      }else{
        const start=cursor
        while(cursor<end&&!/[\s>]/.test(source[cursor]))cursor++
        if(cursor===start)return {ok:false,reason:'empty-attribute'}
        value=source.slice(start,cursor)
        valueStart=start
        valueEnd=cursor
        quote=null
        attributeEnd=cursor
      }
      i=attributeEnd
    }
    attributes.push({
      name,lowerName:name.toLowerCase(),value,valueStart,valueEnd,quote,
      start:nameStart,end:attributeEnd,whitespaceStart,
    })
    if(attributes.length>64)return {ok:false,reason:'too-many-attributes'}
  }
  const seen=new Set(),duplicates=[]
  for(const attribute of attributes){
    if(seen.has(attribute.lowerName))duplicates.push(attribute.lowerName)
    else seen.add(attribute.lowerName)
  }
  return {ok:true,attributes,duplicates}
}

function markUnbalanced(element) {
  element.balanced=false
  element.reasonCode=element.reasonCode||'unbalanced-markup'
  element.closeStart=null
  element.closeEnd=null
  element.textStart=element.openEnd
  element.textEnd=element.openEnd
  element.end=element.openEnd
}

/**
 * Builds a conservative element tree from raw HTML bytes. It never repairs
 * markup: mismatched or missing end tags mark the affected elements (and
 * their descendants) read-only instead of inventing a browser tree.
 */
function scanHtmlStructure(source) {
  const elements=[]
  const stack=[]
  let i=0,malformed=false,rootIndex=0,hasHtmlRoot=false,structureRisk=null
  while(i<source.length){
    if(elements.length>=MAX_STRUCTURE_ELEMENTS){malformed=true;break}
    const start=source.indexOf('<',i)
    if(start<0)break
    if(source.startsWith('<!--',start)){
      const close=source.indexOf('-->',start+4)
      if(close<0){malformed=true;break}
      i=close+3
      continue
    }
    if(source[start+1]==='!'||source[start+1]==='?'){
      const close=source.indexOf('>',start+2)
      if(close<0){malformed=true;break}
      i=close+1
      continue
    }
    if(source.startsWith('</',start)){
      const closeMatch=/^<\/([A-Za-z][\w:-]*)\s*>/.exec(source.slice(start,start+128))
      if(!closeMatch){i=start+1;continue}
      const tag=closeMatch[1].toLowerCase()
      const closeStart=start
      const closeEnd=start+closeMatch[0].length
      let index=-1
      for(let k=stack.length-1;k>=0;k--){
        if(stack[k].tag===tag){index=k;break}
      }
      if(index<0){malformed=true;i=closeEnd;continue}
      for(let k=stack.length-1;k>index;k--){
        markUnbalanced(stack.pop())
        malformed=true
      }
      const element=stack.pop()
      element.closeStart=closeStart
      element.closeEnd=closeEnd
      element.textStart=element.openEnd
      element.textEnd=closeStart
      element.end=closeEnd
      element.balanced=true
      i=closeEnd
      continue
    }
    const openMatch=/^<([A-Za-z][\w:-]*)\b/.exec(source.slice(start,start+128))
    if(!openMatch){i=start+1;continue}
    const tag=openMatch[1].toLowerCase()
    let cursor=start+openMatch[0].length
    let quote=null,closed=false
    for(;cursor<source.length;cursor++){
      const character=source[cursor]
      if(quote){if(character===quote)quote=null}
      else if(character==='"'||character==="'")quote=character
      else if(character==='>'){closed=true;break}
    }
    if(!closed){malformed=true;break}
    const openEnd=cursor+1
    const selfClosing=source[cursor-1]==='/'
    const attributeEnd=selfClosing?cursor-1:cursor
    const parent=stack.length?stack[stack.length-1]:null
    // Self-closing syntax is meaningful inside SVG/MathML foreign content,
    // unlike a non-void HTML element such as `<div/>`.
    const parentForeign=!!parent&&parent.foreign===true&&parent.tag!=='foreignobject'
    const foreign=parentForeign||tag==='svg'||tag==='math'
    let path=null,outsideRoot=false
    if(parent){
      const childIndex=parent.childCount||0
      parent.childCount=childIndex+1
      parent.hasElementChildren=true
      path=parent.path===null?null:[...parent.path,childIndex]
    }else if(tag==='html'&&!hasHtmlRoot){
      hasHtmlRoot=true
      path=[]
    }else{
      path=[rootIndex++]
      if(hasHtmlRoot)outsideRoot=true
    }
    const parsedAttributes=attributeList(source,start+openMatch[0].length,attributeEnd)
    const element={
      tag,start,openEnd,end:openEnd,closeStart:null,closeEnd:null,
      textStart:openEnd,textEnd:openEnd,
      path,pathString:path?path.join('.'):null,key:null,
      parentIndex:parent?elements.indexOf(parent):null,
      childCount:0,hasElementChildren:false,
      selfClosing,voidElement:VOID_TAGS.has(tag),balanced:false,foreign,
      reasonCode:null,ancestorReason:null,inert:parent?parent.inert:null,
      outsideRoot,parsedAttributes,id:null,
    }
    if(INERT_TAGS.has(tag)&&!element.inert)element.inert={tag,reasonCode:`inert-${tag}`}
    if(outsideRoot)element.reasonCode='outside-html-root'
    if(!parsedAttributes.ok)element.reasonCode=element.reasonCode||'ambiguous-attribute'
    else if(parsedAttributes.duplicates.length)
      element.reasonCode=element.reasonCode||'ambiguous-attribute'
    const idAttribute=parsedAttributes.ok
      ? parsedAttributes.attributes.find(attribute=>attribute.lowerName==='id') : null
    element.id=idAttribute?idAttribute.value:null
    if(selfClosing&&!element.voidElement&&!foreign){
      element.reasonCode=element.reasonCode||'ambiguous-self-closing'
      if(structureRisk===null)structureRisk=openEnd
    }
    element.key=`${tag}${element.id?'#'+element.id:''}@${element.pathString??'unmapped'}`
    elements.push(element)
    if(RAW_TEXT_TAGS.has(tag)&&!selfClosing){
      const closing=new RegExp('</'+tag+'\\s*>','ig')
      closing.lastIndex=openEnd
      const found=closing.exec(source)
      if(found){
        element.textStart=openEnd
        element.textEnd=found.index
        element.closeStart=found.index
        element.closeEnd=found.index+found[0].length
        element.end=element.closeEnd
        element.balanced=true
        i=element.closeEnd
      }else{
        element.textStart=openEnd
        element.textEnd=source.length
        element.end=source.length
        element.reasonCode=element.reasonCode||'unbalanced-markup'
        malformed=true
        i=source.length
      }
      continue
    }
    if(element.voidElement||selfClosing){
      element.balanced=true
      i=openEnd
      continue
    }
    if(stack.length>=MAX_STRUCTURE_DEPTH){
      // Do not recurse without bound: the element is still reported with its
      // start-tag span, but its subtree is marked read-only ambiguity.
      element.reasonCode=element.reasonCode||'nesting-too-deep'
      element.balanced=true
      element.textStart=element.openEnd
      element.textEnd=element.openEnd
      if(structureRisk===null)structureRisk=openEnd
      i=openEnd
      continue
    }
    stack.push(element)
    i=openEnd
  }
  while(stack.length){
    markUnbalanced(stack.pop())
    malformed=true
  }
  for(const element of elements){
    let parentIndex=element.parentIndex
    while(parentIndex!==null&&parentIndex>=0){
      const parent=elements[parentIndex]
      if(parent.inert&&!element.inert)element.inert=parent.inert
      if(!element.ancestorReason&&parent.reasonCode&&
         ['unbalanced-markup','ambiguous-self-closing','outside-html-root','ambiguous-structure']
           .includes(parent.reasonCode))element.ancestorReason=parent.reasonCode
      parentIndex=parent.parentIndex
    }
    if(structureRisk!==null&&element.start>=structureRisk&&!element.ancestorReason)
      element.ancestorReason='ambiguous-structure'
  }
  // A document with an <html> root must not also expose stray top-level
  // elements: their structural path would collide with the real root.
  if(hasHtmlRoot){
    for(const element of elements){
      if(element.parentIndex===null&&element.tag!=='html'){
        element.outsideRoot=true
        element.reasonCode=element.reasonCode||'outside-html-root'
      }
    }
  }
  // Duplicate ids in the live tree make every occurrence read-only: a
  // structural key/path lookup must not bypass the id ambiguity refusal.
  const idCounts=new Map()
  for(const element of elements){
    if(element.inert||!element.id||!element.parsedAttributes.ok)continue
    if(element.parsedAttributes.duplicates.includes('id'))continue
    idCounts.set(element.id,(idCounts.get(element.id)||0)+1)
  }
  for(const element of elements){
    if(element.inert||!element.id)continue
    if((idCounts.get(element.id)||0)>1)element.duplicateId=true
  }
  // A malformed subtree also makes its ancestors ambiguous as a whole: their
  // serialized span still exists, but the document structure cannot be
  // trusted for a visual target selection.
  for(const element of elements){
    if(!['unbalanced-markup','ambiguous-self-closing','ambiguous-structure']
      .includes(element.reasonCode))continue
    let parentIndex=element.parentIndex
    while(parentIndex!==null&&parentIndex>=0){
      const ancestor=elements[parentIndex]
      ancestor.descendantReason=ancestor.descendantReason||'ambiguous-descendant'
      parentIndex=ancestor.parentIndex
    }
  }
  // Every descendant of a subtree with a malformed child is ambiguous too:
  // a structural path inside it can no longer be proven against the bytes.
  for(const element of elements){
    if(element.inert||element.ancestorReason||element.reasonCode)continue
    let parentIndex=element.parentIndex
    while(parentIndex!==null&&parentIndex>=0){
      const parent=elements[parentIndex]
      if(parent.descendantReason){
        element.ancestorReason='ambiguous-ancestor'
        break
      }
      parentIndex=parent.parentIndex
    }
  }
  return {elements,malformed}
}

function elementReadonlyReason(element) {
  if(element.inert)return element.inert.reasonCode
  if(element.ancestorReason)return element.ancestorReason
  if(element.reasonCode)return element.reasonCode
  if(element.duplicateId)return 'duplicate-id'
  if(element.descendantReason)return element.descendantReason
  if(element.path===null)return 'unmapped-source'
  return null
}

function elementAttribute(element,name) {
  if(!element.parsedAttributes?.ok)return null
  return element.parsedAttributes.attributes.find(attribute=>attribute.lowerName===name)||null
}

function elementClassTokens(element) {
  const attribute=elementAttribute(element,'class')
  if(!attribute||typeof attribute.value!=='string'||attribute.value.length>256||
     !/^[A-Za-z0-9_\s-]*$/.test(attribute.value))return []
  return Array.from(new Set(attribute.value.split(/\s+/).filter(Boolean)
    .filter(token=>/^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(token)))).slice(0,16)
}

function sourceReasonCode(element,entry,idCounts) {
  if(!element)return 'unmapped-source'
  const structural=elementReadonlyReason(element)
  if(structural)return structural
  const id=entry.attrs.id?.value
  if(idCounts.get(id)>1)return 'duplicate-id'
  if(!/^[A-Za-z][\w:.-]{0,79}$/.test(id||''))return 'invalid-id'
  if(entry.attrs.id?.span?.quote===null)return 'unquoted-id'
  if(entry.attrs.style&&(entry.attrs.style.span?.quote===null||
     /["'<>&\\]/.test(entry.attrs.style.value||'')))return 'complex-style'
  return null
}

function normalizePath(path) {
  if(Array.isArray(path)&&path.every(index=>Number.isSafeInteger(index)&&index>=0))
    return path.slice()
  if(typeof path==='string'&&/^(?:\d+(?:\.\d+)*)?$/.test(path))
    return path===''?[]:path.split('.').map(Number)
  return null
}

function targetFailure(code,message,details={}) {
  const error=new Error(message)
  error.code=code
  Object.assign(error,details)
  throw error
}

function resolveOne(elementList,kind,value) {
  if(kind==='key'){
    if(typeof value!=='string'||!value||value.length>512)
      return {ok:false,code:'invalid-target',reason:'key must be a non-empty string'}
    const indexes=[] 
    for(let index=0;index<elementList.length;index+=1){
      if(elementList[index].key===value)indexes.push(index)
    }
    return indexes.length===1?{ok:true,index:indexes[0]}
      :indexes.length>1?{ok:false,code:'ambiguous-target',reason:'duplicate-key'}
      :{ok:false,code:'unknown-node',reason:'key-not-found'}
  }
  if(kind==='path'){
    const path=normalizePath(value)
    if(!path)return {ok:false,code:'invalid-target',reason:'path must be an array of child indices'}
    const indexes=[]
    for(let index=0;index<elementList.length;index+=1){
      const candidate=elementList[index].path
      if(candidate&&candidate.length===path.length&&candidate.every((part,at)=>part===path[at]))
        indexes.push(index)
    }
    return indexes.length===1?{ok:true,index:indexes[0]}
      :indexes.length>1?{ok:false,code:'ambiguous-target',reason:'duplicate-path'}
      :{ok:false,code:'unknown-node',reason:'path-not-found'}
  }
  if(kind==='id'){
    if(typeof value!=='string'||!value||value.length>80)
      return {ok:false,code:'invalid-target',reason:'id must be a non-empty string'}
    const matches=[]
    for(let index=0;index<elementList.length;index+=1){
      const element=elementList[index]
      if(element.id!==value)continue
      if(!element.parsedAttributes.ok)continue
      matches.push(index)
    }
    // Content inside <template>/<script>/<style> is not part of the live
    // document tree, so an inert duplicate does not make a live id ambiguous.
    const live=matches.filter(index=>!elementList[index].inert)
    const inert=matches.filter(index=>elementList[index].inert)
    if(live.length>1)
      return {ok:false,code:'ambiguous-target',reason:'duplicate-id'}
    if(live.length===1)return {ok:true,index:live[0]}
    if(inert.length===1)return {ok:true,index:inert[0]}
    if(inert.length>1)
      return {ok:false,code:'ambiguous-target',reason:'duplicate-id'}
    return {ok:false,code:'unknown-node',reason:'id-not-found'}
  }
  return {ok:false,code:'invalid-target',reason:'unsupported-target-kind'}
}

function resolvedTarget(source,target) {
  if(typeof source!=='string')
    targetFailure('invalid-source','HTML source must be a string')
  if(source.length>512*1024)
    targetFailure('unsupported-source','HTML source exceeds the 512 KiB visual mapping limit')
  if(!target||typeof target!=='object')
    targetFailure('invalid-target','A target object is required')
  const requested=[]
  if(target.id!==undefined)requested.push('id')
  if(target.key!==undefined)requested.push('key')
  if(target.path!==undefined)requested.push('path')
  if(requested.length===0)
    targetFailure('invalid-target','A target id, key or structural path is required')
  const structure=scanHtmlStructure(source)
  const results=requested.map(kind=>resolveOne(structure.elements,kind,target[kind]))
  const failure=results.find(result=>!result.ok)
  if(failure)targetFailure(failure.code,failure.reason||'Target could not be resolved',{
    reasonCode:failure.reason||null,
  })
  const index=results[0].index
  if(results.some(result=>result.index!==index))
    targetFailure('invalid-target','Conflicting id/key/path selectors point at different elements')
  const element=structure.elements[index]
  const readonlyCode=elementReadonlyReason(element)
  return {source,structure,index,element,readonlyCode}
}

function assertEditable(resolved) {
  if(resolved.readonlyCode){
    targetFailure('read-only-target',
      `Element is read-only: ${resolved.readonlyCode}`,{
        reasonCode:resolved.readonlyCode,reason:resolved.readonlyCode,
      })
  }
  if(!resolved.element.parsedAttributes.ok){
    targetFailure('read-only-target','Element attributes cannot be parsed safely',{
      reasonCode:'ambiguous-attribute',reason:'ambiguous-attribute',
    })
  }
}

function describeElement(element) {
  const reasonCode=elementReadonlyReason(element)
  const attributes=element.parsedAttributes.ok
    ? element.parsedAttributes.attributes.map(attribute=>({
      name:attribute.name,value:attribute.value,quote:attribute.quote,
      start:attribute.start,end:attribute.end,
    })) : []
  return {
    tag:element.tag,id:element.id,key:element.key,path:element.path,
    pathString:element.pathString,start:element.start,end:element.end,
    openStart:element.start,openEnd:element.openEnd,
    textStart:element.textStart,textEnd:element.textEnd,
    closeStart:element.closeStart,closeEnd:element.closeEnd,
    balanced:element.balanced,voidElement:element.voidElement,
    hasElementChildren:element.hasElementChildren,
    readonly:reasonCode!==null,reasonCode,attributes,
  }
}

/**
 * Resolves an id/key/path target against the ORIGINAL source and returns its
 * exact byte spans. Throws typed errors (`ambiguous-target`, `unknown-node`,
 * `read-only-target`, `invalid-target`, `unsupported-source`).
 */
export function resolveHtmlVisualElement(source,target) {
  const resolved=resolvedTarget(source,target)
  const description=describeElement(resolved.element)
  if(description.readonly)description.readonly=true
  return description
}

const TEXT_FORBIDDEN=/[<>&\r\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/**
 * Replaces the raw text content of one text-only element. Surrounding bytes
 * (attributes, comments outside the element, sibling markup) are untouched.
 * Text containing markup, entities or control characters is refused.
 */
export function htmlVisualTextPatch(source,request) {
  const target=request
  const text=target?.text
  if(typeof text!=='string')
    targetFailure('invalid-value','text must be a string')
  if(text.length>MAX_TEXT_LENGTH)
    targetFailure('invalid-value','text exceeds the visual editor limit')
  if(TEXT_FORBIDDEN.test(text))
    targetFailure('invalid-value','Text edits cannot contain markup, entities or control characters')
  const resolved=resolvedTarget(source,target)
  assertEditable(resolved)
  const element=resolved.element
  if(element.voidElement)
    targetFailure('unsupported-target','Void elements have no text content')
  if(element.hasElementChildren)
    targetFailure('unsupported-content','Element contains child elements; edit it in the source editor')
  if(element.closeStart===null||!element.balanced)
    targetFailure('read-only-target','Element has no reliable closing tag',{reasonCode:'balanced-required'})
  const body=source.slice(element.textStart,element.textEnd)
  if(body.includes('<'))
    targetFailure('unsupported-content','Text content contains comments or markup; edit it in the source editor')
  return {start:element.textStart,end:element.textEnd,before:body,after:text}
}

function refusedAttributeReason(name) {
  if(/^on[a-z]+$/.test(name))return 'event handlers execute code'
  return REFUSED_ATTRIBUTES.get(name)||null
}

function allowedAttributeName(name) {
  return EDITABLE_ATTRIBUTES.has(name)||ATTRIBUTE_NAME.test(name)
}

function validateAttributeValue(name,value) {
  if(value===null)return null
  if(typeof value!=='string')
    targetFailure('invalid-value','Attribute value must be a string or null')
  if(value.length>MAX_ATTRIBUTE_VALUE_LENGTH)
    targetFailure('invalid-value','Attribute value exceeds the visual editor limit')
  if(name==='class'){
    if(value.length>256||!/^[A-Za-z0-9_\s-]*$/.test(value)||
       value.split(/\s+/).filter(Boolean).length>16)
      targetFailure('invalid-value','Class value must be up to 16 simple class tokens')
    for(const token of value.split(/\s+/).filter(Boolean)){
      if(!/^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(token))
        targetFailure('invalid-value','Class values only accept simple class tokens')
    }
    return null
  }
  if(name==='lang'){
    if(!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value))
      targetFailure('invalid-value','lang must be a BCP-47-like language tag')
    return null
  }
  if(name==='dir'){
    if(!/^(?:ltr|rtl|auto)$/.test(value))
      targetFailure('invalid-value','dir must be ltr, rtl or auto')
    return null
  }
  if(name==='hidden'){
    if(value!==''&&value!=='hidden')
      targetFailure('invalid-value','hidden accepts an empty value or "hidden"')
    return null
  }
  const grammar=name.startsWith('data-')?SAFE_DATA_ATTRIBUTE:SAFE_TEXT_ATTRIBUTE
  if(!grammar.test(value))
    targetFailure('invalid-value','Attribute value contains unsafe characters')
  return null
}

/**
 * Adds, updates or removes (`value: null`) one allowlisted attribute while
 * preserving every byte outside the attribute range. Dangerous attributes
 * (URL, code, style, document embedding) are refused with `forbidden-attribute`
 * and a reason; attributes outside the allowlist are refused with
 * `unsupported-attribute`.
 */
export function htmlVisualAttributePatch(source,request) {
  const name=request?.name
  const value=request?.value
  if(typeof name!=='string'||!name||name.length>64||!/^[A-Za-z_:][A-Za-z0-9_:.-]*$/.test(name))
    targetFailure('invalid-value','Attribute name must be a simple HTML attribute name')
  const lowerName=name.toLowerCase()
  const refused=refusedAttributeReason(lowerName)
  if(refused)
    targetFailure('forbidden-attribute',`Attribute "${lowerName}" is refused: ${refused}`,{
      attribute:lowerName,reasonCode:'forbidden-attribute',reason:refused,
    })
  if(!allowedAttributeName(lowerName))
    targetFailure('unsupported-attribute',
      `Attribute "${lowerName}" is outside the strict editable allowlist`,{
        attribute:lowerName,reasonCode:'not-in-allowlist',
      })
  validateAttributeValue(lowerName,value)
  const resolved=resolvedTarget(source,request)
  assertEditable(resolved)
  const element=resolved.element
  const attributes=element.parsedAttributes.attributes
  if(element.parsedAttributes.duplicates.includes(lowerName))
    targetFailure('ambiguous-attribute',`Attribute "${lowerName}" is duplicated on this element`,{
      attribute:lowerName,reasonCode:'duplicate-attribute',
    })
  const existing=attributes.find(attribute=>attribute.lowerName===lowerName)||null
  if(value===null){
    if(!existing)
      targetFailure('attribute-not-found',`Attribute "${lowerName}" is not present`,{
        attribute:lowerName,
      })
    return {
      start:existing.whitespaceStart,end:existing.end,
      before:source.slice(existing.whitespaceStart,existing.end),after:'',
    }
  }
  if(!existing){
    const insertAt=element.openEnd-1-(source[element.openEnd-2]==='/'?1:0)
    return {start:insertAt,end:insertAt,before:'',after:` ${lowerName}="${value}"`}
  }
  if(existing.value!==null&&existing.quote&&
     !(existing.quote==="'"&&value.includes("'"))){
    return {
      start:existing.valueStart,end:existing.valueEnd,
      before:source.slice(existing.valueStart,existing.valueEnd),after:value,
    }
  }
  return {
    start:existing.start,end:existing.end,
    before:source.slice(existing.start,existing.end),
    after:`${existing.name}="${value}"`,
  }
}

export function inspectHtmlFragmentAttributes(source) {
  const { elements, malformed } = scanHtmlStructure(source)
  if (malformed || !elements.length || elements.some(element =>
    elementReadonlyReason(element) || !element.balanced || !element.parsedAttributes.ok)) {
    targetFailure('unsupported-fragment', 'The fragment has ambiguous markup or inert content')
  }
  return elements.flatMap(element => element.parsedAttributes.attributes)
}

export function collectHtmlDocumentIds(source) {
  const { elements, malformed } = scanHtmlStructure(source)
  if (malformed || elements.some(element => !element.parsedAttributes.ok)) {
    targetFailure('unsupported-source', 'The document identifiers cannot be mapped safely')
  }
  return new Set(elements.map(element => element.id).filter(Boolean))
}
