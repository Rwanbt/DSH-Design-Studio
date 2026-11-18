/**
 * Rename one SVG layer by changing only the `id` attribute **value**.
 *
 * The rename is a single `{start, end, before, after}` patch over the exact
 * value span of the `id` attribute, so `applyNativePatches` builds a
 * byte-identical inverse: Undo restores the original file, including the
 * original quote style and every untouched byte around the value.
 *
 * The operation is deliberately conservative. It refuses (typed error, no
 * patch, no write) when:
 *  - the new id is empty, longer than MAX_SVG_ID_LENGTH, or does not match the
 *    same family as the existing ids (`[A-Za-z_][\w.:-]*`);
 *  - the new id is the current one (no-op, never a cosmetic rewrite);
 *  - the new id already exists in the document (including an XML-encoded id
 *    that decodes to it), because duplicate ids break `url(#…)` resolution;
 *  - the **old** id is referenced by `url(#id)`, `href="#id"` (any `*:href`
 *    local name, not only xlink), `aria-labelledby` / `aria-describedby` /
 *    `aria-controls` / `aria-owns` / `aria-activedescendant`, a SMIL `begin` /
 *    `end` `id.event` time, a `#id` CSS selector (including `#id:hover`,
 *    `#id.class`, `#id::before`, `#id[attr]`) or an `[id="id"]` attribute
 *    selector in an in-document `<style>`: rewriting references is out of
 *    scope, so refusing is the only honest answer;
 *  - an attribute value (or `<style>` content) contains an unknown or
 *    malformed XML entity (`ambiguous-entities`): the decoded value could hide
 *    a reference, so the rename is refused instead of guessing;
 *  - the old id needs CSS escaping (a character outside `[A-Za-z0-9_-]`) and
 *    the document has any CSS context (`<style>` or `url(`): an escaped
 *    selector such as `#layer\.1` could reference it, so it is refused with
 *    `id-not-renamable` rather than scanned with an incomplete escape matcher;
 *  - the layer is locked (itself or through a locked ancestor), lives in
 *    read-only referenced content (`<defs>`, `<symbol>`, gradients, …), is the
 *    `<svg>` root, or does not exist.
 *
 * Known remaining blind spots (documented in ADR-032, never silent):
 *  - CSS comments and hex colours are scanned as raw text, so a `#id` there is
 *    an accepted false positive;
 *  - a CSS hex escape of an otherwise simple id (`#\63 ard`) is not detected,
 *    and CSS escapes are not decoded inside `url()` fragments;
 *  - references in external stylesheets are not read;
 *  - nothing is ever rewritten: this operation only changes the `id` value.
 *
 * It never re-serialises the XML tree and never guesses an id it could not
 * read exactly from the bytes.
 */
import { scanSvgDocument, svgLockedAncestor } from './svg-document.mjs'

/** Same family as the ids the rest of the editor accepts, bounded in length. */
export const MAX_SVG_ID_LENGTH = 128
const ID_PATTERN = /^[A-Za-z_][\w.:-]*$/
/** An id in this set can be written unescaped in a CSS selector. */
const CSS_SAFE_ID = /^[A-Za-z0-9_-]+$/
/** A CSS identifier character: after `#id` it means a DIFFERENT id. */
const CSS_ID_NAME_CHAR = /[A-Za-z0-9_-]/
const XML_ENTITIES = Object.freeze({ amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" })
const ARIA_ID_LIST_ATTRIBUTES = new Set([
  'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant',
])
const SMIL_TIME_ATTRIBUTES = new Set(['begin', 'end'])
/** A `<style>` element starts a CSS context; escaped selectors can hide there. */
const STYLE_ELEMENT = /<style(?:\s|>)/i
/** Any `url(` value is a CSS context too (CSS escapes are legal inside it). */
const CSS_URL = /\burl\s*\(/i

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Decode XML character references **once** in one attribute value.
 *
 * Numeric decimal/hexadecimal references and the five predefined entities are
 * decoded. A double-encoded `&amp;#35;` becomes the literal text `&#35;`, not
 * `#`, which is the whole point of decoding exactly once. An unknown or
 * malformed entity cannot be resolved safely, so it is a typed refusal rather
 * than a best guess that could hide a reference.
 */
function decodeXmlEntitiesOnce(text) {
  const value = String(text)
  let result = ''
  let at = 0
  while (at < value.length) {
    const amp = value.indexOf('&', at)
    if (amp < 0) { result += value.slice(at); break }
    result += value.slice(at, amp)
    const semi = value.indexOf(';', amp + 1)
    if (semi < 0) fail('ambiguous-entities', 'An unterminated XML entity makes references ambiguous')
    const body = value.slice(amp + 1, semi)
    let decoded
    if (body.startsWith('#')) {
      const hex = /^#x([0-9a-f]+)$/i.exec(body)
      const decimal = /^#(\d+)$/.exec(body)
      if (!hex && !decimal) {
        fail('ambiguous-entities', 'An unknown XML character reference makes references ambiguous')
      }
      try { decoded = String.fromCodePoint(hex ? parseInt(hex[1], 16) : Number(decimal[1])) }
      catch { fail('ambiguous-entities', 'An invalid XML character reference makes references ambiguous') }
    } else if (Object.hasOwn(XML_ENTITIES, body)) {
      decoded = XML_ENTITIES[body]
    } else {
      fail('ambiguous-entities', 'An unknown XML entity makes references ambiguous')
    }
    result += decoded
    at = semi + 1
  }
  return result
}

/** Decode an attribute value (or style text) when it may contain an entity. */
function decodeXmlValue(raw) {
  const text = String(raw)
  return text.includes('&') ? decodeXmlEntitiesOnce(text) : text
}

/** True when the document has any CSS surface where escaping could be used. */
function hasCssContext(source) {
  return STYLE_ELEMENT.test(source) || CSS_URL.test(source)
}

/** True for `href`, `xlink:href` and any other `*:href` local name. */
function isHrefName(name) {
  return name === 'href' || name.endsWith(':href')
}

/** Is `id` one whitespace-separated token of an ARIA id-list attribute? */
function listReferences(value, id) {
  return String(value).trim().split(/\s+/).includes(id)
}

/**
 * Does a SMIL `begin`/`end` value name `id.event`?
 * Values are `;`-separated and offsets may be combined with `+`/`-`, so the id
 * must start a time token. The boundary prevents `#data` matching id `a`.
 */
function smilReferences(value, id) {
  return new RegExp('(?:^|[;+\\s-])' + escapeRegExp(id) + '\\.').test(String(value))
}

/** Every exact `url(#id)` fragment inside one attribute value or style text. */
function urlReferences(value, href) {
  const pattern = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi
  let match
  while ((match = pattern.exec(value))) {
    const fragment = String(match[2] ?? match[3] ?? '').trim()
    if (fragment === href) return true
  }
  return false
}

/**
 * True when `#id` (or `[id="id"]`) appears as a CSS selector token in an
 * in-document style sheet.
 *
 * After `#id`, a `:`, `.` or `[` continues the SAME subject (`:hover`, `.active`,
 * `::before`, `[attr]`); so does the end of the text or any selector
 * delimiter. Only an identifier character (`[A-Za-z0-9_-]`) means a DIFFERENT
 * id (`#card2`, `#card-2`). This deliberately follows the conservative reading:
 * a `.`/`:` that is legal in an id would still be treated as a selector
 * continuation, and is covered by the `id-not-renamable` rule above.
 */
function styleSheetReferences(text, id) {
  const escaped = escapeRegExp(id)
  const attributeSelector = new RegExp(
    `\\[\\s*id\\s*=\\s*(?:"${escaped}"|'${escaped}'|${escaped})(?:\\s+[is])?\\s*\\]`, 'i')
  if (attributeSelector.test(text)) return true
  const needle = '#' + id
  let at = text.indexOf(needle)
  while (at >= 0) {
    const following = text[at + needle.length] ?? ''
    if (!CSS_ID_NAME_CHAR.test(following)) return true
    at = text.indexOf(needle, at + 1)
  }
  return false
}

/** Does any part of the document reference `id`? */
function referenceKind(scan, source, id) {
  if (!CSS_SAFE_ID.test(id) && hasCssContext(source)) return 'css-escaping'
  const href = '#' + id
  for (const node of scan.nodes) {
    for (const attribute of node.attributeList) {
      // Decode once, before every comparison: `href="&#35;card"` is a real
      // reference, and an unknown entity is a typed refusal.
      const value = decodeXmlValue(attribute.value)
      if (isHrefName(attribute.name) && value.trim() === href) return attribute.name
      if (ARIA_ID_LIST_ATTRIBUTES.has(attribute.name) && listReferences(value, id)) {
        return attribute.name
      }
      if (SMIL_TIME_ATTRIBUTES.has(attribute.name) && smilReferences(value, id)) {
        return attribute.name
      }
      if (urlReferences(value, href)) return 'url'
    }
    // `<style>` content is raw text in the scanner: `url(#id)` there is a real
    // reference, and a `#id` token can be a selector. XML entities are decoded
    // once for the same reason as attributes.
    if (node.tag === 'style' && node.contentEnd !== null) {
      const content = decodeXmlValue(source.slice(node.contentStart, node.contentEnd))
      if (urlReferences(content, href)) return 'url'
      if (styleSheetReferences(content, id)) return 'css'
    }
  }
  return null
}

/**
 * Does any part of the document reference `id`?
 * Returns the kind of reference (`url`, `href`, `xlink:href`, `css`, an ARIA
 * attribute name, `begin`/`end`, or `css-escaping`) or null.
 * Scan order is fixed so the reported reason is deterministic.
 */
export function svgIdReference(source, id) {
  if (typeof source !== 'string' || typeof id !== 'string' || !id) return null
  return referenceKind(scanSvgDocument(source), source, id)
}

/**
 * Return `{patch, id, next, tag}` for one rename, or throw a typed error.
 * The patch covers the `id` value only, so every other byte is preserved.
 */
export function svgRenamePatch(source, { id, next } = {}) {
  if (typeof source !== 'string') fail('invalid-source', 'Expected SVG source text')
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    fail('invalid-target', 'A valid SVG layer id is required')
  }
  if (typeof next !== 'string') fail('invalid-id', 'The new layer name must be a string')
  if (next.length === 0) fail('invalid-id', 'The new layer name cannot be empty')
  if (next.length > MAX_SVG_ID_LENGTH) {
    fail('invalid-id', 'The new layer name must be at most ' + MAX_SVG_ID_LENGTH + ' characters')
  }
  if (!ID_PATTERN.test(next)) {
    fail('invalid-id', 'The new layer name must start with a letter or _ and contain only letters, digits, _, . , : or -')
  }
  if (next === id) fail('unchanged', 'The new layer name is identical to the current one')

  const scan = scanSvgDocument(source)
  const node = scan.byId.get(id)
  if (!node) fail('unknown-node', 'SVG layer id not found')
  if (node === scan.root) fail('invalid-target', 'The SVG root cannot be renamed; rename a layer instead')
  if (node.readOnly) fail('read-only', 'Referenced SVG content is read-only')
  if (svgLockedAncestor(node)) fail('locked', 'SVG layer is locked; unlock it before renaming')

  // A collision would create two elements with the same id. XML character
  // references are compared decoded, so `<rect id="c&#97;rd">` is seen as
  // `card` and cannot be silently duplicated. An undecodable id makes the
  // whole comparison unsafe and is refused.
  for (const candidate of scan.nodes) {
    const attribute = candidate.attributes.get('id')
    if (!attribute) continue
    if (decodeXmlValue(attribute.value) === next) {
      fail('id-collision', 'Another SVG element already uses the id "' + next + '"')
    }
  }

  if (!CSS_SAFE_ID.test(id) && hasCssContext(source)) {
    fail('id-not-renamable',
      'The layer id "' + id + '" needs CSS escaping; escaped selectors cannot be scanned safely, so it is not renamed')
  }

  const reference = referenceKind(scan, source, id)
  if (reference) {
    fail('id-referenced',
      'The layer id "' + id + '" is referenced (' + reference + '); renaming it would break the reference')
  }

  const attribute = node.attributes.get('id')
  if (!attribute) fail('missing-id', 'This SVG element has no id attribute to rename')
  return {
    patch: { start: attribute.valueStart, end: attribute.valueEnd, before: attribute.value, after: next },
    id,
    next,
    tag: node.tag,
  }
}
