import {openWorkspaceFile,waitForDisk} from './helpers.mjs'

const SOURCE='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">'+
  '<rect id="shape" x="20" y="20" width="40" height="20" fill="#bda991"/>'+
  '</svg>'

export const customRotationSpec={
  name:'transform: precise relative rotation uses native matrix and exact Undo',
  async run({page,harness,assert}){
    await harness.write('angle.svg',SOURCE)
    await openWorkspaceFile(page,'angle.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer rect #shape'}).click()
    const input=page.getByRole('spinbutton',{name:'Relative rotation angle'})
    await input.fill('-30')
    const apply=page.getByRole('button',{name:'Apply custom rotation'})
    assert.equal(await apply.isDisabled(),false)
    await apply.click()
    const updated=await waitForDisk(harness,'angle.svg',t=>t.includes('transform="matrix('),
      {label:'precise native rotation'})
    const match=/<rect id="shape"[^>]*transform="matrix\(([^)]+)\)"/.exec(updated)
    assert.ok(match,'selected shape acquired a native SVG matrix')
    const [a,b,c,d]=match[1].split(',').map(Number)
    assert.ok(Math.abs(a-Math.cos(Math.PI/6))<0.00001,'cos(-30°) is preserved')
    assert.ok(Math.abs(b+0.5)<0.00001,'sin(-30°) is preserved')
    assert.ok(Math.abs(c-0.5)<0.00001)
    assert.ok(Math.abs(d-Math.cos(Math.PI/6))<0.00001)
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'angle.svg',t=>t===SOURCE,{label:'undo precise rotation'})
    assert.equal(await harness.read('angle.svg'),SOURCE)
  }
}
