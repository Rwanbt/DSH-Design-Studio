/**
 * Level 1 — rename one SVG layer id.
 *
 * Every assertion reads the real patch engine (`applyNativePatches`), so the
 * byte-exactness of the value-only span and of the inverse is proven, not
 * assumed. Refusals are typed and never return a patch.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyNativePatches, sourceHash } from '../src/native-patch.mjs'
import { listEditableSvgNodes } from '../src/svg-attributes.mjs'
import { MAX_SVG_ID_LENGTH, svgIdReference, svgRenamePatch } from '../src/svg-rename.mjs'

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <!-- keep this comment and the following bytes exactly -->
  <rect id="card" x="10" y="10" width="40" height="30" fill="#bda991"/>
  <circle id="dot" cx="80" cy="20" r="10"/>
</svg>
`

function apply(source, patches) {
  return applyNativePatches({ source, format: 'svg', baseHash: sourceHash(source), patches })
}

/** The single differing range between two strings. */
function diff(before, after) {
  const limit = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  return { prefix, suffix, before: before.slice(prefix, before.length - suffix),
    after: after.slice(prefix, after.length - suffix) }
}

test('renames only the id value span and its inverse restores every byte', () => {
  const operation = svgRenamePatch(SVG, { id: 'card', next: 'panel' })
  assert.equal(operation.id, 'card')
  assert.equal(operation.next, 'panel')
  assert.equal(operation.tag, 'rect')
  assert.deepEqual(operation.patch, {
    start: SVG.indexOf('id="card"') + 4,
    end: SVG.indexOf('id="card"') + 8,
    before: 'card',
    after: 'panel',
  })

  const renamed = apply(SVG, [operation.patch])
  assert.equal(renamed.ok, true)
  assert.equal(renamed.source, SVG.replace('id="card"', 'id="panel"'))
  // Exactly one differing range, and it is the value itself: no other byte moved.
  const window = diff(SVG, renamed.source)
  assert.equal(window.before, 'card')
  assert.equal(window.after, 'panel')
  assert.equal(window.prefix + window.suffix + window.before.length, SVG.length)
  assert.equal(window.prefix + window.suffix + window.after.length, renamed.source.length)
  assert.ok(renamed.source.includes('<!-- keep this comment and the following bytes exactly -->'))
  assert.ok(renamed.source.includes('<circle id="dot" cx="80" cy="20" r="10"/>'))

  const undone = apply(renamed.source, renamed.inverse)
  assert.equal(undone.ok, true)
  assert.equal(undone.source, SVG, 'Undo restores the original bytes exactly')
})

test('preserves the authored quote style and accepts the existing id family', () => {
  const source = "<svg xmlns='http://www.w3.org/2000/svg'><rect id='layer.1:a' x='1' y='2' width='3' height='4'/></svg>"
  const renamed = apply(source, [svgRenamePatch(source, { id: 'layer.1:a', next: 'ns:layer_2' }).patch])
  assert.equal(renamed.ok, true)
  assert.equal(renamed.source, source.replace("id='layer.1:a'", "id='ns:layer_2'"))
  assert.ok(renamed.source.includes("x='1' y='2' width='3' height='4'"), 'single quotes elsewhere are untouched')
  assert.equal(apply(renamed.source, renamed.inverse).source, source)
})

test('refuses invalid new ids without producing a patch', () => {
  for (const next of ['', '1card', 'car d', 'card"', "card'", '#card', 'card#', 'card>', 'éclair', 'a'.repeat(MAX_SVG_ID_LENGTH + 1)]) {
    assert.throws(() => svgRenamePatch(SVG, { id: 'card', next }), { code: 'invalid-id' },
      'must refuse: ' + JSON.stringify(next))
  }
  assert.doesNotThrow(() => svgRenamePatch(SVG, { id: 'card', next: 'a'.repeat(MAX_SVG_ID_LENGTH) }))
})

test('refuses a valid target id that is missing, empty or not a string', () => {
  assert.throws(() => svgRenamePatch(SVG, { id: '', next: 'x' }), { code: 'invalid-target' })
  assert.throws(() => svgRenamePatch(SVG, { id: 'ghost', next: 'x' }), { code: 'unknown-node' })
  assert.throws(() => svgRenamePatch(SVG, { id: 'card', next: 7 }), { code: 'invalid-id' })
})

test('refuses an identical id instead of rewriting the same bytes', () => {
  assert.throws(() => svgRenamePatch(SVG, { id: 'card', next: 'card' }), { code: 'unchanged' })
})

test('refuses a collision with any existing id, including an XML-encoded one', () => {
  assert.throws(() => svgRenamePatch(SVG, { id: 'card', next: 'dot' }), { code: 'id-collision' })
  const encoded = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="c&#97;rd" x="1" y="1" width="2" height="2"/><rect id="other" x="3" y="3" width="2" height="2"/></svg>`
  assert.throws(() => svgRenamePatch(encoded, { id: 'other', next: 'card' }), { code: 'id-collision' })
  // The encoded id itself is not addressable, so it is never a rename target.
  assert.throws(() => svgRenamePatch(encoded, { id: 'card', next: 'carte' }), { code: 'unknown-node' })
})

test('refuses a rename whose old id is referenced by url(), href or xlink:href', () => {
  const wrappers = [
    ['url()', `<rect x="0" y="0" width="10" height="10" fill="url(#card)"/>`],
    ['url() with quotes and spaces', `<rect x="0" y="0" width="10" height="10" fill='url( "#card" )'/>`],
    ['style attribute url()', `<rect x="0" y="0" width="10" height="10" style="fill:url(#card)"/>`],
    ['href', `<use href="#card" x="0" y="0"/>`],
    ['xlink:href', `<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#card" x="0" y="0"/>`],
    ['style element url()', `<style>.tint{fill:url(#card)}</style>`],
    ['style element selector', `<style>#card{opacity:.5}</style>`],
  ]
  for (const [label, extra] of wrappers) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="10" y="10" width="20" height="20"/>${extra}</svg>`
    assert.throws(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), { code: 'id-referenced' }, label)
    assert.ok(svgIdReference(source, 'card'), label + ' is reported as a reference')
  }
})

test('detects class, pseudo-class, pseudo-element and attribute selectors on the same id', () => {
  for (const selector of ['#card:hover', '#card.active', '#card::before', '#card[data-x]']) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><style>${selector}{opacity:.5}</style></svg>`
    assert.equal(svgIdReference(source, 'card'), 'css', selector + ' is a reference to #card')
    assert.throws(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), { code: 'id-referenced' }, selector)
  }
  // `#card2` and `#card-2` name different ids: the prefix alone is not a reference.
  for (const selector of ['#card2', '#card-2', '#card_2']) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><style>${selector}{opacity:.5}</style></svg>`
    assert.equal(svgIdReference(source, 'card'), null, selector + ' is a different id')
    assert.doesNotThrow(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), selector)
  }
})

test('detects [id="card"] and [id=card] attribute selectors in a style block', () => {
  for (const selector of ['[id="card"]', "[id='card']", '[id=card]']) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><style>${selector}{opacity:.5}</style></svg>`
    assert.equal(svgIdReference(source, 'card'), 'css', selector + ' is a reference to #card')
    assert.throws(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), { code: 'id-referenced' }, selector)
  }
  const other = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><style>[id="card2"]{opacity:.5}</style></svg>`
  assert.equal(svgIdReference(other, 'card'), null, '[id="card2"] names another id')
})

test('decodes XML character references before matching href and url()', () => {
  const cases = [
    ['href decimal #', `<use href="&#35;card" x="0" y="0"/>`],
    ['href mixed characters', `<use href="#c&#97;rd" x="0" y="0"/>`],
    ['href hexadecimal #', `<use href="&#x23;card" x="0" y="0"/>`],
    ['url() encoded #', `<rect x="0" y="0" width="10" height="10" fill="url(&#35;card)"/>`],
    ['style attribute encoded url()', `<rect x="0" y="0" width="10" height="10" style="fill:url(&#35;card)"/>`],
  ]
  for (const [label, extra] of cases) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="10" y="10" width="20" height="20"/>${extra}</svg>`
    assert.ok(svgIdReference(source, 'card'), label + ' is a reference')
    assert.throws(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), { code: 'id-referenced' }, label)
  }
  // Decoding happens exactly once: `&amp;#35;` is the text `&#35;`, not `#`.
  const once = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><use href="&amp;#35;card" x="0" y="0"/></svg>`
  assert.equal(svgIdReference(once, 'card'), null, 'a double-encoded reference is not a live reference')
})

test('an unknown or malformed XML entity is refused conservatively', () => {
  for (const value of ['a&unknown;b', 'AT&T', '&#xZZ;', '&#;', '&amp']) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><text data-note="${value}">x</text></svg>`
    assert.throws(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), { code: 'ambiguous-entities' },
      'must refuse: ' + JSON.stringify(value))
  }
  const valid = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><text data-note="AT&amp;T">x</text></svg>`
  assert.doesNotThrow(() => svgRenamePatch(valid, { id: 'card', next: 'carte' }), 'a known entity decodes normally')
})

test('detects any attribute whose local name is href, not only xlink:href', () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><use xmlns:x="http://www.w3.org/1999/xlink" x:href="#card" x="0" y="0"/></svg>`
  assert.equal(svgIdReference(source, 'card'), 'x:href')
  assert.throws(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), { code: 'id-referenced' })
})

test('detects ARIA id lists and SMIL begin/end event references', () => {
  const aria = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant']
  for (const name of aria) {
    const value = name === 'aria-activedescendant' ? 'card' : 'title  card  footer'
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><g ${name}="${value}"/></svg>`
    assert.equal(svgIdReference(source, 'card'), name)
    assert.throws(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), { code: 'id-referenced' }, name)
  }
  for (const [name, value] of [['begin', 'card.click'], ['begin', '0s; card.click'], ['end', 'card.end+1s'],
    ['begin', 'other.begin+card.click']]) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><animate ${name}="${value}" attributeName="opacity" dur="1s"/></svg>`
    assert.equal(svgIdReference(source, 'card'), name, name + '=' + value)
    assert.throws(() => svgRenamePatch(source, { id: 'card', next: 'carte' }), { code: 'id-referenced' }, name)
  }
  // A different id whose name merely starts with `card` is not a reference.
  const unrelated = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="card" x="1" y="1" width="2" height="2"/><g aria-labelledby="card2"/><animate begin="card2.click" attributeName="opacity" dur="1s"/></svg>`
  assert.equal(svgIdReference(unrelated, 'card'), null)
  assert.doesNotThrow(() => svgRenamePatch(unrelated, { id: 'card', next: 'carte' }))
})

test('refuses an id that needs CSS escaping when the document contains CSS', () => {
  const withCss = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="layer.1" x="1" y="1" width="2" height="2"/><style>#layer\\.1{opacity:.5}</style></svg>`
  assert.equal(svgIdReference(withCss, 'layer.1'), 'css-escaping')
  assert.throws(() => svgRenamePatch(withCss, { id: 'layer.1', next: 'layer2' }), { code: 'id-not-renamable' })
  const withUrl = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="layer.1" x="1" y="1" width="2" height="2"/><rect width="1" height="1" fill="url(#other)"/></svg>`
  assert.throws(() => svgRenamePatch(withUrl, { id: 'layer.1', next: 'layer2' }), { code: 'id-not-renamable' })
  // Without any CSS context, an escaped selector cannot hide anywhere: the id
  // is still addressable through exact raw href/url comparisons.
  const plain = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="layer.1" x="1" y="1" width="2" height="2"/></svg>`
  assert.equal(svgIdReference(plain, 'layer.1'), null)
  assert.doesNotThrow(() => svgRenamePatch(plain, { id: 'layer.1', next: 'layer2' }))
})

test('an id that is only a prefix of a reference is not refused', () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect id="car" x="1" y="1" width="2" height="2"/><rect x="0" y="0" width="9" height="9" fill="url(#card)"/></svg>`
  assert.equal(svgIdReference(source, 'car'), null)
  const renamed = apply(source, [svgRenamePatch(source, { id: 'car', next: 'auto' }).patch])
  assert.equal(renamed.ok, true)
  assert.ok(renamed.source.includes('fill="url(#card)"'), 'the unrelated reference keeps every byte')
})

test('refuses locked layers, locked ancestors and read-only referenced content', () => {
  const locked = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="card" data-locked="true" x="1" y="1" width="2" height="2"/></svg>`
  assert.throws(() => svgRenamePatch(locked, { id: 'card', next: 'carte' }), { code: 'locked' })
  const ancestor = `<svg xmlns="http://www.w3.org/2000/svg"><g id="group" data-locked="true"><rect id="child" x="1" y="1" width="2" height="2"/></g></svg>`
  assert.throws(() => svgRenamePatch(ancestor, { id: 'child', next: 'enfant' }), { code: 'locked' })
  const referenced = `<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="tint" x="1" y="1" width="2" height="2"/></defs></svg>`
  assert.throws(() => svgRenamePatch(referenced, { id: 'tint', next: 'teinte' }), { code: 'read-only' })
})

test('refuses the svg root and unaddressable elements', () => {
  const root = `<svg xmlns="http://www.w3.org/2000/svg" id="root"><rect id="card" x="1" y="1" width="2" height="2"/></svg>`
  assert.throws(() => svgRenamePatch(root, { id: 'root', next: 'racine' }), { code: 'invalid-target' })
  const anonymous = `<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="2" height="2"/></svg>`
  assert.deepEqual(listEditableSvgNodes(anonymous).map((node) => node.id), [],
    'a layer without an id is not listed and therefore not renameable')
  assert.throws(() => svgRenamePatch(anonymous, { id: 'card', next: 'carte' }), { code: 'unknown-node' })
})

test('a refused rename never touches the source', () => {
  const before = SVG
  for (const attempt of [
    () => svgRenamePatch(SVG, { id: 'card', next: '' }),
    () => svgRenamePatch(SVG, { id: 'card', next: 'dot' }),
    () => svgRenamePatch(SVG, { id: 'ghost', next: 'x' }),
  ]) assert.throws(attempt)
  assert.equal(SVG, before)
})
