/**
 * Bounded conditional CSS editing.
 *
 * The rule is addressed by its exact offset, so two identical selectors in
 * different media blocks are never confused. Only one simple width feature is
 * accepted, conditional rules stay non-`editable` so the HTML preview can never
 * project them unconditionally, and every refusal leaves the source untouched.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listCssVisualRuleDetails, listCssVisualRules, simpleMediaCondition,
  cssMediaDeclarationPatch,
} from '../src/css-visual.mjs'
import { buildSafeLinkedPreviewCss } from '../src/html-responsive-preview.mjs'

function applies(source, patch) {
  return source.slice(0, patch.start) + patch.after + source.slice(patch.end)
}
function undo(source, patch) {
  return source.slice(0, patch.start) + patch.before + source.slice(patch.end)
}

const TWO_MEDIAS = [
  '@media (max-width: 600px) {',
  '  .card { color: #111111; }',
  '}',
  '',
  '@media (max-width: 600px) {',
  '  .card { color: #222222; }',
  '}',
  '',
].join('\n')

test('simple media conditions are parsed narrowly and everything else refused', () => {
  assert.equal(simpleMediaCondition([{ name: 'media', prelude: '(max-width: 600px)' }]), '(max-width: 600px)')
  assert.equal(simpleMediaCondition([{ name: 'media', prelude: ' ( min-width : 768px ) ' }]), '(min-width: 768px)')
  assert.equal(simpleMediaCondition([{ name: 'media', prelude: '(max-width:600.5px)' }]), '(max-width: 600.5px)')
  for (const prelude of [
    'screen and (max-width: 600px)',
    '(max-width: 600px) and (min-width: 400px)',
    '(max-width: 600px), print',
    '(width <= 600px)',
    'print',
    '(max-height: 600px)',
    '(max-width: 60em)',
    '',
  ]) assert.equal(simpleMediaCondition([{ name: 'media', prelude }]), null, prelude)
  assert.equal(simpleMediaCondition([{ name: 'supports', prelude: '(display: grid)' }]), null)
  assert.equal(simpleMediaCondition([
    { name: 'media', prelude: '(max-width: 600px)' },
    { name: 'supports', prelude: '(display: grid)' },
  ]), null, 'an extra at-rule ancestor is refused')
})

test('two identical selectors in media blocks are addressed by offset, not by name', () => {
  const rules = listCssVisualRuleDetails(TWO_MEDIAS).filter((rule) => rule.mediaCondition)
  assert.equal(rules.length, 2)
  assert.deepEqual(rules.map((rule) => rule.mediaCondition), ['(max-width: 600px)', '(max-width: 600px)'])
  assert.deepEqual(rules.map((rule) => rule.mediaEditable), [true, true])
  assert.notEqual(rules[0].start, rules[1].start)

  const first = cssMediaDeclarationPatch(TWO_MEDIAS, {
    start: rules[0].start, condition: rules[0].mediaCondition, property: 'color', value: '#abcdef',
  })
  const after = applies(TWO_MEDIAS, first)
  assert.ok(after.includes('.card { color: #abcdef; }'))
  assert.ok(after.includes('.card { color: #222222; }'), 'the second identical block is untouched')
  assert.equal(undo(after, first), TWO_MEDIAS, 'the inverse restores the exact original bytes')

  const second = cssMediaDeclarationPatch(TWO_MEDIAS, {
    start: rules[1].start, condition: rules[1].mediaCondition, property: 'color', value: '#fedcba',
  })
  const both = applies(TWO_MEDIAS, second)
  assert.ok(both.includes('.card { color: #111111; }'), 'the first block is untouched')
  assert.ok(both.includes('.card { color: #fedcba; }'))
  assert.equal(undo(both, second), TWO_MEDIAS)
})

test('a mismatched condition or offset refuses instead of editing another block', () => {
  const rules = listCssVisualRuleDetails(TWO_MEDIAS).filter((rule) => rule.mediaCondition)
  assert.throws(() => cssMediaDeclarationPatch(TWO_MEDIAS, {
    start: rules[0].start, condition: '(min-width: 600px)', property: 'color', value: '#abcdef',
  }), (error) => error.code === 'stale-reference')
  assert.throws(() => cssMediaDeclarationPatch(TWO_MEDIAS, {}), (error) => error.code === 'invalid-target')
  assert.throws(() => cssMediaDeclarationPatch(TWO_MEDIAS, {
    start: rules[0].start + 1, condition: rules[0].mediaCondition, property: 'color', value: '#abcdef',
  }), (error) => error.code === 'unknown-node')
  assert.throws(() => cssMediaDeclarationPatch(TWO_MEDIAS, {
    start: rules[0].start, condition: rules[0].mediaCondition, property: 'color', value: 'expression(alert(1))',
  }), (error) => error.code === 'invalid-value')
})

test('a top-level rule is never edited through the conditional path', () => {
  const source = '.card { color: #111111; }\n'
  const [rule] = listCssVisualRuleDetails(source)
  assert.equal(rule.mediaCondition, null)
  assert.equal(rule.mediaEditable, false)
  assert.throws(() => cssMediaDeclarationPatch(source, {
    start: rule.start, condition: '(max-width: 600px)', property: 'color', value: '#222222',
  }), (error) => error.code === 'inside-at-rule')
})

test('complex media blocks stay read-only with a typed reason', () => {
  const source = [
    '@media screen and (max-width: 600px) {',
    '  .card { color: #111111; }',
    '}',
    '',
    '@media (max-width: 600px) {',
    '  .card { color: #111111; color: #222222; }',
    '}',
    '',
  ].join('\n')
  const rules = listCssVisualRuleDetails(source)
  assert.equal(rules.every((rule) => rule.mediaEditable === false), true)
  assert.equal(rules.every((rule) => rule.editable === false), true)
  assert.throws(() => cssMediaDeclarationPatch(source, {
    start: rules[1].start, condition: '(max-width: 600px)', property: 'color', value: '#333333',
  }), (error) => error.code === 'duplicate-property')
})

test('conditional rules are never flattened into the partial HTML preview', () => {
  const css = [
    '#title { color: #123456; }',
    '',
    '@media (max-width: 600px) {',
    '  #title { color: #ff0000; }',
    '}',
    '',
  ].join('\n')
  // The historical list only exposes top-level rules, so a conditional block
  // can never be offered as an unconditional editable rule.
  const listed = listCssVisualRules(css)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].selector, '#title')
  assert.equal(listed[0].editable, true)
  const details = listCssVisualRuleDetails(css)
  assert.equal(details.filter((rule) => rule.scope === 'top-level').length, 1)
  // Non-vacuity: the conditional rule must really be present, carry the parsed
  // condition, own the #ff0000 declaration, and stay non-`editable`.
  const conditional = details.filter((rule) => rule.mediaCondition !== null)
  assert.equal(conditional.length, 1)
  assert.equal(conditional[0].mediaCondition, '(max-width: 600px)')
  assert.equal(conditional[0].selector, '#title')
  assert.equal(conditional[0].editable, false, 'a conditional rule is never `editable`')
  assert.equal(conditional[0].mediaEditable, true)
  assert.deepEqual(conditional[0].declarations.map((entry) => entry.value), ['#ff0000'])
  assert.deepEqual(conditional[0].atRules, ['media'])
  const projected = buildSafeLinkedPreviewCss(
    listCssVisualRuleDetails(css), new Set(['#title']))
  assert.equal(projected.css.includes('color:#123456'), true)
  assert.equal(projected.css.includes('ff0000'), false, 'the conditional override must not be projected')
  assert.equal(/@media/.test(projected.css), false, 'no @media block is emitted')
})

/* -------------------------------------------------------------------------
 * Real Host route: the conditional edit goes through the same transactional
 * path as every other write (revision checks, exact precondition, Undo).
 * ---------------------------------------------------------------------- */
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRouteHandler } from '../src/plugin-host.mjs'

const ROUTE_CSS = '@media (max-width: 600px) {\n  .card {\n    color: #111111;\n  }\n}\n'

async function hostFixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-css-media-'))
  try {
    await writeFile(path.join(root, 'media.css'), ROUTE_CSS)
    await writeFile(path.join(root, 'shape.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/></svg>')
    const ctx = {
      agents: { get: (id) => (id === 'known' ? { id } : undefined) },
      workingDirectory: { ensure: async () => root },
    }
    const route = createRouteHandler(ctx)
    const invoke = async (method, url, body) => {
      const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
      request.method = method; request.url = url
      request.headers = body === undefined ? {} : { 'content-type': 'application/json' }
      let status, json
      const response = { writeHead(code) { status = code }, end(data) { json = JSON.parse(data) } }
      await route(request, response)
      return { status, json }
    }
    await run({ invoke, root })
  } finally { await rm(root, { recursive: true, force: true }) }
}

const documentUrl = (file) => '/design-studio-native/document?sessionId=known&file=' + file

test('the Host exposes conditional rules separately and edits them over the real route', () =>
  hostFixture(async ({ invoke, root }) => {
    const opened = (await invoke('GET', documentUrl('media.css'))).json
    assert.equal(opened.cssRules.length, 0, 'no conditional rule may be offered as an unconditional editable rule')
    assert.equal(opened.cssMedia.length, 1)
    const conditional = opened.cssMedia[0]
    assert.equal(conditional.condition, '(max-width: 600px)')
    assert.equal(conditional.selector, '.card')
    assert.equal(conditional.conditionalEditable, true)
    // The ambiguous name must stay absent: `editable` is the single flag the
    // HTML preview guards on, and reintroducing it here would re-arm the trap.
    assert.equal(Object.hasOwn(conditional, 'editable'), false)

    const response = await invoke('POST', '/design-studio-native/apply', {
      sessionId: 'known', file: 'media.css',
      baseHash: opened.document.hash, baseIdentity: opened.document.identity,
      kind: 'css-media', start: conditional.start, condition: conditional.condition,
      property: 'color', value: '#abcdef',
    })
    assert.equal(response.status, 200)
    assert.equal(await readFile(path.join(root, 'media.css'), 'utf8'),
      ROUTE_CSS.replace('#111111', '#abcdef'), 'only the addressed value changes')

    // Undo uses the recorded inverse through the normal patch path.
    const applied = response.json.result
    const undoResponse = await invoke('POST', '/design-studio-native/apply', {
      sessionId: 'known', file: 'media.css',
      baseHash: applied.hash, baseIdentity: applied.identity,
      kind: 'patches', patches: applied.inverse,
    })
    assert.equal(undoResponse.status, 200)
    assert.equal(await readFile(path.join(root, 'media.css'), 'utf8'), ROUTE_CSS,
      'Undo restores the exact original stylesheet bytes')
  }))

test('the Host refuses a falsified condition, a stale revision and a non-CSS target', () =>
  hostFixture(async ({ invoke, root }) => {
    const opened = (await invoke('GET', documentUrl('media.css'))).json
    const conditional = opened.cssMedia[0]
    const base = {
      sessionId: 'known', file: 'media.css',
      baseHash: opened.document.hash, baseIdentity: opened.document.identity,
      kind: 'css-media', start: conditional.start, property: 'color', value: '#abcdef',
    }
    const falsified = await invoke('POST', '/design-studio-native/apply',
      { ...base, condition: '(min-width: 600px)' })
    assert.equal(falsified.status, 400)
    assert.equal(falsified.json.error, 'stale-reference')

    const noRevision = await invoke('POST', '/design-studio-native/apply',
      { ...base, condition: conditional.condition, baseIdentity: undefined })
    assert.equal(noRevision.status, 428)

    const stale = await invoke('POST', '/design-studio-native/apply',
      { ...base, condition: conditional.condition, baseHash: 'a'.repeat(64) })
    assert.equal(stale.status, 409)

    const svg = (await invoke('GET', documentUrl('shape.svg'))).json
    const wrongFormat = await invoke('POST', '/design-studio-native/apply', {
      ...base, file: 'shape.svg', condition: conditional.condition,
      baseHash: svg.document.hash, baseIdentity: svg.document.identity,
    })
    assert.equal(wrongFormat.status, 400)
    assert.equal(wrongFormat.json.error, 'unsupported-format')

    assert.equal(await readFile(path.join(root, 'media.css'), 'utf8'), ROUTE_CSS,
      'every refusal leaves the stylesheet byte-identical')
  }))

test('a proposal targets an exact selector and unique width condition',()=>{
  const edit={selector:'.card',condition:'( max-width : 600px )',property:'color',value:'#abcdef'}
  assert.throws(()=>cssMediaDeclarationPatch(TWO_MEDIAS,edit),{code:'ambiguous-selector'})
  const distinct=TWO_MEDIAS.replace('(max-width: 600px)','(min-width: 601px)')
  const result=applies(distinct,cssMediaDeclarationPatch(distinct,edit))
  assert.equal(result,distinct.replace('#222222','#abcdef'))
  assert.throws(()=>cssMediaDeclarationPatch(distinct,{...edit,selector:'.other'}),{code:'unknown-node'})
})
