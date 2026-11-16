import { createNativeFileStore } from './native-file-store.mjs'
import { listEditableSvgNodes, svgAttributePatch } from './svg-attributes.mjs'
import { svgGeometry } from './svg-geometry.mjs'
import { listSvgPathModels, svgPathPointPatches, svgPathTopologyPatch, svgPenContinuePatch } from './svg-paths.mjs'
import { svgShapeInsertPatch } from './svg-shapes.mjs'
import { listSvgTextNodes, svgTextPatch } from './svg-text.mjs'
import { svgElementPatch } from './svg-elements.mjs'
import { listWorkspaceDocuments } from './workspace-files.mjs'

export const name = 'dsh-design-studio'
export const inject = ['webServer','agents','workingDirectory']
const PREFIX = '/design-studio-native'
const MAX_BODY = 9 * 1024 * 1024

function reply(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(json)
}

async function bodyJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) {
    const e = new Error('Expected application/json'); e.code = 'bad-request'; throw e
  }
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY) { const e=new Error('Request too large'); e.code='too-large'; throw e }
    chunks.push(chunk)
  }
  let result
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { const e=new Error('Invalid JSON'); e.code='bad-request'; throw e }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    const e=new Error('Expected JSON object'); e.code='bad-request'; throw e
  }
  return result
}

async function workspaceFor(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) {
    const e=new Error('Select an active session');e.code='no-session';throw e
  }
  const session=ctx.agents.get(sessionId)
  if(!session){const e=new Error('Session is unavailable');e.code='no-session';throw e}
  return ctx.workingDirectory.ensure(session)
}

async function storeFor(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) { const e=new Error('Select an active session'); e.code='no-session'; throw e }
  const session = ctx.agents.get(sessionId)
  if (!session) { const e=new Error('Session is unavailable'); e.code='no-session'; throw e }
  const root = await ctx.workingDirectory.ensure(session)
  return createNativeFileStore(root)
}

export function createRouteHandler(ctx) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://dsh.local')
      const endpoint = url.pathname.slice(PREFIX.length).replace(/\/+$/, '')
      if (req.method === 'GET' && endpoint === '/health') return reply(res,200,{ok:true,editor:'native-prototype',version:1})
      if (req.method === 'GET' && endpoint === '/files') {
        const root = await workspaceFor(ctx,url.searchParams.get('sessionId'))
        const result = await listWorkspaceDocuments(root)
        return reply(res,200,{ok:true,...result})
      }
      if (req.method === 'GET' && endpoint === '/document') {
        const file=url.searchParams.get('file') || ''
        const store=await storeFor(ctx,url.searchParams.get('sessionId'))
        const document=await store.read(file)
        let nodes=[]; let textNodes=[]; let pathNodes=[]; let warning=null; let geometry={artboard:null, handles:[]}
        if(document.format==='svg') {
          try {
            nodes=listEditableSvgNodes(document.source)
            textNodes=listSvgTextNodes(document.source).map(({id,text,editable,attributes})=>({id,text,editable,attributes}))
            geometry=svgGeometry(document.source)
            pathNodes=listSvgPathModels(document.source)
            if(geometry.warning) warning=geometry.warning
          } catch(e){ warning='SVG property inspector unavailable: ' + (e.code || 'parse-failed') }
        }
        return reply(res,200,{ok:true,document,nodes,textNodes,pathNodes,geometry,warning})
      }
      if (req.method === 'POST' && endpoint === '/apply') {
        const params=await bodyJson(req)
        const store=await storeFor(ctx,params.sessionId)
        const doc=await store.read(params.file)
        if (doc.hash !== params.baseHash ||
            (params.baseIdentity !== undefined && doc.identity !== params.baseIdentity)) {
          return reply(res,409,{ok:false,error:'stale-revision',message:'File content or identity changed; reopen before editing'})
        }
        let patches; let createdId=null
        if (params.kind === 'svg-layer') {
          if (doc.format !== 'svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          const operation = svgElementPatch(doc.source,{id:params.id,operation:params.operation})
          patches=[operation.patch]
          createdId=operation.selectedId
        } else if (params.kind === 'svg-add-shape') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          const created=svgShapeInsertPatch(doc.source,params.shape)
          patches=[created.patch];createdId=created.id
        } else if (params.kind === 'svg-pen') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          if(params.operation==='start') {
            const created=svgShapeInsertPatch(doc.source,'pen',{x:params.x,y:params.y})
            patches=[created.patch];createdId=created.id
          }else{
            patches=[svgPenContinuePatch(doc.source,{
              id:params.id,operation:params.operation,x:params.x,y:params.y,c1:params.c1,c2:params.c2
            })]
          }
        } else if (params.kind === 'svg-path-topology') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[svgPathTopologyPatch(doc.source,{
            id:params.id,operation:params.operation,commandIndex:params.commandIndex
          })]
        } else if (params.kind === 'svg-path-point') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=svgPathPointPatches(doc.source,{id:params.id,index:params.index,x:params.x,y:params.y})
        } else if (params.kind === 'svg-text') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[svgTextPatch(doc.source,{id:params.id,value:params.value})]
        } else if (params.kind === 'svg-attribute') {
          if(doc.format!=='svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[svgAttributePatch(doc.source,{id:params.id,attribute:params.attribute,value:params.value})]
        } else if (params.kind === 'svg-attributes') {
          if (doc.format !== 'svg' || !Array.isArray(params.edits) || params.edits.length < 1 || params.edits.length > 16) {
            return reply(res,400,{ok:false,error:'bad-svg-edit-batch'})
          }
          const unique=new Set()
          patches=params.edits.map(edit => {
            if (!edit || typeof edit.id !== 'string' || typeof edit.attribute !== 'string') {
              const e=new Error('Invalid SVG edit');e.code='invalid-target';throw e
            }
            const key=edit.id+'\0'+edit.attribute
            if(unique.has(key)){const e=new Error('Duplicate SVG attribute edit');e.code='overlap';throw e}
            unique.add(key)
            return svgAttributePatch(doc.source,edit)
          })
        } else if (params.kind === 'replace-source' && typeof params.source==='string') {
          patches=[{start:0,end:doc.source.length,before:doc.source,after:params.source}]
        } else if (params.kind === 'patches' && Array.isArray(params.patches)) {
          patches=params.patches
        } else return reply(res,400,{ok:false,error:'unsupported-operation'})
        const result=await store.apply(params.file,{baseHash:params.baseHash,baseIdentity:params.baseIdentity,patches})
        return reply(res,200,{ok:true,result,patches,createdId})
      }
      return reply(res,404,{ok:false,error:'not-found'})
    } catch (e) {
      const code=e.code || 'internal-error'
      const status=code==='stale-revision'?409:code==='file-busy'?423:code==='too-large'?413:
        ['internal-error','lock-release-failed','lock-changed'].includes(code)?500:400
      return reply(res,status,{ok:false,error:code,message:code==='internal-error'?'Request failed':String(e.message).slice(0,220)})
    }
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({kind:'prefix',path:PREFIX,handler:createRouteHandler(ctx)}), 'dsh-design-studio native edit routes')
}
