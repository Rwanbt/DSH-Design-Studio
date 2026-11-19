/**
 * Move multiple selected SVG shapes by one shared artboard-space vector.
 *
 * The Host, not the browser, computes the patches against the current document
 * and its current parent transforms. This is one revision-checked transaction
 * with one exact inverse and no rewritten XML outside selected transform spans.
 */
import { scanSvgDocument } from './svg-document.mjs'
import { svgAbsoluteGeometry } from './svg-geometry.mjs'
import { svgTransformPatch } from './svg-transform.mjs'

function fail(code,message){const e=new Error(message);e.code=code;throw e}
const LIMIT=10000
export function planSvgMultiNudge(source,{ids,dx,dy}={}) {
  if(typeof source!=='string')fail('invalid-source','Expected native SVG source')
  if(!Array.isArray(ids)||ids.length<2||ids.length>16||
     ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length) {
    fail('invalid-target','Select 2 to 16 distinct named SVG elements')
  }
  if(typeof dx!=='number'||typeof dy!=='number'||
     !Number.isFinite(dx)||!Number.isFinite(dy)||
     Math.abs(dx)>LIMIT||Math.abs(dy)>LIMIT||(dx===0&&dy===0)) {
    fail('invalid-target','A bounded nonzero two-dimensional delta is required')
  }
  const scan=scanSvgDocument(source)
  const selected=new Set(ids)
  for(const id of ids){
    const node=scan.byId.get(id)
    if(!node||node===scan.root||node.readOnly)fail('unknown-node','Selection contains an uneditable element')
    for(let parent=node.parent;parent;parent=parent.parent) {
      if(parent.id&&selected.has(parent.id)) {
        fail('overlapping-selection','A group and its descendant cannot both move in one operation')
      }
    }
  }
  const geometry=svgAbsoluteGeometry(source)
  if(!geometry.artboard||geometry.warning) {
    fail('unsupported-geometry','Cannot safely derive SVG artboard coordinates')
  }
  const handles=new Map(geometry.handles.map(handle=>[handle.id,handle]))
  const patches=[]
  for(const id of ids) {
    const handle=handles.get(id)
    if(!handle?.move)fail('unsupported-geometry','A selected element has no safe geometry handle')
    // A leaf's pivotInverse maps the artboard delta into its parent's space;
    // group move.inverse is the same parent-space inverse.
    const inverse=handle.group?handle.move.inverse:handle.pivotInverse
    if(!Array.isArray(inverse)||inverse.length!==6) {
      fail('unsupported-transform','Parent transform cannot be inverted safely')
    }
    const x=inverse[0]*dx+inverse[2]*dy
    const y=inverse[1]*dx+inverse[3]*dy
    if(!Number.isFinite(x)||!Number.isFinite(y)) {
      fail('unsupported-transform','Nonfinite transformed movement')
    }
    const round=value=>Math.round(value*1000000)/1000000
    const patch=svgTransformPatch(source,{id,operation:{
      type:'translate',dx:round(x),dy:round(y)}}).patch
    patches.push(patch)
  }
  // Native patches are expressed in original source coordinates. Disallow
  // any overlaps explicitly, including accidental nested/editable markup.
  const sorted=[...patches].sort((a,b)=>a.start-b.start)
  for(let i=1;i<sorted.length;i++){
    if(sorted[i-1].end>sorted[i].start||
       (sorted[i-1].start===sorted[i].start)) {
      fail('overlap','Selected SVG transform patches overlap')
    }
  }
  return patches
}
