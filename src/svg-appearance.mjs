/**
 * Copy explicitly authored SVG appearance attributes between two named shapes.
 *
 * Same-document only, never copies external CSS, style= or inherited defaults.
 * Each resulting source change is an exact patch; missing paint declarations
 * are inserted without resaving any element markup.
 */
import { scanSvgDocument, svgLockedAncestor } from './svg-document.mjs'
import { svgAttributePatch } from './svg-attributes.mjs'

const LEAVES=new Set(['rect','circle','ellipse','path','line','polygon','polyline','text'])
const PROPS=['fill','stroke','stroke-width','stroke-opacity','fill-opacity','opacity',
  'stroke-linecap','stroke-linejoin','stroke-dasharray']
const PAINT=/^(?:none|transparent|currentColor|#[0-9a-fA-F]{3,8}|[a-zA-Z]+|url\(#[A-Za-z_][\w.:-]*\))$/
function fail(code,message){const e=new Error(message);e.code=code;throw e}

export function planSvgAppearanceTransfer(source,{sourceId,targetId}={}) {
  if(typeof source!=='string')fail('invalid-source','Expected SVG source')
  if(typeof sourceId!=='string'||typeof targetId!=='string'||!sourceId||!targetId) {
    fail('invalid-target','Both SVG layer ids are required')
  }
  if(sourceId===targetId)fail('unchanged','Cannot copy appearance onto the same layer')
  let scan
  try{scan=scanSvgDocument(source)}
  catch(e){fail(e?.code==='ambiguous-svg'?'ambiguous-svg':'structure-unavailable','SVG structure is unavailable')}
  const from=scan.byId.get(sourceId),to=scan.byId.get(targetId)
  if(!from||!to||!LEAVES.has(from.tag)||!LEAVES.has(to.tag)||from.readOnly||to.readOnly){
    fail('unknown-node','Both source and destination must be editable leaf shapes')
  }
  if(svgLockedAncestor(to))fail('locked','Destination is locked by itself or an ancestor')
  if(from.attributes.has('style')||to.attributes.has('style')||
     scan.nodes.some(node=>node.tag==='style')||/<\?xml-stylesheet\b/i.test(source)){
    fail('ambiguous-style','Cannot copy an appearance controlled by CSS or inline style')
  }
  const patches=[]
  const insertions=[]
  let explicit=0
  for(const name of PROPS) {
    const attribute=from.attributes.get(name)
    if(!attribute)continue
    explicit+=1
    const value=attribute.value
    if(value.includes('&'))fail('encoded-attribute','Encoded native style is not transferable')
    // url(#id) is safe only because source and destination belong to the same
    // document and the referenced id exists in its current source.
    if(name==='fill'||name==='stroke'){
      if(!PAINT.test(value))fail('invalid-value','Unsupported native paint value')
      const m=/^url\(#([A-Za-z_][\w.:-]*)\)$/.exec(value)
      if(m&&!scan.byId.has(m[1]))fail('unknown-reference','Paint references an unknown SVG id')
    }
    const existing=to.attributes.get(name)
    if(existing && existing.value===value)continue
    if(!existing&&name==='fill') {
      insertions.push(' fill="'+value+'"')
      continue
    }
    const patch=svgAttributePatch(source,{id:targetId,attribute:name,value})
    if(patch.start===patch.end)insertions.push(patch.after)
    else patches.push(patch)
  }
  if(!explicit)fail('no-appearance','Source has no explicitly authored SVG appearance')
  if(insertions.length){
    const position=to.openEnd-(to.selfClosing?2:1)
    // Reuse existing whitespace immediately before "/>" or ">" when present:
    // do not create duplicate spaces, and do not delete any source bytes.
    let added=insertions.join('')
    if(/[ \t\r\n]/.test(source[position-1]||'')) added=added.replace(/^ /,'')
    patches.push({start:position,end:position,before:'',after:added})
  }
  if(!patches.length)fail('unchanged','Destination already has these exact native style values')
  if(patches.length>16)fail('invalid-batch','Too many style patches')
  return patches
}
