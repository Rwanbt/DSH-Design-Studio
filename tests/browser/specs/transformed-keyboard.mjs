import { openWorkspaceFile, waitForDisk } from './helpers.mjs'

const SOURCE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'+
  '<rect id="shape" x="10" y="20" width="40" height="20" fill="#aabbcc" transform="rotate(90)"/>'+
  '</svg>'
export const transformedKeyboardNudgeSpec={
  name:'keyboard: visible ArrowRight on a rotated SVG rect changes local y only and undoes exactly',
  async run({page,harness,assert}){
    await harness.write('rotated-nudge.svg',SOURCE)
    await openWorkspaceFile(page,'rotated-nudge.svg',{expect:'svg'})
    const row=page.getByRole('button',{name:'Select layer rect #shape'})
    await row.click()
    await row.press('ArrowRight')
    const updated=await waitForDisk(harness,'rotated-nudge.svg',
      text=>text.includes('x="10" y="19"'),{label:'right nudge in global coordinates'})
    assert.equal(updated,SOURCE.replace('x="10" y="20"','x="10" y="19"'))
    assert.ok(updated.includes('transform="rotate(90)"'),'original transform is byte-identical')
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'rotated-nudge.svg',text=>text===SOURCE,{label:'rotated nudge Undo'})
    assert.equal(await harness.read('rotated-nudge.svg'),SOURCE)
  }
}
