import { listHtmlVisualElements, resolveHtmlVisualElement } from './html-visual.mjs'

const deckId = 'dsh-deck'
const slideId = /^slide-[a-z][a-z0-9-]{0,47}$/
const maxSlides = 32

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

function slideMarkup(id, title) {
  const escaped = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<section id="${id}">\n  <h1 id="${id}-title">${escaped}</h1>\n</section>`
}

export function createHtmlPresentation() {
  return '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Presentation</title></head>\n' +
    `<body>\n<main id="${deckId}" data-dsh-deck="1">\n${slideMarkup('slide-intro', 'Untitled slide')}\n</main>\n</body>\n</html>\n`
}

export function readHtmlPresentation(source) {
  const deck = resolveHtmlVisualElement(source, { id: deckId })
  const version = deck.attributes.find(attribute => attribute.name === 'data-dsh-deck')?.value
  if (deck.tag !== 'main' || version !== '1' || deck.readonly || !deck.balanced) {
    fail('unsupported-presentation', 'Expected a version 1 presentation root')
  }
  const slides = listHtmlVisualElements(source).filter(element =>
    element.path?.length === deck.path.length + 1 &&
    element.path.slice(0,-1).every((segment,index) => segment === deck.path[index]))
  if (!slides.length || slides.length > maxSlides) {
    fail('unsupported-presentation', 'Expected one to 32 slides')
  }
  let end = deck.openEnd
  for (const slide of slides) {
    if (slide.tag !== 'section' || !slideId.test(slide.id) || !slide.balanced ||
        !slide.editable || slide.start < end || source.slice(end, slide.start).trim()) {
      fail('unsupported-presentation', 'Expected complete, uniquely identified slides with whitespace between them')
    }
    end = slide.end
  }
  if (source.slice(end, deck.closeStart).trim()) {
    fail('unsupported-presentation', 'Unexpected content after the last slide')
  }
  return { version: 1, deck, slides }
}

function assertAvailableId(source, id) {
  try {
    resolveHtmlVisualElement(source, { id })
  } catch (error) {
    if (error.code === 'unknown-node') return
    throw error
  }
  fail('duplicate-id', 'The slide or title ID is already used')
}

export function appendHtmlSlide(source, { id, title }) {
  if (typeof id !== 'string' || !slideId.test(id) || typeof title !== 'string' ||
      title.length > 256 || /[\u0000-\u001f\u007f]/u.test(title)) {
    fail('invalid-slide', 'Expected a valid slide ID and a single-line title')
  }
  const { deck, slides } = readHtmlPresentation(source)
  if (slides.length >= maxSlides) fail('too-many-slides', 'The presentation already has 32 slides')
  assertAvailableId(source,id)
  assertAvailableId(source,id+'-title')
  const after = slideMarkup(id,title)+'\n'
  readHtmlPresentation(source.slice(0,deck.closeStart)+after+source.slice(deck.closeStart))
  return { start:deck.closeStart, end:deck.closeStart, before:'', after }
}

export function reorderHtmlSlide(source, { id, direction }) {
  const { slides } = readHtmlPresentation(source)
  const index = slides.findIndex(slide => slide.id === id)
  if (index < 0 || (direction !== 'earlier' && direction !== 'later')) {
    fail('invalid-slide-order', 'Expected a slide ID and a direction')
  }
  const other = index + (direction === 'earlier' ? -1 : 1)
  if (other < 0 || other >= slides.length) fail('slide-at-boundary', 'The slide cannot move further')
  const [left,right] = [slides[Math.min(index,other)],slides[Math.max(index,other)]]
  return {
    start:left.start, end:right.end, before:source.slice(left.start,right.end),
    after:source.slice(right.start,right.end)+source.slice(left.end,right.start)+source.slice(left.start,left.end),
  }
}
