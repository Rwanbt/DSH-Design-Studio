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
    function safePreview(source, format) {
      const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
      const svgLayout = format === 'svg' ? '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>' : ''
      return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + policy + '">' + svgLayout + '</head><body style="margin:' + (format==='svg'?'0':'12px') + '">' + source + '</body></html>'
    }
    async function request(endpoint, options) {
      const response = await fetch(new URL(api + endpoint, document.baseURI),{credentials:'same-origin',...options})
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'Request failed')
      return result
    }
    function Studio(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      const [file,setFile] = React.useState('design.svg')
      const [doc,setDoc] = React.useState(null)
      const [source,setSource] = React.useState('')
      const [nodes,setNodes] = React.useState([])
      const [textNodes,setTextNodes] = React.useState([])
      const [editingText,setEditingText] = React.useState('')
      const [textDraft,setTextDraft] = React.useState('')
      const [active,setActive] = React.useState('')
      const [attribute,setAttribute] = React.useState('')
      const [value,setValue] = React.useState('')
      const [error,setError] = React.useState('')
      const [warning,setWarning] = React.useState('')
      const [busy,setBusy] = React.useState(false)
      const [geometry,setGeometry] = React.useState({artboard:null,handles:[]})
      const [dragDelta,setDragDelta] = React.useState(null)
      const dragRef=React.useRef(null)
      const [undoStack,setUndoStack]=React.useState([])
      const [redoStack,setRedoStack]=React.useState([])
      async function load(force=false, targetFile=file, retainSelection='') {
        if(!force && doc && source!==doc.source) {setError('Unsaved source changes: save or discard them before opening another file');return}
        if(!sessionId) {setError('Open a conversation first');return}
        setBusy(true);setError('')
        try {
          const url='/document?sessionId='+encodeURIComponent(sessionId)+'&file='+encodeURIComponent(targetFile)
          const data=await request(url)
          setDoc(data.document);setSource(data.document.source);setNodes(data.nodes||[])
          setTextNodes(data.textNodes||[]);setEditingText('')
          setTextDraft((data.textNodes||[]).find(item=>item.id===retainSelection)?.text||'')
          setGeometry(data.geometry||{artboard:null,handles:[]})
          setDragDelta(null);dragRef.current=null
          if(!force || (doc && doc.file!==targetFile)) {setUndoStack([]);setRedoStack([])}
          setWarning(data.warning||'')
          const remembered = (data.nodes||[]).find(node=>node.id===retainSelection)
          setActive(remembered?retainSelection:'')
          const retainedAttr=remembered && remembered.attributes[attribute]?attribute:Object.keys(remembered?.attributes||{})[0]||''
          setAttribute(retainedAttr);setValue(remembered && retainedAttr ? remembered.attributes[retainedAttr]: '')
        }catch(e){setError(String(e.message))}finally{setBusy(false)}
      }
      async function save(payload, historyMode='record') {
        if(!doc || busy)return false
        if(payload.kind!=='replace-source' && source!==doc.source) {setError('Unsaved source changes: save or discard them first');return false}
        setBusy(true);setError('')
        try {
          const response=await request('/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,file:doc.file,baseHash:doc.hash,...payload})})
          await load(true,doc.file,response.createdId||active)
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
          return true
        }catch(e){setError(String(e.message));return false}finally{setBusy(false)}
      }
      async function undo() {
        if(busy || source!==doc?.source || !undoStack.length)return
        const entry=undoStack[undoStack.length-1]
        if(await save({kind:'patches',patches:entry.undo},'replay')) {
          setUndoStack(previous=>previous.slice(0,-1))
          setRedoStack(previous=>[...previous,entry])
        }
      }
      async function redo() {
        if(busy || source!==doc?.source || !redoStack.length)return
        const entry=redoStack[redoStack.length-1]
        if(await save({kind:'patches',patches:entry.redo},'replay')) {
          setRedoStack(previous=>previous.slice(0,-1))
          setUndoStack(previous=>[...previous,entry])
        }
      }
      function onEditorKeyDown(event) {
        const tag=String(event.target?.tagName||'').toLowerCase()
        if(['input','textarea','select'].includes(tag)||event.target?.isContentEditable)return
        const command=event.ctrlKey || event.metaKey
        if(command && !event.altKey) {
          if(event.key?.toLowerCase()==='z') {
            event.preventDefault()
            if(event.shiftKey)void redo();else void undo()
          }else if(event.key?.toLowerCase()==='y'){
            event.preventDefault();void redo()
          }
          return
        }
        if(command || event.altKey || busy || !active || !doc || source!==doc.source)return
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
      function select(nodeId) {
        setActive(nodeId)
        setEditingText('')
        setTextDraft(textNodes.find(item=>item.id===nodeId)?.text||'')
        const node=nodes.find(n=>n.id===nodeId)
        const property=Object.keys(node?.attributes||{})[0]||''
        setAttribute(property);setValue(property ? node.attributes[property]:'')
      }
      const selected=nodes.find(n=>n.id===active)
      const selectedText=textNodes.find(node=>node.id===active)
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
      function startDrag(event,handle,mode='move') {
        if(event.button!==0 || busy) return
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
        setDragDelta({id:drag.id,dx,dy,mode:drag.mode,corner:drag.corner,lockAspect:!!event.shiftKey})
      }
      function finishDrag(event,cancel=false) {
        const drag=dragRef.current
        if(!drag || drag.pointerId!==event.pointerId) return
        dragRef.current=null
        setDragDelta(null)
        if(cancel || !artboard || busy) return
        const dx=(event.clientX-drag.startX)*artboard.width/drag.width
        const dy=(event.clientY-drag.startY)*artboard.height/drag.height
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
      return h('section',{className:'dsh-studio-workbench',onKeyDown:onEditorKeyDown,style:{...pane,height:'min(87vh,920px)',overflow:'hidden',display:'flex',flexDirection:'column',gap:0,padding:0,fontFamily:'system-ui,sans-serif',fontSize:12}},
        h('style',null,[
          '.dsh-studio-workbench *{box-sizing:border-box}',
          '.dsh-studio-workbench input:focus-visible,.dsh-studio-workbench textarea:focus-visible,.dsh-studio-workbench button:focus-visible{outline:2px solid #bca58c;outline-offset:1px}',
          '.dsh-studio-workbench button:not(:disabled):hover{filter:brightness(1.12)}',
          '.dsh-studio-layout{min-height:0;flex:1;overflow:auto}',
          '.dsh-studio-canvas{background-color:#191a1d;background-image:radial-gradient(#4a4a4a44 .8px,transparent .8px);background-size:18px 18px}',
          '@media(max-width:1020px){.dsh-studio-layout{grid-template-columns:160px minmax(250px,1fr) 210px!important}}',
          '@media(max-width:650px){.dsh-studio-layout{grid-template-columns:minmax(0,1fr)!important}.dsh-studio-sidebar,.dsh-studio-inspector{max-height:200px}.dsh-studio-canvas{min-height:240px}}'
        ].join('')),
        h('header',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'9px 14px',borderBottom:'1px solid #3a3b3e',background:'#1e2023',minHeight:46}},
          h('strong',{style:{fontSize:14,letterSpacing:'.01em'}},'DSH · Design Studio'),
          h('span',{style:{fontSize:11,opacity:0.7}},'Édition native · sans IA'),
          h('button',{style:button,disabled:busy||!undoStack.length||source!==doc?.source,onClick:()=>void undo(),'aria-label':'Undo saved edit'},'↶ Undo'),
          h('button',{style:button,disabled:busy||!redoStack.length||source!==doc?.source,onClick:()=>void redo(),'aria-label':'Redo saved edit'},'↷ Redo')),
        h('div',{style:{display:'flex',gap:8,padding:'9px 12px',borderBottom:'1px solid #35373b',background:'#232529'}},
          h('input',{style:{...field,flex:1,maxWidth:460},'aria-label':'Workspace file',value:file,onChange:e=>setFile(e.target.value),placeholder:'relative/path/file.svg'}),
          h('button',{style:button,onClick:()=>load(false),disabled:busy||!sessionId},busy?'Loading…':'Open')),
        doc?.format==='svg'&&h('nav',{style:{display:'flex',gap:7,flexWrap:'wrap',padding:'7px 12px',borderBottom:'1px solid #37383b',background:'#222427'},'aria-label':'SVG creation tools'},
          ['rect','circle','ellipse','text'].map(shape=>h('button',{
            key:shape,type:'button',style:button,'aria-label':'Add '+shape,
            disabled:busy||source!==doc.source,
            onClick:()=>void save({kind:'svg-add-shape',shape})
          },'＋ '+(shape==='rect'?'Rectangle':shape==='circle'?'Circle':shape==='ellipse'?'Ellipse':'Text')))),
        error&&h('div',{role:'alert',style:{color:'#ff8585'}},error),
        warning&&h('div',{role:'status',style:{color:'#f5c36a'}},warning),
        doc&&h('div',{className:'dsh-studio-layout',style:{display:'grid',gridTemplateColumns:'220px minmax(330px,1fr) 280px',gap:0,minHeight:390}},
          h('aside',{className:'dsh-studio-sidebar',style:{...pane,overflow:'auto',borderRadius:0,borderWidth:'0 1px 0 0',background:'#232529'}},
            h('strong',null,'Calques'),h('div',{style:{display:'flex',flexDirection:'column',gap:4,marginTop:12}},
              nodes.length?nodes.map(n=>h('button',{key:n.id,style:{...button,textAlign:'left',background:active===n.id?'#494034':'transparent'},onClick:()=>select(n.id)},n.tag+' #'+n.id)):
              h('small',null,'No addressable SVG nodes (unique id attributes required).'))),
          h('div',{className:'dsh-studio-canvas',style:{...pane,overflow:'auto',border:0,borderRadius:0,padding:18,display:'flex',flexDirection:'column',justifyContent:'center'}},
            h('div',{style:{display:'flex',justifyContent:'space-between',marginBottom:12}},h('strong',null,'Canevas'),h('small',null,doc.format.toUpperCase())),
            doc.format==='css'?h('p',null,'CSS file · use source editor below'):
              artboard && doc.format==='svg'?
                h('div',{style:{position:'relative',width:'100%',aspectRatio:artboard.width+' / '+artboard.height,background:'#fff',overflow:'hidden',borderRadius:6}},
                  h('iframe',{title:'Isolated SVG preview',sandbox:'',referrerPolicy:'no-referrer',srcDoc:safePreview(source,'svg'),style:{width:'100%',height:'100%',position:'absolute',inset:0,border:'none',pointerEvents:'none'}}),
                  h('div',{style:{position:'absolute',inset:0,touchAction:'none'},'aria-label':'Direct manipulation overlay'},
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
                          background:active===handle.id?'rgba(201,171,126,.12)':'transparent',boxSizing:'border-box',cursor:busy?'wait':'move',touchAction:'none',padding:0},
                        onPointerDown:event=>startDrag(event,handle),
                        onDoubleClick:handle.text?()=>startTextEditing(handle.id):undefined,
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
                          onPointerDown:event=>{event.stopPropagation();startDrag(event,handle,'resize')},
                          onPointerMove:moveDrag,
                          onPointerUp:event=>finishDrag(event),
                          onPointerCancel:event=>finishDrag(event,true)})
                      })
                      return [main,...resizes]
                    }),
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
                ):
                h('iframe',{title:'Isolated design preview',sandbox:'',referrerPolicy:'no-referrer',srcDoc:safePreview(source,doc.format),style:{width:'100%',height:350,border:'none',background:'#fff',borderRadius:6}})),
          h('aside',{className:'dsh-studio-inspector',style:{...pane,overflow:'auto',borderRadius:0,borderWidth:'0 0 0 1px',background:'#232529'}},
            h('strong',null,'Design · Propriétés'),selected?
              h('div',{style:{display:'flex',flexDirection:'column',gap:8,marginTop:12}},
                h('div',null,selected.tag+' #'+selected.id),
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
            h('button',{style:button,disabled:busy||source===doc.source,onClick:()=>save({kind:'replace-source',source})},'Save source'),
            h('button',{style:button,onClick:()=>setSource(doc.source)},'Discard unsaved text'))),
        h('small',{style:{opacity:0.65,padding:'7px 14px',borderTop:'1px solid #38393b',background:'#202124'}},'Experimental editor. SVG primitives move with pointer or arrow keys; rectangles/ellipses resize from four corners (Shift: lock ratio). Undo/Redo applies to saved actions in this session. HTML source editing remains manual. DSH live UI not verified.')
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
