import {openWorkspaceFile,waitForDisk} from './helpers.mjs'

const SOURCE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+
  '<path id="curve" fill="none" stroke="#bda991" d="M 0 0 C 10 0 20 0 30 0 C 40 10 50 20 60 0"/>'+
  '</svg>'

export const pathTangentSpec={
  name:'path: symmetrize a cubic junction through the inspector, preserve native source and Undo',
  async run({page,harness,assert}){
    await harness.write('curve.svg',SOURCE)
    await openWorkspaceFile(page,'curve.svg',{expect:'svg',advanced:true})
    await page.getByRole('button',{name:'Select layer path #curve'}).click()
    const button=page.getByRole('button',{name:'Symétriser ancre 3'})
    await button.waitFor({state:'visible',timeout:10000})
    assert.equal(await button.isDisabled(),false)
    await button.click()
    const changed=await waitForDisk(harness,'curve.svg',t=>t.includes('C 40 0 50 20'),
      {label:'smooth cubic tangent saved'})
    assert.equal(changed,SOURCE.replace('C 40 10 50 20','C 40 0 50 20'))
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'curve.svg',t=>t===SOURCE,{label:'undo tangent smoothing'})
    assert.equal(await harness.read('curve.svg'),SOURCE)
  }
}
