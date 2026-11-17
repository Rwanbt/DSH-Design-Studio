/** Conservative SVG source-span inspector; never serializes the XML tree. */
import { scanSvgDocument, svgLockedAncestor } from './svg-document.mjs'

const TAGS = new Set(['svg','g','rect','circle','ellipse','line','polyline','polygon','path','text','use'])
const PROPS = new Set(['fill','stroke','stroke-width','opacity','x','y','width','height','r','rx','ry','cx','cy','x1','x2','y1','y2','d','transform','font-size','font-family','font-weight','font-style','letter-spacing','text-anchor'])
const NUMERIC = new Set(['stroke-width','opacity','x','y','width','height','r','rx','ry','cx','cy','x1','x2','y1','y2','font-size','letter-spacing'])
function fail(code, message) { const error = new Error(message); error.code = code; throw error }
function nameChar(c) { return /[\w.:\-]/.test(c ?? '') }

function tags(source) {
  if (typeof source !== 'string' || source.length > 8 * 1024 * 1024) fail('invalid-source','Invalid or too large SVG')
  if (/<!DOCTYPE\b/i.test(source) || /<script\b/i.test(source)) fail('unsupported-svg','SVG containing DTD or scripts is not editable in this prototype')
  const output=[]
  for (let p=0; p<source.length; p++) {
    if (source[p] !== '<') continue
    if (source.startsWith('<!--',p)) {
      const end=source.indexOf('-->',p+4)
      if(end<0) fail('invalid-svg','Unterminated comment')
      p=end+2; continue
    }
    if (source.startsWith('<![CDATA[',p)) {
      const end=source.indexOf(']]>',p+9)
      if(end<0) fail('invalid-svg','Unterminated CDATA')
      p=end+2; continue
    }
    if (source.startsWith('<?',p)) {
      const end=source.indexOf('?>',p+2)
      if(end<0) fail('invalid-svg','Unterminated processing instruction')
      p=end+1; continue
    }
    if (source[p+1] === '/' || source[p+1] === '!') continue
    let k=p+1
    while(nameChar(source[k])) k++
    const tag=source.slice(p+1,k)
    if(!tag || !TAGS.has(tag)) continue
    const attrs=[]
    let closed=false
    while(k<source.length) {
      while(/\s/.test(source[k]??'')) k++
      if(source[k] === '>') {closed=true;break}
      if(source[k] === '/' && source[k+1] === '>') {k++;closed=true;break}
      const start=k
      while(nameChar(source[k])) k++
      if (k === start) fail('invalid-svg','Malformed SVG attribute')
      const name=source.slice(start,k)
      while(/\s/.test(source[k]??'')) k++
      if(source[k] !== '=') fail('invalid-svg','Unsupported boolean SVG attribute')
      k++
      while(/\s/.test(source[k]??'')) k++
      const quote=source[k]
      if(quote !== '"' && quote !== "'") fail('invalid-svg','SVG attributes must be quoted')
      k++
      const valueStart=k
      while(k<source.length && source[k]!==quote) k++
      if(k>=source.length) fail('invalid-svg','Unterminated SVG attribute')
      attrs.push({name, value:source.slice(valueStart,k), start:valueStart, end:k})
      k++
    }
    if(!closed) fail('invalid-svg','Unterminated SVG tag')
    output.push({tag,attrs})
    p=k
  }
  return output
}

export function svgRootAttributes(source) {
  const roots = tags(source).filter(item => item.tag === 'svg')
  if (roots.length !== 1) fail('ambiguous-svg', 'Expected exactly one SVG root')
  const result = {}
  for (const attr of roots[0].attrs) {
    if (Object.prototype.hasOwnProperty.call(result, attr.name)) {
      fail('ambiguous-svg', 'Duplicate SVG root attribute')
    }
    result[attr.name] = attr.value
  }
  return result
}

function legacyNodes(source) {
  const used=new Set()
  const nodes=[]
  for(const item of tags(source)) {
    const ids=item.attrs.filter(a=>a.name==='id')
    if(ids.length>1) fail('ambiguous-svg','Tag contains multiple ids')
    if(!ids.length) continue
    const id=ids[0].value
    if(!/^[A-Za-z_][\w.:-]*$/.test(id)) continue
    if(used.has(id)) fail('ambiguous-svg','Duplicate SVG id: ' + id)
    used.add(id)
    nodes.push({id,tag:item.tag,attributes:Object.fromEntries(item.attrs.filter(a=>PROPS.has(a.name)).map(a=>[a.name,a.value]))})
  }
  return nodes
}

function unlocated(node) {
  return {...node,depth:null,parentId:null,parentTag:null,ancestorIds:[],siblingIndex:null,
    order:null,isGroup:node.tag==='g',start:null,openEnd:null,contentStart:null,contentEnd:null,
    end:null,selfClosing:null,readOnly:true,structure:false}
}

function located(node,scan) {
  const parent=scan.parent
  // Named ancestor ids only (the SVG root and anonymous wrappers have no id);
  // `parentTag` still names the immediate parent even when it is anonymous.
  const ancestorIds=[]
  for(let current=parent;current;current=current.parent)if(current.id)ancestorIds.unshift(current.id)
  return {...node,depth:scan.depth,parentId:parent?parent.id:null,parentTag:parent?parent.tag:null,
    ancestorIds,siblingIndex:scan.siblingIndex,order:scan.order,isGroup:scan.tag==='g',
    start:scan.start,openEnd:scan.openEnd,contentStart:scan.contentStart,contentEnd:scan.contentEnd,
    end:scan.end,selfClosing:scan.selfClosing,readOnly:scan.readOnly,structure:true}
}

/**
 * Hierarchical layer model, backwards compatible with the flat alpha listing.
 * Each node now also exposes `depth`, `parentId`/`parentTag`/`ancestorIds`,
 * `siblingIndex`, `order`, `isGroup`, its exact source span
 * (`start`/`openEnd`/`contentStart`/`contentEnd`/`end`, `selfClosing`) and
 * `readOnly` (content of `<defs>`, `<symbol>`, gradients, … is listed but not
 * directly editable).
 *
 * When the document cannot be mapped structurally (for example a tolerated
 * legacy malformed fragment), the flat listing is still returned with
 * `structure:false` and null hierarchy fields rather than guessing offsets.
 * Ids that only exist inside comments, CDATA or quoted attribute values are
 * never reported as editable nodes.
 */
export function listEditableSvgNodes(source) {
  const nodes=legacyNodes(source)
  let scan=null
  try { scan=scanSvgDocument(source) } catch { scan=null }
  if(!scan) return nodes.map(unlocated)
  const result=[]
  for(const node of nodes) {
    const exact=scan.byId.get(node.id)
    if(!exact || exact.tag!==node.tag) continue
    result.push(located(node,exact))
  }
  return result
}

function validatedValue(attribute,value) {
  if (typeof value!=='string' || value.length>4096 || /[<>\0]/.test(value)) fail('invalid-value','Unsafe attribute value')
  if(NUMERIC.has(attribute)) {
    if(!/^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) fail('invalid-value','Expected a finite numeric value')
    if(!Number.isFinite(Number(value))) fail('invalid-value','Number not finite')
    if(['width','height','r','rx','ry','stroke-width'].includes(attribute) && Number(value)<0) fail('invalid-value','Nonnegative value required')
    if(attribute==='font-size' && (Number(value)<1 || Number(value)>500)) fail('invalid-value','Font size must be 1..500')
    if(attribute==='letter-spacing' && Math.abs(Number(value))>100) fail('invalid-value','Letter spacing out of range')
    if(attribute==='opacity' && (Number(value)<0 || Number(value)>1)) fail('invalid-value','Opacity must be within 0..1')
  } else if(['fill','stroke'].includes(attribute)) {
    if(!/^(?:none|transparent|currentColor|#[0-9a-fA-F]{3,8}|[a-zA-Z]+|url\(#[A-Za-z_][\w.:-]*\))$/.test(value)) fail('invalid-value','Unsupported or unsafe paint value')
  } else if(attribute==='font-family') {
    if(!/^[\p{L}\p{N} ,._-]{1,120}$/u.test(value)) fail('invalid-value','Unsupported font family name')
  } else if(attribute==='font-weight') {
    if(!/^(?:normal|bold|[1-9]00)$/.test(value)) fail('invalid-value','Unsupported font weight')
  } else if(attribute==='font-style') {
    if(!/^(?:normal|italic|oblique)$/.test(value)) fail('invalid-value','Unsupported font style')
  } else if(attribute==='text-anchor') {
    if(!/^(?:start|middle|end)$/.test(value)) fail('invalid-value','Unsupported text alignment')
  } else if(attribute==='d') {
    if(!/^[MmZzLlHhVvCcSsQqTtAaEe0-9+\-.,\s]*$/.test(value)) fail('invalid-value','Invalid path data characters')
  } else if(attribute==='transform') {
    if(!/^(?:\s*(?:translate|scale|rotate|matrix|skewX|skewY)\s*\([0-9eE+\-.,\s]+\)\s*)+$/.test(value)) fail('invalid-value','Invalid transform expression')
  }
  return value
}

export function svgAttributePatch(source,{id,attribute,value}) {
  if(typeof id!=='string' || typeof attribute!=='string' || !PROPS.has(attribute)) fail('invalid-target','Attribute is not editable')
  validatedValue(attribute,value)
  if(!listEditableSvgNodes(source).some(item=>item.id===id)) fail('unknown-node','SVG node id not found')
  // A locked layer (or a locked ancestor) refuses attribute edits too, not only
  // visibility/transform/grouping: otherwise the lock is a decoration.
  try {
    const node=scanSvgDocument(source).byId.get(id)
    if(node && svgLockedAncestor(node)) fail('locked','Element is locked; unlock it before editing')
  } catch(error) {
    if(error?.code==='locked') throw error
    // An unparsable document is already reported by the scanners above.
  }
  const selected=tags(source).find(item=>item.attrs.some(a=>a.name==='id'&&a.value===id))
  const matches=selected.attrs.filter(a=>a.name===attribute)
  if(matches.length!==1) fail('unsupported-edit','This attribute must already exist and be unique')
  const a=matches[0]
  return {start:a.start,end:a.end,before:a.value,after:value}
}
