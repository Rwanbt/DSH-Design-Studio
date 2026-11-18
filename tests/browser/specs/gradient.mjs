/**
 * Gradient stop editing from the inspector.
 *
 * Every spec drives a real browser against the real Host handler and a real
 * temporary filesystem: the assertions read the bytes on disk, count the actual
 * `POST /apply` requests, and prove that Undo restores the previous file exactly.
 *
 * The fixture deliberately contains: a writable gradient (`sky`), a gradient
 * inherited through `href` (`inherited`), and shapes whose fill is a plain hex,
 * a `url(#…)` pointing at an unknown gradient, and no fill at all.
 */
import { assertSingleDifferingRange, openWorkspaceFile, waitForDisk } from './helpers.mjs'

const GRADIENT_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <!-- gradient fixture: only stop attributes may ever be rewritten -->
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#102030" stop-opacity="1"/>
      <stop offset="0.55" stop-color="#405060"/>
      <stop offset="100%" stop-color="#8090a0" stop-opacity="0.8"/>
    </linearGradient>
    <linearGradient id="inherited" href="#sky" x1="0" y1="0" x2="0" y2="1"/>
  </defs>
  <rect id="panel" x="20" y="20" width="240" height="140" fill="url(#sky)"/>
  <rect id="ghost" x="300" y="20" width="120" height="80" fill="url(#inherited)"/>
  <rect id="orphan" x="300" y="140" width="120" height="80" fill="url(#absent)"/>
  <circle id="chip" cx="460" cy="300" r="40" fill="#3a3f45"/>
</svg>
`

function countApplies(page) {
  let count = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/design-studio-native/apply')) count += 1
  })
  return () => count
}

/** The inspector section for the gradient referenced by the selected shape. */
async function openGradientSection(page, id) {
  const section = page.locator('[data-gradient-section="' + id + '"]')
  await section.waitFor({ state: 'visible', timeout: 10000 })
  return section
}

export const gradientStopEditSpec = {
  name: 'gradient: editing a stop colour and opacity writes one exact attribute each and Undo restores the bytes',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('degrade.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'degrade.svg', { expect: 'svg' })

    await page.getByRole('button', { name: 'Select layer rect #panel', exact: true }).click()
    const section = await openGradientSection(page, 'sky')
    assert.equal(await section.getAttribute('data-gradient-usable'), 'true',
      'the referenced gradient is writable')
    assert.ok((await section.innerText()).includes('linearGradient · #sky · 3 arrêt(s)'),
      'the section names the gradient and its stop count')
    const preview=section.locator('[data-gradient-preview="sky"]')
    assert.equal(await preview.count(),1,'a native gradient exposes a visual stop strip')
    const originalPreview=await preview.evaluate(node=>node.style.backgroundImage)
    assert.match(originalPreview,/linear-gradient/i,'the strip is an actual browser gradient')

    const color = page.getByLabel('Gradient stop 0 colour', { exact: true })
    const opacity = page.getByLabel('Gradient stop 0 opacity', { exact: true })
    assert.equal(await color.inputValue(), '#102030', 'the colour field starts from the file value')
    assert.equal(await opacity.inputValue(), '1', 'the opacity field starts from the file value')
    // A stop without stop-opacity must not offer an active opacity field.
    assert.equal(await page.getByLabel('Gradient stop 1 opacity', { exact: true }).isDisabled(), true,
      'an absent attribute has no active field (this tranche never inserts one)')
    assert.equal(await harness.read('degrade.svg'), GRADIENT_SVG, 'rendering the inspector must not write')
    assert.equal(applies(), 0, 'rendering the inspector must not call the Host')

    await color.fill('#205080')
    await color.press('Enter')
    const withColor = await waitForDisk(harness, 'degrade.svg',
      (text) => text.includes('stop-color="#205080"'), { label: 'stop colour' })
    const colorWindow = assertSingleDifferingRange(assert, GRADIENT_SVG, withColor, 'stop colour')
    // The differing range is inside the value (the shared prefix/suffix digits
    // are excluded by the diff), and the full comparison below proves that only
    // this attribute value changed.
    assert.ok(colorWindow.before.length > 0 && colorWindow.after.length > 0 && colorWindow.before.length <= 7,
      'the differing range stays inside the edited value')
    assert.equal(withColor, GRADIENT_SVG.replace('stop-color="#102030"', 'stop-color="#205080"'),
      'no other byte moved: comments, offsets, quote style and other stops are untouched')
    assert.equal(applies(), 1, 'one stop colour is exactly one Host write')
    // The field must show what the file now says, not what was typed: if the
    // client stopped reloading, a stale panel would silently misreport the file.
    await page.waitForFunction(() => document.querySelector('[aria-label="Gradient stop 0 colour"]')?.value === '#205080')
    assert.equal(await color.inputValue(), '#205080', 'the colour field resynchronises from the saved file')
    await page.waitForFunction(before=>
      document.querySelector('[data-gradient-preview="sky"]')?.style.backgroundImage!==before,
      originalPreview)
    assert.ok((await preview.evaluate(node=>node.style.backgroundImage))!==originalPreview,
      'editing a stop changes the rendered gradient strip')

    // Writing the same value again must not reach the Host at all.
    await color.fill('#205080')
    await color.press('Enter')
    await page.waitForTimeout(300)
    assert.equal(applies(), 1, 'an identical value must not call the Host')

    // The same inspector, after reload, edits the third stop opacity.
    const thirdOpacity = page.getByLabel('Gradient stop 2 opacity', { exact: true })
    assert.equal(await thirdOpacity.inputValue(), '0.8', 'the opacity value comes from the file')
    await thirdOpacity.fill('0.5')
    await thirdOpacity.press('Enter')
    const withOpacity = await waitForDisk(harness, 'degrade.svg',
      (text) => text.includes('stop-opacity="0.5"'), { label: 'stop opacity' })
    assertSingleDifferingRange(assert, withColor, withOpacity, 'stop opacity')
    assert.equal(withOpacity, withColor.replace('stop-opacity="0.8"', 'stop-opacity="0.5"'),
      'only the targeted stop-opacity value changed')
    assert.equal(applies(), 2, 'one stop opacity is exactly one Host write')

    // Undo is byte-exact and only reverts the last write.
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'degrade.svg', (text) => text === withColor, { label: 'undo stop opacity' })
    assert.equal(await harness.read('degrade.svg'), withColor, 'Undo restores the colour-only bytes exactly')
    assert.equal(applies(), 3, 'Undo is one more Host write')
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'degrade.svg', (text) => text === GRADIENT_SVG, { label: 'undo stop colour' })
    assert.equal(await harness.read('degrade.svg'), GRADIENT_SVG, 'the second Undo restores the original file')
    assert.equal(applies(), 4, 'each Undo is exactly one Host write')
    // After Undo the panel must show the restored value, not the edited one.
    await page.waitForFunction(() => document.querySelector('[aria-label="Gradient stop 0 colour"]')?.value === '#102030')
    assert.equal(await color.inputValue(), '#102030', 'Undo resynchronises the colour field from disk')
  },
}

export const gradientInheritedReadOnlySpec = {
  name: 'gradient: an href-inherited gradient is read-only, shows its reason and sends no request',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('herite.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'herite.svg', { expect: 'svg' })

    await page.getByRole('button', { name: 'Select layer rect #ghost', exact: true }).click()
    const section = await openGradientSection(page, 'inherited')
    assert.equal(await section.getAttribute('data-gradient-usable'), 'false',
      'an inherited gradient is never reported as writable')
    const reason = page.locator('[data-gradient-reason]')
    assert.equal(await reason.getAttribute('data-gradient-reason'), 'inherited-gradient',
      'the refusal is typed in the DOM, not only in prose')
    assert.match(await reason.innerText(), /hérité par href/,
      'the reason is visible to the user')
    assert.equal(await page.locator('[data-gradient-section] input').count(), 0,
      'no active field is proposed for a non-editable gradient')
    assert.equal(await harness.read('herite.svg'), GRADIENT_SVG, 'nothing was written')
    assert.equal(applies(), 0, 'no request was sent for a read-only gradient')
  },
}

const SOLO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <defs>
    <linearGradient id="solo">
      <stop offset="0" stop-color="#102030"/>
    </linearGradient>
  </defs>
  <rect id="solo-panel" x="10" y="10" width="80" height="60" fill="url(#solo)"/>
</svg>
`

export const gradientAddStopSpec = {
  name: 'gradient: adding a stop inserts one complete stop line, writes once and Undo restores the bytes',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('ajout.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'ajout.svg', { expect: 'svg' })

    await page.getByRole('button', { name: 'Select layer rect #panel', exact: true }).click()
    const section = await openGradientSection(page, 'sky')
    assert.ok((await section.innerText()).includes('3 arrêt(s)'), 'the panel starts from the three file stops')
    const add = page.getByRole('button', { name: 'Ajouter un arrêt', exact: true })
    assert.equal(await add.isDisabled(), false, 'adding is available on a writable gradient')
    assert.equal(await harness.read('ajout.svg'), GRADIENT_SVG, 'rendering the section never writes')
    assert.equal(applies(), 0, 'rendering the section never calls the Host')

    await add.click()
    const withStop = await waitForDisk(harness, 'ajout.svg',
      (text) => (text.match(/<stop\b/g) || []).length === 4, { label: 'added stop' })

    // Exactly one new line, every original line preserved in order: one span.
    const beforeLines = GRADIENT_SVG.split('\n')
    const afterLines = withStop.split('\n')
    assert.equal(afterLines.length, beforeLines.length + 1, 'exactly one line was added')
    const addedAt = afterLines.findIndex((line, index) => line !== beforeLines[index])
    assert.equal(addedAt > 0, true, 'the added line is found')
    assert.deepEqual(afterLines.filter((_, index) => index !== addedAt), beforeLines,
      'every original line is still present, in the same order')
    assert.match(afterLines[addedAt],
      /^ {6}<stop offset="[^"]+" stop-color="#8090a0" stop-opacity="0.8"\/>$/,
      'the inserted span is one complete stop with the neighbouring style and the file indentation')
    const window = assertSingleDifferingRange(assert, GRADIENT_SVG, withStop, 'added stop')
    assert.equal(window.before, '', 'adding a stop deletes no byte')

    // The computed offset duplicates no existing one, and the panel count,
    // colour, offset and delete target all resynchronise from disk.
    const offsets = [...withStop.matchAll(/offset="([^"]+)"/g)].map((match) => match[1])
    assert.equal(offsets.length, 4)
    assert.equal(new Set(offsets).size, 4, 'the new offset duplicates no existing offset')
    assert.equal(applies(), 1, 'one added stop is exactly one Host write')
    await page.waitForFunction(() =>
      document.querySelector('[data-gradient-meta]')?.textContent.includes('4 arrêt(s)'))
    const newStop = page.locator('[data-gradient-stop="3"]')
    assert.equal(await newStop.count(), 1, 'the panel lists the new fourth stop')
    assert.equal(await newStop.locator('[data-gradient-offset]').innerText(),
      'offset ' + offsets[3], 'the displayed offset is the one written to disk')
    assert.equal(await page.getByRole('button', { name: 'Supprimer l’arrêt 4', exact: true }).count(), 1,
      'the delete control targets the new stop by its position')

    // Undo is byte-exact and resynchronises the panel again.
    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'ajout.svg', (text) => text === GRADIENT_SVG, { label: 'undo added stop' })
    assert.equal(await harness.read('ajout.svg'), GRADIENT_SVG, 'Undo restores the original bytes exactly')
    assert.equal(applies(), 2, 'Undo is exactly one more Host write')
    await page.waitForFunction(() =>
      document.querySelector('[data-gradient-meta]')?.textContent.includes('3 arrêt(s)'))
  },
}

export const gradientRemoveStopSpec = {
  name: 'gradient: removing a stop deletes exactly its line span and Undo restores the bytes',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('retrait.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'retrait.svg', { expect: 'svg' })

    await page.getByRole('button', { name: 'Select layer rect #panel', exact: true }).click()
    const section = await openGradientSection(page, 'sky')
    assert.ok((await section.innerText()).includes('3 arrêt(s)'))
    assert.equal(await page.getByRole('button', { name: 'Supprimer l’arrêt 3', exact: true }).count(), 1,
      'the third stop has its own delete control')

    // N is the 1-based number shown in the panel; stop 2 is the 0.55 one.
    await page.getByRole('button', { name: 'Supprimer l’arrêt 2', exact: true }).click()
    const withoutStop = await waitForDisk(harness, 'retrait.svg',
      (text) => !text.includes('stop-color="#405060"'), { label: 'removed stop' })
    const expected = GRADIENT_SVG.replace('\n      <stop offset="0.55" stop-color="#405060"/>', '')
    assert.equal(withoutStop, expected, 'exactly the targeted stop line disappeared')
    const window = assertSingleDifferingRange(assert, GRADIENT_SVG, withoutStop, 'removed stop')
    assert.equal(window.after, '', 'removing a stop adds no byte')
    assert.ok(withoutStop.includes('stop-color="#102030"'), 'the first stop is intact')
    assert.ok(withoutStop.includes('stop-color="#8090a0" stop-opacity="0.8"'), 'the last stop is intact')
    assert.equal(applies(), 1, 'one removed stop is exactly one Host write')

    // The remaining stops and their delete targets are renumbered correctly.
    await page.waitForFunction(() =>
      document.querySelector('[data-gradient-meta]')?.textContent.includes('2 arrêt(s)'))
    assert.equal(await page.getByRole('button', { name: 'Supprimer l’arrêt 2', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Supprimer l’arrêt 3', exact: true }).count(), 0,
      'no stale delete control survives the reload')

    await page.waitForFunction(() => document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'retrait.svg', (text) => text === GRADIENT_SVG, { label: 'undo removed stop' })
    assert.equal(await harness.read('retrait.svg'), GRADIENT_SVG, 'Undo restores the removed line exactly')
    assert.equal(applies(), 2, 'Undo is exactly one more Host write')
  },
}

export const gradientLastStopRefusalSpec = {
  name: 'gradient: the last remaining stop cannot be removed and no request is sent',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('dernier.svg', SOLO_SVG)
    await openWorkspaceFile(page, 'dernier.svg', { expect: 'svg' })

    await page.getByRole('button', { name: 'Select layer rect #solo-panel', exact: true }).click()
    const section = await openGradientSection(page, 'solo')
    assert.ok((await section.innerText()).includes('1 arrêt(s)'))
    const remove = page.getByRole('button', { name: 'Supprimer l’arrêt 1', exact: true })
    assert.equal(await remove.isDisabled(), true,
      'the delete control is inactive for the last remaining stop')
    assert.match(String(await remove.getAttribute('title')), /Dernier arrêt/,
      'the visible refusal reason names the last stop')
    assert.equal(await page.getByRole('button', { name: 'Ajouter un arrêt', exact: true }).isDisabled(), false,
      'adding a second stop stays available')
    assert.equal(await harness.read('dernier.svg'), SOLO_SVG, 'the refused removal writes nothing')
    assert.equal(applies(), 0, 'the refused removal sends no Host request')
  },
}

export const gradientNotReferencedSpec = {
  name: 'gradient: a fill that is not a resolvable url(#id) shows no gradient section',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('sans-degrade.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'sans-degrade.svg', { expect: 'svg' })

    // Plain hex fill: the existing fill controls are enough, nothing new.
    await page.getByRole('button', { name: 'Select layer circle #chip', exact: true }).click()
    await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-gradient-section]').count(), 0,
      'a hex fill must not show a gradient section')

    // url(#absent) is a reference to an unknown gradient: it is not listed, so
    // no section is invented for it.
    await page.getByRole('button', { name: 'Select layer rect #orphan', exact: true }).click()
    await page.waitForTimeout(300)
    assert.equal(await page.locator('[data-gradient-section]').count(), 0,
      'an unknown gradient id must not show a gradient section')
    assert.equal(await harness.read('sans-degrade.svg'), GRADIENT_SVG, 'selection never writes')
    assert.equal(applies(), 0, 'selection never calls the Host')
  },
}


export const gradientOffsetInspectorSpec = {
  name: 'gradient: offset edits preserve percentage units and Undo restores exact bytes',
  async run({ page, harness, assert }) {
    const applies = countApplies(page)
    await harness.write('offset.svg', GRADIENT_SVG)
    await openWorkspaceFile(page, 'offset.svg', { expect: 'svg' })
    await page.getByRole('button', { name: 'Select layer rect #panel', exact: true }).click()
    await openGradientSection(page, 'sky')

    const offset = page.getByLabel('Gradient stop 2 offset', { exact: true })
    assert.equal(await offset.inputValue(), '100%', 'the native percentage is displayed unchanged')
    assert.equal(await offset.isDisabled(), false, 'existing offset is editable')
    assert.equal(applies(), 0, 'opening the inspector is read-only')
    await offset.fill('75%')
    await offset.press('Enter')
    const changed = await waitForDisk(harness, 'offset.svg',
      (text) => text.includes('<stop offset="75%" stop-color="#8090a0"'), { label: 'offset changed' })
    assert.equal(changed, GRADIENT_SVG.replace('offset="100%"', 'offset="75%"'),
      'the exact value span alone was replaced')
    assert.equal(applies(), 1, 'offset commit sends one Host write')

    await page.waitForFunction(() =>
      document.querySelector('[aria-label="Undo saved edit"]')?.disabled === false)
    await page.getByRole('button', { name: 'Undo saved edit' }).click()
    await waitForDisk(harness, 'offset.svg', text => text === GRADIENT_SVG,
      { label: 'offset Undo' })
    assert.equal(applies(), 2, 'Undo sends one reverse write')
    assert.equal(await harness.read('offset.svg'), GRADIENT_SVG, 'Undo restores original bytes')
  },
}


export const gradientCreateSpec = {
  name: 'gradient: create linear fill from the inspector, native stop editing and Undo are one transaction',
  async run({ page, harness, assert }) {
    const applies=countApplies(page)
    await harness.write('create-gradient.svg',GRADIENT_SVG)
    await openWorkspaceFile(page,'create-gradient.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer circle #chip',exact:true}).click()
    const create=page.getByRole('button',{name:'Créer un dégradé linéaire',exact:true})
    assert.equal(await create.isDisabled(),false,'the selected circle can create a gradient')
    assert.equal(applies(),0,'opening the fill inspector is read-only')
    await create.click()
    const changed=await waitForDisk(harness,'create-gradient.svg',
      text=>text.includes('fill="url(#dsh_gradient_1)"'),{label:'gradient created'})
    assert.ok(changed.includes('<linearGradient id="dsh_gradient_1"'))
    assert.ok(changed.includes('stop-color="#3a3f45"'), 'the circle\'s original fill becomes the first stop')
    assert.ok(changed.includes('stop-color="#ffffff"'))
    assert.equal(changed.includes('<!-- gradient fixture: only stop attributes may ever be rewritten -->'),true)
    assert.equal(applies(),1,'creating gradient and attaching it uses a single Host /apply')
    const section=await openGradientSection(page,'dsh_gradient_1')
    assert.ok((await section.innerText()).includes('2 arrêt(s)'),'new gradient is editable immediately')
    await page.waitForFunction(()=>
      document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'create-gradient.svg',text=>text===GRADIENT_SVG,
      {label:'gradient creation undone'})
    assert.equal(await harness.read('create-gradient.svg'),GRADIENT_SVG,
      'Undo returns both definition and fill to their exact original bytes')
    assert.equal(applies(),2,'Undo is one reverse Host write')
  },
}


export const gradientGeometrySpec = {
  name: 'gradient: editing the native linear direction changes one value and Undo restores the source',
  async run({page,harness,assert}) {
    const applies=countApplies(page)
    await harness.write('gradient-direction.svg',GRADIENT_SVG)
    await openWorkspaceFile(page,'gradient-direction.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer rect #panel',exact:true}).click()
    await openGradientSection(page,'sky')
    const x2=page.getByRole('textbox',{name:'Gradient x2'})
    assert.equal(await x2.inputValue(),'0','the inspector reads the original x2')
    assert.equal(applies(),0,'opening geometry never writes')
    await x2.fill('1')
    await x2.press('Enter')
    const updated=await waitForDisk(harness,'gradient-direction.svg',
      t=>t.includes('<linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">'),
      {label:'native gradient direction'})
    assert.equal(updated,GRADIENT_SVG.replace('x2="0" y2="1"','x2="1" y2="1"'))
    assert.equal(applies(),1,'one coordinate update is one exact Host write')
    await page.waitForFunction(()=>document.querySelector('[aria-label="Gradient x2"]')?.value==='1')
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'gradient-direction.svg',t=>t===GRADIENT_SVG,{label:'undo gradient direction'})
    assert.equal(await harness.read('gradient-direction.svg'),GRADIENT_SVG)
    assert.equal(applies(),2,'Undo is one reverse write')
  },
}


export const gradientStopMoveSpec = {
  name:'gradient: move an adjacent stop without losing its native markup and Undo restores bytes',
  async run({page,harness,assert}) {
    const applies=countApplies(page)
    await harness.write('move-stop.svg',GRADIENT_SVG)
    await openWorkspaceFile(page,'move-stop.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer rect #panel',exact:true}).click()
    await openGradientSection(page,'sky')
    assert.equal(await page.getByRole('button',{name:'Monter arrêt 1'}).isDisabled(),true)
    await page.getByRole('button',{name:'Descendre arrêt 1'}).click()
    const changed=await waitForDisk(harness,'move-stop.svg',text=>{
      const first=text.indexOf('stop-color="#405060"')
      const second=text.indexOf('stop-color="#102030"')
      return first>=0&&second>=0&&first<second
    },{label:'reordered gradient stops'})
    assert.equal(applies(),1,'one move is one Host transaction')
    assert.ok(changed.includes('<!-- gradient fixture: only stop attributes may ever be rewritten -->'))
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'move-stop.svg',text=>text===GRADIENT_SVG,
      {label:'undo reordered stop'})
    assert.equal(await harness.read('move-stop.svg'),GRADIENT_SVG)
    assert.equal(applies(),2,'Undo reverts both spans in one transaction')
  },
}


export const gradientSharedWarningSpec = {
  name: 'gradient: shared gradient warns before an edit that affects multiple layers',
  async run({page,harness,assert}) {
    const shared=GRADIENT_SVG.replace(
      '  <rect id="ghost"',
      '  <rect id="panel-2" x="24" y="175" width="90" height="65" fill="url(#sky)"/>\n  <rect id="ghost"')
    await harness.write('shared-gradient.svg',shared)
    await openWorkspaceFile(page,'shared-gradient.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer rect #panel',exact:true}).click()
    const section=await openGradientSection(page,'sky')
    const warning=section.locator('[data-gradient-shared-count]')
    assert.equal(await warning.getAttribute('data-gradient-shared-count'),'2')
    assert.match(await warning.innerText(),/partagé par 2 éléments/)
    assert.equal(await harness.read('shared-gradient.svg'),shared,
      'the shared-gradient warning is read-only')
  },
}
