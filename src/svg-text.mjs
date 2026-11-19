import { listEditableSvgNodes } from './svg-attributes.mjs'

function reject(code, message) { const e = new Error(message); e.code = code; throw e }
const XML_ENTITIES = { amp:'&',lt:'<',gt:'>',quot:'"',apos:"'" }
const MAX_LENGTH = 8192

/** Escape decoded human text without ever evaluating SVG/HTML markup. */
export function escapeSvgText(value) {
  if (typeof value !== 'string' || value.length > MAX_LENGTH || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    reject('invalid-text', 'Text is too large or contains unsupported control characters')
  }
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

export function decodeSvgText(value) {
  const text = value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-zA-Z]+);/gi, (full, name) => {
    if (name[0]==='#') {
      const n=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):parseInt(name.slice(1),10)
      if (!Number.isInteger(n) || n<=0 || n>0x10ffff || (n>=0xd800&&n<=0xdfff)) reject('invalid-entity','Invalid XML character reference')
      return String.fromCodePoint(n)
    }
    if (!(name in XML_ENTITIES)) reject('unsupported-entity','Unknown XML entity')
    return XML_ENTITIES[name]
  })
  if (/&(?!(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#[0-9]+);)/i.test(value)) reject('unsupported-entity','Unresolved XML entity')
  return text
}

function tokens(source) {
  if (typeof source!=='string' || source.length>8*1024*1024) reject('invalid-source','Invalid SVG source')
  if (/<!DOCTYPE\b/i.test(source) || /<script\b/i.test(source)) reject('unsupported-svg','Scripts and DTD cannot be edited')
  const out=[]
  for(let i=0;i<source.length;){
    const at=source.indexOf('<',i)
    if(at<0)break
    if(source.startsWith('<!--',at)){
      const end=source.indexOf('-->',at+4)
      if(end<0)reject('invalid-svg','Unclosed SVG comment')
      i=end+3;continue
    }
    if(source.startsWith('<![CDATA[',at)){
      const end=source.indexOf(']]>',at+9)
      if(end<0)reject('unsupported-svg','Unclosed CDATA')
      i=end+3;continue
    }
    if(source.startsWith('<?',at)){
      const end=source.indexOf('?>',at+2)
      if(end<0)reject('invalid-svg','Unclosed processing instruction')
      i=end+2;continue
    }
    if(source.startsWith('<!',at))reject('unsupported-svg','Markup declaration not supported')
    const closing=source[at+1]==='/'
    const nameStart=at+(closing?2:1)
    const nameMatch=/^[A-Za-z][\w:.-]*/.exec(source.slice(nameStart))
    if(!nameMatch)reject('invalid-svg','Malformed markup')
    const name=nameMatch[0]
    let end=nameStart+name.length,quote=''
    for(;end<source.length;end++){
      const c=source[end]
      if(quote){if(c===quote)quote='';continue}
      if(c==='"'||c==="'"){quote=c;continue}
      if(c==='>')break
    }
    if(end>=source.length)reject('invalid-svg','Unclosed SVG tag')
    const opening=source.slice(at,end+1)
    out.push({name,opening,start:at,end:end+1,closing,selfClose:/\/\s*>$/.test(opening)})
    i=end+1
  }
  return out
}

/** Only plain SVG text or our own simple, deterministic tspan line markup. */
function textSpan(text, x) {
  if (!text.includes('<')) return {editable:true,text:decodeSvgText(text)}
  const exact=/^(?:<tspan x="[^"<>]*" dy="(?:0|1\.2em)">[^<]*<\/tspan>)+$/u
  if(!exact.test(text))return {editable:false,text:''}
  const parts=[...text.matchAll(/<tspan x="([^"<>]*)" dy="(0|1\.2em)">([^<]*)<\/tspan>/gu)]
  if(!parts.length || parts.some((p,i)=>p[1]!==String(x)||p[2] !== (i===0?'0':'1.2em')))return {editable:false,text:''}
  return {editable:true,text:parts.map(part=>decodeSvgText(part[3])).join('\n')}
}

export function listSvgTextNodes(source) {
  const indexed=listEditableSvgNodes(source)
  const ids=new Set(indexed.filter(n=>n.tag==='text').map(n=>n.id))
  const result=[]
  const stream=tokens(source)
  for(let i=0;i<stream.length;i++){
    const token=stream[i]
    if(token.closing || token.name!=='text' || token.selfClose)continue
    const idMatch=/(?:\s)id\s*=\s*(["'])([^"']+)\1/.exec(token.opening)
    if(!idMatch || !ids.has(idMatch[2]))continue
    const end=stream.findIndex((next,index)=>index>i && next.name==='text' && next.closing)
    if(end<0)continue
    const closing=stream[end]
    const nested=stream.some((next,index)=>index>i && index<end && !['tspan'].includes(next.name))
    const attrs=indexed.find(n=>n.id===idMatch[2])?.attributes || {}
    const content=source.slice(token.end,closing.start)
    let data={editable:false,text:''}
    try { if(!nested)data=textSpan(content,attrs.x) } catch {}
    result.push({id:idMatch[2],start:token.end,end:closing.start,before:content,...data,attributes:attrs})
    i=end
  }
  return result
}

export function serializeSvgText(value,x) {
  const escaped=value.split(/\r?\n/u).map(escapeSvgText)
  return escaped.length===1?escaped[0]:escaped.map((line,index)=>{
    if(!x)reject('unsupported-text','Multiline SVG text requires an explicit x coordinate')
    return '<tspan x="'+x+'" dy="'+(index===0?'0':'1.2em')+'">'+line+'</tspan>'
  }).join('')
}

export function svgTextPatch(source,{id,value}) {
  if(typeof id!=='string' || !id || typeof value!=='string')reject('invalid-target','Invalid text edit')
  const nodes=listSvgTextNodes(source)
  const matches=nodes.filter(node=>node.id===id)
  if(matches.length!==1)reject('unknown-node','SVG text id not found or ambiguous')
  const node=matches[0]
  if(!node.editable)reject('unsupported-text','Complex SVG text needs source editing')
  const after=serializeSvgText(value,node.attributes.x)
  return {start:node.start,end:node.end,before:node.before,after}
}
