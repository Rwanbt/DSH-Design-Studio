import { listEditableSvgNodes, svgRootAttributes } from './svg-attributes.mjs'
import { svgGeometry } from './svg-geometry.mjs'

const TYPES=new Set(['rect','circle','ellipse','text'])
const ATTRS={
  rect:['x','y','width','height','fill'],
  circle:['cx','cy','r','fill'],
  ellipse:['cx','cy','rx','ry','fill'],
  text:['x','y','font-size','font-family','font-weight','font-style','letter-spacing','text-anchor','fill'],
}
function invalid(code,message){const e=new Error(message);e.code=code;throw e}
function number(value) {
  if(!Number.isFinite(value) || Math.abs(value)>1e6)invalid('invalid-geometry','Invalid SVG geometry')
  const rounded=Math.round(value*1000)/1000
  return String(Object.is(rounded,-0)?0:rounded)
}
export function svgShapeInsertPatch(source,kind) {
  if(typeof source!=='string' || !TYPES.has(kind))invalid('unsupported-shape','Only rectangle/circle/ellipse/text are supported')
  // The existing inspector rejects scripts/DOCTYPE and ambiguous SVG IDs.
  svgRootAttributes(source)
  const ids=new Set(listEditableSvgNodes(source).map(node=>node.id))
  // Conservative insertion: only a single, explicit closing SVG tag, not a
  // self-closing document or trailing markup beyond whitespace.
  const close=/<\/svg\s*>\s*$/i.exec(source)
  if(!close)invalid('unsupported-svg','SVG must end with a closing root element')
  const start=close.index
  if(source.slice(0,start).match(/<\/svg\s*>/gi))invalid('ambiguous-svg','Multiple closing root elements')
  const geometry=svgGeometry(source)
  if(!geometry.artboard || geometry.warning)invalid('unsupported-svg','Add shape requires a simple root viewBox and safe geometry')
  let id
  for(let i=1;i<=10000;i++){
    const proposed='shape-'+i
    if(!ids.has(proposed)){id=proposed;break}
  }
  if(!id)invalid('too-many-shapes','No unique shape identifier available')
  const {x,y,width,height}=geometry.artboard
  const cx=x+width/2,cy=y+height/2
  const size=Math.max(1,Math.min(width,height)*0.2)
  const attr=kind==='rect'?
    {x:cx-size/2,y:cy-size/2,width:size,height:size,fill:'#bca38d'}:
    kind==='circle'?
      {cx,cy,r:size/2,fill:'#bca38d'}:
      kind==='ellipse'?
        {cx,cy,rx:size/2,ry:size*0.35,fill:'#bca38d'}:
        {x:cx,y:cy,'font-size':Math.max(12,size/2),'font-family':'Inter, Arial','font-weight':'500','font-style':'normal','letter-spacing':0,'text-anchor':'middle',fill:'#e9e7e2'}
  const string=ATTRS[kind].map(key=>key+'="'+(typeof attr[key]==='number'?number(attr[key]):attr[key])+'"').join(' ')
  const prefix=(start>0 && source[start-1]==='\n'?'':'\n')
  const inserted=prefix+'  <'+kind+' id="'+id+'" '+string+(kind==='text'?'>Double-click to edit</text>':'/>')+'\n'
  return {id,patch:{start,end:start,before:'',after:inserted}}
}
