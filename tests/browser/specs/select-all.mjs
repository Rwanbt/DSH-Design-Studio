import {openWorkspaceFile,waitForDisk} from './helpers.mjs'

const SOURCE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">'+
  '<g id="group"><rect id="child" x="10" y="10" width="20" height="20"/></g>'+
  '<rect id="sibling" x="100" y="10" width="20" height="20"/>'+
  '</svg>'

export const selectAllArtboardSpec={
  name:'keyboard: Ctrl+A selects top-level SVG objects without double-selecting a group child',
  async run({page,harness,assert}){
    await harness.write('select-all.svg',SOURCE)
    await openWorkspaceFile(page,'select-all.svg',{expect:'svg'})
    const workbench=page.getByRole('region',{name:'DSH Design Studio workbench'})
    await page.getByRole('button',{name:'Select layer g #group'}).click()
    await workbench.dispatchEvent('keydown',{key:'a',code:'KeyA',ctrlKey:true,bubbles:true,cancelable:true})
    assert.equal(await page.getByRole('button',{name:/Select layer rect #sibling/}).getAttribute('aria-label'),
      'Select layer rect #sibling (in selection)')
    assert.equal(await page.getByRole('button',{name:/Select layer rect #child/}).getAttribute('aria-label'),
      'Select layer rect #child')
    await page.getByRole('button',{name:/Select layer g #group/}).press('Shift+ArrowRight')
    const result=await waitForDisk(harness,'select-all.svg',text=>
      text.includes('id="group" transform="matrix(1,0,0,1,10,0)"')&&
      text.includes('id="sibling"')&&text.includes('transform="matrix(1,0,0,1,10,0)"'),
      {label:'select all nudge'})
    assert.equal((result.match(/transform="matrix\(1,0,0,1,10,0\)"/g)||[]).length,2,
      'group and sibling each move once, child inherits group transform')
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'select-all.svg',text=>text===SOURCE,{label:'select-all Undo'})
    assert.equal(await harness.read('select-all.svg'),SOURCE)
  }
}
