import {openWorkspaceFile,waitForDisk} from './helpers.mjs'
const SOURCE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 100">'+
 '<rect id="a" x="10" y="10" width="20" height="20" fill="#aabbcc"/>'+
 '<rect id="b" x="50" y="10" width="20" height="20" fill="#ccddee"/>'+
 '</svg>'
export const multiNudgeSpec={
 name:'keyboard: selected SVG shapes move 10 visible units in one saved batch and one Undo',
 async run({page,harness,assert}){
   await harness.write('multi-nudge.svg',SOURCE)
   await openWorkspaceFile(page,'multi-nudge.svg',{expect:'svg'})
   await page.getByRole('button',{name:'Select layer rect #a'}).click()
   const second=page.getByRole('button',{name:/Select layer rect #b/})
   await second.click({modifiers:['Control']})
   await second.press('Shift+ArrowRight')
   const changed=await waitForDisk(harness,'multi-nudge.svg',text=>
     (text.match(/transform="matrix\(1,0,0,1,10,0\)"/g)||[]).length===2,
     {label:'multi-selection shift nudge'})
   assert.equal((changed.match(/transform="matrix\(1,0,0,1,10,0\)"/g)||[]).length,2)
   assert.ok(changed.includes('fill="#aabbcc"'),'native appearance untouched')
   await page.waitForFunction(()=>document.querySelector('[aria-label="Undo saved edit"]')?.disabled===false)
   await page.getByRole('button',{name:'Undo saved edit'}).click()
   await waitForDisk(harness,'multi-nudge.svg',text=>text===SOURCE,{label:'undo batch nudge'})
   assert.equal(await harness.read('multi-nudge.svg'),SOURCE)
 }
}
