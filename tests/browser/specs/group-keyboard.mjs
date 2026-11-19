import { openWorkspaceFile, waitForDisk } from './helpers.mjs'

const SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">'+
  '<g id="group"><rect id="child" x="10" y="20" width="30" height="20" fill="#af9988"/></g>'+
  '</svg>'

export const groupKeyboardNudgeSpec = {
  name:'keyboard: arrows nudge SVG groups in visible units, Shift moves ten, Undo restores exact source',
  async run({ page, harness, assert }) {
    await harness.write('nudge-group.svg', SVG)
    await openWorkspaceFile(page, 'nudge-group.svg', { expect:'svg' })
    const group=page.getByRole('button', { name:'Select layer g #group' })
    await group.click()
    await group.press('ArrowRight')
    const first=await waitForDisk(harness,'nudge-group.svg',
      text=>text.includes('transform="matrix(1,0,0,1,1,0)"'),
      {label:'group nudge right'})
    assert.ok(first.includes('<rect id="child" x="10" y="20"'), 'group child source unchanged')
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    // Wait for the editor's post-save reload before sending the next keystroke.
    await page.waitForFunction(()=>document.querySelector('[aria-label="Select layer g #group"]')?.disabled===false)
    await group.press('Shift+ArrowDown')
    const second=await waitForDisk(harness,'nudge-group.svg',
      text=>text.includes('transform="matrix(1,0,0,1,1,10)"'),
      {label:'group nudge down ten'})
    assert.ok(second.includes('id="child"'), 'child remains a native SVG element')
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'nudge-group.svg',text=>text===first,{label:'undo 10-unit nudge'})
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'nudge-group.svg',text=>text===SVG,{label:'undo 1-unit nudge'})
    assert.equal(await harness.read('nudge-group.svg'),SVG)
  },
}
