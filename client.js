/* Experimental native DSH client; browser UI is an editor, not an agent front-end. */
window.__ModuleLoader__.load({
  id: '@rwanbt/dsh-design-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const api = 'design-studio-native'
    const pane = { background:'var(--dsw-alias-surface-1,#171b27)', color:'var(--dsw-alias-content-primary,#e7eaf1)', border:'1px solid var(--dsw-alias-border,#35394a)', borderRadius:8, padding:12 }
    const button = { cursor:'pointer', border:'1px solid #626a80', borderRadius:6, padding:'6px 10px', background:'transparent', color:'inherit' }
    const field = { width:'100%', boxSizing:'border-box', borderRadius:6, border:'1px solid #626a80', background:'var(--dsw-alias-surface-2,#232838)', color:'inherit', padding:'6px 8px' }
    function safePreview(source) {
      const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
      return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + policy + '"></head><body style="margin:12px">' + source + '</body></html>'
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
      const [active,setActive] = React.useState('')
      const [attribute,setAttribute] = React.useState('')
      const [value,setValue] = React.useState('')
      const [error,setError] = React.useState('')
      const [warning,setWarning] = React.useState('')
      const [busy,setBusy] = React.useState(false)
      async function load() {
        if(!sessionId) {setError('Open a conversation first');return}
        setBusy(true);setError('')
        try {
          const url='/document?sessionId='+encodeURIComponent(sessionId)+'&file='+encodeURIComponent(file)
          const data=await request(url)
          setDoc(data.document);setSource(data.document.source);setNodes(data.nodes||[])
          setWarning(data.warning||'');setActive('');setAttribute('');setValue('')
        }catch(e){setError(String(e.message))}finally{setBusy(false)}
      }
      async function save(payload) {
        if(!doc)return
        setBusy(true);setError('')
        try {
          await request('/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,file:doc.file,baseHash:doc.hash,...payload})})
          await load()
        }catch(e){setError(String(e.message))}finally{setBusy(false)}
      }
      function select(nodeId) {
        setActive(nodeId)
        const node=nodes.find(n=>n.id===nodeId)
        const property=Object.keys(node?.attributes||{})[0]||''
        setAttribute(property);setValue(property ? node.attributes[property]:'')
      }
      const selected=nodes.find(n=>n.id===active)
      return h('section',{style:{...pane,height:'min(80vh,860px)',overflow:'auto',display:'flex',flexDirection:'column',gap:12,fontFamily:'system-ui,sans-serif',fontSize:13}},
        h('header',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}},
          h('strong',{style:{fontSize:16}},'Design Studio · Manual'),
          h('span',{style:{fontSize:11,opacity:0.7}},'SVG / HTML / CSS · No AI needed')),
        h('div',{style:{display:'flex',gap:8}},
          h('input',{style:{...field,flex:1},'aria-label':'Workspace file',value:file,onChange:e=>setFile(e.target.value),placeholder:'relative/path/file.svg'}),
          h('button',{style:button,onClick:load,disabled:busy||!sessionId},busy?'Loading…':'Open')),
        error&&h('div',{role:'alert',style:{color:'#ff8585'}},error),
        warning&&h('div',{role:'status',style:{color:'#f5c36a'}},warning),
        doc&&h('div',{style:{display:'grid',gridTemplateColumns:'minmax(130px,1fr) minmax(240px,3fr) minmax(170px,1.3fr)',gap:12,minHeight:380}},
          h('aside',{style:{...pane,overflow:'auto'}},
            h('strong',null,'Layers'),h('div',{style:{display:'flex',flexDirection:'column',gap:4,marginTop:12}},
              nodes.length?nodes.map(n=>h('button',{key:n.id,style:{...button,textAlign:'left',background:active===n.id?'#314674':'transparent'},onClick:()=>select(n.id)},n.tag+' #'+n.id)):
              h('small',null,'No addressable SVG nodes (unique id attributes required).'))),
          h('div',{style:{...pane,overflow:'auto'}},
            h('div',{style:{display:'flex',justifyContent:'space-between',marginBottom:6}},h('strong',null,'Preview'),h('small',null,doc.format.toUpperCase())),
            doc.format==='css'?h('p',null,'CSS file · use source editor below'):
              h('iframe',{title:'Isolated design preview',sandbox:'',referrerPolicy:'no-referrer',srcDoc:safePreview(source),style:{width:'100%',height:350,border:'none',background:'#fff',borderRadius:6}})),
          h('aside',{style:{...pane,overflow:'auto'}},
            h('strong',null,'Properties'),selected?
              h('div',{style:{display:'flex',flexDirection:'column',gap:8,marginTop:12}},
                h('div',null,selected.tag+' #'+selected.id),
                h('label',null,'Property',h('select',{style:field,value:attribute,onChange:e=>{setAttribute(e.target.value);setValue(selected.attributes[e.target.value]||'')}},Object.keys(selected.attributes).map(k=>h('option',{value:k,key:k},k)))),
                attribute&&h('label',null,'Value',h('input',{style:field,value,onChange:e=>setValue(e.target.value)})),
                h('button',{style:button,disabled:busy||!attribute,onClick:()=>save({kind:'svg-attribute',id:active,attribute,value})},'Apply without AI')):
              h('p',{style:{opacity:0.65}},'Select an SVG layer to edit existing attributes.'))),
        doc&&h('details',null,h('summary',{style:{cursor:'pointer'}},'Manual source editor (advanced)'),
          h('textarea',{spellCheck:false,value:source,onChange:e=>setSource(e.target.value),style:{...field,minHeight:220,font:'12px monospace',marginTop:8}}),
          h('div',{style:{display:'flex',gap:8,marginTop:8}},
            h('button',{style:button,disabled:busy||source===doc.source,onClick:()=>save({kind:'replace-source',source})},'Save source'),
            h('button',{style:button,onClick:()=>setSource(doc.source)},'Discard unsaved text'))),
        h('small',{style:{opacity:0.65}},'Experimental editor. Preview is sandboxed. No drag, freehand vector drawing or live DSH compatibility claim yet.')
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
