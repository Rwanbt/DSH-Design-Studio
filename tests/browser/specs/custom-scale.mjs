import {openWorkspaceFile,waitForDisk} from './helpers.mjs'
const SOURCE='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">'+
  '<rect id="shape" x="20" y="20" width="40" height="20" fill="#bda991"/>'+
  '</svg>'
export const customScaleSpec={
  name:'transform: precise uniform scale uses native SVG matrix and reverses exactly',
  async run({page,harness,assert}){
    await harness.write('scale.svg',SOURCE)
    await openWorkspaceFile(page,'scale.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Select layer rect #shape'}).click()
    const input=page.getByRole('spinbutton',{name:'Uniform scale percentage'})
    await input.fill('150')
    const apply=page.getByRole('button',{name:'Apply uniform scale'})
    assert.equal(await apply.isDisabled(),false)
    await apply.click()
    const updated=await waitForDisk(harness,'scale.svg',t=>t.includes('transform="matrix('),
      {label:'precise native scale'})
    const match=/<rect id="shape"[^>]*transform="matrix\(([^)]+)\)"/.exec(updated)
    assert.ok(match)
    const [a,b,c,d]=match[1].split(',').map(Number)
    assert.equal(a,1.5)
    assert.equal(b,0)
    assert.equal(c,0)
    assert.equal(d,1.5)
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'scale.svg',t=>t===SOURCE,{label:'undo uniform scaling'})
    assert.equal(await harness.read('scale.svg'),SOURCE)
  }
}
