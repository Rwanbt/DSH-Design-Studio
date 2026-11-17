/* Experimental native DSH client; browser UI is an editor, not an agent front-end. */
window.__ModuleLoader__.load({
  id: '@rwanbt/dsh-design-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const api = 'design-studio-native'
    const ACCENT='#bda991'
    const pane = { background:'var(--dsw-alias-surface-1,#202124)', color:'var(--dsw-alias-content-primary,#e8e7e2)', border:'1px solid var(--dsw-alias-border,#37383b)', borderRadius:8, padding:12 }
    const button = { cursor:'pointer', border:'1px solid #44464b', borderRadius:6, padding:'6px 10px', background:'#292b2f', color:'inherit' }
    const field = { width:'100%', boxSizing:'border-box', borderRadius:6, border:'1px solid #44464b', background:'var(--dsw-alias-surface-2,#27292d)', color:'inherit', padding:'6px 8px' }
    function safePreview(source, format, selectedHtmlId='', linkedCss='') {
      const policy = "default-src 'none'; script-src 'none'; object-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
      const svgLayout = format === 'svg' ? '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>' : ''
      const marked = /^(?:[A-Za-z][\w:.-]{0,79})$/.test(selectedHtmlId)?
        '<style>[id="'+selectedHtmlId+'"]{outline:2px solid #bda991!important;outline-offset:2px!important;}</style>':''
      // Linked CSS is a bounded, allowlisted *subset* prepared by the native
      // Host, never the original stylesheet bytes. No @rules, URLs or JS.
      const projected = ['html','htm'].includes(format) &&
        typeof linkedCss==='string' && linkedCss.length<=24576 &&
        !/[<>&]/.test(linkedCss) ?
          '<style data-dsh-preview-subset="partial">'+linkedCss+'</style>' : ''
      return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + policy +
        '"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        svgLayout + projected + marked + '</head><body style="margin:' +
        (format==='svg'?'0':'12px') + '">' + source + '</body></html>'
    }
    async function request(endpoint, options) {
      const response = await fetch(new URL('/' + api + endpoint, document.baseURI),{credentials:'same-origin',...options})
      const result = await response.json()
      if (!response.ok || !result.ok) {
        const failure=new Error(result.message || result.error || 'Request failed')
        failure.code=result.error
        failure.status=response.status
        throw failure
      }
      return result
    }
    function Studio(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      const [file,setFile] = React.useState('design.svg')
      const [workspaceFiles,setWorkspaceFiles] = React.useState([])
      const [filesTruncated,setFilesTruncated] = React.useState(false)
      const [showFiles,setShowFiles] = React.useState(false)
      const [fileSearch,setFileSearch] = React.useState('')
      const [doc,setDoc] = React.useState(null)
      const [source,setSource] = React.useState('')
      const [nodes,setNodes] = React.useState([])
      const [htmlElements,setHtmlElements] = React.useState([])
      const [htmlActive,setHtmlActive] = React.useState('')
      const previewContextRef=React.useRef(null)
      const previewBindingRef=React.useRef(null)
      const [htmlProperty,setHtmlProperty] = React.useState('background-color')
      const [htmlValue,setHtmlValue] = React.useState('')
      const [htmlStylesheets,setHtmlStylesheets] = React.useState([])
      const [htmlPreviewCss,setHtmlPreviewCss] = React.useState('')
      const [htmlPreviewCoverage,setHtmlPreviewCoverage] = React.useState(null)
      const [htmlViewport,setHtmlViewport] = React.useState('auto')
      const [mobilePanel,setMobilePanel] = React.useState('canvas')
      const [htmlStyleMatches,setHtmlStyleMatches] = React.useState([])
      const [returnHtmlRef,setReturnHtmlRef] = React.useState(null)
      const [cssRules,setCssRules] = React.useState([])
      const [cssActive,setCssActive] = React.useState('')
      const [cssProperty,setCssProperty] = React.useState('color')
      const [cssValue,setCssValue] = React.useState('')
      const [textNodes,setTextNodes] = React.useState([])
      const [editingText,setEditingText] = React.useState('')
      const [textDraft,setTextDraft] = React.useState('')
      const [active,setActive] = React.useState('')
      const [attribute,setAttribute] = React.useState('')
      const [value,setValue] = React.useState('')
      const [error,setError] = React.useState('')
      const [warning,setWarning] = React.useState('')
      const [busy,setBusy] = React.useState(false)
      const [reloadRequired,setReloadRequired]=React.useState(false)
      const [geometry,setGeometry] = React.useState({artboard:null,handles:[]})
      const [pathNodes,setPathNodes] = React.useState([])
      const [pathDrag,setPathDrag] = React.useState(null)
      const pathDragRef=React.useRef(null)
      const [dragDelta,setDragDelta] = React.useState(null)
      const dragRef=React.useRef(null)
      const panRef=React.useRef(null)
      const viewportRef=React.useRef(null)
      const [canvasTool,setCanvasTool]=React.useState('select')
      const [penPathId,setPenPathId]=React.useState('')
      const [penOutgoing,setPenOutgoing]=React.useState(null)
      const [penPreview,setPenPreview]=React.useState(null)
      const penGestureRef=React.useRef(null)
      const penPendingRef=React.useRef(false)
      const [spaceHeld,setSpaceHeld]=React.useState(false)
      const [camera,setCamera]=React.useState({zoom:1,offsetX:0,offsetY:0})
      const [gridVisible,setGridVisible]=React.useState(false)
      const [snapToGrid,setSnapToGrid]=React.useState(false)
      const [smartGuides,setSmartGuides]=React.useState(true)
      const [gridStep,setGridStep]=React.useState(10)
      const [undoStack,setUndoStack]=React.useState([])
      const [redoStack,setRedoStack]=React.useState([])
      function disconnectHtmlPreview() {
        const old=previewBindingRef.current
        previewBindingRef.current=null
        if(old) {
          try{old.frameDoc.removeEventListener('click',old.handler,true)}catch(_){}
        }
      }
      async function load(force=false, targetFile=file, retainSelection='', onLoaded=null) {
        if(!force && doc && source!==doc.source) {setError('Unsaved source changes: save or discard them before opening another file');return false}
        if(!sessionId) {setError('Open a conversation first');return false}
        setBusy(true);setError('')
        try {
          const url='/document?sessionId='+encodeURIComponent(sessionId)+'&file='+encodeURIComponent(targetFile)
          const data=await request(url)
          if(doc?.file!==targetFile) {
            setCamera({zoom:1,offsetX:0,offsetY:0})
            setCanvasTool('select')
            setPenPathId('');setPenOutgoing(null);setPenPreview(null)
            penGestureRef.current=null;penPendingRef.current=false
            panRef.current=null
          }
          disconnectHtmlPreview()
          setFile(targetFile)
          setDoc(data.document);setSource(data.document.source);setNodes(data.nodes||[])
          setHtmlElements(data.htmlElements||[])
          setHtmlStylesheets(data.stylesheets||[])
          setHtmlPreviewCss(data.previewCss||'')
          setHtmlPreviewCoverage(data.previewCoverage||null)
          setHtmlStyleMatches(data.styleMatches||[])
          setCssRules(data.cssRules||[])
          if(doc?.file!==targetFile){
            setHtmlActive('');setHtmlValue('')
            setCssActive('');setCssValue('')
          } else if(data.cssRules?.length && cssActive){
            const retained=data.cssRules.find(rule=>rule.selector===cssActive)
            setCssValue(retained?.declarations?.find(d=>d.property===cssProperty)?.value||'')
          }
          setReloadRequired(false)
          setTextNodes(data.textNodes||[]);setEditingText('')
          setTextDraft((data.textNodes||[]).find(item=>item.id===retainSelection)?.text||'')
          setGeometry(data.geometry||{artboard:null,handles:[]})
          setPathNodes(data.pathNodes||[])
          setPathDrag(null);pathDragRef.current=null
          setDragDelta(null);dragRef.current=null
          if(!force || (doc && doc.file!==targetFile)) {setUndoStack([]);setRedoStack([])}
          setWarning(data.warning||'')
          const remembered = (data.nodes||[]).find(node=>node.id===retainSelection)
          setActive(remembered?retainSelection:'')
          const retainedAttr=remembered && remembered.attributes[attribute]?attribute:Object.keys(remembered?.attributes||{})[0]||''
          setAttribute(retainedAttr);setValue(remembered && retainedAttr ? remembered.attributes[retainedAttr]: '')
          if(typeof onLoaded==='function')onLoaded(data)
          return true
        }catch(e){setError(String(e.message));return false}finally{setBusy(false)}
      }
      async function browseFiles() {
        if(showFiles){setShowFiles(false);return}
        if(!sessionId){setError('Open a conversation first');return}
        setBusy(true);setError('')
        try {
          const response=await request('/files?sessionId='+encodeURIComponent(sessionId))
          setWorkspaceFiles(response.files||[])
          setFilesTruncated(!!response.truncated)
          setFileSearch('')
          setShowFiles(true)
        }catch(e){setError(String(e.message))}finally{setBusy(false)}
      }
      async function openPickedFile(picked) {
        const opened=await load(false,picked)
        if(opened)setShowFiles(false)
      }
      async function save(payload, historyMode='record',onSaved=null) {
        if(!doc || busy)return false
        if(reloadRequired){setError('Document state uncertain. Reload the file before making further changes.');return false}
        if(payload.kind!=='replace-source' && source!==doc.source) {setError('Unsaved source changes: save or discard them first');return false}
        setBusy(true);setError('')
        try {
          const response=await request('/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,file:doc.file,baseHash:doc.hash,baseIdentity:doc.identity,...payload})})
          const reloaded=await load(true,doc.file,response.createdId||active)
          if(!reloaded) {
            setReloadRequired(true)
            setUndoStack([]);setRedoStack([])
            setError('The file may have been saved, but could not be reloaded. Reload before editing; history has been cleared.')
            return false
          }
          if(response.result?.changed) {
            if(historyMode==='record') {
              const entry={undo:response.result.inverse,redo:response.patches}
              // Avoid storing dozens of full-document copies in memory.
              const bytes=JSON.stringify(entry).length
              if(bytes<=2*1024*1024) setUndoStack(previous=>[...previous,entry].slice(-30))
              else setUndoStack([])
              setRedoStack([])
            }
          }
          if(typeof onSaved==='function')onSaved(response)
          return true
        }catch(e){
          const uncertain=!Number.isInteger(e.status) || e.status>=500 || e.status===409
          if(uncertain) {
            setReloadRequired(true)
            setUndoStack([]);setRedoStack([])
          }
          setError(String(e.message)+(uncertain?' · Reload the file before editing.':''))
          return false
        }finally{setBusy(false)}
      }
      async function layerAction(operation) {
        if(!active || busy || reloadRequired || !doc || doc.format!=='svg' || source!==doc.source)return false
        return save({kind:'svg-layer',id:active,operation})
      }
      async function undo() {
        if(busy || reloadRequired || source!==doc?.source || !undoStack.length)return
        const entry=undoStack[undoStack.length-1]
        if(await save({kind:'patches',patches:entry.undo},'replay')) {
          setUndoStack(previous=>previous.slice(0,-1))
          setRedoStack(previous=>[...previous,entry])
        }
      }
      async function redo() {
        if(busy || reloadRequired || source!==doc?.source || !redoStack.length)return
        const entry=redoStack[redoStack.length-1]
        if(await save({kind:'patches',patches:entry.redo},'replay')) {
          setRedoStack(previous=>previous.slice(0,-1))
          setUndoStack(previous=>[...previous,entry])
        }
      }
      function changeZoom(factor, anchor) {
        if(!artboard || !Number.isFinite(factor) || factor<=0)return
        const rect=viewportRef.current?.getBoundingClientRect?.()
        setCamera(previous=>{
          const next=Math.min(8,Math.max(0.125,previous.zoom*factor))
          const ratio=next/previous.zoom
          const relativeX=rect && anchor ? anchor.x-rect.left-rect.width/2 : 0
          const relativeY=rect && anchor ? anchor.y-rect.top-rect.height/2 : 0
          return {
            zoom:next,
            offsetX:previous.offsetX+(1-ratio)*(relativeX-previous.offsetX),
            offsetY:previous.offsetY+(1-ratio)*(relativeY-previous.offsetY),
          }
        })
      }
      function resetView() {
        const node=viewportRef.current
        const rect=node?.getBoundingClientRect?.()
        if(!rect || !artboard || rect.width<=0 || rect.height<=0) {
          setCamera({zoom:1,offsetX:0,offsetY:0});return
        }
        const fit=Math.min(1,Math.max(0.125,(rect.height-28)/(rect.width*artboard.height/artboard.width)))
        setCamera({zoom:fit,offsetX:0,offsetY:0})
      }
      function onCanvasWheel(event) {
        if(['textarea','input','select'].includes(String(event.target?.tagName||'').toLowerCase()))return
        event.preventDefault()
        if(event.ctrlKey || event.metaKey) {
          changeZoom(Math.exp(-event.deltaY*0.002),{x:event.clientX,y:event.clientY})
        } else {
          setCamera(previous=>({
            ...previous,
            offsetX:previous.offsetX-(event.shiftKey && !event.deltaX?event.deltaY:event.deltaX),
            offsetY:previous.offsetY-(event.shiftKey?0:event.deltaY),
          }))
        }
      }
      function startPan(event) {
        if(event.button!==1 && !((canvasTool==='hand'||spaceHeld) && event.button===0))return
        const rect=event.currentTarget.getBoundingClientRect()
        if(rect.width<=0 || rect.height<=0)return
        panRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY}
        try {event.currentTarget.setPointerCapture(event.pointerId)}catch(_){}
        event.preventDefault()
      }
      function movePan(event) {
        const gesture=panRef.current
        if(!gesture || gesture.pointerId!==event.pointerId)return
        const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY
        panRef.current={...gesture,startX:event.clientX,startY:event.clientY}
        setCamera(previous=>({...previous,offsetX:previous.offsetX+dx,offsetY:previous.offsetY+dy}))
      }
      function endPan(event) {
        if(panRef.current?.pointerId!==event.pointerId)return
        panRef.current=null
      }
      function onEditorKeyDown(event) {
        const tag=String(event.target?.tagName||'').toLowerCase()
        if(['input','textarea','select'].includes(tag)||event.target?.isContentEditable)return
        if(event.key==='Escape' && (dragRef.current || pathDragRef.current || penGestureRef.current)) {
          event.preventDefault()
          dragRef.current=null;pathDragRef.current=null
          penGestureRef.current=null;setPenPreview(null)
          setDragDelta(null);setPathDrag(null)
          return
        }
        const command=event.ctrlKey || event.metaKey
        if(!command && !event.altKey && (event.key===' ' || event.code==='Space')) {
          event.preventDefault()
          setSpaceHeld(true)
          return
        }
        if(!command && !event.altKey && !event.shiftKey && (event.key==='v' || event.key==='h' || event.key==='p')) {
          event.preventDefault()
          setCanvasTool(event.key==='h'?'hand':event.key==='p'?'pen':'select')
          if(event.key==='p'){setPenPathId('');setPenOutgoing(null)}
          return
        }
        if(!command && !event.altKey && artboard && ['+','=','-','0'].includes(event.key)) {
          event.preventDefault()
          if(event.key==='0')resetView()
          else changeZoom(event.key==='-'?1/1.25:1.25)
          return
        }
        if(command && !event.altKey) {
          if(event.key?.toLowerCase()==='z') {
            event.preventDefault()
            if(event.shiftKey)void redo();else void undo()
          }else if(event.key?.toLowerCase()==='y'){
            event.preventDefault();void redo()
          }else if(event.key?.toLowerCase()==='d' && active && doc?.format==='svg' && !busy){
            event.preventDefault();void layerAction('duplicate')
          }
          return
        }
        if(command || event.altKey || busy || reloadRequired || !active || !doc || source!==doc.source)return
        if((event.key==='Delete' || event.key==='Backspace') && doc.format==='svg') {
          event.preventDefault()
          void layerAction('delete')
          return
        }
        const direction={ArrowLeft:['x',-1],ArrowRight:['x',1],ArrowUp:['y',-1],ArrowDown:['y',1]}[event.key]
        if(!direction)return
        const item=geometry.handles.find(handle=>handle.id===active)
        if(!item || !item.move)return
        event.preventDefault()
        const [axis,sign]=direction
        const property=item.move[axis]
        const amount=sign*(event.shiftKey?10:1)
        const previous=item.move[axis==='x'?'initialX':'initialY']
        void save({kind:'svg-attribute',id:item.id,attribute:property,value:String(Math.round((previous+amount)*1000)/1000)})
      }
      function onEditorKeyUp(event) {
        if(event.key===' ' || event.code==='Space') setSpaceHeld(false)
      }
      function select(nodeId) {
        setActive(nodeId)
        setEditingText('')
        setTextDraft(textNodes.find(item=>item.id===nodeId)?.text||'')
        const node=nodes.find(n=>n.id===nodeId)
        const property=Object.keys(node?.attributes||{})[0]||''
        setAttribute(property);setValue(property ? node.attributes[property]:'')
      }
      const selected=nodes.find(n=>n.id===active)
      const selectedHtml=htmlElements.find(node=>node.id===htmlActive)
      const selectedHtmlRules=htmlStyleMatches.find(entry=>entry.id===htmlActive)?.matches||[]
      const selectedCss=cssRules.find(rule=>rule.selector===cssActive)
      const htmlProps=['color','background-color','display','width','height','padding','margin',
        'gap','font-size','border-radius','font-weight','text-align','grid-template-columns','grid-auto-flow','flex-direction',
        'justify-content','align-items','opacity']
      const layoutGroups=[
        {property:'display',label:'Conteneur',options:[['flex','Flex'],['grid','Grid'],['block','Block']]},
        {property:'flex-direction',label:'Direction · Flex',mode:'flex',
          options:[['row','→'],['column','↓'],['row-reverse','←'],['column-reverse','↑']]},
        {property:'justify-content',label:'Justification · Flex',mode:'flex',
          options:[['flex-start','Début'],['center','Centre'],['flex-end','Fin'],['space-between','Répartir']]},
        {property:'align-items',label:'Alignement · Flex',mode:'flex',
          options:[['stretch','Étirer'],['flex-start','Début'],['center','Centre'],['flex-end','Fin']]},
        {property:'grid-template-columns',label:'Colonnes · Grid',mode:'grid',
          options:[['1fr','1'],['repeat(2, minmax(0, 1fr))','2'],
            ['repeat(3, minmax(0, 1fr))','3'],['repeat(4, minmax(0, 1fr))','4']]},
        {property:'grid-auto-flow',label:'Flux · Grid',mode:'grid',
          options:[['row','Lignes'],['column','Colonnes']]},
        {property:'gap',label:'Espacement',mode:'layout',
          options:[['0px','0'],['8px','8'],['16px','16'],['24px','24'],['32px','32']]},
      ]
      function renderLayoutControls(format,item) {
        if(!item?.editable || !doc)return null
        const values={}
        if(format==='css') {
          for(const declaration of item.declarations||[])values[declaration.property]=declaration.value
        } else {
          for(const part of String(item.style||'').split(';')){
            const match=/^\s*([a-z-]+)\s*:\s*([^;]*)$/i.exec(part)
            if(match)values[match[1].toLowerCase()]=match[2].trim()
          }
        }
        const displayMode=values.display==='inline-flex'?'flex':values.display
        const editingBlocked=busy||reloadRequired||source!==doc.source
        return h('section',{className:'dsh-studio-layout-controls',
          'aria-label':'Visual layout controls',
          style:{display:'grid',gap:8,padding:10,marginTop:6,
            background:'#292b2f',border:'1px solid #474343',borderRadius:8}},
          h('strong',{style:{color:ACCENT}},'Disposition · Flex / Grid'),
          h('small',{style:{color:'#b6afa7'}},
            'Préréglages natifs, une propriété par action. CSS externe et cascade non calculés.'),
          layoutGroups.map(group=>{
            const requires=group.mode
            const compatible=!requires || (requires==='layout'
              ?displayMode==='flex'||displayMode==='grid'
              :displayMode===requires)
            if(!compatible && requires && requires!=='layout' && displayMode!=='flex' && displayMode!=='grid')return null
            const off=editingBlocked||!compatible
            return h('div',{key:group.property,style:{display:'grid',gap:5}},
              h('small',{style:{color:'#d6c7b2'}},group.label+
                (!compatible?' · choisir le mode correspondant':'')),
              h('div',{style:{display:'flex',flexWrap:'wrap',gap:5}},
                group.options.map(([value,label])=>
                  h('button',{key:value,type:'button',
                    'aria-label':'Set '+format+' layout '+group.property+' to '+value,
                    'aria-pressed':values[group.property]===value,
                    title:group.property+': '+value,
                    disabled:off,
                    style:{...button,minWidth:32,padding:'5px 8px',
                      background:values[group.property]===value?'#574939':button.background,
                      borderColor:values[group.property]===value?ACCENT:'#44464b'},
                    onClick:()=>void save(format==='css'
                      ?{kind:'css-rule',selector:item.selector,property:group.property,value}
                      :{kind:'html-style',id:item.id,property:group.property,value})
                  },label))
              )
            )
          })
        )
      }
      async function openLinkedCssRule(match) {
        if(!doc || !['html','htm'].includes(doc.format)||busy||reloadRequired||
           source!==doc.source || !match?.file || !match?.selector)return
        const back={file:doc.file,id:htmlActive}
        const ok=await load(false,match.file,'',data=>{
          const current=data.cssRules?.find(rule=>rule.selector===match.selector)
          if(!current) {
            setCssActive('');setCssValue('')
            setError('La règle CSS liée a changé ; réouvrez le HTML pour actualiser les correspondances.')
            return
          }
          setCssActive(match.selector)
          const first=current.declarations?.find(entry=>htmlProps.includes(entry.property))
          setCssProperty(first?.property||'color')
          setCssValue(first?.value||'')
        })
        if(ok)setReturnHtmlRef(back)
      }
      async function returnToHtml() {
        if(!returnHtmlRef || busy || reloadRequired || source!==doc?.source)return
        const back=returnHtmlRef
        if(await load(false,back.file)) {
          setHtmlActive(back.id)
          setReturnHtmlRef(null)
        }
      }
      function chooseCssRule(selector) {
        setCssActive(selector)
        const rule=cssRules.find(item=>item.selector===selector)
        setCssValue(rule?.declarations?.find(item=>item.property===cssProperty)?.value||'')
      }
      function chooseCssProperty(property) {
        setCssProperty(property)
        const rule=cssRules.find(item=>item.selector===cssActive)
        setCssValue(rule?.declarations?.find(item=>item.property===property)?.value||'')
      }
      function chooseHtmlElement(id) {
        setHtmlActive(id)
        const item=htmlElements.find(node=>node.id===id)
        const current=new RegExp('(?:^|;)\\s*'+htmlProperty+'\\s*:\\s*([^;]*)','i')
        setHtmlValue(current.exec(item?.style||'')?.[1]?.trim()||'')
      }
      function chooseHtmlProperty(property) {
        setHtmlProperty(property)
        const item=htmlElements.find(node=>node.id===htmlActive)
        const escaped=property
        const current=new RegExp('(?:^|;)\\s*'+escaped+'\\s*:\\s*([^;]*)','i')
        setHtmlValue(current.exec(item?.style||'')?.[1]?.trim()||'')
      }
      // An HTML document is sandboxed with scripts disabled. The trusted
      // *parent* reads its inert DOM and installs the selection event handler;
      // no script or postMessage bridge is injected into untrusted HTML.
      previewContextRef.current={
        file:doc?.file,identity:doc?.identity,sessionId,
        htmlElements,validSource:source===doc?.source,busy,reloadRequired,
        choose:chooseHtmlElement
      }
      function connectHtmlPreview(event) {
        disconnectHtmlPreview()
        if(!doc || !['html','htm'].includes(doc.format))return
        const frame=event?.currentTarget
        let frameDoc
        try{frameDoc=frame?.contentDocument}catch(_){return}
        // Do not attach to a navigated iframe or any cross-origin content.
        if(!frameDoc || frameDoc.URL!=='about:srcdoc' ||
            typeof frameDoc.addEventListener!=='function')return
        const expectedFile=doc.file,expectedIdentity=doc.identity,expectedSession=sessionId
        const handler=event=>{
          // Neutralize hyperlinks, form controls and navigations in the preview.
          event.preventDefault()
          // Browser-generated clicks (mouse/touch/keyboard) are trusted. If
          // scripts ever become possible here, synthetic DOM events are ignored.
          if(event.isTrusted===false)return
          const context=previewContextRef.current
          if(!context || context.file!==expectedFile ||
             context.identity!==expectedIdentity ||
             context.sessionId!==expectedSession ||
             !context.validSource || context.busy || context.reloadRequired)return
          const target=event.target
          if(!target || typeof target.closest!=='function')return
          const element=target.closest('[id]')
          if(!element || !frameDoc.documentElement?.contains(element))return
          const id=element.getAttribute?.('id')
          if(typeof id!=='string'||!(/^[A-Za-z][A-Za-z0-9_:.-]{0,79}$/).test(id))return
          const models=context.htmlElements.filter(item=>item.id===id)
          if(models.length!==1 || !models[0].editable ||
             models[0].tag!==String(element.tagName||'').toLowerCase())return
          // The browser's parsed DOM and the source scanner must agree:
          // malformed HTML could otherwise hide a second matching id.
          let domMatches=0
          try {
            for(const node of frameDoc.querySelectorAll('[id]')) {
              if(node.getAttribute('id')===id)domMatches++
              if(domMatches>1)break
            }
          }catch(_){return}
          if(domMatches!==1)return
          context.choose(id)
        }
        frameDoc.addEventListener('click',handler,true)
        previewBindingRef.current={frameDoc,handler}
      }
      const selectedText=textNodes.find(node=>node.id===active)
      const selectedPath=pathNodes.find(node=>node.id===active)
      function startTextEditing(nodeId) {
        const node=textNodes.find(item=>item.id===nodeId)
        if(!node || !node.editable) {setError('Complex SVG text cannot be edited visually without risking its source');return}
        if(busy || source!==doc?.source) {setError('Save or discard current source changes first');return}
        select(nodeId)
        setTextDraft(node.text);setEditingText(nodeId)
      }
      async function commitText() {
        const id=editingText||active
        const node=textNodes.find(item=>item.id===id)
        if(!node || !node.editable)return false
        if(textDraft===node.text) {setEditingText('');return true}
        const ok=await save({kind:'svg-text',id,value:textDraft})
        if(ok)setEditingText('')
        return ok
      }
      const {artboard,handles=[]}=geometry
      function previewPoint(point) {
        if(pathDrag?.id===active && pathDrag.index===point.index) {
          return {...point,x:pathDrag.x,y:pathDrag.y}
        }
        return point
      }
      function previewPathData(path) {
        if(!path || !pathDrag || pathDrag.id!==path.id)return path?.d||''
        const point=path.points[pathDrag.index]
        if(!point)return path.d
        const updates=[
          {start:point.xSpan.start,end:point.xSpan.end,after:String(Math.round(pathDrag.x*1000)/1000)},
          {start:point.ySpan.start,end:point.ySpan.end,after:String(Math.round(pathDrag.y*1000)/1000)}
        ].sort((a,b)=>b.start-a.start)
        let d=path.d
        for(const edit of updates)d=d.slice(0,edit.start)+edit.after+d.slice(edit.end)
        return d
      }
      function startPathDrag(event,point) {
        if(event.button!==0 || canvasTool!=='select' || spaceHeld || busy || reloadRequired ||
          !selectedPath?.editable || source!==doc?.source || !artboard)return
        const rect=event.currentTarget.parentElement.getBoundingClientRect()
        if(!rect.width||!rect.height)return
        pathDragRef.current={id:selectedPath.id,index:point.index,pointerId:event.pointerId,
          x:point.x,y:point.y,startX:event.clientX,startY:event.clientY,
          width:rect.width,height:rect.height}
        setPathDrag(null)
        try{event.currentTarget.setPointerCapture(event.pointerId)}catch(_){}
        event.stopPropagation();event.preventDefault()
      }
      function pathPosition(event,gesture) {
        const movementX=event.clientX-gesture.startX
        const movementY=event.clientY-gesture.startY
        let x=gesture.x+movementX*artboard.width/gesture.width
        let y=gesture.y+movementY*artboard.height/gesture.height
        if(snapToGrid && !event.altKey && gridStep>0) {
          // A horizontal gesture must not jump a non-grid-aligned Y coordinate.
          if(Math.abs(movementX)>0.001)x=snapAxis(x,artboard.x,gridStep)
          if(Math.abs(movementY)>0.001)y=snapAxis(y,artboard.y,gridStep)
        }
        return {id:gesture.id,index:gesture.index,x,y}
      }
      function movePathDrag(event) {
        const gesture=pathDragRef.current
        if(!gesture || gesture.pointerId!==event.pointerId || !artboard)return
        setPathDrag(pathPosition(event,gesture))
      }
      function finishPathDrag(event,cancel=false) {
        const gesture=pathDragRef.current
        if(!gesture || gesture.pointerId!==event.pointerId)return
        pathDragRef.current=null
        setPathDrag(null)
        if(cancel || busy || reloadRequired || !artboard)return
        if(Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<3)return
        const next=pathPosition(event,gesture)
        if(next.x===gesture.x && next.y===gesture.y)return
        void save({kind:'svg-path-point',...next})
      }
      function positionInArtboard(event,target) {
        const rect=target.getBoundingClientRect()
        if(!rect || rect.width<=0 || rect.height<=0 || !artboard)return null
        const nx=(event.clientX-rect.left)/rect.width
        const ny=(event.clientY-rect.top)/rect.height
        if(!Number.isFinite(nx)||!Number.isFinite(ny)||nx<0||nx>1||ny<0||ny>1)return null
        let x=artboard.x+nx*artboard.width,y=artboard.y+ny*artboard.height
        if(snapToGrid&&!event.altKey&&gridStep>0) {
          x=snapAxis(x,artboard.x,gridStep);y=snapAxis(y,artboard.y,gridStep)
        }
        return {x:Math.round(x*1000)/1000,y:Math.round(y*1000)/1000}
      }
      function startPenGesture(event) {
        if(event.button!==0 || canvasTool!=='pen'||spaceHeld||penPendingRef.current||
          busy||reloadRequired||source!==doc?.source||!artboard)return
        const point=positionInArtboard(event,event.currentTarget)
        if(!point)return
        penGestureRef.current={pointerId:event.pointerId,point,startX:event.clientX,startY:event.clientY,
          left:event.currentTarget.getBoundingClientRect().left}
        setPenPreview({anchor:point,control:null})
        try{event.currentTarget.setPointerCapture(event.pointerId)}catch(_){}
        event.preventDefault();event.stopPropagation()
      }
      function movePenGesture(event) {
        const gesture=penGestureRef.current
        if(!gesture||gesture.pointerId!==event.pointerId)return
        const delta={x:(event.clientX-gesture.startX)*artboard.width/event.currentTarget.getBoundingClientRect().width,
          y:(event.clientY-gesture.startY)*artboard.height/event.currentTarget.getBoundingClientRect().height}
        setPenPreview({anchor:gesture.point,control:{x:gesture.point.x+delta.x,y:gesture.point.y+delta.y}})
      }
      async function finishPenGesture(event,cancel=false) {
        const gesture=penGestureRef.current
        if(!gesture||gesture.pointerId!==event.pointerId)return
        penGestureRef.current=null;setPenPreview(null)
        if(cancel||penPendingRef.current||busy||reloadRequired||source!==doc?.source)return
        const magnitude=Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)
        const rect=event.currentTarget.getBoundingClientRect()
        if(!rect?.width||!rect?.height)return
        const tangent=magnitude>=4?{
          x:(event.clientX-gesture.startX)*artboard.width/rect.width,
          y:(event.clientY-gesture.startY)*artboard.height/rect.height,
        }:null
        const point=gesture.point
        const current=pathNodes.find(p=>p.id===penPathId && p.editable)
        const anchors=current?.points?.filter(p=>p.role==='anchor')||[]
        // The initial gesture creates M only; all later gestures extend that path.
        let request
        if(!penPathId)request={kind:'svg-pen',operation:'start',x:point.x,y:point.y}
        else if(current&&anchors.length) {
          const prev=anchors.at(-1)
          const dx=point.x-prev.x,dy=point.y-prev.y
          if(Math.hypot(dx,dy)<1e-4)return
          request={kind:'svg-pen',operation:'append',id:penPathId,x:point.x,y:point.y}
          if(tangent||penOutgoing) {
            const c1=penOutgoing?
              {x:prev.x+penOutgoing.x,y:prev.y+penOutgoing.y}:
              {x:prev.x+dx/3,y:prev.y+dy/3}
            const c2=tangent?
              {x:point.x-tangent.x,y:point.y-tangent.y}:
              {x:point.x-dx/3,y:point.y-dy/3}
            request.c1=c1;request.c2=c2
          }
        }else {
          setError('Tracé Plume non disponible : sélectionner Nouvelle Plume pour recommencer.')
          return
        }
        penPendingRef.current=true
        try {
          const saved=await save(request,'record',response=>{
            if(response.createdId)setPenPathId(response.createdId)
          })
          if(saved)setPenOutgoing(tangent)
        }finally{penPendingRef.current=false}
      }
      async function closePenPath() {
        if(!penPathId||penPendingRef.current||busy||reloadRequired)return
        penPendingRef.current=true
        try {
          const saved=await save({kind:'svg-pen',operation:'close',id:penPathId})
          if(saved){setPenPathId('');setPenOutgoing(null)}
        }finally{penPendingRef.current=false}
      }
      function snapAxis(value, origin, step) {
        if (!Number.isFinite(value) || !Number.isFinite(origin) || !Number.isFinite(step) || step<=0) return value
        return origin+Math.round((value-origin)/step)*step
      }
      function snapDrag(drag,dx,dy,shiftKey=false,bypass=false) {
        if(!artboard || !drag || bypass) return {dx,dy,guideX:null,guideY:null}
        const handle=drag.handle
        const resize=drag.mode==='resize'
        const corner=drag.corner||'se'
        let deltaX=dx,deltaY=dy,guideX=null,guideY=null
        if(snapToGrid && Number.isFinite(gridStep) && gridStep>0) {
          if(resize) {
            const baseX=corner.includes('w')?handle.x:handle.x+handle.width
            const baseY=corner.includes('n')?handle.y:handle.y+handle.height
            deltaX=snapAxis(baseX+dx,artboard.x,gridStep)-baseX
            deltaY=snapAxis(baseY+dy,artboard.y,gridStep)-baseY
          }else{
            deltaX=snapAxis(handle.move.initialX+dx,artboard.x,gridStep)-handle.move.initialX
            deltaY=snapAxis(handle.move.initialY+dy,artboard.y,gridStep)-handle.move.initialY
          }
        }
        // In the first alignment milestone, smart guides cover untransformed
        // moves only; aspect-locked resizing remains explicit and deterministic.
        if(smartGuides && !resize && !shiftKey) {
          const toleranceX=6*artboard.width/drag.width
          const toleranceY=6*artboard.height/drag.height
          const xTargets=[artboard.x,artboard.x+artboard.width/2,artboard.x+artboard.width]
          const yTargets=[artboard.y,artboard.y+artboard.height/2,artboard.y+artboard.height]
          for(const other of handles) {
            if(other.id===handle.id) continue
            if(![other.x,other.y,other.width,other.height].every(Number.isFinite))continue
            xTargets.push(other.x,other.x+other.width/2,other.x+other.width)
            yTargets.push(other.y,other.y+other.height/2,other.y+other.height)
          }
          const pointsX=[handle.x,handle.x+handle.width/2,handle.x+handle.width]
          const pointsY=[handle.y,handle.y+handle.height/2,handle.y+handle.height]
          let bestX=toleranceX,bestY=toleranceY,correctionX=0,correctionY=0
          for(const point of pointsX)for(const target of xTargets) {
            const distance=target-(point+deltaX)
            if(Math.abs(distance)<bestX) {bestX=Math.abs(distance);guideX=target;correctionX=distance}
          }
          for(const point of pointsY)for(const target of yTargets) {
            const distance=target-(point+deltaY)
            if(Math.abs(distance)<bestY) {bestY=Math.abs(distance);guideY=target;correctionY=distance}
          }
          deltaX+=correctionX
          deltaY+=correctionY
        }
        return {dx:deltaX,dy:deltaY,guideX,guideY}
      }
      function startDrag(event,handle,mode='move') {
        if(event.button!==0 || busy || reloadRequired || canvasTool!=='select' || spaceHeld) return
        if(!doc || source!==doc.source) {setError('Save or discard source changes before dragging');return}
        const rect=event.currentTarget.parentElement.getBoundingClientRect()
        if(rect.width<=0 || rect.height<=0) return
        select(handle.id);setError('')
        dragRef.current={id:handle.id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,width:rect.width,height:rect.height,handle,mode,corner:mode==='resize'?(event.currentTarget?.dataset?.corner||'se'):null}
        setDragDelta(null)
        try {event.currentTarget.setPointerCapture(event.pointerId)} catch (_) {}
        event.preventDefault()
      }
      function moveDrag(event) {
        const drag=dragRef.current
        if(!drag || drag.pointerId!==event.pointerId || !artboard) return
        const dx=(event.clientX-drag.startX)*artboard.width/drag.width
        const dy=(event.clientY-drag.startY)*artboard.height/drag.height
        const snapped=snapDrag(drag,dx,dy,!!event.shiftKey,!!event.altKey)
        setDragDelta({id:drag.id,...snapped,mode:drag.mode,corner:drag.corner,lockAspect:!!event.shiftKey})
      }
      function finishDrag(event,cancel=false) {
        const drag=dragRef.current
        if(!drag || drag.pointerId!==event.pointerId) return
        dragRef.current=null
        setDragDelta(null)
        if(cancel || !artboard || busy) return
        const unsnappedX=(event.clientX-drag.startX)*artboard.width/drag.width
        const unsnappedY=(event.clientY-drag.startY)*artboard.height/drag.height
        const {dx,dy}=snapDrag(drag,unsnappedX,unsnappedY,!!event.shiftKey,!!event.altKey)
        const pixelMovement=Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)
        if(pixelMovement<3) return
        const number=value=>String(Math.round(value*1000)/1000)
        const item=drag.handle
        let edits
        if(drag.mode==='resize' && item.resizable) {
          const corner=drag.corner||'se'
          const leftSide=corner.includes('w'),topSide=corner.includes('n')
          let w=Math.max(1,item.width+(leftSide?-dx:dx))
          let height=Math.max(1,item.height+(topSide?-dy:dy))
          if(event.shiftKey) {
            const ratioX=w/item.width,ratioY=height/item.height
            const scale=Math.max(1/item.width,1/item.height,
              Math.abs(ratioX-1)>=Math.abs(ratioY-1)?ratioX:ratioY)
            w=item.width*scale;height=item.height*scale
          }
          const x=leftSide?item.x+item.width-w:item.x
          const y=topSide?item.y+item.height-height:item.y
          edits=item.tag==='rect'?
            [{id:item.id,attribute:'x',value:number(x)},{id:item.id,attribute:'y',value:number(y)},
             {id:item.id,attribute:'width',value:number(w)},{id:item.id,attribute:'height',value:number(height)}]:
            [{id:item.id,attribute:'cx',value:number(x+w/2)},{id:item.id,attribute:'cy',value:number(y+height/2)},
             {id:item.id,attribute:'rx',value:number(w/2)},{id:item.id,attribute:'ry',value:number(height/2)}]
        }else{
          edits=[
            {id:drag.id,attribute:item.move.x,value:number(item.move.initialX+dx)},
            {id:drag.id,attribute:item.move.y,value:number(item.move.initialY+dy)}
          ]
        }
        void save({kind:'svg-attributes',edits})
      }
      return h('section',{className:'dsh-studio-workbench',onKeyDown:onEditorKeyDown,onKeyUp:onEditorKeyUp,style:{...pane,height:'min(87vh,920px)',overflow:'hidden',display:'flex',flexDirection:'column',gap:0,padding:0,fontFamily:'system-ui,sans-serif',fontSize:12}},
        h('style',null,[
          '.dsh-studio-workbench *{box-sizing:border-box}',
          '.dsh-studio-workbench input:focus-visible,.dsh-studio-workbench textarea:focus-visible,.dsh-studio-workbench button:focus-visible{outline:2px solid #bca58c;outline-offset:1px}',
          '.dsh-studio-workbench button:not(:disabled):hover{filter:brightness(1.12)}',
          '.dsh-studio-layout{min-height:0;flex:1;overflow:auto}',
          '.dsh-studio-canvas{background-color:#191a1d;background-image:radial-gradient(#4a4a4a44 .8px,transparent .8px);background-size:18px 18px}',
          '.dsh-studio-workbench{container-type:inline-size}',
          '.dsh-studio-mobile-tabs{display:none}',
          '@container(max-width:1080px){.dsh-studio-layout{grid-template-columns:170px minmax(230px,1fr) 230px!important}}',
          '@container(max-width:750px){.dsh-studio-mobile-tabs{display:flex!important;gap:6px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid #414141;background:#232529}.dsh-studio-layout{grid-template-columns:minmax(0,1fr)!important;min-height:0}.dsh-studio-layout>.dsh-studio-sidebar:not(.dsh-studio-mobile-active),.dsh-studio-layout>.dsh-studio-canvas:not(.dsh-studio-mobile-active),.dsh-studio-layout>.dsh-studio-inspector:not(.dsh-studio-mobile-active){display:none!important}.dsh-studio-sidebar,.dsh-studio-inspector{max-height:none;min-height:300px}.dsh-studio-canvas{min-width:0;min-height:300px}}'
        ].join('')),
        h('header',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'9px 14px',borderBottom:'1px solid #3a3b3e',background:'#1e2023',minHeight:46}},
          h('strong',{style:{fontSize:14,letterSpacing:'.01em'}},'DSH · Design Studio'),
          h('span',{style:{fontSize:11,opacity:0.7}},'Édition native · sans IA'),
          h('button',{style:button,disabled:busy||reloadRequired||!undoStack.length||source!==doc?.source,onClick:()=>void undo(),'aria-label':'Undo saved edit'},'↶ Undo'),
          h('button',{style:button,disabled:busy||reloadRequired||!redoStack.length||source!==doc?.source,onClick:()=>void redo(),'aria-label':'Redo saved edit'},'↷ Redo')),
        h('div',{style:{display:'flex',gap:8,padding:'9px 12px',borderBottom:'1px solid #35373b',background:'#232529'}},
          h('input',{style:{...field,flex:1,maxWidth:460},'aria-label':'Workspace file',value:file,onChange:e=>setFile(e.target.value),placeholder:'relative/path/file.svg'}),
          h('button',{style:button,onClick:()=>load(false),disabled:busy||!sessionId},busy?'Loading…':'Open'),
          h('button',{style:button,onClick:()=>void browseFiles(),disabled:busy||!sessionId,
            'aria-label':'Browse workspace design files'},showFiles?'Fermer les fichiers':'Parcourir…')),
        showFiles&&h('div',{className:'dsh-studio-file-picker',style:{
          padding:'10px 14px',background:'#26282b',borderBottom:'1px solid #47484a',
          maxHeight:225,overflow:'auto',display:'flex',flexDirection:'column',gap:8
        }},
          h('div',{style:{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'}},
            h('strong',null,'Fichiers du workspace'),
            h('small',{style:{color:'#aaa9a5'}},workspaceFiles.length+' fichier(s)'+(filesTruncated?' · liste limitée':''))),
          h('input',{style:field,value:fileSearch,'aria-label':'Filter design files',
            placeholder:'Rechercher : nom, dossier, extension…',
            onChange:e=>setFileSearch(e.target.value)}),
          h('div',{role:'list',style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:4}},
            ...workspaceFiles.filter(item=>item.path.toLocaleLowerCase().includes(fileSearch.toLocaleLowerCase())).slice(0,100).map(item=>
              h('button',{key:item.path,style:{...button,textAlign:'left',overflowWrap:'anywhere'},
                'aria-label':'Open file '+item.path,disabled:busy,
                title:item.path+' · '+item.size+' bytes',
                onClick:()=>void openPickedFile(item.path)},
                h('span',{style:{color:ACCENT,marginRight:8,fontWeight:650}},item.format.toUpperCase()),
                item.path))),
          workspaceFiles.length===0&&h('small',{style:{color:'#aaa9a5'}},'Aucun fichier SVG, HTML ou CSS détecté.')
        ),
        doc?.format==='svg'&&h('nav',{style:{display:'flex',gap:7,flexWrap:'wrap',padding:'7px 12px',borderBottom:'1px solid #37383b',background:'#222427'},'aria-label':'SVG creation tools'},
          h('button',{type:'button',
            'aria-label':'Activate Pen tool',
            style:{...button,background:canvasTool==='pen'?'#51483d':button.background},
            disabled:busy||reloadRequired||source!==doc.source,
            onClick:()=>{setCanvasTool('pen');setPenPathId('');setPenOutgoing(null)}
          },'✒ Plume · P'),
          canvasTool==='pen'&&h('button',{type:'button',
            'aria-label':'Start new pen path',
            style:button,disabled:busy||reloadRequired,
            onClick:()=>{setPenPathId('');setPenOutgoing(null)}
          },'Nouveau'),
          canvasTool==='pen'&&penPathId&&h('button',{type:'button',
            'aria-label':'Close current pen path',style:{...button,borderColor:ACCENT},
            disabled:busy||reloadRequired||
              (pathNodes.find(path=>path.id===penPathId)?.points?.filter(p=>p.role==='anchor').length||0)<3,
            onClick:()=>void closePenPath()
          },'Fermer le tracé'),
          ['rect','circle','ellipse','text','path'].map(shape=>h('button',{
            key:shape,type:'button',style:button,'aria-label':'Add '+shape,
            disabled:busy||reloadRequired||source!==doc.source,
            onClick:()=>void save({kind:'svg-add-shape',shape})
          },'＋ '+(shape==='rect'?'Rectangle':shape==='circle'?'Circle':shape==='ellipse'?'Ellipse':shape==='text'?'Text':'Tracé')))),
        error&&h('div',{role:'alert',style:{color:'#ff8585',padding:'8px 12px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}},
          h('span',null,error),
          reloadRequired&&h('button',{type:'button',style:button,'aria-label':'Reload after save error',
            disabled:busy,onClick:()=>void load(true,doc?.file||file)},'Recharger le fichier')),
        warning&&h('div',{role:'status',style:{color:'#f5c36a'}},warning),
        doc&&h('nav',{className:'dsh-studio-mobile-tabs',role:'tablist',
          'aria-label':'Mobile editor panels'},
          [['layers','Calques'],['canvas','Canevas'],['inspector','Propriétés']].map(([tab,label])=>
            h('button',{key:tab,type:'button',role:'tab',
              'aria-label':'Mobile panel '+tab,'aria-selected':mobilePanel===tab,
              style:{...button,background:mobilePanel===tab?'#574939':button.background,
                borderColor:mobilePanel===tab?ACCENT:'#44464b'},
              onClick:()=>setMobilePanel(tab)},label))),
        doc&&h('div',{className:'dsh-studio-layout',style:{display:'grid',gridTemplateColumns:'220px minmax(330px,1fr) 280px',gap:0,minHeight:390}},
          h('aside',{className:'dsh-studio-sidebar'+(mobilePanel==='layers'?' dsh-studio-mobile-active':''),style:{...pane,overflow:'auto',borderRadius:0,borderWidth:'0 1px 0 0',background:'#232529'}},
            h('strong',null,doc.format==='html'||doc.format==='htm'?'Éléments HTML':doc.format==='css'?'Règles CSS':'Calques'),
            h('div',{style:{display:'flex',flexDirection:'column',gap:4,marginTop:12}},
              doc.format==='css'?
                (cssRules.length?cssRules.map(rule=>h('button',{
                  key:rule.selector,type:'button','aria-label':'Select CSS rule '+rule.selector,
                  style:{...button,textAlign:'left',background:cssActive===rule.selector?'#494034':'transparent'},
                  onClick:()=>chooseCssRule(rule.selector)},
                  rule.selector+(rule.editable?'':' · lecture seule'))):
                  h('small',null,'Règles simples #id ou .classe uniquement.')):
              (doc.format==='html'||doc.format==='htm')?
                (htmlElements.length?htmlElements.map(n=>h('button',{key:n.id,type:'button',
                  'aria-label':'Select HTML element '+n.id,
                  style:{...button,textAlign:'left',background:htmlActive===n.id?'#494034':'transparent'},
                  onClick:()=>chooseHtmlElement(n.id)},n.tag+' #'+n.id+(n.editable?'':' · lecture seule'))):
                  h('small',null,'HTML visuel : ajoutez des id uniques aux éléments à éditer.')):
                (nodes.length?nodes.map(n=>h('button',{key:n.id,
                  style:{...button,textAlign:'left',background:active===n.id?'#494034':'transparent'},
                  onClick:()=>select(n.id)},n.tag+' #'+n.id)):
                  h('small',null,'No addressable SVG nodes (unique id attributes required).')))),
          h('div',{className:'dsh-studio-canvas'+(mobilePanel==='canvas'?' dsh-studio-mobile-active':''),style:{...pane,overflow:'auto',border:0,borderRadius:0,padding:18,display:'flex',flexDirection:'column',justifyContent:'center'}},
            h('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:12}},
              h('strong',null,'Canevas · '+doc.format.toUpperCase()),
              artboard&&doc.format==='svg'&&h('div',{role:'toolbar','aria-label':'Canvas navigation',style:{display:'flex',gap:5,alignItems:'center'}},
                h('button',{type:'button',style:{...button,background:canvasTool==='select'?'#51483d':button.background},
                  'aria-label':'Select canvas tool',onClick:()=>setCanvasTool('select'),title:'Sélection · V'},'↖'),
                h('button',{type:'button',style:{...button,background:canvasTool==='hand'?'#51483d':button.background},
                  'aria-label':'Pan canvas tool',onClick:()=>setCanvasTool('hand'),title:'Main · H / clic milieu'},'✋'),
                h('button',{type:'button',style:button,'aria-label':'Zoom out canvas',
                  onClick:()=>changeZoom(1/1.25)},'−'),
                h('output',{'aria-label':'Canvas zoom level',style:{fontVariantNumeric:'tabular-nums',minWidth:48,textAlign:'center',color:ACCENT}},
                  Math.round(camera.zoom*100)+'%'),
                h('button',{type:'button',style:button,'aria-label':'Zoom in canvas',
                  onClick:()=>changeZoom(1.25)},'+'),
                h('button',{type:'button',style:button,'aria-label':'Fit canvas view',
                  onClick:resetView,title:'Recentrer / adapter au canevas · 0'},'Fit'),
                h('span',{style:{width:1,height:20,background:'#47484b',margin:'0 3px'}}),
                h('button',{type:'button',style:{...button,background:gridVisible?'#51483d':button.background},
                  'aria-label':'Toggle canvas grid','aria-pressed':gridVisible,
                  onClick:()=>setGridVisible(v=>!v)},'Grille'),
                h('button',{type:'button',style:{...button,background:snapToGrid?'#51483d':button.background},
                  'aria-label':'Toggle snap to grid','aria-pressed':snapToGrid,
                  onClick:()=>setSnapToGrid(v=>!v),title:'Magnétisme sur la grille · Alt désactive temporairement'},'Aimant'),
                h('select',{style:{...field,width:68,padding:'5px 6px'},'aria-label':'Grid spacing',
                  value:gridStep,onChange:e=>setGridStep(Number(e.target.value)),
                  title:'Pas de grille en unités SVG'},
                  [2,5,8,10,16,20,25,32,50,64,100].map(step=>h('option',{key:step,value:step},step+' u'))),
                h('button',{type:'button',style:{...button,background:smartGuides?'#51483d':button.background},
                  'aria-label':'Toggle smart alignment guides','aria-pressed':smartGuides,
                  onClick:()=>setSmartGuides(v=>!v),title:'Aligner automatiquement les bords et centres · Alt désactive temporairement'},'Repères')
              )),

            doc.format==='css'?
                  h('div',{className:'dsh-studio-css-rule-preview',
                    style:{background:'#24262a',border:'1px solid #414142',borderRadius:8,
                      padding:18,minHeight:240,display:'grid',alignContent:'start',gap:12}},
                    h('strong',{style:{color:ACCENT}},selectedCss?.selector||'Feuille de style native'),
                    h('small',{style:{color:'#bbb9b4'}},
                      'Sélectionne une règle simple à gauche. Les changements ciblent le fichier .css ouvert.'),
                    selectedCss?.declarations?.map(declaration=>h('div',{key:declaration.property,
                      style:{display:'flex',gap:8,justifyContent:'space-between'}},
                      h('code',{style:{color:'#ccc'}},declaration.property),
                      h('code',{style:{color:'#e8cdb1'}},declaration.value))
                    )
                  ):
              artboard && doc.format==='svg'?
                h('div',{className:'dsh-studio-viewport',ref:viewportRef,
                  'aria-label':'Canvas viewport',
                  onWheel:onCanvasWheel,
                  onPointerDown:startPan,
                  onPointerMove:movePan,
                  onPointerUp:endPan,
                  onPointerCancel:endPan,
                  style:{position:'relative',width:'100%',height:'100%',minHeight:340,flex:'1 1 auto',
                    overflow:'hidden',touchAction:'none',borderRadius:6,
                    cursor:panRef.current?'grabbing':canvasTool==='pen'?'crosshair':canvasTool==='hand'||spaceHeld?'grab':'default',
                    background:'transparent'}},
                  h('div',{className:'dsh-studio-artboard',
                    style:{position:'absolute',left:'50%',top:'50%',width:'100%',
                      aspectRatio:artboard.width+' / '+artboard.height,background:'#fff',
                      transform:'translate(-50%, -50%) translate('+camera.offsetX+'px, '+camera.offsetY+'px) scale('+camera.zoom+')',
                      transformOrigin:'center center',
                      boxShadow:'0 10px 42px #0009'}},
                  h('iframe',{title:'Isolated SVG preview',sandbox:'',referrerPolicy:'no-referrer',srcDoc:safePreview(source,'svg'),style:{width:'100%',height:'100%',position:'absolute',inset:0,border:'none',pointerEvents:'none'}}),
                  gridVisible&&h('div',{className:'dsh-studio-document-grid','aria-hidden':true,style:{
                    position:'absolute',inset:0,pointerEvents:'none',zIndex:1,
                    backgroundImage:'linear-gradient(to right, #927f6670 1px, transparent 1px), linear-gradient(to bottom, #927f6670 1px, transparent 1px)',
                    backgroundSize:(gridStep/artboard.width*100)+'% '+(gridStep/artboard.height*100)+'%',
                    opacity:0.48
                  }}),
                  h('div',{style:{position:'absolute',inset:0,touchAction:'none',zIndex:2},'aria-label':'Direct manipulation overlay'},
                    handles.flatMap(handle=>{
                      const delta=dragDelta?.id===handle.id?dragDelta:{dx:0,dy:0,mode:'move'}
                      let left=handle.x+(delta.mode==='move'?delta.dx:0)
                      let top=handle.y+(delta.mode==='move'?delta.dy:0)
                      let width=handle.width,height=handle.height
                      if(delta.mode==='resize') {
                        const corner=delta.corner||'se',leftSide=corner.includes('w'),topSide=corner.includes('n')
                        width=Math.max(1,handle.width+(leftSide?-delta.dx:delta.dx))
                        height=Math.max(1,handle.height+(topSide?-delta.dy:delta.dy))
                        if(delta.lockAspect) {
                          const ratioX=width/handle.width,ratioY=height/handle.height
                          const scale=Math.max(1/handle.width,1/handle.height,
                            Math.abs(ratioX-1)>=Math.abs(ratioY-1)?ratioX:ratioY)
                          width=handle.width*scale;height=handle.height*scale
                        }
                        left=leftSide?handle.x+handle.width-width:handle.x
                        top=topSide?handle.y+handle.height-height:handle.y
                      }
                      const main=h('button',{key:handle.id,type:'button',title:'Drag '+handle.id+' to move', 'aria-label':'Drag '+handle.tag+' '+handle.id,
                        style:{position:'absolute',left:((left-artboard.x)/artboard.width*100)+'%',top:((top-artboard.y)/artboard.height*100)+'%',
                          width:(width/artboard.width*100)+'%',height:(height/artboard.height*100)+'%',
                          minWidth:5,minHeight:5,border:active===handle.id?'2px solid #c8ab87':'1px dashed #8b847c',
                          borderRadius:handle.tag==='circle'||handle.tag==='ellipse'?'50%':0,
                          background:active===handle.id?'rgba(201,171,126,.12)':'transparent',boxSizing:'border-box',cursor:busy?'wait':canvasTool==='hand'||spaceHeld?'grab':'move',touchAction:'none',padding:0},
                        onPointerDown:event=>startDrag(event,handle),
                        onDoubleClick:handle.text&&canvasTool==='select'?()=>startTextEditing(handle.id):undefined,
                        onPointerMove:moveDrag,
                        onPointerUp:event=>finishDrag(event),
                        onPointerCancel:event=>finishDrag(event,true)
                      })
                      if(!handle.resizable || active!==handle.id) return [main]
                      const corners=['nw','ne','sw','se']
                      const resizes=corners.map(corner=>{
                        const west=corner.includes('w'),north=corner.includes('n')
                        const px=left+(west?0:width),py=top+(north?0:height)
                        return h('button',{key:handle.id+'-resize-'+corner,type:'button',
                          'aria-label':corner==='se'?'Resize '+handle.tag+' '+handle.id:'Resize '+corner.toUpperCase()+' '+handle.tag+' '+handle.id,
                          title:'Resize from '+corner.toUpperCase()+' corner · Shift locks aspect ratio',
                          'data-corner':corner,
                          style:{position:'absolute',left:((px-artboard.x)/artboard.width*100)+'%',
                            top:((py-artboard.y)/artboard.height*100)+'%',transform:'translate(-50%,-50%)',
                            width:14,height:14,padding:0,border:'2px solid #262626',borderRadius:3,
                            background:'#bca88a',cursor:west===north?'nwse-resize':'nesw-resize',touchAction:'none',zIndex:3},
                          onPointerDown:event=>{if(canvasTool==='select'&&!spaceHeld)event.stopPropagation();startDrag(event,handle,'resize')},
                          onPointerMove:moveDrag,
                          onPointerUp:event=>finishDrag(event),
                          onPointerCancel:event=>finishDrag(event,true)})
                      })
                      return [main,...resizes]
                    }),
                    dragDelta?.guideX!==null&&dragDelta?.guideX!==undefined&&h('div',{
                      className:'dsh-studio-guide-x','aria-hidden':true,style:{
                        pointerEvents:'none',position:'absolute',zIndex:8,
                        left:((dragDelta.guideX-artboard.x)/artboard.width*100)+'%',
                        top:0,bottom:0,borderLeft:'1px solid #a47c56',boxShadow:'0 0 1px #fff'
                      }
                    }),
                    dragDelta?.guideY!==null&&dragDelta?.guideY!==undefined&&h('div',{
                      className:'dsh-studio-guide-y','aria-hidden':true,style:{
                        pointerEvents:'none',position:'absolute',zIndex:8,
                        top:((dragDelta.guideY-artboard.y)/artboard.height*100)+'%',
                        left:0,right:0,borderTop:'1px solid #a47c56',boxShadow:'0 0 1px #fff'
                      }
                    }),
                    selectedPath?.editable&&h('svg',{
                      className:'dsh-studio-path-overlay','aria-hidden':true,
                      viewBox:artboard.x+' '+artboard.y+' '+artboard.width+' '+artboard.height,
                      preserveAspectRatio:'none',
                      style:{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:9}
                    },
                      h('path',{d:previewPathData(selectedPath),fill:'none',
                        stroke:'#bca991',strokeWidth:Math.max(0.4,1.5*artboard.width/(viewportRef.current?.clientWidth||600)),
                        opacity:.85,strokeDasharray:'4 3'}),
                      selectedPath.points.flatMap(p=>{
                        const targets=[p.linkIndex,p.linkIndex2].filter(index=>Number.isInteger(index))
                        return targets.map((index,side)=>{
                          const a=previewPoint(p),b=previewPoint(selectedPath.points[index])
                          return h('line',{key:'path-connector-'+p.index+(side?'b':''),
                            x1:a.x,y1:a.y,x2:b.x,y2:b.y,
                            stroke:'#bca991',strokeWidth:Math.max(.3,artboard.width/700),opacity:.8})
                        })
                      })
                    ),
                    selectedPath?.editable&&(selectedPath.segments||[]).map(segment=>
                      h('button',{key:'path-insert-'+segment.commandIndex,type:'button',
                        'aria-label':'Insert path point on segment '+segment.commandIndex+' of '+selectedPath.id,
                        title:'Ajouter une ancre au milieu du segment '+segment.commandIndex,
                        disabled:busy||reloadRequired||canvasTool!=='select'||source!==doc.source,
                        style:{position:'absolute',
                          left:((segment.midpoint.x-artboard.x)/artboard.width*100)+'%',
                          top:((segment.midpoint.y-artboard.y)/artboard.height*100)+'%',
                          width:17,height:17,transform:'translate(-50%, -50%)',
                          background:'#2b2c2e',border:'1px solid #c4ab90',borderRadius:'50%',
                          color:'#f5e9d7',fontSize:13,lineHeight:'13px',textAlign:'center',
                          padding:0,zIndex:11,cursor:'crosshair',touchAction:'manipulation'},
                        onPointerDown:event=>event.stopPropagation(),
                        onClick:()=>void save({kind:'svg-path-topology',id:selectedPath.id,
                          operation:'insert',commandIndex:segment.commandIndex})
                      },'+')),
                    selectedPath?.editable&&selectedPath.points.map(point=>{
                      const current=previewPoint(point),control=point.role!=='anchor'
                      return h('button',{key:'path-point-'+point.index,type:'button',
                        'aria-label':'Move path point '+point.index+' of '+selectedPath.id,
                        title:(control?'Poignée Bézier':'Ancre')+' · point '+point.index+' · Alt : libre',
                        style:{position:'absolute',left:((current.x-artboard.x)/artboard.width*100)+'%',
                          top:((current.y-artboard.y)/artboard.height*100)+'%',
                          width:control?12:14,height:control?12:14,padding:0,
                          transform:'translate(-50%, -50%)',zIndex:10,
                          cursor:canvasTool==='select'&&!spaceHeld?'crosshair':'grab',
                          touchAction:'none',
                          border:'2px solid '+(control?'#bca991':'#292a2d'),
                          borderRadius:control?'50%':'3px',
                          background:control?'#292a2d':'#e4c3a2'},
                        onPointerDown:e=>startPathDrag(e,point),
                        onPointerMove:movePathDrag,
                        onPointerUp:e=>finishPathDrag(e),
                        onPointerCancel:e=>finishPathDrag(e,true)
                      })
                    }),
                    canvasTool==='pen'&&h('div',{
                      className:'dsh-studio-pen-surface',
                      'aria-label':'Pen drawing surface',
                      style:{position:'absolute',inset:0,zIndex:15,cursor:'crosshair',
                        touchAction:'none',background:'transparent'},
                      onPointerDown:startPenGesture,
                      onPointerMove:movePenGesture,
                      onPointerUp:event=>void finishPenGesture(event),
                      onPointerCancel:event=>void finishPenGesture(event,true)
                    },
                      penPreview&&h('svg',{viewBox:artboard.x+' '+artboard.y+' '+artboard.width+' '+artboard.height,
                        'aria-hidden':true,preserveAspectRatio:'none',style:{
                          position:'absolute',width:'100%',height:'100%',inset:0,pointerEvents:'none'
                        }},
                        penPreview.control&&h('line',{x1:penPreview.anchor.x,y1:penPreview.anchor.y,
                          x2:penPreview.control.x,y2:penPreview.control.y,
                          stroke:'#bda991',strokeWidth:artboard.width/600}),
                        h('circle',{cx:penPreview.anchor.x,cy:penPreview.anchor.y,
                          r:Math.max(1,artboard.width/180),
                          fill:'#bda991',stroke:'#262626',strokeWidth:artboard.width/500}))
                    ),
                    editingText&&(()=> {
                      const item=handles.find(h=>h.id===editingText)
                      if(!item)return null
                      return h('div',{key:'text-editor',style:{
                        position:'absolute',left:((item.x-artboard.x)/artboard.width*100)+'%',
                        top:((item.y-artboard.y)/artboard.height*100)+'%',zIndex:12,
                        width:'max(220px, 28%)',background:'#242424',padding:8,border:'1px solid '+ACCENT,
                        borderRadius:6,boxShadow:'0 8px 22px #0009'
                      }},
                        h('textarea',{autoFocus:true,'aria-label':'Edit SVG text inline',value:textDraft,
                          onChange:e=>setTextDraft(e.target.value),onKeyDown:e=>{
                            if(e.key==='Escape'){e.stopPropagation();setEditingText('')}
                            if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.stopPropagation();void commitText()}
                          },
                          style:{...field,minHeight:75,resize:'both',font:'14px system-ui'}}),
                        h('div',{style:{display:'flex',justifyContent:'flex-end',gap:6,marginTop:6}},
                          h('button',{style:button,onClick:()=>setEditingText('')},'Cancel'),
                          h('button',{style:{...button,borderColor:ACCENT},onClick:()=>void commitText(),disabled:busy},'Apply text'))
                      )
                    })()
                  )
                  )
                ):
                  ['html','htm'].includes(doc.format)?
                    h('div',{className:'dsh-studio-responsive-preview',
                      style:{width:'100%',display:'grid',gap:8,alignContent:'start'}},
                      h('div',{role:'toolbar','aria-label':'HTML responsive viewport',
                        style:{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}},
                        [['auto','Auto'],['desktop','1280'],['tablet','768'],['mobile','390']].map(([mode,label])=>
                          h('button',{type:'button',key:mode,
                            'aria-label':'HTML viewport '+mode,'aria-pressed':htmlViewport===mode,
                            style:{...button,background:htmlViewport===mode?'#574939':button.background},
                            onClick:()=>setHtmlViewport(mode)},label)),
                        h('small',{style:{color:'#aaa9a5',marginLeft:7}},
                          htmlViewport==='auto'?'Largeur disponible':({desktop:'1280 px',tablet:'768 px',mobile:'390 px'})[htmlViewport])
                      ),
                      h('small',{role:'status',style:{color:'#d6b787',fontSize:11}},
                        'Aperçu partiel · CSS locaux simples uniquement (pas de cascade calculée). '+
                        (htmlPreviewCoverage?.includedDeclarations||0)+' déclarations compatibles, '+
                        (htmlPreviewCoverage?.omittedDeclarations||0)+' ignorées'+
                        (htmlPreviewCoverage?.truncated?' · limite atteinte':'')+'.'),
                      h('div',{className:'dsh-studio-html-frame-scroll',
                        style:{width:'100%',maxWidth:'100%',overflowX:'auto',overflowY:'hidden',
                          border:'1px solid #474747',borderRadius:8,background:'#17191b',
                          padding:8,boxSizing:'border-box'}},
                        h('iframe',{title:'Isolated design preview',sandbox:'allow-same-origin',
                          referrerPolicy:'no-referrer',onLoad:connectHtmlPreview,
                          srcDoc:safePreview(source,doc.format,htmlActive,htmlPreviewCss),
                          style:{display:'block',
                            width:({auto:'100%',desktop:'1280px',tablet:'768px',mobile:'390px'})[htmlViewport],
                            maxWidth:'none',height:520,border:'none',background:'#fff',borderRadius:6}})
                      )
                    ):
                    h('iframe',{title:'Isolated design preview',sandbox:'',
                      referrerPolicy:'no-referrer',onLoad:connectHtmlPreview,
                      srcDoc:safePreview(source,doc.format,htmlActive),
                      style:{width:'100%',height:350,border:'none',background:'#fff',borderRadius:6}})),
          h('aside',{className:'dsh-studio-inspector'+(mobilePanel==='inspector'?' dsh-studio-mobile-active':''),style:{...pane,overflow:'auto',borderRadius:0,borderWidth:'0 0 0 1px',background:'#232529'}},
            h('strong',null,'Design · Propriétés'),selectedCss?
              h('div',{style:{display:'flex',flexDirection:'column',gap:9,marginTop:12}},
                h('strong',{style:{color:ACCENT}},selectedCss.selector),
                returnHtmlRef&&h('button',{type:'button',style:button,
                  'aria-label':'Return to linked HTML page',
                  disabled:busy||reloadRequired||source!==doc.source,
                  onClick:()=>void returnToHtml()},'← Retour à la page HTML'),
                h('small',{style:{color:'#a9a6a1'}},
                  'Édition ciblée d’une règle dans le fichier CSS natif. Les @media et sélecteurs complexes restent en lecture seule.'),
                !selectedCss.editable?h('small',{style:{color:'#e7b2a8'}},
                  'Lecture seule : '+(selectedCss.reason||'sélecteur complexe')):
                  h('div',{style:{display:'grid',gap:8}},
                    h('label',null,'Propriété',
                      h('select',{style:field,'aria-label':'CSS rule property',
                        value:cssProperty,onChange:e=>chooseCssProperty(e.target.value)},
                        htmlProps.map(property=>h('option',{key:property,value:property},property)))),
                    h('label',null,'Valeur',
                      h('input',{style:field,'aria-label':'CSS rule value',
                        value:cssValue,placeholder:'ex : 12px, flex, #bda991',
                        onChange:e=>setCssValue(e.target.value)})),
                    h('button',{style:{...button,borderColor:ACCENT},
                      'aria-label':'Apply CSS rule style',
                      disabled:busy||reloadRequired||source!==doc.source||!cssValue,
                      onClick:()=>void save({kind:'css-rule',selector:cssActive,
                        property:cssProperty,value:cssValue})
                    },'Appliquer à la règle · sans IA'),
                    h('small',{style:{opacity:.7}},
                      'Un seul changement de déclaration CSS par opération ; Undo/Redo natif.'),
                    renderLayoutControls('css',selectedCss)
                  )
              ):
              selectedHtml?
              h('div',{style:{display:'flex',flexDirection:'column',gap:9,marginTop:12}},
                h('strong',{style:{color:ACCENT}},selectedHtml.tag+' #'+selectedHtml.id),
                h('small',{style:{color:'#a9a6a1'}},'HTML natif : clic dans l’aperçu pour sélectionner un élément à id unique. Scripts bloqués ; propriétés inline ciblées.'),
                h('div',{className:'dsh-studio-linked-css',style:{display:'grid',gap:5,padding:8,
                  background:'#282a2d',border:'1px solid #3e4042',borderRadius:6}},
                  h('strong',{style:{fontSize:12,color:'#c5ae94'}},'CSS externe · correspondances possibles'),
                  h('small',{style:{fontSize:11,color:'#aaa9a5'}},
                    'Ce ne sont pas des styles calculés. Cascade, !important, media queries et héritage non résolus.'),
                  htmlStylesheets.filter(link=>link.status!=='inspected').map((link,index)=>
                    h('small',{key:'blocked-'+index,style:{color:'#e5b39b'}},
                      (link.file||'Lien CSS')+' · '+link.status)),
                  selectedHtmlRules.length?
                    selectedHtmlRules.map((match,index)=>
                      h('button',{type:'button',key:match.file+match.selector+index,
                        'aria-label':'Open linked CSS '+match.selector+' in '+match.file,
                        title:'Ouvrir le fichier CSS natif et inspecter '+match.selector,
                        disabled:busy||reloadRequired||source!==doc.source,
                        style:{...button,textAlign:'left',display:'grid',gap:3},
                        onClick:()=>void openLinkedCssRule(match)},
                        h('span',{style:{color:ACCENT}},match.selector+' · '+match.file),
                        h('small',{style:{color:'#bdbbb7'}},
                          'Spécificité indicative '+match.specificity+
                          (match.editable?'':' · règle en lecture seule')+
                          (match.duplicateAcrossFiles?' · sélecteur répété':'')
                        )
                      )
                    ):
                    h('small',{style:{color:'#aaa9a5'}},
                      'Aucune règle simple #id ou .classe reconnue dans les CSS locaux référencés.')
                ),
                !selectedHtml.editable?h('small',{style:{color:'#f1b6aa'}},
                  'Lecture seule : '+(selectedHtml.reason||'structure complexe')):
                h('div',{style:{display:'grid',gap:8}},
                  h('label',null,'Propriété CSS',
                    h('select',{style:{...field,marginTop:4},'aria-label':'HTML style property',
                      value:htmlProperty,onChange:e=>chooseHtmlProperty(e.target.value)},
                      htmlProps.map(property=>h('option',{key:property,value:property},property)))),
                  h('label',null,'Valeur',
                    h('input',{style:{...field,marginTop:4},'aria-label':'HTML style value',
                      value:htmlValue,placeholder:'ex : 12px, flex, #bda991',
                      onChange:e=>setHtmlValue(e.target.value)})),
                  h('button',{style:{...button,borderColor:ACCENT},
                    'aria-label':'Apply HTML visual style',
                    disabled:busy||reloadRequired||source!==doc.source||!htmlValue,
                    onClick:()=>void save({kind:'html-style',id:htmlActive,property:htmlProperty,value:htmlValue})
                  },'Appliquer au HTML · sans IA'),
                  h('small',{style:{opacity:.7}},'Modifie uniquement l’attribut style du nœud sélectionné, avec Undo/Redo.'),
                  renderLayoutControls('html',selectedHtml))):
              selected?
              h('div',{style:{display:'flex',flexDirection:'column',gap:8,marginTop:12}},
                h('div',null,selected.tag+' #'+selected.id),
                h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
                  h('button',{style:button,'aria-label':'Duplicate selected layer',disabled:busy||source!==doc.source,
                    onClick:()=>void layerAction('duplicate'),title:'Dupliquer le calque · Ctrl+D'},'⧉ Dupliquer'),
                  h('button',{style:{...button,color:'#e7b2a8'},'aria-label':'Delete selected layer',
                    disabled:busy||source!==doc.source,
                    onClick:()=>void layerAction('delete'),title:'Supprimer le calque · Delete (annulable)'},'⌫ Supprimer')
                ),
                selected.tag==='path'&&h('div',{style:{display:'grid',gap:6,padding:'10px 0'}},
                  h('strong',{style:{color:ACCENT}},'Tracé vectoriel · Nœuds'),
                  selectedPath?.editable?
                    h('div',{style:{display:'grid',gap:8}},
                      h('small',{style:{color:'#aaa9a5'}},selectedPath.points.length+
                        ' points · ancres carrées, poignées Bézier rondes. Les boutons + insèrent un point au milieu du segment.'),
                      h('small',{style:{color:'#989690'}},
                        'Insertion sur ligne ou courbe : le segment est subdivisé. Suppression limitée aux points terminant une ligne simple.'),
                      selectedPath.penExtendable&&h('button',{style:button,type:'button',
                        'aria-label':'Resume selected path with pen tool',
                        disabled:busy||reloadRequired||source!==doc.source,
                        onClick:()=>{setPenPathId(selectedPath.id);setPenOutgoing(null);setCanvasTool('pen')}
                      },'✒ Reprendre le tracé avec la Plume'),
                      h('div',{style:{display:'flex',flexDirection:'column',gap:5,maxHeight:190,overflow:'auto'}},
                        (selectedPath.segments||[]).map(segment=>
                          h('div',{key:segment.commandIndex,style:{display:'flex',gap:5,alignItems:'center'}},
                            h('small',{style:{flex:1,color:'#aaa9a5'}},
                              segment.type+' · segment '+segment.commandIndex),
                            h('button',{type:'button',style:button,
                              'aria-label':'Insert midpoint segment '+segment.commandIndex,
                              disabled:busy||reloadRequired||source!==doc.source,
                              onClick:()=>void save({kind:'svg-path-topology',
                                id:active,operation:'insert',commandIndex:segment.commandIndex})
                            },'+ Ajouter'),
                            segment.removable&&h('button',{type:'button',style:{...button,color:'#e6b3a7'},
                              'aria-label':'Remove line point segment '+segment.commandIndex,
                              disabled:busy||reloadRequired||source!==doc.source,
                              onClick:()=>void save({kind:'svg-path-topology',
                                id:active,operation:'remove',commandIndex:segment.commandIndex})
                            },'− Retirer')
                          )
                        )
                      )
                    ):
                    h('small',{style:{color:'#e7b2a8'}},'Tracé non pris en charge en édition visuelle ('+
                      (selectedPath?.reason||'unsupported-path')+'). Utiliser le code source sans conversion forcée.')
                ),
                selected.tag==='text'&&selectedText&&h('div',{style:{display:'grid',gap:8,padding:'9px 0'}},
                  h('strong',{style:{fontSize:12,color:ACCENT}},'Text / Typography'),
                  h('textarea',{style:{...field,minHeight:80,resize:'vertical'},value:textDraft,
                    'aria-label':'Text content',onChange:e=>setTextDraft(e.target.value),
                    disabled:!selectedText.editable}),
                  h('button',{style:button,disabled:busy||!selectedText.editable||textDraft===selectedText.text,
                    onClick:()=>void commitText()},'Save text'),
                  h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}},
                    ['font-family','font-size','font-weight','font-style','letter-spacing','text-anchor'].map(key=>
                      h('label',{key,style:{display:'grid',gap:3,color:'#aaa9a5',fontSize:11}},
                        key,
                        key==='font-family'?
                          h('select',{style:field,value:selected.attributes[key]||'Inter, Arial',
                            disabled:busy||!selected.attributes[key],
                            onChange:e=>void save({kind:'svg-attribute',id:active,attribute:key,value:e.target.value})},
                            ['Inter, Arial','Arial','Georgia','Verdana','Times New Roman','Courier New'].map(font=>h('option',{key:font,value:font},font))):
                        key==='font-weight'||key==='font-style'||key==='text-anchor'?
                          h('select',{style:field,value:selected.attributes[key]||'normal',
                            disabled:busy||!selected.attributes[key],
                            onChange:e=>void save({kind:'svg-attribute',id:active,attribute:key,value:e.target.value})},
                            (key==='font-weight'?['normal','400','500','600','700','bold']:key==='font-style'?['normal','italic','oblique']:['start','middle','end']).map(value=>h('option',{key:value,value},value))):
                          h('input',{style:field,type:'number',step:1,key:key+':'+selected.attributes[key],defaultValue:selected.attributes[key]||'',
                            disabled:busy||!selected.attributes[key],
                            onBlur:e=>{if(e.target.value&&e.target.value!==selected.attributes[key])void save({kind:'svg-attribute',id:active,attribute:key,value:e.target.value})}})
                      ))
                  ),
                  h('small',{style:{color:'#989690'}},'Double-click on a text layer in the canvas to edit directly.')),
                h('label',null,'Property',h('select',{style:field,value:attribute,onChange:e=>{setAttribute(e.target.value);setValue(selected.attributes[e.target.value]||'')}},Object.keys(selected.attributes).map(k=>h('option',{value:k,key:k},k)))),
                attribute&&h('label',null,'Value',h('input',{style:field,value,onChange:e=>setValue(e.target.value)})),
                h('button',{style:button,disabled:busy||!attribute,onClick:()=>save({kind:'svg-attribute',id:active,attribute,value})},'Apply without AI')):
              h('p',{style:{opacity:0.65}},'Select an SVG layer to edit existing attributes.'))),
        doc&&h('details',{style:{padding:'10px 14px',borderTop:'1px solid #36383b',background:'#222427'}},h('summary',{style:{cursor:'pointer'}},'Code source natif · avancé'),
          h('textarea',{spellCheck:false,value:source,onChange:e=>setSource(e.target.value),style:{...field,minHeight:220,font:'12px monospace',marginTop:8}}),
          h('div',{style:{display:'flex',gap:8,marginTop:8}},
            h('button',{style:button,disabled:busy||reloadRequired||source===doc.source,onClick:()=>save({kind:'replace-source',source})},'Save source'),
            h('button',{style:button,onClick:()=>setSource(doc.source)},'Discard unsaved text'))),
        h('small',{style:{opacity:0.65,padding:'7px 14px',borderTop:'1px solid #38393b',background:'#202124'}},'Éditeur expérimental · Grille (pas en unités SVG), magnétisme et repères de centres/bords réglables (Alt = précision libre). V sélection, H main, Espace+glisser, Ctrl+molette zoom. Aucun changement de fichier tant que le geste n’est pas validé. Installation DSH réelle non validée.')
      )
    }
    return {
      inject:['slots'],
      apply(ctx) {
        const slots=ctx.slots
        if (!slots || typeof slots.inject!=='function') return
        slots.inject('conversation.view',()=>slots.register({name:'conversation.view',id:'dsh-design-studio',order:25,label:()=> 'Design Studio'},Studio))
      },
    }
  },
})
