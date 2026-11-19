import { createNativeFileStore } from './native-file-store.mjs'
import { planReviewableEdit, previewNativeEdit, REVIEWABLE_EDIT_KINDS } from './reviewable-edit.mjs'

const editFields = Object.freeze({
  'html-text': ['id', 'value'],
  'html-style': ['id', 'property', 'value'],
  'html-attribute': ['id', 'attribute', 'value'],
  'svg-text': ['id', 'value'],
  'svg-attribute': ['id', 'attribute', 'value'],
  'svg-order': ['id', 'direction'],
  'svg-transform': ['id', 'operation'],
  'svg-visibility': ['id', 'property', 'value'],
  'css-rule': ['selector', 'property', 'value'],
  'css-media': ['selector', 'condition', 'property', 'value'],
  'slide-add': ['id', 'title'],
  'slide-reorder': ['id', 'direction'],
  'slide-duplicate': ['id', 'newId'],
  'slide-remove': ['id'],
})
const required = ['file', 'kind']
const optional = [...new Set(Object.values(editFields).flat())]
const maxProposalBytes = 64 * 1024

const transformFields = {
  translate:['dx','dy'], scale:['sx','sy','pivot'], rotate:['angle','pivot'],
  skewX:['angle','pivot'], skewY:['angle','pivot'], matrix:['matrix'],
}
const transformSchema = {
  type:'object',additionalProperties:false,required:['type'],
  properties:{
    type:{type:'string',enum:Object.keys(transformFields)},
    ...Object.fromEntries(['dx','dy','sx','sy','angle'].map(field=>[field,{type:'number'}])),
    pivot:{type:'object',additionalProperties:false,required:['x','y'],
      properties:{x:{type:'number'},y:{type:'number'}}},
    matrix:{type:'array',minItems:6,maxItems:6,items:{type:'number'}},
  },
}
function validTransform(operation) {
  if(!operation||typeof operation!=='object'||Array.isArray(operation)||
    !Object.hasOwn(transformFields,operation.type))return false
  return Object.entries(operation).every(([key,value])=>{
    if(key==='type')return true
    if(!transformFields[operation.type].includes(key))return false
    if(key==='pivot')return value!==null&&typeof value==='object'&&
      Object.keys(value).length===2&&Object.hasOwn(value,'x')&&Object.hasOwn(value,'y')&&
      [value.x,value.y].every(Number.isFinite)
    if(key==='matrix')return Array.isArray(value)&&value.length===6&&Array.from(value).every(Number.isFinite)
    return Number.isFinite(value)
  })
}

function validatedEdit(args) {
  if (!args || typeof args !== 'object' || !REVIEWABLE_EDIT_KINDS.includes(args.kind)) return null
  const fields = [...required, ...editFields[args.kind]]
  if (Object.keys(args).length !== fields.length || fields.some(field =>
    !Object.hasOwn(args, field) || (field==='operation' ? !validTransform(args[field]) :
      typeof args[field] !== 'string' || args[field].length > 8192 || (field !== 'value' && !args[field].trim())))) return null
  return Object.fromEntries(fields.map(field => [field, args[field]]))
}

export const AGENT_PROPOSAL_TOOL = 'design_studio_propose'

export function registerAgentProposal(ctx, inbox) {
  ctx.tools.register({
    name: AGENT_PROPOSAL_TOOL,
    description: 'Prepare a read-only Design Studio edit for human review. Use a relative file in the current session and a supported typed edit. Show the resulting proposal to the user. Use id, property and value for html-style or id, attribute and value for html-attribute. Use id and direction (front, back, forward or backward) for svg-order, and id, property (display or visibility), and value for svg-visibility. For svg-transform use id and an operation object with type and numeric components (translate dx/dy, scale sx/sy, rotate or skew angle, matrix six values). Use selector, condition, property and value for css-media, with the exact selector and a simple width condition. For slide-add supply id and title, for slide-reorder id and direction (earlier or later), for slide-duplicate id and newId, and for slide-remove id. Slide ids start with slide-. The tool never saves the file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required,
      properties: {
        ...Object.fromEntries([...required, ...optional].map(field => [field, field==='operation'?transformSchema:{ type: 'string' }])),
        kind: { type: 'string', enum: REVIEWABLE_EDIT_KINDS },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, execution) {
      const { agent, signal, callId } = execution
      signal.throwIfAborted()
      if (!agent) return JSON.stringify({ ok: false, error: 'no-session' })
      const edit = validatedEdit(args)
      if (!edit) return JSON.stringify({ ok: false, error: 'invalid-edit' })
      try {
        const root = await ctx.workingDirectory.ensure(agent, signal)
        signal.throwIfAborted()
        const document = await createNativeFileStore(root).read(edit.file)
        signal.throwIfAborted()
        const preview = previewNativeEdit(document, planReviewableEdit(document, edit))
        const proposal = { version: 1, edit, ...preview }
        const output = JSON.stringify({ ok: true, proposal, callId })
        if (Buffer.byteLength(output) > maxProposalBytes) {
          return JSON.stringify({ ok: false, error: 'proposal-too-large' })
        }
        if (proposal.changed) inbox.add(agent, { ...proposal, callId })
        return output
      } catch (error) {
        signal.throwIfAborted()
        return JSON.stringify({ ok: false, error: error.code || 'proposal-unavailable' })
      }
    },
  })
}
