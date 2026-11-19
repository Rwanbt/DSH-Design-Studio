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
export function parseEditablePathDetailed(d) {
  if(typeof d!=='string' || !d.trim() || d.length>8192)fail('unsupported-path','Invalid path length')
  let cursor=0, commands=0, previous=null, subpath=null, closed=false
  const points=[]
  const commandsList=[]
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
    const commandStart=cursor
    const previousPoint=previous
    const groupStart=points.length
    const command=d[cursor++]
    if(!Object.prototype.hasOwnProperty.call(ARITY,command)) {
      fail('unsupported-path','Only explicit absolute M L Q C Z commands are supported')
    }
    if(!previous && command!=='M')fail('unsupported-path','A path must begin with M')
    if(closed && command!=='M')fail('unsupported-path','Start a new M after Z')
    if(command==='Z') {
      if(!subpath || closed)fail('unsupported-path','Invalid closepath')
      commandsList.push({commandIndex:commands,type:'Z',start:commandStart,end:cursor,from:previousPoint,to:subpath,controls:[]})
      previous=subpath;closed=true;continue
    }
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
    commandsList.push({commandIndex:commands,type:command,start:commandStart,end:cursor,
      from:command==='M'?null:previousPoint,to:previous,controls:points.slice(groupStart,-1)})
    if(cursor!==d.length && !Object.prototype.hasOwnProperty.call(ARITY,d[cursor])) {
      fail('unsupported-path','Implicit repeated points and unrecognized path commands are not supported')
    }
  }
  if(!points.length)fail('unsupported-path','Path has no editable points')
  return {points,commands:commandsList}
}
export function parseEditablePath(d) {return parseEditablePathDetailed(d).points}

function interpolate(a,b,t=0.5) {return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}}
function segmentCenter(segment) {
  const {type,from,to,controls}=segment
  if(!from || !to)fail('unsupported-segment','Selected path command is not a drawable segment')
  if(type==='L')return interpolate(from,to)
  if(type==='Q')return interpolate(interpolate(from,controls[0]),interpolate(controls[0],to))
  if(type==='C') {
    const a=interpolate(from,controls[0]),b=interpolate(controls[0],controls[1]),c=interpolate(controls[1],to)
    return interpolate(interpolate(a,b),interpolate(b,c))
  }
  fail('unsupported-segment','Only line and Bézier segments support midpoint insertion')
}
function highPrecision(value) {
  if(!Number.isFinite(value)||Math.abs(value)>LIMIT)fail('invalid-target','Nonfinite or out-of-range path coordinate')
  const rounded=Math.round(value*1e6)/1e6
  return String(Object.is(rounded,-0)?0:rounded)
}
function coordinates(point) {return highPrecision(point.x)+' '+highPrecision(point.y)}

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
  return {...parseEditablePathDetailed(node.attributes.d),attribute}
}

/** Identify anchors joining two native cubic segments; only these have paired tangents. */
function cubicJunctions(commands) {
  const result=[]
  for(let i=1;i<commands.length;i++){
    const previous=commands[i-1],next=commands[i]
    if(previous.type==='C'&&next.type==='C'&&previous.to?.index===next.from?.index) {
      result.push({index:previous.to.index,x:previous.to.x,y:previous.to.y})
    }
  }
  return result
}

/** Shape-list metadata: unsupported paths remain listed but are not changed. */
export function listSvgPathModels(source) {
  const nodes=listEditableSvgNodes(source).filter(node=>node.tag==='path')
  return nodes.slice(0,128).map(node=>{
    try {
      const {points,commands}=model(source,node.id)
      return {id:node.id,editable:true,d:node.attributes.d,
        smoothAnchors:cubicJunctions(commands),
        penExtendable:commands.filter(item=>item.type==='M').length===1 && !commands.some(item=>item.type==='Z'),
        segments:commands.filter(item=>['L','Q','C'].includes(item.type)).map(item=>({
          commandIndex:item.commandIndex,type:item.type,midpoint:segmentCenter(item),
          removable:item.type==='L',endIndex:item.to.index
        })),
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


/**
 * Safely add the mathematical midpoint of an existing L/Q/C path segment, or
 * remove one explicit L segment. For curves, de Casteljau subdivision preserves
 * the original shape to six-decimal coordinate precision; other path commands
 * are unaffected and retain their exact source bytes.
 */
export function svgPathTopologyPatch(source,{id,operation,commandIndex}) {
  if(!['insert','remove'].includes(operation) ||
     !Number.isInteger(commandIndex) || commandIndex<1 || commandIndex>128) {
    fail('invalid-target','Unsupported path topology operation or segment index')
  }
  const {commands,attribute}=model(source,id)
  const segment=commands.find(item=>item.commandIndex===commandIndex)
  if(!segment || !['L','Q','C'].includes(segment.type)) {
    fail('unsupported-segment','Only explicit line or Bézier segments are editable')
  }
  const from=attribute.start+segment.start, end=attribute.start+segment.end
  const before=source.slice(from,end)
  let after
  if(operation==='remove') {
    if(segment.type!=='L')fail('unsupported-segment','Removing a Bézier segment would change the curve unpredictably')
    after=''
  } else {
    const p0=segment.from,p1=segment.controls[0],p2=segment.controls[1],p3=segment.to
    const midpoint=segmentCenter(segment)
    if(segment.type==='L') {
      after='L '+coordinates(midpoint)+' L '+coordinates(p3)+' '
    } else if(segment.type==='Q') {
      const a=interpolate(p0,p1),b=interpolate(p1,p3)
      after='Q '+coordinates(a)+' '+coordinates(midpoint)+
        ' Q '+coordinates(b)+' '+coordinates(p3)+' '
    } else {
      const a=interpolate(p0,p1),b=interpolate(p1,p2),c=interpolate(p2,p3)
      const d=interpolate(a,b),e=interpolate(b,c)
      after='C '+coordinates(a)+' '+coordinates(d)+' '+coordinates(midpoint)+
        ' C '+coordinates(e)+' '+coordinates(c)+' '+coordinates(p3)+' '
    }
  }
  // Do not exceed the same conservative parser limits after editing.
  const d=attribute.before
  const next=d.slice(0,segment.start)+after+d.slice(segment.end)
  parseEditablePath(next)
  return {start:from,end,before,after}
}


/**
 * The pen tool appends explicit path commands at the END of an existing open
 * single-subpath path. It never normalizes the user's original path syntax.
 */
export function svgPenContinuePatch(source,{id,operation,x,y,c1,c2}) {
  if(!['append','close'].includes(operation))fail('invalid-target','Unknown pen operation')
  const {points,commands,attribute}=model(source,id)
  if(!commands.length || commands[0].type!=='M' ||
     commands.filter(command=>command.type==='M').length!==1 ||
     commands.some(command=>command.type==='Z')) {
    fail('unsupported-path','Pen requires a single open SVG path')
  }
  const last=commands.at(-1)
  if(!last || !['M','L','Q','C'].includes(last.type))fail('unsupported-path','Pen requires a drawable path endpoint')
  let after
  if(operation==='close') {
    if(commands.length<3 || points.filter(point=>point.role==='anchor').length<3) {
      fail('unsupported-path','Closing requires at least three anchors')
    }
    after=' Z'
  }else{
    if(typeof x!=='number'||typeof y!=='number')fail('invalid-target','Pen requires finite coordinates')
    const target={x,y}
    const endpoint=commands.at(-1).to
    if(target.x===endpoint.x&&target.y===endpoint.y)fail('invalid-target','Pen endpoint must differ from the previous point')
    if((c1===undefined)!==(c2===undefined))fail('invalid-target','Both Bézier control points must be provided')
    if(c1===undefined){
      after=' L '+coordinates(target)
    }else{
      if(!c1 || !c2 || typeof c1.x!=='number'||typeof c1.y!=='number'||
         typeof c2.x!=='number'||typeof c2.y!=='number')fail('invalid-target','Invalid Bézier controls')
      after=' C '+coordinates(c1)+' '+coordinates(c2)+' '+coordinates(target)
    }
  }
  if(attribute.before.length+after.length>8192)fail('unsupported-path','Pen path has reached the source length limit')
  parseEditablePath(attribute.before+after) // enforce limits before persistence
  return {start:attribute.end,end:attribute.end,before:'',after}
}


/**
 * Make the outgoing control of the next cubic collinear with the incoming
 * control of the previous cubic at their shared anchor. "smooth" keeps the
 * outgoing handle length; "symmetric" also matches the incoming length.
 * The incoming control and anchor remain byte-identical.
 */
export function svgPathTangentPatches(source,{id,index,mode}={}) {
  if(!Number.isSafeInteger(index)||index<0||index>=256||
     (mode!=='smooth'&&mode!=='symmetric')) {
    fail('invalid-target','Expected an anchor index and smooth or symmetric mode')
  }
  const {commands}=model(source,id)
  let previous=null,next=null
  for(let i=1;i<commands.length;i++){
    const a=commands[i-1],b=commands[i]
    if(a.type==='C'&&b.type==='C'&&a.to?.index===index&&b.from?.index===index){
      previous=a;next=b;break
    }
  }
  if(!previous||!next)fail('unsupported-segment','This anchor has no adjoining cubic tangents')
  const anchor=previous.to
  const incoming=previous.controls[1]
  const outgoing=next.controls[0]
  const dx=anchor.x-incoming.x,dy=anchor.y-incoming.y
  const incomingLength=Math.hypot(dx,dy)
  const outgoingLength=Math.hypot(outgoing.x-anchor.x,outgoing.y-anchor.y)
  if(incomingLength<1e-9 || (mode==='smooth'&&outgoingLength<1e-9)) {
    fail('degenerate-tangent','The tangent has no stable direction or length')
  }
  const length=mode==='symmetric'?incomingLength:outgoingLength
  const x=Math.round((anchor.x+dx/incomingLength*length)*1000)/1000
  const y=Math.round((anchor.y+dy/incomingLength*length)*1000)/1000
  if(![x,y].every(v=>Number.isFinite(v)&&Math.abs(v)<=LIMIT)) {
    fail('invalid-target','The resulting tangent is out of bounds')
  }
  if(Math.abs(x-outgoing.x)<1e-9 && Math.abs(y-outgoing.y)<1e-9) {
    fail('unchanged','The cubic tangents already meet the requested constraint')
  }
  return svgPathPointPatches(source,{id,index:outgoing.index,x,y})
}
