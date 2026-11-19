import {openWorkspaceFile,waitForDisk} from './helpers.mjs'

const SOURCE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+
  '<rect id="from" x="1" y="1" width="20" height="20" fill="#af3100" stroke="#223344" opacity="0.5"/>'+
  '<rect id="to" x="40" y="1" width="20" height="20" fill="#dddddd"/>'+
  '</svg>'

export const appearanceTransferSpec={
  name:'appearance: copy native SVG paint from one shape to another with exact Undo',
  async run({page,harness,assert}){
    await harness.write('appearance.svg',SOURCE)
    await openWorkspaceFile(page,'appearance.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer rect #from'}).click()
    await page.getByRole('button',{name:'Copier apparence SVG'}).click()
    await page.getByRole('button',{name:'Select layer rect #to'}).click()
    const apply=page.getByRole('button',{name:'Appliquer apparence SVG'})
    assert.equal(await apply.isDisabled(),false)
    await apply.click()
    const changed=await waitForDisk(harness,'appearance.svg',text=>
      text.includes('id="to" x="40" y="1" width="20" height="20" fill="#af3100" stroke="#223344" opacity="0.5"'),
      {label:'native appearance transferred'})
    assert.ok(changed.includes('id="from" x="1" y="1" width="20" height="20" fill="#af3100"'))
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'appearance.svg',text=>text===SOURCE,{label:'undo appearance transfer'})
    assert.equal(await harness.read('appearance.svg'),SOURCE)
  }
}
