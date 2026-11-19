import { createNativeFileStore } from './native-file-store.mjs'
import { listEditableSvgNodes, svgAttributePatch } from './svg-attributes.mjs'
import { inspectSvgArtboard, planSvgArtboard } from './svg-artboard.mjs'
import { svgGeometry } from './svg-geometry.mjs'
import { listSvgPathModels, svgPathPointPatches, svgPathTopologyPatch, svgPenContinuePatch, svgPathTangentPatches } from './svg-paths.mjs'
import { svgFragmentInsertPatch } from './svg-fragment.mjs'
import { listSvgGradients, svgGradientStopPatch, svgGradientStopInsertPatch, svgGradientStopRemovePatch, svgGradientGeometryPatch, svgGradientStopMovePatches } from './svg-gradient.mjs'
import { planSvgGradientCreation } from './svg-gradient-create.mjs'
import { svgOrderPatch } from './svg-order.mjs'
import { svgRenamePatch } from './svg-rename.mjs'
import { svgShapeInsertPatch } from './svg-shapes.mjs'
import { listSvgTextNodes } from './svg-text.mjs'
import { svgElementPatch } from './svg-elements.mjs'
import { listWorkspaceDocuments } from './workspace-files.mjs'
import { listHtmlVisualElements, htmlVisualStylePatch, htmlVisualAttributePatch } from './html-visual.mjs'
import { svgGroupingPatch } from './svg-groups.mjs'
import { planSvgAppearanceTransfer } from './svg-appearance.mjs'
import { svgVisibilityPatch, svgLockPatch } from './svg-visibility.mjs'
import { scanSvgDocument } from './svg-document.mjs'
import { svgTransformPatch } from './svg-transform.mjs'
import { planSvgMultiNudge } from './svg-multi-nudge.mjs'
import { listCssVisualRules, listCssVisualRuleDetails, cssMediaDeclarationPatch } from './css-visual.mjs'
import { collectHtmlCssCandidates } from './html-css-associations.mjs'

import { planReviewableEdit, previewNativeEdit, REVIEWABLE_EDIT_KINDS } from './reviewable-edit.mjs'
import { AGENT_PROPOSAL_TOOL, registerAgentProposal } from './agent-proposal.mjs'

import { createProposalInbox } from './proposal-inbox.mjs'

import { appendHtmlSlide, createHtmlPresentation, duplicateHtmlSlide, readHtmlPresentation, reorderHtmlSlide } from './html-presentation.mjs'

import { createPdfPageCopier } from './pdf-page-copy.mjs'

export const name = 'dsh-design-studio'
export const inject = ['webServer','agents','workingDirectory','workspaceRegistry']
const PREFIX = '/design-studio-native'
const MAX_BODY = 9 * 1024 * 1024

/** Typed route failure: the HTTP status is derived from `code`, never invented. */
function failure(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

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

/**
 * Resolve the workspace root a request is allowed to touch.
 *
 * Two mutually exclusive targets, deliberately (ADR-024):
 *  - `sessionId`: the conversation's working directory (existing behaviour);
 *  - `workspaceId`: a DSH **workspace id**, resolved through the host registry.
 *
 * A client can never send a path. `workspaceId` is a registry key, so an id that
 * is not registered is refused instead of being interpreted as a location.
 */
async function resolveRoot(ctx, target) {
  const sessionId = typeof target.sessionId === 'string' ? target.sessionId : ''
  const workspaceId = typeof target.workspaceId === 'string' ? target.workspaceId : ''
  if (sessionId && workspaceId) {
    throw failure('invalid-target', 'Provide either sessionId or workspaceId, not both')
  }
  if (workspaceId) {
    const registry = ctx.workspaceRegistry ?? (typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined)
    if (!registry) throw failure('workspace-unavailable', 'Workspace registry is not available in this host')
    const workspace = registry.get(workspaceId)
    if (!workspace) throw failure('unknown-workspace', 'Unknown workspace')
    if (typeof workspace.status === 'function' && (await workspace.status()) !== 'ok') {
      throw failure('workspace-missing', 'Workspace directory is missing; restore it before editing')
    }
    if (typeof workspace.path !== 'string' || !workspace.path) {
      throw failure('unknown-workspace', 'Unknown workspace')
    }
    return workspace.path
  }
  if (sessionId) {
    const session = ctx.agents.get(sessionId)
    if (!session) throw failure('no-session', 'Session is unavailable')
    return ctx.workingDirectory.ensure(session)
  }
  throw failure('no-session', 'Select an active session')
}

async function workspaceFor(ctx, target) {
  return resolveRoot(ctx, target)
}

async function storeFor(ctx, target) {
  return createNativeFileStore(await resolveRoot(ctx, target))
}

/** Public projection of a workspace: no path is returned, ids and titles only. */
async function workspaceCard(workspace) {
  let status = 'ok'
  if (typeof workspace.status === 'function') {
    try { status = await workspace.status() } catch { status = 'unknown' }
  }
  return { id: workspace.id, title: typeof workspace.title === 'string' ? workspace.title : '',
    status: status === 'ok' || status === 'missing-dir' ? status : 'unknown' }
}

function proposalSession(ctx, sessionId, workspaceId) {
  if (workspaceId || !sessionId) throw failure('invalid-target', 'Proposals require a conversation session')
  const agent = ctx.agents.get(sessionId)
  if (!agent) throw failure('no-session', 'Session is unavailable')
  return agent
}

function approvedProposal(inbox, ctx, request) {
  const agent = proposalSession(ctx, request.sessionId, request.workspaceId)
  const proposal = inbox.list(agent, request.file).find(entry => entry.id === request.proposalId)
  if (!proposal) throw failure('proposal-missing', 'Proposal is unavailable or expired')
  if (proposal.baseHash !== request.baseHash || proposal.baseIdentity !== request.baseIdentity) {
    throw failure('stale-revision', 'The proposal was prepared for a different revision')
  }
  if (proposal.proposedHash !== request.expectedProposedHash) {
    throw failure('proposal-changed', 'Review the proposal before applying')
  }
  return { agent, proposal }
}

export function createRouteHandler(ctx, inbox = createProposalInbox()) {
  const copyPdfPages = createPdfPageCopier()
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://dsh.local')
      const endpoint = url.pathname.slice(PREFIX.length).replace(/\/+$/, '')
      if (req.method === 'GET' && endpoint === '/health') {
        const tools = ctx.get?.('tools')
        return reply(res,200,{ok:true,editor:'native-prototype',version:1,
          agentProposal:Boolean(tools?.get(AGENT_PROPOSAL_TOOL))})
      }
      // The registry projection the sidebar panel needs: ids and titles only,
      // so no filesystem path ever reaches the client through this route.
      if (req.method === 'GET' && endpoint === '/workspaces') {
        const registry = ctx.workspaceRegistry ?? (typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined)
        if (!registry) return reply(res,200,{ok:true,workspaces:[],available:false})
        const workspaces = []
        for (const workspace of registry.list()) workspaces.push(await workspaceCard(workspace))
        return reply(res,200,{ok:true,workspaces,available:true})
      }
      if (req.method === 'GET' && endpoint === '/proposals') {
        const agent = proposalSession(ctx,url.searchParams.get('sessionId'),url.searchParams.get('workspaceId'))
        const file = url.searchParams.get('file')
        return reply(res,200,{ok:true,proposals:inbox.list(agent,file)})
      }
      if (req.method === 'GET' && endpoint === '/files') {
        const root = await workspaceFor(ctx,{
          sessionId:url.searchParams.get('sessionId'),
          workspaceId:url.searchParams.get('workspaceId'),
        })
        const result = await listWorkspaceDocuments(root,{
          includePdf:Boolean(url.searchParams.get('sessionId')) && url.searchParams.get('includePdf')==='1',
        })
        return reply(res,200,{ok:true,...result})
      }
      if (req.method === 'POST' && endpoint === '/pdf/copy') {
        const params = await bodyJson(req)
        const store = await storeFor(ctx,{sessionId:params.sessionId,workspaceId:params.workspaceId})
        const selections = params.selections ?? [{file:params.file,pages:params.pages}]
        const bytes = await copyPdfPages(selections,async file=>(await store.readPdf(file)).source)
        res.writeHead(200,{'content-type':'application/pdf','content-length':bytes.length,
          'content-disposition':'attachment; filename="pages.pdf"','cache-control':'no-store','x-content-type-options':'nosniff'})
        return res.end(bytes)
      }
      if (req.method === 'GET' && endpoint === '/document') {
        const file=url.searchParams.get('file') || ''
        const store=await storeFor(ctx,{
          sessionId:url.searchParams.get('sessionId'),
          workspaceId:url.searchParams.get('workspaceId'),
        })
        const document=await store.read(file)
        let nodes=[]; let textNodes=[]; let pathNodes=[]; let gradients=[]; let htmlElements=[]; let cssRules=[]; let cssMedia=[]; let stylesheets=[]; let styleMatches=[]; let previewCss=''; let previewCoverage=null; let warning=null; let geometry={artboard:null, handles:[]}; let artboard=null
        if(document.format==='svg') {
          try {
            // One structure scan feeds the whole layer list. Calling the per-node
            // helpers here would rescan the document for every node and turn a
            // 1500-layer open into quadratic work (measured: 12 s instead of 0.7 s).
            let layerScan=null
            try { layerScan=scanSvgDocument(document.source) } catch(_) { layerScan=null }
            // The inspector must show the size actually declared in the file, and
            // refuse honestly when it cannot be resolved. This is read-only
            // metadata; the resize itself is a typed `/apply` operation. Reuse
            // the structure scan instead of scanning a large document again.
            artboard=inspectSvgArtboard(document.source,{scan:layerScan})
            // Source-context eligibility only, not a rendering-fidelity promise:
            // the destination may still have its own CSS/inherited presentation.
            const structuralRootAttributes=new Set(['xmlns','xmlns:xlink','width','height','viewBox','preserveAspectRatio','version','id'])
            const rootContextReason=!layerScan?'structure-unavailable'
              // The scanner skips processing instructions. Fail closed even for
              // an xml-stylesheet marker inside a comment (accepted false positive).
              :layerScan.nodes.some(node=>node.tag==='style')||/<\?xml-stylesheet\b/i.test(document.source)?'document-styles'
                :layerScan.root.attributeList.some(attribute=>!structuralRootAttributes.has(attribute.name))?'root-context'
                  :null
            nodes=listEditableSvgNodes(document.source).map(node=>{
              // Visibility/lock/transform state is read from the very bytes the
              // patch engine will edit, never inferred from a rendered preview.
              const scanned=layerScan?.byId.get(node.id)
              const attribute=name=>scanned?.attributes.get(name)?.value??null
              const display=attribute('display')
              const visibility=attribute('visibility')
              const copyContextReason=rootContextReason||(!scanned?'structure-unavailable'
                :scanned.parent!==layerScan.root?'ancestor-context':null)
              return {...node,
                copyContextSafe:copyContextReason===null,
                copyContextReason,
                hidden:display==='none'||visibility==='hidden'||visibility==='collapse',
                locked:attribute('data-locked')==='true',
                transform:attribute('transform')}
            })
            textNodes=listSvgTextNodes(document.source).map(({id,text,editable,attributes})=>({id,text,editable,attributes}))
            // Transform-aware geometry: a document with groups or transforms keeps
            // a real canvas, and each handle carries the linear inverse of its
            // ancestor+self matrix so a visible drag maps back to local coordinates.
            geometry=svgGeometry(document.source,{transforms:true})
            pathNodes=listSvgPathModels(document.source)
            // Gradient stops are their own addressable surface: the client only
            // offers fields for attributes that already exist, and every edit is
            // one exact attribute-value patch. An unstructurable document is an
            // empty list plus a visible warning, never a guessed gradient.
            try { gradients=listSvgGradients(document.source,{scan:layerScan}) }
            catch(e){ warning=(warning?warning+' · ':'')+'Gradient inspector unavailable: '+(e.code||'parse-failed') }
            if(geometry.warning) warning=warning?warning+' · '+geometry.warning:geometry.warning
          } catch(e){ warning='SVG property inspector unavailable: ' + (e.code || 'parse-failed') }
        }
        if(document.format==='html'||document.format==='htm') {
          htmlElements=listHtmlVisualElements(document.source)
          if(document.source.length>512*1024) warning='HTML visual mapping limited to documents under 512 KiB'
          else {
            try {
              const linked=await collectHtmlCssCandidates(store,document)
              stylesheets=linked.stylesheets
              styleMatches=linked.styleMatches
              previewCss=linked.previewCss
              previewCoverage=linked.previewCoverage
            } catch(_) { warning='Linked CSS inspector unavailable: reload document or use source editor' }
          }
        }
        if(document.format==='css') {
          cssRules=listCssVisualRules(document.source)
          // Conditional rules are a separate, offset-addressed surface: they are
          // never `editable` (so no unconditional projection) and are listed here
          // with their condition so the inspector can show the real scope.
          cssMedia=listCssVisualRuleDetails(document.source)
            .filter(rule=>rule.mediaCondition!==null)
            .map(rule=>({start:rule.start,condition:rule.mediaCondition,selector:rule.selector,
              // Deliberately NOT named `editable`: that flag is what the HTML
              // preview guards on, and a conditional rule must never be projected
              // unconditionally by a future consumer.
              conditionalEditable:rule.mediaEditable,reason:rule.mediaReason,
              declarations:rule.declarations.map(({property,value})=>({property,value}))}))
          if(document.source.length>512*1024) warning='CSS visual mapping limited to documents under 512 KiB'
        }
        let presentation = null
        if (['html','htm'].includes(document.format) && document.source.includes('data-dsh-deck')) {
          try {
            const { version, slides } = readHtmlPresentation(document.source)
            presentation = { version, slides: slides.map(({ id }) => ({ id })) }
          } catch (error) {
            presentation = { error: error.code || 'invalid-presentation' }
          }
        }
        return reply(res,200,{ok:true,presentation,document:presentation?{...document,presentation}:document,nodes,textNodes,pathNodes,gradients,htmlElements,cssRules,cssMedia,stylesheets,styleMatches,previewCss,previewCoverage,geometry,artboard,warning})
      }
      if (req.method === 'POST' && endpoint === '/create') {
        // Creating a document is exclusive: an existing path is refused (409),
        // never replaced. The store owns the no-overwrite commit protocol.
        const params=await bodyJson(req)
        if (typeof params.file !== 'string' || !params.file) {
          return reply(res,400,{ok:false,error:'invalid-path',message:'A relative workspace path is required'})
        }
        const presentation = params.kind === 'presentation'
        if (presentation && !/\.html?$/i.test(params.file)) {
          return reply(res,400,{ok:false,error:'unsupported-format'})
        }
        const source = presentation ? createHtmlPresentation() : params.source
        if (typeof source !== 'string') {
          return reply(res,400,{ok:false,error:'invalid-source',message:'New file content must be a string'})
        }
        const store=await storeFor(ctx,{sessionId:params.sessionId,workspaceId:params.workspaceId})
        const created=await store.create(params.file,{source})
        return reply(res,201,{ok:true,created})
      }
      if (req.method === 'POST' && endpoint === '/rename') {
        // Renaming is revision-checked and never overwrites: the store refuses a
        // stale document and a destination that is already occupied.
        const params=await bodyJson(req)
        if (typeof params.file!=='string' || !params.file || typeof params.next!=='string' || !params.next) {
          return reply(res,400,{ok:false,error:'invalid-path',message:'Current and new relative paths are required'})
        }
        if (typeof params.baseIdentity!=='string' || !/^[a-f0-9]{64}$/.test(params.baseIdentity)) {
          return reply(res,428,{ok:false,error:'missing-revision',
            message:'Open the document in a current Design Studio client before renaming it'})
        }
        const store=await storeFor(ctx,{sessionId:params.sessionId,workspaceId:params.workspaceId})
        const document=await store.rename(params.file,{next:params.next,
          baseHash:params.baseHash,baseIdentity:params.baseIdentity})
        return reply(res,200,{ok:true,document})
      }
      if (req.method === 'POST' && endpoint === '/delete') {
        // Deleting is the only destructive route: exact revision required, no
        // directory, no symlink, no hardlink, everything inside the workspace.
        const params=await bodyJson(req)
        if (typeof params.file!=='string' || !params.file) {
          return reply(res,400,{ok:false,error:'invalid-path',message:'A relative workspace path is required'})
        }
        if (typeof params.baseIdentity!=='string' || !/^[a-f0-9]{64}$/.test(params.baseIdentity)) {
          return reply(res,428,{ok:false,error:'missing-revision',
            message:'Open the document in a current Design Studio client before deleting it'})
        }
        const store=await storeFor(ctx,{sessionId:params.sessionId,workspaceId:params.workspaceId})
        const result=await store.delete(params.file,{baseHash:params.baseHash,baseIdentity:params.baseIdentity})
        return reply(res,200,{ok:true,result})
      }
      if (req.method === 'POST' && (endpoint === '/apply' || endpoint === '/preview')) {
        const preview = endpoint === '/preview'
        let params=await bodyJson(req)
        const approval = !preview && params.kind === 'agent-proposal' ? approvedProposal(inbox,ctx,params) : null
        if (approval) {
          params = { ...approval.proposal.edit, sessionId:params.sessionId, baseHash:params.baseHash,
            baseIdentity:params.baseIdentity, expectedProposedHash:params.expectedProposedHash }
        }
        const reviewed = Object.hasOwn(params,'expectedProposedHash')
        if ((preview || reviewed) && !REVIEWABLE_EDIT_KINDS.includes(params.kind)) {
          return reply(res,400,{ok:false,error:'unsupported-operation'})
        }
        if (reviewed && (preview || typeof params.expectedProposedHash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(params.expectedProposedHash))) {
          return reply(res,400,{ok:false,error:'invalid-proposal-hash'})
        }
        if (typeof params.baseIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(params.baseIdentity)) {
          return reply(res,428,{ok:false,error:'missing-revision',
            message:preview?'Open the document before previewing an edit':'Reopen document in a current Design Studio client before saving'})
        }
        const store=await storeFor(ctx,{sessionId:params.sessionId,workspaceId:params.workspaceId})
        const doc=await store.read(params.file)
        if (doc.hash !== params.baseHash || doc.identity !== params.baseIdentity) {
          return reply(res,409,{ok:false,error:'stale-revision',message:'File content or identity changed; reopen before editing'})
        }
        let patches; let createdId=null
        if (REVIEWABLE_EDIT_KINDS.includes(params.kind)) {
          patches=planReviewableEdit(doc,params)
        } else if (['slide-add','slide-reorder','slide-duplicate'].includes(params.kind)) {
          if (!['html','htm'].includes(doc.format)) return reply(res,400,{ok:false,error:'unsupported-format'})
          const plan = { 'slide-add':appendHtmlSlide, 'slide-reorder':reorderHtmlSlide, 'slide-duplicate':duplicateHtmlSlide }[params.kind]
          patches=[plan(doc.source,params)]
        } else if (params.kind === 'css-media') {
          // Conditional editing is addressed by the rule's exact offset and the
          // condition the user was shown, so two identical selectors can never be
          // confused. It is never a cascade or a computed-value edit.
          if(doc.format!=='css')return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[cssMediaDeclarationPatch(doc.source,{start:params.start,condition:params.condition,
            property:params.property,value:params.value})]
        } else if (params.kind === 'html-style') {
          if(!['html','htm'].includes(doc.format))return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[htmlVisualStylePatch(doc.source,{id:params.id,property:params.property,value:params.value})]
        } else if (params.kind === 'svg-layer') {
          if (doc.format !== 'svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          // Nested/grouped layers are the normal case now: default to the nested
          // implementation, which returns exact inverses and unique clone ids.
          const operation = svgElementPatch(doc.source,{id:params.id,operation:params.operation,
            nested:params.nested!==false})
          patches=[operation.patch]
          createdId=operation.selectedId
        } else if (params.kind === 'svg-add-shape') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          const positioned=Object.hasOwn(params,'x') || Object.hasOwn(params,'y')
          const created=svgShapeInsertPatch(doc.source,params.shape,positioned?{x:params.x,y:params.y}:null)
          patches=[created.patch];createdId=created.id
        } else if (params.kind === 'svg-order') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          // Document order is paint order in SVG: moving one exact span is the
          // whole implementation, so Undo restores the original bytes.
          patches=[svgOrderPatch(doc.source,{id:params.id,direction:params.direction}).patch]
        } else if (params.kind === 'svg-paste') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          // The clipboard payload is re-validated here: the renderer is not a
          // trusted source of markup, even for bytes it copied itself.
          const inserted=svgFragmentInsertPatch(doc.source,{fragment:params.fragment})
          patches=[inserted.patch];createdId=inserted.id
        } else if (params.kind === 'svg-rename') {
          if (doc.format !== 'svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          // One patch over the exact `id` value span: the inverse is exact and
          // Undo restores the original bytes. References to the old id and
          // collisions are refused before anything is written.
          const renamed = svgRenamePatch(doc.source,{id:params.id,next:params.next})
          patches=[renamed.patch]
          createdId=renamed.next
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
        } else if (params.kind === 'svg-path-tangent') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=svgPathTangentPatches(doc.source,{id:params.id,index:params.index,mode:params.mode})
        } else if (params.kind === 'svg-path-point') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=svgPathPointPatches(doc.source,{id:params.id,index:params.index,x:params.x,y:params.y})
        } else if (params.kind === 'svg-appearance-transfer') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=planSvgAppearanceTransfer(doc.source,{sourceId:params.sourceId,targetId:params.targetId})
        } else if (params.kind === 'svg-gradient-create') {
          if(doc.format!=='svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          const created=planSvgGradientCreation(doc.source,{id:params.id,type:params.type})
          patches=created.patches
          createdId=created.selectedId
        } else if (params.kind === 'svg-gradient-geometry') {
          if(doc.format!=='svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[svgGradientGeometryPatch(doc.source,{gradientId:params.gradientId,
            attribute:params.attribute,value:params.value})]
        } else if (params.kind === 'svg-gradient-stop') {
          if(doc.format!=='svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          // One existing stop attribute, one exact value span: the inverse is
          // byte-exact, so Undo restores the original file. No attribute is
          // ever inserted or removed by this operation.
          patches=[svgGradientStopPatch(doc.source,{gradientId:params.gradientId,index:params.index,
            attribute:params.attribute,value:params.value})]
        } else if (params.kind === 'svg-gradient-stop-move') {
          if(doc.format!=='svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=svgGradientStopMovePatches(doc.source,{gradientId:params.gradientId,
            index:params.index,direction:params.direction})
        } else if (params.kind === 'svg-gradient-stop-add') {
          if(doc.format!=='svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          // One complete <stop> inserted as one span inside the addressed
          // gradient: a single patch, a single inverse, a single Undo step.
          // An omitted index means "append at the end"; an explicit offset is
          // accepted only when it does not duplicate an existing position.
          patches=[svgGradientStopInsertPatch(doc.source,{gradientId:params.gradientId,
            index:params.index,offset:params.offset}).patch]
        } else if (params.kind === 'svg-gradient-stop-remove') {
          if(doc.format!=='svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          // One stop span removed, including its own line indentation when it
          // sits alone on its line; no other stop and no other byte moves.
          patches=[svgGradientStopRemovePatch(doc.source,{gradientId:params.gradientId,
            index:params.index}).patch]
        } else if (params.kind === 'svg-artboard') {
          if (doc.format !== 'svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          // ONE plan = one transactional write. The explicit content mode puts
          // `viewBox`, `width` and `height` in the same patch set so the board
          // can never be left inconsistent.
          patches=planSvgArtboard(doc.source,{
            width:params.width,
            height:params.height,
            scaleContent:params.scaleContent===true,
          }).patches
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
        } else if (params.kind === 'svg-grouping') {
          if (doc.format !== 'svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          const operation=svgGroupingPatch(doc.source,{
            operation:params.operation,
            ids:params.ids,
            // `group` names its new wrapper, `ungroup` targets an existing one.
            id:params.operation==='group'?(params.groupId||params.id):params.id,
          })
          patches=operation.patches
          createdId=operation.id||null
        } else if (params.kind === 'svg-visibility') {
          if (doc.format !== 'svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[svgVisibilityPatch(doc.source,{
            id:params.id,property:params.property,value:params.value===undefined?null:params.value,
          })]
        } else if (params.kind === 'svg-lock') {
          if (doc.format !== 'svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[svgLockPatch(doc.source,{id:params.id,locked:params.locked===true})]
        } else if (params.kind === 'svg-multi-nudge') {
          if(doc.format!=='svg')return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=planSvgMultiNudge(doc.source,{
            ids:params.ids,dx:params.dx,dy:params.dy})
        } else if (params.kind === 'svg-transform') {
          if (doc.format !== 'svg') return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[svgTransformPatch(doc.source,{id:params.id,operation:params.operation}).patch]
        } else if (params.kind === 'html-attribute') {
          if (!['html','htm'].includes(doc.format)) return reply(res,400,{ok:false,error:'unsupported-format'})
          patches=[htmlVisualAttributePatch(doc.source,{
            id:params.id,key:params.key,path:params.path,name:params.attribute,
            value:params.value===undefined?null:params.value,
          })]
        } else if (params.kind === 'replace-source' && typeof params.source==='string') {
          patches=[{start:0,end:doc.source.length,before:doc.source,after:params.source}]
        } else if (params.kind === 'patches' && Array.isArray(params.patches)) {
          patches=params.patches
        } else return reply(res,400,{ok:false,error:'unsupported-operation'})
        if (preview || reviewed) {
          const proposal=previewNativeEdit(doc,patches)
          if (preview) return reply(res,200,{ok:true,...proposal})
          if (proposal.proposedHash !== params.expectedProposedHash) {
            return reply(res,409,{ok:false,error:'proposal-changed',
              message:'The edit no longer matches the preview; review it again before applying'})
          }
        }
        const result=await store.apply(params.file,{baseHash:params.baseHash,baseIdentity:params.baseIdentity,patches})
        if (approval) inbox.remove(approval.agent,approval.proposal.id)
        return reply(res,200,{ok:true,result,patches,createdId})
      }
      return reply(res,404,{ok:false,error:'not-found'})
    } catch (e) {
      const code=e.code || 'internal-error'
      const status=['stale-revision','already-exists','workspace-missing','proposal-changed'].includes(code)?409:
        code==='proposal-missing'?404:
        code==='file-busy'?423:code==='too-large'?413:code==='workspace-unavailable'?503:
        ['internal-error','lock-release-failed','lock-changed'].includes(code)?500:400
      return reply(res,status,{ok:false,error:code,message:code==='internal-error'?'Request failed':String(e.message).slice(0,220)})
    }
  }
}

export function apply(ctx) {
  const inbox = createProposalInbox()
  ctx.effect(() => ctx.webServer.register({kind:'prefix',path:PREFIX,handler:createRouteHandler(ctx,inbox)}), 'dsh-design-studio native edit routes')
  ctx.inject?.(['tools'], scope => registerAgentProposal(scope,inbox))
}
