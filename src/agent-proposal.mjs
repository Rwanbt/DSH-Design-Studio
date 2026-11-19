import { createNativeFileStore } from './native-file-store.mjs'
import { planReviewableEdit, planReviewableBatch, previewNativeEdit, REVIEWABLE_EDIT_KINDS } from './reviewable-edit.mjs'

const editFields = Object.freeze({
  'html-text': ['id', 'value'],
  'html-style': ['id', 'property', 'value'],
  'html-attribute': ['id', 'attribute', 'value'],
  'svg-text': ['id', 'value'],
  'svg-attribute': ['id', 'attribute', 'value'],
  'svg-order': ['id', 'direction'],
  'svg-transform': ['id', 'operation'],
  'svg-add-shape': ['shape'],
  'svg-gradient-create': ['id', 'type', 'fromColor', 'toColor'],
  'svg-gradient-stop': ['gradientId','index','attribute','value'],
  'svg-gradient-geometry': ['gradientId','attribute','value'],
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
  const placedShape=args.kind==='svg-add-shape'&&(Object.hasOwn(args,'x')||Object.hasOwn(args,'y'))
  const hasText=args.kind==='svg-add-shape'&&args.shape==='text'&&Object.hasOwn(args,'text')
  const fields = [...required, ...editFields[args.kind], ...(placedShape?['x','y']:[]), ...(hasText?['text']:[])]
  if (Object.keys(args).length !== fields.length || fields.some(field =>
    !Object.hasOwn(args, field) || (field==='operation' ? !validTransform(args[field]) :
      field==='index' ? !Number.isSafeInteger(args[field])||args[field]<0 :
      field==='x'||field==='y' ? !Number.isFinite(args[field]) :
      typeof args[field] !== 'string' || args[field].length > 8192 || (field !== 'value' && field !== 'text' && !args[field].trim())))) return null
  return Object.fromEntries(fields.map(field => [field, args[field]]))
}

const maxBatchEdits=6
const editProperties = {
  ...Object.fromEntries(optional.map(field=>[field,field==='operation'?transformSchema:{type:'string'}])),
  x:{type:'number'},y:{type:'number'},text:{type:'string'},index:{type:'integer',minimum:0},
}

function validatedProposal(args) {
  if(args?.kind!=='batch')return validatedEdit(args)
  if(Object.keys(args).length!==3||typeof args.file!=='string'||!args.file.trim()||
    !Array.isArray(args.edits)||args.edits.length<2||args.edits.length>maxBatchEdits)return null
  const edits=[]
  for(const operation of args.edits) {
    if(!operation||typeof operation!=='object'||Array.isArray(operation)||Object.hasOwn(operation,'file'))return null
    const edit=validatedEdit({...operation,file:args.file})
    if(!edit)return null
    delete edit.file
    edits.push(edit)
  }
  return {file:args.file,kind:'batch',edits}
}

export const AGENT_PROPOSAL_TOOL = 'design_studio_propose'

export function registerAgentProposal(ctx, inbox) {
  ctx.tools.register({
    name: AGENT_PROPOSAL_TOOL,
    description: 'Prepare a read-only Design Studio edit for human review. Use a relative file in the current session and a supported typed edit. Show the resulting proposal to the user. Use id, property and value for html-style or id, attribute and value for html-attribute. Use id and direction (front, back, forward or backward) for svg-order, and id, property (display or visibility), and value for svg-visibility. For svg-transform use id and an operation object with type and numeric components (translate dx/dy, scale sx/sy, rotate or skew angle, matrix six values). Use selector, condition, property and value for css-media, with the exact selector and a simple width condition. For slide-add supply id and title, for slide-reorder id and direction (earlier or later), for slide-duplicate id and newId, and for slide-remove id. Slide ids start with slide-. Use svg-add-shape with shape rect, circle, ellipse, text or path to insert a native primitive at the artboard center. Supply numeric x and y together to place a rect or text by its anchor, or a circle or ellipse by its center. For text shapes, optional text sets the literal initial content and supports line breaks. Use svg-gradient-create with id, type (linear or radial), fromColor and toColor in hex to add and apply a gradient. Use svg-gradient-stop with gradientId, zero-based index, attribute (offset, stop-color or stop-opacity) and value, or svg-gradient-geometry with gradientId, attribute and value. Use batch with an edits array of two to six typed edits for the same file. Every edit targets the original revision and source ranges must not overlap. The tool never saves the file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required,
      properties: {
        file:{type:'string'},
        ...editProperties,
        kind:{type:'string',enum:[...REVIEWABLE_EDIT_KINDS,'batch']},
        edits:{type:'array',minItems:2,maxItems:maxBatchEdits,items:{
          type:'object',additionalProperties:false,required:['kind'],
          properties:{...editProperties,kind:{type:'string',enum:REVIEWABLE_EDIT_KINDS}},
        }},
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
      const edit = validatedProposal(args)
      if (!edit) return JSON.stringify({ ok: false, error: 'invalid-edit' })
      try {
        const root = await ctx.workingDirectory.ensure(agent, signal)
        signal.throwIfAborted()
        const document = await createNativeFileStore(root).read(edit.file)
        signal.throwIfAborted()
        const patches=edit.kind==='batch'?planReviewableBatch(document,edit.edits):planReviewableEdit(document,edit)
        const preview = previewNativeEdit(document,patches)
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
