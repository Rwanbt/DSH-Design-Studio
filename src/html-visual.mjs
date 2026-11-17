/**
 * Conservative HTML source mapping for the first manual visual inspector.
 * Only uniquely identified, directly styled HTML start tags are editable.
 * The source is never reformatted and no scripts/DOM objects are executed.
 */
const TAGS=new Set(['div','main','header','footer','section','article','aside','nav','p','span',
  'h1','h2','h3','h4','h5','h6','button','a','ul','ol','li','label','figure','figcaption',
  'form','input','textarea','img','picture','strong','em'])
const RAW=new Set(['script','style','textarea','template'])
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
  'flex-direction':/^(?:row|column|row-reverse|column-reverse)$/i,
  'justify-content':/^(?:start|end|center|space-between|space-around|space-evenly|flex-start|flex-end)$/i,
  'align-items':/^(?:start|end|center|stretch|baseline|flex-start|flex-end)$/i,
  opacity:/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/,
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
    if(['id','style','class','href','rel'].includes(key)){
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
export function listHtmlVisualElements(source) {
  return indexed(source).slice(0,200).map(entry=>{
    const raw=entry.attrs.class
    const valid=raw?.span?.quote &&
      typeof raw.value==='string' && raw.value.length<=256 &&
      /^[A-Za-z0-9_\s-]*$/.test(raw.value)
    const classes=valid?Array.from(new Set(raw.value.split(/\s+/).filter(Boolean)
      .filter(token=>/^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(token)))).slice(0,16):[]
    return {id:entry.id,tag:entry.tag,editable:entry.editable,reason:entry.reason,
      style:entry.attrs.style?.value||'',classes}
  })
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
    if(!/^(?:stylesheet|stylesheet\s+type)$/.test(relValue))return null
    const valid=href?.span?.quote && rel?.span?.quote &&
      typeof href.value==='string' && href.value.length>0 && href.value.length<=256
    return {href:valid?href.value:'',valid:!!valid,
      reason:valid?null:'unquoted-or-invalid-stylesheet-link'}
  }).filter(Boolean)
}
