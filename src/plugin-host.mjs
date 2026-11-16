import { createNativeFileStore } from './native-file-store.mjs'
import { listEditableSvgNodes, svgAttributePatch } from './svg-attributes.mjs'

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
      if (req.method === 'GET' && endpoint === '/document') {
        const file=url.searchParams.get('file') || ''
        const store=await storeFor(ctx,url.searchParams.get('sessionId'))
        const document=await store.read(file)
        let nodes=[]; let warning=null
        if(document.format==='svg') {
          try { nodes=listEditableSvgNodes(document.source) }
          catch(e){ warning='SVG property inspector unavailable: ' + (e.code || 'parse-failed') }
        }
        return reply(res,200,{ok:true,document,nodes,warning})
      }
      if (req.method === 'POST' && endpoint === '/apply') {
        const params=await bodyJson(req)
        const store=await storeFor(ctx,params.sessionId)
        const doc=await store.read(params.file)
        if (doc.hash !== params.baseHash) return reply(res,409,{ok:false,error:'stale-revision',message:'File changed; reopen before editing'})
        let patches
        if (params.kind === 'svg-attribute') {
          if(doc.format!=='svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[svgAttributePatch(doc.source,{id:params.id,attribute:params.attribute,value:params.value})]
        } else if (params.kind === 'replace-source' && typeof params.source==='string') {
          patches=[{start:0,end:doc.source.length,before:doc.source,after:params.source}]
        } else if (params.kind === 'patches' && Array.isArray(params.patches)) {
          patches=params.patches
        } else return reply(res,400,{ok:false,error:'unsupported-operation'})
        const result=await store.apply(params.file,{baseHash:params.baseHash,patches})
        return reply(res,200,{ok:true,result})
      }
      return reply(res,404,{ok:false,error:'not-found'})
    } catch (e) {
      const code=e.code || 'internal-error'
      const status=code==='stale-revision'?409:code==='too-large'?413:code==='internal-error'?500:400
      return reply(res,status,{ok:false,error:code,message:code==='internal-error'?'Request failed':String(e.message).slice(0,220)})
    }
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({kind:'prefix',path:PREFIX,handler:createRouteHandler(ctx)}), 'dsh-design-studio native edit routes')
}
