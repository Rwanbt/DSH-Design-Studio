import {openWorkspaceFile,waitForDisk} from './helpers.mjs'

const ORIGINAL='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">'+
  '<rect id="a" x="20" y="10" width="30" height="20" fill="#ab9988"/>'+
  '<rect id="b" x="85" y="10" width="30" height="20" fill="#8899aa"/>'+
  '</svg>'

export const multiDragSpec={
  name:'canvas: selected shapes drag together, preview without writes, commit once and Undo exactly',
  async run({page,harness,assert}){
    await harness.write('multi-drag.svg',ORIGINAL)
    await openWorkspaceFile(page,'multi-drag.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Drag rect a'}).click()
    await page.getByRole('button',{name:'Drag rect b'}).click({modifiers:['Shift']})
    const handle=page.getByRole('button',{name:'Drag rect b'})
    const artboard=await page.locator('.dsh-studio-artboard-content').boundingBox()
    const bbox=await handle.boundingBox()
    assert.ok(artboard?.width>100&&bbox,'canvas positions are available')
    const start={x:bbox.x+bbox.width/2,y:bbox.y+bbox.height/2}
    const dx=artboard.width/200*10
    const applies=()=>harness.requests.filter(req=>
      req.method==='POST'&&req.path==='/design-studio-native/apply').length
    const before=applies()
    await page.mouse.move(start.x,start.y)
    await page.mouse.down()
    await page.keyboard.down('Alt')
    await page.mouse.move(start.x+dx,start.y,{steps:8})
    assert.equal(applies(),before,'drag preview never writes')
    assert.equal(await harness.read('multi-drag.svg'),ORIGINAL,
      'native document remains unchanged until pointer release')
    await page.mouse.up()
    await page.keyboard.up('Alt')
    const translations=text=>Array.from(text.matchAll(/transform="matrix\(1,0,0,1,([\d.]+),0\)"/g),
      match=>Number(match[1]))
    const result=await waitForDisk(harness,'multi-drag.svg',
      text=>translations(text).length===2,{label:'multi drag saved'})
    const [first,second]=translations(result)
    assert.equal(first,second,'the same translation moves both selected shapes')
    assert.ok(Math.abs(first-10)<=200/artboard.width,'translation matches the pointer within one CSS pixel')
    assert.equal(applies(),before+1,'multi drag is exactly one Host write')
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'multi-drag.svg',text=>text===ORIGINAL,
      {label:'multi drag Undo'})
    assert.equal(await harness.read('multi-drag.svg'),ORIGINAL)
    assert.equal(applies(),before+2,'Undo reverses the entire multi-drag in one write')
  }
}
