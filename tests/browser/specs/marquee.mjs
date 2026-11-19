import { openWorkspaceFile, waitForDisk } from './helpers.mjs'

const DOCUMENT='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">'+
  '<rect id="first" x="25" y="20" width="30" height="25" fill="#bda991"/>'+
  '<rect id="second" x="75" y="25" width="35" height="25" fill="#8a9a7b"/>'+
  '<rect id="outside" x="170" y="90" width="15" height="15" fill="#556677"/>'+
  '</svg>'
export const marqueeSelectionSpec={
  name:'canvas: dragging on empty artboard selects intersecting root shapes and nudge saves once',
  async run({page,harness,assert}){
    await harness.write('marquee.svg',DOCUMENT)
    await openWorkspaceFile(page,'marquee.svg',{expect:'svg'})
    const overlay=page.getByLabel('Direct manipulation overlay')
    const rect=await overlay.boundingBox()
    assert.ok(rect&&rect.width>100&&rect.height>60,'artboard overlay is measurable')
    const start={x:rect.x+rect.width*0.05,y:rect.y+rect.height*0.05}
    const end={x:rect.x+rect.width*0.62,y:rect.y+rect.height*0.58}
    await page.mouse.move(start.x,start.y)
    await page.mouse.down()
    await page.mouse.move(end.x,end.y,{steps:8})
    assert.equal(await page.locator('[data-marquee-selection]').count(),1,
      'the user sees a visible selection rectangle')
    assert.equal(await harness.read('marquee.svg'),DOCUMENT,
      'marquee preview never writes to disk')
    await page.mouse.up()
    assert.equal(await page.locator('[data-marquee-selection]').count(),0,
      'the rectangle is removed after release')
    const second=page.getByRole('button',{name:/Select layer rect #second/})
    assert.equal(await second.getAttribute('aria-label'),
      'Select layer rect #second (in selection)')
    assert.equal(await page.getByRole('button',{name:/Select layer rect #outside/}).getAttribute('aria-label'),
      'Select layer rect #outside','an out-of-range shape is not selected')
    await page.getByRole('button',{name:/Select layer rect #first/}).press('Shift+ArrowRight')
    const changed=await waitForDisk(harness,'marquee.svg',text=>
      (text.match(/transform="matrix\(1,0,0,1,10,0\)"/g)||[]).length===2,
      {label:'marquee multi nudge'})
    assert.equal((changed.match(/transform="matrix\(1,0,0,1,10,0\)"/g)||[]).length,2)
    assert.ok(changed.includes('id="outside" x="170" y="90"'),
      'the out-of-range shape stays byte-identical')
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'marquee.svg',text=>text===DOCUMENT,{label:'marquee Undo'})
    assert.equal(await harness.read('marquee.svg'),DOCUMENT)
  }
}


export const marqueeModifierSpec={
  name:'canvas: Shift adds to marquee selection and Alt selects only fully enclosed shapes',
  async run({page,harness,assert}){
    await harness.write('marquee-modes.svg',DOCUMENT)
    await openWorkspaceFile(page,'marquee-modes.svg',{expect:'svg'})
    const overlay=page.getByLabel('Direct manipulation overlay')
    const rect=await overlay.boundingBox()
    assert.ok(rect&&rect.width>100&&rect.height>60)
    async function marquee(from,to,modifier) {
      const point=({x,y})=>({x:rect.x+x/200*rect.width,y:rect.y+y/120*rect.height})
      const a=point(from),b=point(to)
      await page.mouse.move(a.x,a.y)
      if(modifier)await page.keyboard.down(modifier)
      await page.mouse.down()
      await page.mouse.move(b.x,b.y,{steps:8})
      const mode=await page.locator('[data-marquee-selection]').getAttribute('data-marquee-mode')
      await page.mouse.up()
      if(modifier)await page.keyboard.up(modifier)
      return mode
    }
    assert.equal(await marquee({x:5,y:5},{x:60,y:55}), 'intersect')
    assert.equal(await page.getByRole('button',{name:/Select layer rect #second/}).getAttribute('aria-label'),
      'Select layer rect #second')
    assert.equal(await marquee({x:68,y:5},{x:115,y:55},'Shift'),'intersect-add')
    assert.equal(await page.getByRole('button',{name:/Select layer rect #second/}).getAttribute('aria-label'),
      'Select layer rect #second (in selection)')
    assert.equal(await marquee({x:18,y:10},{x:95,y:63},'Alt'),'contain')
    assert.equal(await page.getByRole('button',{name:/Select layer rect #second/}).getAttribute('aria-label'),
      'Select layer rect #second','Alt containment replaces the previous additive selection')
    await page.getByRole('button',{name:/Select layer rect #first/}).press('Escape')
    assert.equal(await page.getByRole('button',{name:/Select layer rect #first/}).getAttribute('aria-pressed'),
      'false','Escape clears the primary selection')
    assert.equal(await page.getByRole('button',{name:/Select layer rect #second/}).getAttribute('aria-pressed'),
      'false','Escape clears the rest of the selection')
    assert.equal(await harness.read('marquee-modes.svg'),DOCUMENT,
      'marquee modifiers and Escape remain local, with no Host write')
  }
}


export const canvasModifierClickSpec={
  name:'canvas: Shift-clicking a shape extends artboard selection without writing or starting a drag',
  async run({page,harness,assert}){
    await harness.write('click-select.svg',DOCUMENT)
    await openWorkspaceFile(page,'click-select.svg',{expect:'svg'})
    await page.getByRole('button',{name:'Drag rect first'}).click()
    await page.getByRole('button',{name:'Drag rect second'}).click({modifiers:['Shift']})
    assert.equal(await page.getByRole('button',{name:/Select layer rect #first/}).getAttribute('aria-label'),
      'Select layer rect #first (in selection)')
    assert.equal(await page.getByRole('button',{name:/Select layer rect #outside/}).getAttribute('aria-label'),
      'Select layer rect #outside')
    assert.equal(await harness.read('click-select.svg'),DOCUMENT,'modifier clicks never write')
    await page.getByRole('button',{name:/Select layer rect #second/}).press('Shift+ArrowRight')
    const changed=await waitForDisk(harness,'click-select.svg',
      t=>(t.match(/transform="matrix\\(1,0,0,1,10,0\\)"/g)||[]).length===2,
      {label:'modifier click selection nudge'})
    assert.equal((changed.match(/transform="matrix\\(1,0,0,1,10,0\\)"/g)||[]).length,2)
    await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
    await page.getByRole('button',{name:'Undo saved edit'}).click()
    await waitForDisk(harness,'click-select.svg',t=>t===DOCUMENT,{label:'modifier select Undo'})
    assert.equal(await harness.read('click-select.svg'),DOCUMENT)
  }
}
