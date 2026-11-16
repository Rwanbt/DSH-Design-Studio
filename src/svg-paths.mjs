/**
 * Loss-conscious SVG path-point editing. Supports explicit ABSOLUTE M/L/Q/C/Z
 * commands only. Edits two numeric source spans without serializing SVG/XML.
 * Repeated implicit coordinates, relative commands, arcs and smooth commands
 * are intentionally rejected until their semantics can be preserved.
 */
import { listEditableSvgNodes, svgAttributePatch } from './svg-attributes.mjs'
import { svgElementPatch } from './svg-elements.mjs'
import { svgGeometry } from './svg-geometry.mjs'

const ARITY = { M:2, L:2, Q:4, C:6, Z:0 }
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
const LIMIT=1_000_000
function fail(code,message) {const e=new Error(message);e.code=code;throw e}
function round(value) {
  const v=Math.round(value*1000)/1000
  return String(Object.is(v,-0)?0:v)
}

/**
 * Parse a small, explicit SVG path grammar; source offsets are relative to d.
 * Controls carry a line endpoint so the client can draw editing handles.
 */
export function parseEditablePath(d) {
  if(typeof d!=='string' || !d.trim() || d.length>8192)fail('unsupported-path','Invalid path length')
  let cursor=0, commands=0, previous=null, subpath=null, closed=false
  const points=[]
  function skip() {while(cursor<d.length && /[\s,]/.test(d[cursor]))cursor++}
  function coordinate() {
    skip()
    const found=NUMBER.exec(d.slice(cursor))
    if(!found)fail('unsupported-path','Expected an explicit numeric path coordinate')
    const start=cursor, token=found[0]
    cursor+=token.length
    const value=Number(token)
    if(!Number.isFinite(value)||Math.abs(value)>LIMIT)fail('unsupported-path','Path coordinate outside bounds')
    return {value,start,end:cursor}
  }
  function point(role,commandIndex) {
    const x=coordinate(),y=coordinate()
    const result={index:points.length,role,commandIndex,x:x.value,y:y.value,
      xSpan:{start:x.start,end:x.end},ySpan:{start:y.start,end:y.end},link:null,linkIndex:null,linkIndex2:null}
    points.push(result)
    return result
  }
  while(true) {
    skip()
    if(cursor===d.length)break
    if(++commands>128)fail('unsupported-path','Too many path commands')
    const command=d[cursor++]
    if(!Object.prototype.hasOwnProperty.call(ARITY,command)) {
      fail('unsupported-path','Only explicit absolute M L Q C Z commands are supported')
    }
    if(!previous && command!=='M')fail('unsupported-path','A path must begin with M')
    if(closed && command!=='M')fail('unsupported-path','Start a new M after Z')
    if(command==='Z') {if(!subpath || closed)fail('unsupported-path','Invalid closepath');previous=subpath;closed=true;continue}
    if(points.length + ARITY[command]/2>256)fail('unsupported-path','Too many points')
    if(command==='M') {
      const anchor=point('anchor',commands)
      previous=anchor;subpath=anchor;closed=false
    } else if(command==='L') {
      previous=point('anchor',commands)
    } else if(command==='Q') {
      const control=point('quadratic',commands)
      const end=point('anchor',commands)
      control.link={x:end.x,y:end.y};control.linkIndex=end.index;control.linkIndex2=previous.index
      previous=end
    } else if(command==='C') {
      const control1=point('cubic-in',commands)
      const control2=point('cubic-out',commands)
      const end=point('anchor',commands)
      control1.link={x:previous.x,y:previous.y};control1.linkIndex=previous.index
      control2.link={x:end.x,y:end.y};control2.linkIndex=end.index
      previous=end
    }
    skip()
    if(cursor!==d.length && !Object.prototype.hasOwnProperty.call(ARITY,d[cursor])) {
      fail('unsupported-path','Implicit repeated points and unrecognized path commands are not supported')
    }
  }
  if(!points.length)fail('unsupported-path','Path has no editable points')
  return points
}

/** Validate that the path is a direct, untransformed SVG leaf. */
function model(source,id) {
  if(typeof id!=='string'||!id)fail('invalid-target','A path id is required')
  const nodes=listEditableSvgNodes(source)
  const node=nodes.find(item=>item.id===id)
  if(!node || node.tag!=='path')fail('unknown-node','Editable SVG path not found')
  if(node.attributes.transform || !Object.prototype.hasOwnProperty.call(node.attributes,'d')) {
    fail('unsupported-path','Transformed or missing-d paths are unsupported')
  }
  const geometry=svgGeometry(source)
  if(!geometry.artboard || geometry.warning)fail('unsupported-path','Path editing requires an untransformed SVG with a root viewBox')
  svgElementPatch(source,{id,operation:'delete'}) // Validate well-formed direct SVG leaf.
  const attribute=svgAttributePatch(source,{id,attribute:'d',value:node.attributes.d})
  return {points:parseEditablePath(node.attributes.d),attribute}
}

/** Shape-list metadata: unsupported paths remain listed but are not changed. */
export function listSvgPathModels(source) {
  const nodes=listEditableSvgNodes(source).filter(node=>node.tag==='path')
  return nodes.slice(0,128).map(node=>{
    try {
      const {points}=model(source,node.id)
      return {id:node.id,editable:true,d:node.attributes.d,
        points:points.map(({index,role,x,y,link,linkIndex,linkIndex2,xSpan,ySpan})=>
          ({index,role,x,y,link,linkIndex,linkIndex2,xSpan,ySpan}))}
    }catch(e){
      return {id:node.id,editable:false,reason:e.code||'unsupported-path',points:[]}
    }
  })
}

/** Return two exact source-range patches for one x/y node. */
export function svgPathPointPatches(source,{id,index,x,y}) {
  if(!Number.isInteger(index)||index<0||index>=256 ||
     typeof x!=='number'||typeof y!=='number'||
     ![x,y].every(value=>Number.isFinite(value)&&Math.abs(value)<=LIMIT)) {
    fail('invalid-target','Invalid path point position')
  }
  const {points,attribute}=model(source,id)
  const point=points[index]
  if(!point)fail('unknown-node','Path point index not found')
  return [
    {start:attribute.start+point.xSpan.start,end:attribute.start+point.xSpan.end,
      before:source.slice(attribute.start+point.xSpan.start,attribute.start+point.xSpan.end),after:round(x)},
    {start:attribute.start+point.ySpan.start,end:attribute.start+point.ySpan.end,
      before:source.slice(attribute.start+point.ySpan.start,attribute.start+point.ySpan.end),after:round(y)},
  ]
}
