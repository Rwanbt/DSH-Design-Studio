/* Experimental native DSH client; browser UI is an editor, not an agent front-end. */
window.__ModuleLoader__.load({
  id: '@rwanbt/dsh-design-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const api = 'design-studio-native'
    const ACCENT='#bda991'
    // Document tabs (ADR-034). Memory stays bounded on purpose: each open tab
    // keeps a full native source, its parsed layers and up to 30 undo entries in
    // the renderer, so past this hard limit the editor refuses a new tab with an
    // explicit message instead of growing without bound.
    const MAX_TABS = 8
    /**
     * Raster export bounds. A canvas larger than this is refused *before* any
     * allocation: converting an 8000×8000 SVG at 2x would otherwise ask the
     * renderer for 256 megapixels and could crash the tab instead of explaining
     * the refusal. The limit is per side, matching the user-facing message.
     */
    const PNG_MAX_SIDE = 8192
    const PNG_SCALES = [1, 2]
    // Stable, collision-free id for the visible PNG refusal reason. A counter is
    // used instead of React.useId because the level-1 client harness renders the
    // component with a minimal React mock.
    let pngReasonSequence = 0
    /**
     * Unsaved-recovery journal (ADR-035). DSH can close, reload or crash while a
     * document has unsaved edits, and those bytes live only in the renderer.
     * The journal copies the SOURCE OF AN OPEN, DIRTY DOCUMENT into
     * `localStorage`, under a key that names this plugin, the entry format
     * version and the workspace (or conversation) scope. It is never read back
     * into a file automatically: recovery only loads it into the editor after an
     * explicit click, and the normal save path remains the only writer.
     *
     * Only the edited source, its workspace-relative path and the revision it
     * was based on are stored: no profile path, token, preference or host
     * configuration ever reaches it. Storage is bounded per scope, and every
     * refusal (too large, too many entries, storage disabled) is reported rather
     * than silently truncating the user's work.
     */
    const RECOVERY_PREFIX = 'dsh-design-studio:recovery:v1:'
    const RECOVERY_PREF_KEY = 'dsh-design-studio:pref:v1:recovery-enabled'
    const RECOVERY_VERSION = 1
    const RECOVERY_MAX_ENTRIES = 8
    const RECOVERY_MAX_BYTES = 256 * 1024
    /**
     * The browser storage, or null when it is absent or refuses access.
     * Reading `window.localStorage` itself can throw (a browser with site data
     * blocked raises SecurityError), so both the lookup and every use below are
     * guarded: the journal must never break the editor.
     */
    function recoveryStorage() {
      try {
        if(typeof window === 'undefined' || !window) return null
        const storage = window.localStorage
        if(!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' ||
          typeof storage.removeItem !== 'function' || typeof storage.key !== 'function') return null
        return storage
      } catch(_) { return null }
    }
    /** UTF-8 byte length, so the per-entry budget is a real size, not a guess. */
    function recoveryBytes(text) {
      let bytes = 0
      for(const character of String(text)) {
        const point = character.codePointAt(0)
        bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
      }
      return bytes
    }
    /** One key per (scope, file): the workspace id is part of the key, never shared. */
    function recoveryKey(scope, file) {
      return RECOVERY_PREFIX + encodeURIComponent(String(scope)) + ':' + encodeURIComponent(String(file))
    }
    function recoveryScopePrefix(scope) {
      return RECOVERY_PREFIX + encodeURIComponent(String(scope)) + ':'
    }
    /**
     * Every valid entry of one scope, most recent first. A malformed or foreign
     * value is ignored, never repaired: a corrupt journal must not break a mount.
     */
    function recoveryEntries(scope) {
      const storage = recoveryStorage()
      if(!storage || !scope) return []
      const prefix = recoveryScopePrefix(scope)
      const entries = []
      try {
        for(let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index)
          if(typeof key !== 'string' || !key.startsWith(prefix)) continue
          const raw = storage.getItem(key)
          if(typeof raw !== 'string') continue
          let entry
          try { entry = JSON.parse(raw) } catch(_) { continue }
          if(!entry || entry.v !== RECOVERY_VERSION) continue
          if(typeof entry.file !== 'string' || !entry.file) continue
          if(typeof entry.source !== 'string' || entry.source.length > RECOVERY_MAX_BYTES * 2) continue
          const savedAt = Number(entry.savedAt)
          if(!Number.isFinite(savedAt) || savedAt <= 0) continue
          entries.push({...entry, savedAt})
        }
      } catch(_) { return [] }
      return entries.sort((a, b) => b.savedAt - a.savedAt)
    }
    /**
     * Journal one dirty document. Returns `{ok:true}` or `{ok:false, reason}`;
     * it never throws, never truncates and never replaces another file's entry.
     * Refusal reasons are rendered verbatim by the workbench.
     */
    function recoveryWrite(scope, entry) {
      const storage = recoveryStorage()
      if(!storage || !scope) return {ok:false, reason:'storage-unavailable'}
      const key = recoveryKey(scope, entry.file)
      const payload = JSON.stringify({v:RECOVERY_VERSION, file:entry.file, format:entry.format||'',
        source:entry.source, baseHash:entry.baseHash||'', baseIdentity:entry.baseIdentity||'',
        savedAt:Number(entry.savedAt)||Date.now()})
      const bytes = recoveryBytes(payload)
      if(bytes > RECOVERY_MAX_BYTES) return {ok:false, reason:'entry-too-large', bytes}
      try {
        if(storage.getItem(key) === null) {
          const existing = recoveryEntries(scope)
          if(existing.length >= RECOVERY_MAX_ENTRIES) {
            return {ok:false, reason:'journal-full', entries:existing.length}
          }
        }
        storage.setItem(key, payload)
        return {ok:true, bytes}
      } catch(error) {
        return {ok:false, reason:'storage-refused', message:String(error && error.message ? error.message : error)}
      }
    }
    /** Remove the entry of one file; a failure is reported by the caller if needed. */
    function recoveryClear(scope, file) {
      const storage = recoveryStorage()
      if(!storage || !scope || !file) return false
      try { storage.removeItem(recoveryKey(scope, file)); return true } catch(_) { return false }
    }
    /** The persisted preference; journaling is opt-out and enabled by default. */
    function recoveryPreference() {
      const storage = recoveryStorage()
      if(!storage) return true
      try { return storage.getItem(RECOVERY_PREF_KEY) !== '0' } catch(_) { return true }
    }
    function recoverySetPreference(enabled) {
      const storage = recoveryStorage()
      if(!storage) return false
      try { storage.setItem(RECOVERY_PREF_KEY, enabled ? '1' : '0'); return true } catch(_) { return false }
    }
    /**
     * Rebuild the exact bytes the Host just committed from the response
     * `patches` (UTF-16 offsets, `before` preconditions, relative to the source
     * the request was computed on). This is used only when the user typed
     * while the POST was in flight: reloading would discard that typing, so the
     * editor keeps the live buffer and still needs the true on-disk source for
     * its dirty/discard semantics. Returns null on anything unexpected, so the
     * caller can fall back instead of inventing bytes.
     */
    function sourceAfterPatches(base, patches) {
      if(typeof base !== 'string' || !Array.isArray(patches) || patches.length === 0) return null
      const ordered = patches.slice().sort((a, b) => a.start - b.start || a.end - b.end)
      let result = ''
      let position = 0
      let lastStart = -1
      for(const patch of ordered) {
        if(!patch || !Number.isSafeInteger(patch.start) || !Number.isSafeInteger(patch.end) ||
          patch.start < position || patch.start === lastStart ||
          patch.end < patch.start || patch.end > base.length ||
          typeof patch.before !== 'string' || typeof patch.after !== 'string' ||
          base.slice(patch.start, patch.end) !== patch.before) return null
        result += base.slice(position, patch.start) + patch.after
        position = patch.end
        lastStart = patch.start
      }
      return result + base.slice(position)
    }
    /** Human age of a journal entry, in French, without a new dependency. */
    function recoveryAge(savedAt, now = Date.now()) {
      const stamp = Number(savedAt)
      if(!Number.isFinite(stamp) || stamp <= 0) return 'âge inconnu'
      const delta = Math.max(0, now - stamp)
      if(delta < 60000) return 'il y a quelques secondes'
      const minutes = Math.floor(delta / 60000)
      if(minutes < 60) return 'il y a ' + minutes + ' min'
      const hours = Math.floor(minutes / 60)
      if(hours < 24) return 'il y a ' + hours + ' h'
      return 'il y a ' + Math.floor(hours / 24) + ' j'
    }
    const pane = { background:'var(--dsw-alias-bg-base, #202124)', color:'var(--dsw-alias-label-primary, #e8e7e2)', border:'1px solid var(--dsw-alias-border-l1, #37383b)', borderRadius:8, padding:12 }
    const button = { cursor:'pointer', border:'1px solid #44464b', borderRadius:6, padding:'6px 10px', background:'var(--dsw-alias-bg-layer-2, #292b2f)', color:'inherit' }
    const field = { width:'100%', boxSizing:'border-box', borderRadius:6, border:'1px solid #44464b', background:'var(--dsw-alias-bg-layer-2,#27292d)', color:'inherit', padding:'6px 8px' }
    /**
     * Starting points for a brand-new document. Each one is valid native source
     * that the existing inspectors can already edit: the SVG carries a real
     * viewBox so the canvas mounts, the HTML carries ids the element mapper can
     * target, the CSS carries rules the rule inspector can list.
     */
    const GRAPHITE_EXAMPLE = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" id=\"graphite-board\" width=\"680\" height=\"440\" viewBox=\"0 0 680 440\">\n<defs>\n<linearGradient id=\"baseGrad\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n<stop stop-color=\"#f7f7f4\"/>\n<stop offset=\"1\" stop-color=\"#e8ecf6\"/>\n</linearGradient>\n<linearGradient id=\"orbGrad\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n<stop stop-color=\"#2458e9\"/>\n<stop offset=\".48\" stop-color=\"#527af6\"/>\n<stop offset=\"1\" stop-color=\"#9cc8ff\"/>\n</linearGradient>\n<linearGradient id=\"peach\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n<stop stop-color=\"#ffce9f\"/>\n<stop offset=\"1\" stop-color=\"#ef725f\"/>\n</linearGradient>\n<filter id=\"blur\">\n<feGaussianBlur stdDeviation=\"21\"/>\n</filter>\n</defs>\n<rect x=\"0\" y=\"0\" width=\"680\" height=\"440\" fill=\"url(#baseGrad)\"/>\n<g id=\"scene\">\n<rect id=\"bg-panel\" x=\"33\" y=\"32\" width=\"614\" height=\"376\" rx=\"15\" fill=\"#161d31\"/>\n<ellipse cx=\"491\" cy=\"231\" rx=\"145\" ry=\"118\" fill=\"#416aff\" opacity=\".15\" filter=\"url(#blur)\"/>\n<ellipse id=\"orb\" cx=\"490\" cy=\"221\" rx=\"137\" ry=\"137\" fill=\"url(#orbGrad)\"/>\n<path d=\"M406 220C442 177 470 176 490 176c58 0 88 64 130 69\" stroke=\"#b9d9ff\" stroke-width=\"6\" opacity=\".45\" fill=\"none\"/>\n<path d=\"M430 300c42-90 116-106 165-157\" stroke=\"#091d72\" stroke-width=\"14\" opacity=\".12\" fill=\"none\"/>\n<ellipse id=\"accent\" cx=\"560\" cy=\"291\" rx=\"53\" ry=\"53\" fill=\"url(#peach)\"/>\n<rect x=\"72\" y=\"69\" width=\"31\" height=\"31\" rx=\"6\" fill=\"#6592ff\"/>\n<path d=\"m79 83 8-8 8 8-8 8z\" stroke=\"#fff\" stroke-width=\"2\" fill=\"none\"/>\n<text id=\"brand-title\" x=\"113\" y=\"89\" font-size=\"12\" fill=\"#b7c2de\" font-family=\"Inter,Arial,sans-serif\" font-weight=\"700\" letter-spacing=\".14em\">NOVA / DESIGN SYSTEMS</text>\n<text id=\"hero-title\" x=\"72\" y=\"198\" fill=\"#fff\" font-size=\"64\" font-family=\"Inter,Arial,sans-serif\" font-weight=\"790\" letter-spacing=\"-3\">Make</text>\n<text id=\"hero-subtitle\" x=\"72\" y=\"264\" fill=\"#fff\" font-size=\"64\" font-family=\"Inter,Arial,sans-serif\" font-weight=\"790\" letter-spacing=\"-3\">space.</text>\n<text id=\"description\" x=\"76\" y=\"320\" fill=\"#afbed9\" font-size=\"12\" font-family=\"Inter,Arial,sans-serif\">A playground for better ideas.</text>\n<rect id=\"chip\" x=\"72\" y=\"346\" width=\"129\" height=\"33\" rx=\"16.5\" fill=\"#e9f0ff\"/>\n<text id=\"cta-label\" x=\"91\" y=\"367\" fill=\"#203457\" font-size=\"11\" font-family=\"Inter,Arial,sans-serif\" font-weight=\"700\">Explore concept ↗</text>\n<text id=\"copyright\" x=\"572\" y=\"378\" fill=\"#8899bb\" font-size=\"10\" font-family=\"Inter,Arial,sans-serif\">© 2026</text>\n</g>\n</svg>\n"
    const NEW_TEMPLATES = {
      svg: '<?xml version="1.0" encoding="UTF-8"?>\n'+
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">\n'+
        '  <rect id="fond" x="0" y="0" width="640" height="360" fill="#1f2124"/>\n'+
        '  <text id="titre" x="40" y="80" fill="#e8e7e2" font-family="system-ui, sans-serif" font-size="28">Nouveau titre</text>\n'+
        '</svg>\n',
      html: '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<title>Nouvelle page</title>\n</head>\n<body>\n'+
        '<h1 id="titre">Nouvelle page</h1>\n<p id="intro">Modifiez ce texte depuis le canevas.</p>\n</body>\n</html>\n',
      css: ':root {\n  --accent: #bda991;\n}\n\nbody {\n  font-family: system-ui, sans-serif;\n  color: #1f2124;\n}\n',
    }
    /** Decode numeric HTML character references, so an encoded `refresh` is seen. */
    function decodeNumericReferences(text) {
      return String(text)
        .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)) } catch { return '' } })
        .replace(/&#(\d+);?/g, (_, dec) => { try { return String.fromCodePoint(Number(dec)) } catch { return '' } })
    }
    /**
     * Remove `<base>` and `<meta http-equiv="refresh">` from the PREVIEW copy only.
     * A plain regex is not enough: quoted '>' inside an attribute and numeric
     * character references both defeat it, so this scans tag ends while honouring
     * quotes and decodes references before deciding. The file on disk is untouched.
     */
    function stripNavigationTags(html) {
      let out = ''
      let index = 0
      while (index < html.length) {
        const start = html.indexOf('<', index)
        if (start < 0) { out += html.slice(index); break }
        out += html.slice(index, start)
        const head = html.slice(start, start + 12)
        const tagMatch = /^<\s*(base|meta)(?=[\s/>])/i.exec(head)
        if (!tagMatch) { out += '<'; index = start + 1; continue }
        let cursor = start + tagMatch[0].length
        let quote = null
        while (cursor < html.length) {
          const character = html[cursor]
          if (quote) { if (character === quote) quote = null }
          else if (character === '"' || character === "'") quote = character
          else if (character === '>') break
          cursor += 1
        }
        const tagText = html.slice(start, Math.min(cursor + 1, html.length))
        const isBase = tagMatch[1].toLowerCase() === 'base'
        const equiv = /http-equiv\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagText)
        const equivValue = decodeNumericReferences(equiv ? (equiv[1] ?? equiv[2] ?? equiv[3] ?? '') : '')
        const looksRefreshing = /refresh/i.test(equivValue) || /refresh/i.test(decodeNumericReferences(tagText))
        if (isBase || looksRefreshing) { index = cursor + 1; continue }
        out += tagText
        index = cursor + 1
      }
      return out
    }
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
      // Defence in depth for the preview copy only (never the file):
      // a `<meta http-equiv="refresh">` or `<base>` can steer navigation and
      // relative URLs. The sandbox already neutralises both in real Chromium and
      // Firefox (measured), but relying on one layer for a security boundary is
      // not acceptable, and neither tag carries visual meaning for a preview.
      const neutral = stripNavigationTags(String(source))
      return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="' + policy +
        '"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        svgLayout + projected + marked + '</head><body style="margin:' +
        (format==='svg'?'0':'12px') + '">' + neutral + '</body></html>'
    }
    /**
     * Resolve the export size of an SVG source: declared `width`/`height` first,
     * then the `viewBox` extents. Percentages, ems and every other unit are
     * refused instead of guessed: a PNG of the wrong size is worse than a clear
     * message. The source is parsed, never written and never fetched.
     */
    function svgPngGeometry(source) {
      try {
        const parsed = new DOMParser().parseFromString(String(source ?? ''), 'image/svg+xml')
        // Firefox replaces the whole document with a <parsererror> root while
        // Chromium keeps the partial tree; check the error node first so both
        // engines give the same explicit refusal.
        if (parsed.getElementsByTagName('parsererror').length)
          return { ok:false, reason:'la source SVG est invalide et ne peut pas être analysée.' }
        const root = parsed.documentElement
        if (!root || String(root.localName || root.nodeName).toLowerCase() !== 'svg')
          return { ok:false, reason:'la source SVG est invalide ou ne contient pas de racine <svg>.' }
        const declared = (value) => {
          const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(String(value ?? ''))
          return match ? Number(match[1]) : NaN
        }
        let width = declared(root.getAttribute('width'))
        let height = declared(root.getAttribute('height'))
        if (!(width > 0) || !(height > 0)) {
          const viewBox = String(root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
          if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) ||
              !(viewBox[2] > 0) || !(viewBox[3] > 0))
            return { ok:false, reason:'dimensions introuvables : déclarez width/height ou un viewBox valide.' }
          width = viewBox[2]
          height = viewBox[3]
        }
        return { ok:true, width, height }
      } catch {
        return { ok:false, reason:'la source SVG ne peut pas être analysée.' }
      }
    }
    /**
     * Active content is refused, not sanitised. Per the SVG-as-image model an
     * `<img>` loaded from a blob URL does not execute scripts and does not fetch
     * external resources in Chromium/Firefox; that is a browser behaviour, not a
     * licence to convert a document that declares a script. The file stays
     * editable as source, and the export says so.
     */
    function svgSourceHasScript(source) {
      return /<\s*(?:[A-Za-z_][\w.-]*:)?script(?=[\s/>])/i.test(String(source ?? ''))
    }
    /** Load a blob URL into an Image, with an explicit refusal on timeout. */
    function loadPngImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        let settled = false
        const finish = (callback, value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          callback(value)
        }
        const timer = setTimeout(() => finish(reject,
          new Error('le navigateur n’a pas rendu la source SVG à temps.')), 10000)
        image.onload = () => finish(resolve, image)
        image.onerror = () => finish(reject,
          new Error('le navigateur a refusé cette source SVG (image invalide ou non rendue).'))
        image.src = url
      })
    }
    function canvasToPngBlob(canvas) {
      return new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('la conversion canvas → PNG a échoué.')),
        'image/png'))
    }
    /** Trigger one download from an in-memory blob. No filesystem or Host write. */
    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
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
    /**
     * Multi-layer alignment. Each entry writes exactly ONE coordinate attribute
     * per layer (`x` for the horizontal modes, `y` for the vertical ones), so
     * the common Host batch `svg-attributes` applies the whole gesture as one
     * atomic patch: one Undo step, no second write path.
     *
     * The target is computed from the SAME transform-aware boxes the pointer
     * drag uses (`geometry.handles`): `x`/`y` are artboard-space edges and
     * `move.inverse` maps an artboard delta back into the layer's local space.
     */
    const ALIGNMENT_MODES = Object.freeze([
      {key:'left',axis:'x',edge:'start',label:'Aligner à gauche',text:'Gauche'},
      {key:'centerX',axis:'x',edge:'center',label:'Aligner au centre horizontal',text:'Centre'},
      {key:'right',axis:'x',edge:'end',label:'Aligner à droite',text:'Droite'},
      {key:'top',axis:'y',edge:'start',label:'Aligner en haut',text:'Haut'},
      {key:'middleY',axis:'y',edge:'center',label:'Aligner au milieu vertical',text:'Milieu'},
      {key:'bottom',axis:'y',edge:'end',label:'Aligner en bas',text:'Bas'},
    ])
    /**
     * Equal-gap distribution: the same single-coordinate primitive as alignment,
     * but the target is derived from the free space between the first and the
     * last box instead of from one shared edge. Both modes write exactly one
     * attribute per layer (`x` or `y`) and therefore ride the same atomic Host
     * batch: one request, one Undo step.
     */
    const DISTRIBUTION_MODES = Object.freeze([
      {key:'distributeX',axis:'x',label:'Distribuer horizontalement',text:'Distribuer ↔'},
      {key:'distributeY',axis:'y',label:'Distribuer verticalement',text:'Distribuer ↕'},
    ])
    /** Edge of one handle along the mode's axis, in artboard coordinates. */
    function alignmentEdge(handle, mode) {
      const start = mode.axis === 'x' ? handle.x : handle.y
      const size = mode.axis === 'x' ? handle.width : handle.height
      if (!Number.isFinite(start) || !Number.isFinite(size)) return null
      if (mode.edge === 'start') return start
      if (mode.edge === 'end') return start + size
      return start + size / 2
    }
    /** Same rounding as the drag gesture, so a saved value is never exotic. */
    function alignmentCoordinate(value) {
      const rounded = Math.round(value * 1000) / 1000
      return String(Object.is(rounded, -0) ? 0 : rounded)
    }
    /**
     * A pure local-x move only stays horizontal when the accumulated matrix has
     * b=0 (`inverse[1]=0`); a pure local-y move only stays vertical when
     * c=0 (`inverse[2]=0`). Under a rotation/pivot the single-axis write cannot
     * reach the target: alignment AND distribution share this refusal so both
     * gestures name the same cause instead of approximating.
     */
    function alignmentAxisRefusal(entry, axis) {
      const inverse = entry.move.inverse
      const scale = axis === 'x' ? inverse[0] : inverse[3]
      const cross = axis === 'x' ? inverse[1] : inverse[2]
      // A 90°/270° rotation keeps the matrix invertible but makes the axis
      // scale vanish while the cross term dominates: report the axis problem,
      // not a false "not invertible".
      if (!Number.isFinite(scale) || !Number.isFinite(cross) ||
          Math.abs(scale) < 1e-12 || Math.abs(cross) > 1e-9) {
        return 'Transform non alignable sur l’axe ' +
          (axis === 'x' ? 'horizontal' : 'vertical') + ' pour #' + entry.id +
          ' : rotation/pivot détecté, aucune approximation.'
      }
      return ''
    }
    // Rename pre-checks mirror `src/svg-rename.mjs` for the UI only; the Host is
    // still the only writer and re-validates every rule before touching bytes.
    const SVG_ID_PATTERN = /^[A-Za-z_][\w.:-]*$/
    const MAX_SVG_ID_LENGTH = 128
    /**
     * Conservative CLIENT pre-check: only the two cheapest, most common cases
     * are duplicated here (`url(#id)` and any `href="#id"` in the raw source).
     * CSS selectors, XML-encoded values, ARIA id lists, SMIL times and ids that
     * need CSS escaping are deliberately left to the Host, which stays the only
     * writer. A match inside a comment blocks the UI (accepted false positive);
     * a case this pre-check misses costs exactly one POST and zero writes.
     */
    function svgIdLooksReferenced(source, id) {
      if (typeof source !== 'string' || !id) return false
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const boundary = '(?![\\w.:-])'
      if (new RegExp('url\\(\\s*["\']?#' + escaped + boundary, 'i').test(source)) return true
      return new RegExp('(?:[\\w.-]+:)?href\\s*=\\s*["\']#' + escaped + boundary + '["\']', 'i').test(source)
    }
    /** Rewrite one id inside a selection list, without creating duplicates. */
    function rewriteRenameSelection(selection, from, to) {
      if (!from || !to) return selection
      const mapped = []
      for (const value of selection || []) {
        const next = value === from ? to : value
        if (!mapped.includes(next)) mapped.push(next)
      }
      return mapped
    }
    // SVG paths and shell stylesheet are translated from the committed Graphite V3 reference.
    const GRAPHITE_CSS = `
.dsh-studio-workbench{--bg:#15171b;--shell:#1d2026;--panel:#202329;--panel2:#262a31;--line:#333740;--soft:#2a2f39;--text:var(--dsw-alias-label-primary,#e8ebf0);--muted:#949ba9;--sub:var(--dsw-alias-label-tertiary,#6e7786);--blue:#c7ad8e;--blue-bg:#4b4035;--canvas:#111317;--shadow:0 14px 50px #080a0c9c;--radius:8px}
.dsh-studio-workbench *{box-sizing:border-box}
.dsh-studio-workbench{height:100%;margin:0;background:var(--bg);color:var(--text);font:12px/1.35 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dsh-studio-workbench button,.dsh-studio-workbench input,.dsh-studio-workbench select{font:inherit}
.dsh-studio-workbench button{border:0;background:none;color:inherit;cursor:pointer}
.dsh-studio-workbench button:disabled{opacity:.3;cursor:default}
.dsh-studio-workbench button:hover:not(:disabled){background:#ffffff0e}
.dsh-studio-workbench button:focus-visible,.dsh-studio-workbench input:focus-visible{outline:2px solid var(--blue);outline-offset:1px}
.dsh-studio-workbench{height:100%;min-height:650px;display:grid;grid-template-rows:48px 50px minmax(0,1fr) 30px;overflow:hidden}
.dsh-studio-workbench .dsh-studio-top{display:flex;align-items:center;padding:0 15px;gap:12px;background:#1e2127;border-bottom:1px solid var(--line)}
.dsh-studio-workbench .dsh-studio-mark{display:flex;align-items:center;gap:9px;font-weight:700;font-size:12.5px;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-brandmark{width:23px;height:23px;border-radius:6px;background:linear-gradient(145deg,#a88e70,#d5b796);display:grid;place-items:center;color:#fff;box-shadow:0 2px 11px #a88e7034}
.dsh-studio-workbench .dsh-studio-brandmark svg{width:15px;height:15px}
.dsh-studio-workbench .dsh-studio-tb-divider{height:20px;width:1px;background:var(--line)}
.dsh-studio-workbench .dsh-studio-crumb{font-weight:500;color:var(--muted);white-space:nowrap}
.dsh-studio-workbench .dsh-studio-crumb b{font-weight:600;color:var(--text)}
.dsh-studio-workbench .dsh-studio-tag{border:1px solid #3a414e;color:#aab3c0;padding:3px 8px;border-radius:5px;font-size:10px}
.dsh-studio-workbench .dsh-studio-grow{flex:1}
.dsh-studio-workbench .dsh-studio-avatars{display:flex;margin-right:3px}
.dsh-studio-workbench .dsh-studio-avatar{width:25px;height:25px;border:2px solid var(--shell);border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:10px;background:#546477;margin-right:-5px}
.dsh-studio-workbench .dsh-studio-avatar.dsh-studio-two{background:#66545e}
.dsh-studio-workbench .dsh-studio-topbtn{height:29px;padding:0 11px;border:1px solid #3a404b;background:#2c3038;border-radius:6px;font-weight:550;display:flex;align-items:center;gap:7px}
.dsh-studio-workbench .dsh-studio-topbtn.dsh-studio-primary{border:1px solid #bda17e;background:#4e4235;color:white}
.dsh-studio-workbench .dsh-studio-topbtn.dsh-studio-muted{background:transparent}
.dsh-studio-workbench .dsh-studio-topbtn svg{width:14px;height:14px}
.dsh-studio-workbench .dsh-studio-png-scale{height:29px;display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--muted);flex-shrink:0}
.dsh-studio-workbench .dsh-studio-png-scale select{height:29px;border:1px solid #3a404b;background:#2c3038;border-radius:6px;padding:0 5px;font-size:11px}
.dsh-studio-workbench .dsh-studio-png-reason{font-size:10px;line-height:1.25;color:var(--muted);max-width:190px;flex-shrink:0}
.dsh-studio-workbench .dsh-studio-toolbar{background:#1c1f25;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:center;padding:0 14px}
.dsh-studio-workbench .dsh-studio-tools{display:flex;align-items:center;gap:3px}
.dsh-studio-workbench .dsh-studio-tool{width:33px;height:33px;border-radius:6px;color:#aab2be;display:grid;place-items:center;position:relative}
.dsh-studio-workbench .dsh-studio-tool svg{width:17px;height:17px;stroke:currentColor;stroke-width:1.65;fill:none;stroke-linecap:round;stroke-linejoin:round}
.dsh-studio-workbench .dsh-studio-tool.dsh-studio-selected{background:#4b4035;color:#f1ebe2}
.dsh-studio-workbench .dsh-studio-tool .dsh-studio-shortcut{display:none;position:absolute;top:36px;z-index:20;background:#2c3038;padding:5px 9px;border:1px solid #444c59;color:#dce1e8;white-space:nowrap;border-radius:5px}
.dsh-studio-workbench .dsh-studio-tool:hover .dsh-studio-shortcut{display:block}
.dsh-studio-workbench .dsh-studio-sdiv{height:21px;border-left:1px solid var(--line);margin:0 8px}
.dsh-studio-workbench .dsh-studio-tooltext{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;color:#b0b8c4;font-size:11px}
.dsh-studio-workbench .dsh-studio-tooltext svg{width:15px;height:15px}
.dsh-studio-workbench .dsh-studio-active-dot{width:6px;height:6px;border-radius:50%;background:#b9b3a1}
.dsh-studio-workbench .dsh-studio-layout{display:grid;grid-template-columns:50px 244px minmax(320px,1fr) 298px;min-height:0}
.dsh-studio-workbench .dsh-studio-rail{background:#191c21;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;padding-top:11px;gap:8px}
.dsh-studio-workbench .dsh-studio-railbtn{width:34px;height:34px;display:grid;place-items:center;border-radius:7px;color:#939aa7}
.dsh-studio-workbench .dsh-studio-railbtn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round}
.dsh-studio-workbench .dsh-studio-railbtn.dsh-studio-selected{background:#383632;color:#d4b18a}
.dsh-studio-workbench .dsh-studio-rail .dsh-studio-spacer{flex:1}
.dsh-studio-workbench .dsh-studio-rail .dsh-studio-bottom{margin-bottom:11px}
.dsh-studio-workbench .dsh-studio-sidebar{display:flex;flex-direction:column;background:var(--panel);border-right:1px solid var(--line);min-height:0}
.dsh-studio-workbench .dsh-studio-sidehead{height:43px;padding:0 13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);font-weight:600}
.dsh-studio-workbench .dsh-studio-small-tool{width:23px;height:23px;border-radius:4px;color:var(--muted);font-size:16px}
.dsh-studio-workbench .dsh-studio-tabs{display:flex;padding:8px 10px 0;gap:16px;border-bottom:1px solid var(--line)}
.dsh-studio-workbench .dsh-studio-tab{padding:7px 3px 10px;color:var(--muted);font-size:11px;position:relative}
.dsh-studio-workbench .dsh-studio-tab.dsh-studio-selected{color:#e8edf6;font-weight:600}
.dsh-studio-workbench .dsh-studio-tab.dsh-studio-selected:after{content:"";height:2px;background:var(--blue);position:absolute;bottom:-1px;left:0;right:0}
.dsh-studio-workbench .dsh-studio-layer-search{margin:11px 10px 11px;border:1px solid #363a43;border-radius:6px;height:29px;display:flex;align-items:center;gap:7px;padding:0 9px;color:#7f8997}
.dsh-studio-workbench .dsh-studio-layer-search span{margin-left:auto;font:10px ui-monospace,monospace;border:1px solid #414550;border-radius:3px;padding:1px 5px}
.dsh-studio-workbench .dsh-studio-group{color:#808a9a;padding:10px 14px 7px;letter-spacing:.09em;text-transform:uppercase;font-size:9px;font-weight:700}
.dsh-studio-workbench .dsh-studio-layer-list{overflow:auto;flex:1;padding:0 7px}
.dsh-studio-workbench .dsh-studio-item{display:flex;align-items:center;gap:9px;padding:0 10px;height:31px;border-radius:5px;color:#b9c0cb;cursor:pointer;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-item .dsh-studio-mini{width:14px;color:#8f9aa9;text-align:center;font-size:11px;flex-shrink:0}
.dsh-studio-workbench .dsh-studio-item.dsh-studio-active{background:#464038;color:#f1eae0}
.dsh-studio-workbench .dsh-studio-item:hover:not(.dsh-studio-active){background:#ffffff0b}
.dsh-studio-workbench .dsh-studio-item .dsh-studio-label{overflow:hidden;text-overflow:ellipsis;flex:1}
.dsh-studio-workbench .dsh-studio-item .dsh-studio-eye{color:#687383}
.dsh-studio-workbench .dsh-studio-item.dsh-studio-child{padding-left:24px}
.dsh-studio-workbench .dsh-studio-panel-note{padding:13px;color:#7e8795;font-size:11px;border-top:1px solid var(--line);line-height:1.5}
.dsh-studio-workbench .dsh-studio-canvas{background:#111317;position:relative;min-width:0;overflow:hidden;display:flex;flex-direction:column}
.dsh-studio-workbench .dsh-studio-stage-top{height:38px;display:flex;align-items:center;gap:10px;padding:0 15px;border-bottom:1px solid #282b31;background:#1a1d22;color:#9099a7;font-size:11px;z-index:2}
.dsh-studio-workbench .dsh-studio-stage-top b{color:#e3e6eb;font-weight:550}
.dsh-studio-workbench .dsh-studio-stage-top .dsh-studio-pill{background:#2b303a;border-radius:4px;padding:4px 7px;font-size:10px}
.dsh-studio-workbench .dsh-studio-stage-top .dsh-studio-right{margin-left:auto;display:flex;gap:12px;align-items:center}
.dsh-studio-workbench .dsh-studio-workspace{flex:1;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center;background-color:#13161b;background-image:radial-gradient(#52566026 .7px,transparent .7px);background-size:17px 17px}
.dsh-studio-workbench .dsh-studio-artframe{position:relative;box-shadow:0 16px 45px #0009;transform:scale(var(--zoom,1));transform-origin:center;transition:transform .15s ease;flex-shrink:0}
.dsh-studio-workbench .dsh-studio-artboard-label{position:absolute;left:0;top:-27px;color:#aab4c4;font-size:12px;font-weight:550;display:flex;gap:7px;align-items:center}
.dsh-studio-workbench .dsh-studio-artboard-label:before{content:"▣";color:#c0a37f;font-size:14px}
.dsh-studio-workbench .dsh-studio-document-svg{width:680px;height:440px;display:block;background:#fff;touch-action:none;user-select:none}
.dsh-studio-workbench .dsh-studio-document-svg .dsh-studio-selectable{cursor:move}
.dsh-studio-workbench .dsh-studio-document-svg .dsh-studio-selectable:hover{filter:brightness(1.06)}
.dsh-studio-workbench .dsh-studio-selection{position:absolute;pointer-events:none;border:1.5px solid #cbb092;box-shadow:0 0 0 .5px #cbb09255}
.dsh-studio-workbench .dsh-studio-handle{position:absolute;width:9px;height:9px;background:#fff;border:1.5px solid #b89975;box-shadow:0 0 0 1px #fff7;border-radius:1px;pointer-events:auto;transform:translate(-50%,-50%);cursor:nwse-resize}
.dsh-studio-workbench .dsh-studio-handle.dsh-studio-nw{left:0;top:0}
.dsh-studio-workbench .dsh-studio-handle.dsh-studio-ne{left:100%;top:0;cursor:nesw-resize}
.dsh-studio-workbench .dsh-studio-handle.dsh-studio-sw{left:0;top:100%;cursor:nesw-resize}
.dsh-studio-workbench .dsh-studio-handle.dsh-studio-se{left:100%;top:100%}
.dsh-studio-workbench .dsh-studio-handle.dsh-studio-n{left:50%;top:0;cursor:ns-resize}
.dsh-studio-workbench .dsh-studio-handle.dsh-studio-s{left:50%;top:100%;cursor:ns-resize}
.dsh-studio-workbench .dsh-studio-handle.dsh-studio-w{left:0;top:50%;cursor:ew-resize}
.dsh-studio-workbench .dsh-studio-handle.dsh-studio-e{left:100%;top:50%;cursor:ew-resize}
.dsh-studio-workbench .dsh-studio-distance{position:absolute;top:-25px;right:0;color:#e2cfb4;font:10px ui-monospace,monospace;background:#5b4635;padding:3px 6px;border-radius:3px;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-canvas-bottom{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:8px;align-items:center;background:#242831e8;border:1px solid #3d424d;border-radius:8px;padding:5px;box-shadow:0 4px 22px #0006;backdrop-filter:blur(10px)}
.dsh-studio-workbench .dsh-studio-zoom-btn{padding:6px 10px;color:#dce2ec;border-radius:5px;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-zoom-btn:hover{background:#3c414b}
.dsh-studio-workbench .dsh-studio-zoom-btn.dsh-studio-min{min-width:29px}
.dsh-studio-workbench .dsh-studio-inspector{display:flex;flex-direction:column;background:var(--panel);border-left:1px solid var(--line);min-height:0;overflow:hidden}
.dsh-studio-workbench .dsh-studio-inspect-top{height:43px;display:flex;align-items:center;padding:0 17px;gap:20px;border-bottom:1px solid var(--line)}
.dsh-studio-workbench .dsh-studio-it{height:100%;display:flex;align-items:center;position:relative;color:#9fa7b3;font-weight:550}
.dsh-studio-workbench .dsh-studio-it.dsh-studio-on{color:#eaf1ff}
.dsh-studio-workbench .dsh-studio-it.dsh-studio-on:after{content:"";height:2px;background:var(--blue);position:absolute;bottom:-1px;left:0;right:0}
.dsh-studio-workbench .dsh-studio-inspect-scroll{overflow:auto;padding-bottom:20px}
.dsh-studio-workbench .dsh-studio-inspect-head{padding:17px;display:flex;align-items:center;gap:8px}
.dsh-studio-workbench .dsh-studio-type-icon{border:1px solid #4d5a6c;color:#ceb394;padding:4px 7px;border-radius:4px}
.dsh-studio-workbench .dsh-studio-inspect-title{font-weight:650;font-size:12px}
.dsh-studio-workbench .dsh-studio-inspect-detail{font-size:11px;color:#7e8896}
.dsh-studio-workbench .dsh-studio-ins-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dsh-studio-workbench .dsh-studio-ins-row.dsh-studio-triple{grid-template-columns:1fr 1fr 1fr}
.dsh-studio-workbench .dsh-studio-prop{position:relative;display:flex;align-items:center;gap:7px;padding:0 9px;height:30px;border:1px solid var(--dsw-alias-border-l2,#3a414c);background:#252a32;border-radius:5px;min-width:0}
.dsh-studio-workbench .dsh-studio-prop span{color:#8c96a6;min-width:10px}
.dsh-studio-workbench .dsh-studio-prop input{width:100%;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary,#e8ecf1);outline:none;font-size:11px}
.dsh-studio-workbench .dsh-studio-prop input:focus{outline:none}
.dsh-studio-workbench .dsh-studio-prop input[type=color]{width:18px;height:18px;padding:0;border:0;background:transparent;cursor:pointer;flex-shrink:0}
.dsh-studio-workbench .dsh-studio-ins-block{padding:0 17px 16px;border-bottom:1px solid var(--line);margin-bottom:16px}
.dsh-studio-workbench .dsh-studio-ins-block:last-child{border:0}
.dsh-studio-workbench .dsh-studio-ins-head{display:flex;justify-content:space-between;align-items:center;font-weight:650;font-size:11px;margin-bottom:11px}
.dsh-studio-workbench .dsh-studio-ins-head span{color:#858e9e;font-size:14px}
.dsh-studio-workbench .dsh-studio-hint{margin:8px 0 0;color:#808a9a;font-size:10px}
.dsh-studio-workbench .dsh-studio-rowspace{height:10px}
.dsh-studio-workbench .dsh-studio-toggle-row{height:32px;display:flex;justify-content:space-between;align-items:center;color:#aeb6c1}
.dsh-studio-workbench .dsh-studio-switch{width:28px;height:16px;background:#3a4050;border-radius:20px;position:relative}
.dsh-studio-workbench .dsh-studio-switch:before{content:"";position:absolute;left:3px;top:3px;width:10px;height:10px;border-radius:50%;background:#9ca4b3}
.dsh-studio-workbench .dsh-studio-switch.dsh-studio-on{background:#7e654c}
.dsh-studio-workbench .dsh-studio-switch.dsh-studio-on:before{left:15px;background:white}
.dsh-studio-workbench .dsh-studio-color-row{display:flex;gap:8px;align-items:center}
.dsh-studio-workbench .dsh-studio-swatch{width:22px;height:22px;border-radius:4px;background:#3c66ff;border:1px solid #ffffff44}
.dsh-studio-workbench .dsh-studio-colorcode{flex:1}
.dsh-studio-workbench .dsh-studio-opacity{width:35px}
.dsh-studio-workbench .dsh-studio-addprop{color:#9aa7be;background:#282c35;border:1px dashed #3c4350;width:100%;height:31px;border-radius:5px;text-align:left;padding-left:10px;font-size:11px}
.dsh-studio-workbench .dsh-studio-footer{background:#1d2025;border-top:1px solid var(--line);display:flex;align-items:center;padding:0 15px;gap:12px;color:#88929f;font-size:10px}
.dsh-studio-workbench .dsh-studio-footer .dsh-studio-r{margin-left:auto;display:flex;gap:14px}
.dsh-studio-workbench .dsh-studio-live{color:#6acbaa}
.dsh-studio-workbench .dsh-studio-kbd{border:1px solid #4c5360;border-radius:3px;padding:1px 4px;color:#a9b3c0;font-size:10px}
.dsh-studio-workbench .dsh-studio-toast{position:absolute;bottom:72px;left:50%;transform:translateX(-50%);background:#202d43;border:1px solid #4f8ce7;border-radius:7px;padding:9px 13px;color:#e5eeff;z-index:9;box-shadow:0 7px 22px #0008;opacity:0;pointer-events:none;transition:opacity .17s;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-toast.dsh-studio-show{opacity:1}
.dsh-studio-workbench .dsh-studio-icon-small{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round}
.dsh-studio-workbench .dsh-studio-mini-select{color:var(--muted);font-size:10px}
.dsh-studio-workbench input[type=range]{accent-color:#709dff}
.dsh-studio-workbench #exportLink{display:none}
.dsh-studio-workbench .dsh-studio-panel-sub{margin-top:2px;color:#717d8b;font-size:10px}
.dsh-studio-workbench .dsh-studio-helper{font-size:10px;color:#8d98a7}
.dsh-studio-workbench .dsh-studio-type-inspector[hidden]{display:none!important}
.dsh-studio-workbench .dsh-studio-field-label{display:block;color:#a6afbf;font-size:11px;margin-bottom:6px}
.dsh-studio-workbench .dsh-studio-type-content{width:100%;min-height:76px;resize:vertical;padding:10px 11px;border:1px solid #414a59;border-radius:6px;background:#171b23;color:#f1f4fa;font:12px/1.5 Inter,Arial,sans-serif;outline:none;box-sizing:border-box}
.dsh-studio-workbench .dsh-studio-type-content:focus,.dsh-studio-workbench .dsh-studio-type-select:focus{border-color:#bea88c;box-shadow:0 0 0 2px #bea88c22}
.dsh-studio-workbench .dsh-studio-type-select,.dsh-studio-workbench .dsh-studio-prop select{width:100%;min-width:0;border:1px solid #414a59;border-radius:5px;background:#262b34;color:#edf1f9;padding:7px 9px;font-size:11px;outline:none}
.dsh-studio-workbench .dsh-studio-prop select{border:0;padding:0;background:transparent}
.dsh-studio-workbench .dsh-studio-type-help{font-size:10px;color:#788a9f;margin-top:6px;line-height:1.5}
.dsh-studio-workbench .dsh-studio-type-actions{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:4px}
.dsh-studio-workbench .dsh-studio-type-action{height:31px;border:1px solid #3e4551;border-radius:5px;background:#262b34;color:#b5bfd0;font-size:17px}
.dsh-studio-workbench .dsh-studio-type-action:hover{background:#343d4d}
.dsh-studio-workbench .dsh-studio-type-action.dsh-studio-active{background:#294a7c;border-color:#4e85dd;color:#e4efff}
.dsh-studio-workbench .dsh-studio-type-action:nth-child(2){text-align:center}
.dsh-studio-workbench .dsh-studio-type-action:nth-child(3){text-align:right;padding-right:10px}
.dsh-studio-workbench .dsh-studio-type-action.dsh-studio-italic-action{font-family:Georgia,serif}
.dsh-studio-workbench .dsh-studio-type-action.dsh-studio-edit-canvas-action{font-size:16px}
.dsh-studio-workbench .dsh-studio-document-svg text.dsh-studio-selectable{cursor:move;pointer-events:bounding-box}
.dsh-studio-workbench .dsh-studio-document-svg text.dsh-studio-selectable:hover{paint-order:stroke fill;stroke:#8aafff;stroke-width:.22px}
.dsh-studio-workbench .dsh-studio-text-inline-editor{position:absolute;z-index:20;resize:none;overflow:hidden;background:#102038ef;color:#fff;border:1.5px solid #7eafff;box-shadow:0 0 0 3px #3b7bed25,0 12px 32px #0008;border-radius:3px;padding:0;outline:none;white-space:pre;line-height:1.2;min-height:28px}
.dsh-studio-workbench .dsh-studio-text-inline-editor:focus{outline:none}
.dsh-studio-workbench .dsh-studio-text-editor-hint{position:absolute;z-index:21;pointer-events:none;background:#274b81;color:#eaf3ff;padding:3px 7px;border-radius:3px;font-size:10px;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-selection.dsh-studio-is-text .dsh-studio-handle{display:none}
.dsh-studio-workbench .dsh-studio-document-svg.dsh-studio-text-insert-mode{cursor:text}
.dsh-studio-workbench{ --bg:var(--dsw-alias-bg-base,#191a1c); --shell:var(--dsw-alias-bg-base,#202125); --panel:var(--dsw-alias-bg-layer-1,#242528); --panel2:var(--dsw-alias-bg-layer-2,#2a2b2e); --line:var(--dsw-alias-border-l1,#38393b); --soft:#303136; --canvas:#151618; --muted:var(--dsw-alias-label-secondary,#a19f9d); }
.dsh-studio-workbench .dsh-studio-brandmark{box-shadow:none; background:linear-gradient(150deg,#756657,#ad9272)}
.dsh-studio-workbench .dsh-studio-topbtn.dsh-studio-primary{background:#504538;color:#f3eee6;border-color:#85745f}
.dsh-studio-workbench .dsh-studio-tool.dsh-studio-selected,.dsh-studio-workbench .dsh-studio-railbtn.dsh-studio-selected,.dsh-studio-workbench .dsh-studio-item.dsh-studio-active{color:#e9e1d7;background:#453b32}
.dsh-studio-workbench .dsh-studio-selection{border-color:#c6aa89;box-shadow:0 0 0 .5px #c6aa8955}
.dsh-studio-workbench .dsh-studio-handle{border-color:#b59d7e}
.dsh-studio-workbench .dsh-studio-workspace{background-color:var(--dsw-alias-bg-base,#17181a)}


.dsh-studio-workbench{container-type:inline-size;position:relative;min-height:0!important;border-radius:8px;--g-line:var(--line);--g-panel:var(--panel);--g-panel2:var(--panel2);--g-shell:var(--shell);--g-text:var(--text);--g-muted:var(--muted);--g-sub:var(--sub);--g-accent:var(--blue);--g-sel:#453b32;font-family:var(--dsw-font-family,Inter,system-ui,sans-serif)}

.dsh-studio-workbench button{border:0;background:none;color:inherit;cursor:pointer}
.dsh-studio-workbench input,.dsh-studio-workbench select,.dsh-studio-workbench textarea{color:var(--text)}

.dsh-studio-workbench .dsh-studio-top,.dsh-studio-workbench .dsh-studio-toolbar{min-width:0}
.dsh-studio-workbench .dsh-studio-topbtn{flex-shrink:0}
.dsh-studio-workbench .dsh-studio-brand{font-size:12.5px;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-crumb{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dsh-studio-workbench .dsh-studio-crumb b{overflow:hidden;text-overflow:ellipsis}
.dsh-studio-workbench .dsh-studio-tool.selected{color:#e9e1d7;background:#453b32}

.dsh-studio-workbench .dsh-studio-layout{overflow:hidden}
.dsh-studio-workbench .dsh-studio-sidebar{overflow:hidden}
.dsh-studio-workbench .dsh-studio-layer-search{width:calc(100% - 20px);background:transparent;color:var(--text);flex-shrink:0}
.dsh-studio-workbench .dsh-studio-layer-list{display:flex;flex-direction:column;gap:1px}
.dsh-studio-workbench .dsh-studio-layer-list>button{height:31px;min-height:31px;flex-shrink:0;border:0!important;display:flex;align-items:center;gap:9px;padding-top:0!important;padding-bottom:0!important;border-radius:5px}
.dsh-studio-workbench .dsh-studio-layer-list>button[aria-pressed=true]{background:#453b32!important;color:#e9e1d7}
.dsh-studio-workbench .dsh-studio-layer-list svg{width:14px;height:14px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.7}

.dsh-studio-workbench .dsh-studio-canvas{padding:0;min-height:0;background-image:none}
.dsh-studio-workbench .dsh-studio-stage-top{height:38px;flex:0 0 38px;min-width:0}
.dsh-studio-workbench .dsh-studio-stage-top b{max-width:50%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-studio-workbench .dsh-studio-workspace{min-height:0;padding:32px;overflow:auto}
.dsh-studio-workbench .dsh-studio-viewport{min-height:0!important;flex:1;align-self:stretch}
.dsh-studio-workbench .dsh-studio-artboard{max-width:calc(100% - 48px)!important;max-height:calc(100% - 48px)!important;width:min(var(--art-width),calc(100cqw - 48px),calc((100cqh - 48px) * var(--art-ratio)))!important}
.dsh-studio-workbench .dsh-studio-artboard-label{white-space:nowrap;font-size:11px}

.dsh-studio-workbench .dsh-studio-canvas-bottom{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:18;display:flex;align-items:center;gap:4px;padding:5px;background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 22px #0006}
.dsh-studio-workbench .dsh-studio-canvas-bottom button{height:29px;border:0;padding:4px 8px}
.dsh-studio-workbench .dsh-studio-canvas-bottom output{font-size:11px}
.dsh-studio-workbench .dsh-studio-canvas-bottom select{height:28px}

.dsh-studio-workbench .dsh-studio-inspector{padding:0;overflow:hidden}
.dsh-studio-workbench .dsh-studio-inspect-top{flex:0 0 43px}
.dsh-studio-workbench .dsh-studio-inspect-scroll{min-height:0;flex:1}
.dsh-studio-workbench .dsh-studio-inspect-head{min-height:76px}
.dsh-studio-workbench .dsh-studio-inspect-head svg{width:20px;height:20px;stroke:var(--blue);fill:none;stroke-width:1.65}
.dsh-studio-workbench .dsh-studio-ins-block{padding:0 17px 16px;margin-bottom:16px}
.dsh-studio-workbench .dsh-studio-ins-block input,.dsh-studio-workbench .dsh-studio-ins-block select{max-width:100%;min-width:0}
.dsh-studio-workbench .dsh-studio-prop input{height:28px;padding:0}
.dsh-studio-workbench .dsh-studio-prop{font-size:11px}
.dsh-studio-workbench .dsh-studio-ins-head{color:var(--text)}
.dsh-studio-workbench .dsh-studio-ins-head span{color:var(--muted)}

.dsh-studio-workbench details>summary{cursor:pointer;list-style:none;font-size:11px;color:var(--muted)}
.dsh-studio-workbench details>summary::-webkit-details-marker{display:none}
.dsh-studio-workbench details>summary:after{content:'⌄';margin-left:8px}
.dsh-studio-workbench .dsh-studio-menu{position:relative}
.dsh-studio-workbench .dsh-studio-menu>summary{height:29px;display:flex;align-items:center;padding:0 10px;border:1px solid var(--line);border-radius:6px;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-menu-body{position:absolute;top:36px;left:0;width:320px;padding:14px;display:grid;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:8px;z-index:40;box-shadow:var(--shadow)}
.dsh-studio-workbench .dsh-studio-menu-body input{width:100%;min-width:0}
.dsh-studio-workbench .dsh-studio-menu-body button{border:1px solid var(--line)}
.dsh-studio-workbench .dsh-studio-settings .dsh-studio-menu-body{left:auto;right:0}
.dsh-studio-workbench .dsh-studio-file-picker{position:absolute;left:15px;top:96px;width:min(600px,calc(100% - 30px));z-index:35;background:var(--panel)!important;border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}

.dsh-studio-workbench .dsh-studio-welcome{width:min(540px,100%);margin:auto;padding:28px;background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:12px}
.dsh-studio-workbench .dsh-studio-welcome button{border:1px solid var(--line);background:var(--panel2)}
.dsh-studio-workbench .dsh-studio-welcome [role=list]{max-height:230px;overflow:auto}
.dsh-studio-workbench .dsh-studio-empty{padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;min-height:0!important}

.dsh-studio-workbench .dsh-studio-alerts{position:absolute;top:104px;left:50%;transform:translateX(-50%);max-width:65%;z-index:32;background:var(--panel);border-radius:6px;box-shadow:var(--shadow)}
.dsh-studio-workbench .dsh-studio-alerts:empty{display:none}
.dsh-studio-workbench .dsh-studio-source{position:absolute;bottom:30px;left:294px;right:298px;z-index:30;background:var(--panel);border-top:1px solid var(--line);padding:8px 14px}
.dsh-studio-workbench .dsh-studio-source[open]{box-shadow:0 -8px 24px #0006}
.dsh-studio-workbench .dsh-studio-source textarea{max-height:35vh}
.dsh-studio-workbench .dsh-studio-footer{height:30px;min-width:0;white-space:nowrap;overflow:hidden}
.dsh-studio-workbench .dsh-studio-footer>span:last-child{margin-left:auto}

.dsh-studio-workbench .dsh-studio-mobile-tabs{display:none}
/* Document tabs: one row above the canvas, one tab per open document. */
.dsh-studio-workbench .dsh-studio-doc-tabs{display:flex;align-items:stretch;gap:2px;padding:0 8px;background:#181b20;border-bottom:1px solid var(--line);flex:0 0 auto;min-height:34px;max-height:34px;overflow-x:auto;overflow-y:hidden}
.dsh-studio-workbench .dsh-studio-doc-tab{display:flex;align-items:center;min-width:0;max-width:240px;border-right:1px solid var(--line);border-top:2px solid transparent;color:var(--muted)}
.dsh-studio-workbench .dsh-studio-doc-tab.dsh-studio-selected{background:#242830;border-top-color:var(--blue);color:var(--text)}
.dsh-studio-workbench .dsh-studio-doc-tab>button[role=tab]{display:flex;align-items:center;gap:6px;height:100%;padding:0 8px;font-size:11.5px;color:inherit;min-width:0}
.dsh-studio-workbench .dsh-studio-doc-tab>button[role=tab] .dsh-studio-doc-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-studio-workbench .dsh-studio-doc-dirty{color:#d8b184;font-size:9px;line-height:1;flex-shrink:0}
.dsh-studio-workbench .dsh-studio-doc-close{width:20px;height:20px;margin-right:3px;display:grid;place-items:center;border-radius:4px;font-size:14px;line-height:1;color:var(--muted);flex-shrink:0}
.dsh-studio-workbench .dsh-studio-doc-close:hover:not(:disabled){background:#ffffff14;color:var(--text)}
.dsh-studio-workbench .dsh-studio-tab-confirm{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px;background:#2a2320;border-bottom:1px solid #6d4a3f;color:#f0e2d6;font-size:11.5px;flex:0 0 auto}
.dsh-studio-workbench .dsh-studio-tab-confirm code{background:#00000038;padding:1px 5px;border-radius:3px}
.dsh-studio-workbench .dsh-studio-layout-controls{padding:0!important;border:0!important;background:transparent!important}
.dsh-studio-workbench .dsh-studio-technical{padding:0 17px 16px}
.dsh-studio-workbench .dsh-studio-technical>summary{padding:9px 0}
.dsh-studio-workbench .dsh-studio-type-actions{grid-template-columns:repeat(3,1fr)}

@container (max-width:1150px){.dsh-studio-workbench .dsh-studio-layout{grid-template-columns:50px 200px minmax(240px,1fr) 260px}
.dsh-studio-workbench .dsh-studio-source{left:250px;right:260px}
.dsh-studio-workbench .dsh-studio-helper{display:none}
}

@container (max-width:950px){.dsh-studio-workbench .dsh-studio-layout{grid-template-columns:44px 160px minmax(180px,1fr) 240px}
.dsh-studio-workbench .dsh-studio-source{left:204px;right:240px}
.dsh-studio-workbench .dsh-studio-status{display:none}
}

@container (max-width:750px){.dsh-studio-workbench{grid-template-rows:48px 50px minmax(0,1fr) 30px}
.dsh-studio-workbench .dsh-studio-mobile-tabs{display:flex;position:absolute;top:103px;left:8px;z-index:25;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:4px}
.dsh-studio-workbench .dsh-studio-mobile-tabs button{padding:4px 7px}
.dsh-studio-workbench .dsh-studio-layout{display:block}
.dsh-studio-workbench .dsh-studio-layout>.dsh-studio-rail{display:none}
.dsh-studio-workbench .dsh-studio-layout>.dsh-studio-sidebar,.dsh-studio-workbench .dsh-studio-layout>.dsh-studio-inspector,.dsh-studio-workbench .dsh-studio-layout>.dsh-studio-canvas{display:none;height:100%;padding-top:40px}
.dsh-studio-workbench .dsh-studio-layout>.dsh-studio-mobile-active{display:flex}
.dsh-studio-workbench .dsh-studio-source{left:0;right:0}
.dsh-studio-workbench .dsh-studio-crumb,.dsh-studio-workbench .dsh-studio-helper,.dsh-studio-workbench .dsh-studio-tag{display:none}
.dsh-studio-workbench .dsh-studio-tools{gap:0}
.dsh-studio-workbench .dsh-studio-tool{width:28px}
.dsh-studio-workbench .dsh-studio-toolbar{gap:5px;padding:0 6px}
.dsh-studio-workbench .dsh-studio-sdiv{margin:0 3px}
.dsh-studio-workbench .dsh-studio-workspace{padding:12px}
.dsh-studio-workbench .dsh-studio-welcome{padding:15px}
.dsh-studio-workbench .dsh-studio-inspector{max-height:none}
.dsh-studio-workbench .dsh-studio-canvas-bottom{bottom:35px}
.dsh-studio-workbench .dsh-studio-footer>span:nth-child(n+4){display:none}
}

@media(prefers-reduced-motion:reduce){.dsh-studio-workbench *{transition:none!important;animation:none!important;scroll-behavior:auto!important}
}


.dsh-studio-workbench{--dsw-alias-bg-base:#202125;--dsw-alias-bg-layer-1:#242528;--dsw-alias-bg-layer-2:#2a2b2e;--dsw-alias-border-l1:#38393b;--dsw-alias-border-l2:#3a414c;--dsw-alias-label-primary:#e8ebf0;--dsw-alias-label-secondary:#a19f9d;--dsw-alias-label-tertiary:#949ba9}
.dsh-studio-workbench .dsh-studio-tabs button[aria-selected=true]{color:var(--text);font-weight:600;border-bottom:2px solid var(--blue)}
.dsh-studio-workbench .dsh-studio-rail button{width:34px;height:34px;border-radius:7px;color:#939aa7;display:grid;place-items:center}
.dsh-studio-workbench .dsh-studio-rail button svg{width:17px;height:17px}
.dsh-studio-workbench .dsh-studio-rail button[aria-pressed=true]{background:#453b32;color:#e9e1d7}
.dsh-studio-workbench .dsh-studio-canvas-bottom{background:#242528}
.dsh-studio-workbench .dsh-studio-inspector{overflow:hidden!important}
.dsh-studio-workbench .dsh-studio-tooltext svg{width:15px;height:15px}
.dsh-studio-workbench .dsh-studio-brandmark svg{width:15px;height:15px}
.dsh-studio-workbench .dsh-studio-welcome{min-height:0!important;flex-shrink:0}
.dsh-studio-workbench .dsh-studio-source:not([open]){background:transparent;border:0;left:auto;right:12px;padding:6px 10px}
.dsh-studio-workbench .dsh-studio-artboard-label{pointer-events:none}


.dsh-studio-workbench .dsh-studio-layer-list>button{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Paint-order drag: the row is its own handle, the sibling under the pointer is
   the socket. Graphite stone/copper only; no blue and no new surface colours. */
.dsh-studio-workbench .dsh-studio-layer-list>button[data-layer-id]{cursor:pointer;user-select:none;-webkit-user-select:none}
.dsh-studio-workbench .dsh-studio-layer-list>button.dsh-studio-layer-dragging{opacity:.55!important;cursor:grabbing}
.dsh-studio-workbench .dsh-studio-layer-list>button.dsh-studio-drop-target{background:#4b4035!important;color:#f1ebe2;box-shadow:inset 0 0 0 1px #c7ad8e;cursor:grabbing}
.dsh-studio-workbench .dsh-studio-layer-list>button.dsh-studio-drop-refused{background:#3d2f2d!important;color:#f0d6d0;box-shadow:inset 0 0 0 1px #8a4b45;cursor:not-allowed}
.dsh-studio-workbench .dsh-studio-grip{margin-left:2px;color:#8f9aa9;font-size:12px;line-height:1;letter-spacing:-1px;opacity:0;cursor:grab;transition:opacity .12s ease}
.dsh-studio-workbench .dsh-studio-layer-list>button:hover .dsh-studio-grip,
.dsh-studio-workbench .dsh-studio-layer-list>button:focus-visible .dsh-studio-grip{opacity:.7}
.dsh-studio-workbench .dsh-studio-layer-list>button.dsh-studio-layer-dragging .dsh-studio-grip{opacity:1}
.dsh-studio-workbench .dsh-studio-drop-status{position:absolute;left:0;right:0;bottom:0;z-index:12;pointer-events:none;background:#262a31;border-top:1px solid #3d434c;padding:7px 12px;font-size:10.5px;line-height:1.45;color:#d8c3a6;box-shadow:0 -6px 18px #0006}
.dsh-studio-workbench .dsh-studio-drop-status[data-invalid=true]{color:#e7b2a8}
.dsh-studio-workbench .dsh-studio-sidebar{position:relative}
.dsh-studio-workbench .dsh-studio-toolbar button[data-tool]{flex-shrink:0}
.dsh-studio-workbench[data-preview=true] .dsh-studio-layout{grid-template-columns:minmax(0,1fr)}
.dsh-studio-workbench[data-preview=true] .dsh-studio-layout>.dsh-studio-rail,
.dsh-studio-workbench[data-preview=true] .dsh-studio-layout>.dsh-studio-sidebar,
.dsh-studio-workbench[data-preview=true] .dsh-studio-layout>.dsh-studio-inspector,
.dsh-studio-workbench[data-preview=true] [aria-label="Direct manipulation overlay"],
.dsh-studio-workbench[data-preview=true] .dsh-studio-source{display:none!important}
.dsh-studio-workbench .dsh-studio-tool[aria-pressed=true]{background:#453b32!important;color:#e9e1d7}
.dsh-studio-workbench .dsh-studio-type-commit{display:flex;gap:6px;margin-top:6px}
.dsh-studio-workbench .dsh-studio-type-commit:has(button:only-child:disabled){display:none}

    `
    const GRAPHITE_ICONS = {"previewBtn":[["path",{"d":"M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"export":[["path",{"d":"M12 3v13m-4-4 4 4 4-4M4 18v3h16v-3"}]],"select":[["path",{"d":"M5 3v17l5-5 4 7 2-1-4-7 8-1Z"}]],"frame":[["path",{"d":"M4 2v20M20 2v20M2 4h20M2 20h20"}]],"rect":[["rect",{"x":"4","y":"4","width":"16","height":"16","rx":"1"}]],"ellipse":[["circle",{"cx":"12","cy":"12","r":"9"}]],"pen":[["path",{"d":"M3 21 16 8m-4-4 8 8M3 21l5-1 12-12-4-4L4 16Z"}]],"text":[["path",{"d":"M3 5h18M12 5v15m-5 0h10M5 5l-1 4m15-4 1 4"}]],"hand":[["path",{"d":"M6 13V8a2 2 0 0 1 4 0v2-5a2 2 0 0 1 4 0v5-3a2 2 0 0 1 4 0v5-2a2 2 0 0 1 4 0v6c0 4-4 6-9 6-4 0-6-2-8-6l-3-3 2-2Z"}]],"undoBtn":[["path",{"d":"M9 5 3 11l6 6M3 11h12a6 6 0 0 1 0 12"}]],"redoBtn":[["path",{"d":"m15 5 6 6-6 6m6-6H9a6 6 0 0 0 0 12"}]],"Calques":[["path",{"d":"m3 8 9-5 9 5-9 5Z"}],["path",{"d":"m3 12 9 5 9-5M3 16l9 5 9-5"}]],"Composants":[["rect",{"x":"3","y":"3","width":"8","height":"8"}],["rect",{"x":"13","y":"3","width":"8","height":"8"}],["rect",{"x":"3","y":"13","width":"8","height":"8"}],["rect",{"x":"13","y":"13","width":"8","height":"8"}]],"Ressources":[["rect",{"x":"3","y":"3","width":"18","height":"18","rx":"2"}],["circle",{"cx":"8","cy":"9","r":"2"}],["path",{"d":"m3 18 6-5 3 3 4-6 5 6"}]],"Historique":[["path",{"d":"M3 12a9 9 0 1 1 3 7M3 5v7h7M12 6v6l4 2"}]],"Réglages":[["circle",{"cx":"12","cy":"12","r":"3"}],["path",{"d":"M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"}]],"brand":[["path",{"d":"M12 2 22 12 12 22 2 12Z"}]],"path":[["path",{"d":"M3 21 16 8m-4-4 8 8M3 21l5-1 12-12-4-4L4 16Z"}]],"circle":[["circle",{"cx":"12","cy":"12","r":"9"}]],"grid":[["path",{"d":"M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"}]]}
    function glyph(name) {
      return h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':'true',focusable:'false'},
        (GRAPHITE_ICONS[name]||GRAPHITE_ICONS.rect).map(([tag,attrs],index)=>h(tag,{...attrs,key:index})))
    }
    function Studio(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      const workspaceId = props && typeof props.workspaceId === 'string' ? props.workspaceId : ''
      const panelMode = props && props.panel === true
      // Exactly one target: a conversation session, or a registered workspace
      // (ADR-024). The Host refuses a request carrying both, so build one here.
      const scope = workspaceId ? {workspaceId} : (sessionId ? {sessionId} : null)
      const scopeReady = scope !== null
      const scopeQuery = !scope ? '' : (scope.workspaceId
        ? 'workspaceId='+encodeURIComponent(scope.workspaceId)
        : 'sessionId='+encodeURIComponent(scope.sessionId))
      const scopeBody = !scope ? {} : (scope.workspaceId
        ? {workspaceId:scope.workspaceId} : {sessionId:scope.sessionId})
      const scopeKey = !scope ? '' : (scope.workspaceId?'w:'+scope.workspaceId:'s:'+scope.sessionId)
      const scopeMessage = workspaceId ? 'Sélectionnez un espace de travail' : 'Open a conversation first'
      // Unsaved-recovery journal (ADR-035). `recoveryPending` is what could be
      // recovered for the CURRENT scope; `recoveryNotice` reports a storage
      // refusal once; `recoveryNote` states what the last recovery/ignore did.
      // Nothing here ever writes a document: recovery only fills the editor.
      const [recoveryEnabled,setRecoveryEnabled] = React.useState(recoveryPreference())
      const [recoveryPending,setRecoveryPending] = React.useState([])
      const [recoveryNotice,setRecoveryNotice] = React.useState('')
      const [recoveryNote,setRecoveryNote] = React.useState(null)
      const recoveryReportedRef = React.useRef({})
      const recoveryTimerRef = React.useRef(null)
      // Files already recovered in this session. Their entry is kept (a second
      // crash must still find it) but the banner stays dismissed until a save,
      // an ignore, or a return to the clean disk bytes.
      const recoveryHandledRef = React.useRef({})
      // Latest render state, readable from a timer or a page-hide listener whose
      // closure is older than the source being typed.
      const recoveryRuntimeRef = React.useRef({})
      // Per-file revision a successful save just committed. A journal entry is
      // normally based on the revision its edit started from and must keep that
      // base across recoveries; a successful save is the one event that
      // legitimately rebases it, so this marker is consumed by the next journal
      // write for that file.
      const recoverySavedRef = React.useRef({})
      // The revision currently loaded on disk (`/document`), updated
      // synchronously by `load()` so a recovery can compare it after an await.
      const currentDocRef = React.useRef(null)
      const [file,setFile] = React.useState('design.svg')
      // `file` is the path of the ACTIVE document. `pathInput` is only the text
      // typed in the File menu, kept apart so typing a future path can never
      // relabel the active tab or be mistaken for an open document.
      const [pathInput,setPathInput] = React.useState('design.svg')
      // One entry per open document: {id, file, state, dirty, stale}. `state`
      // is written when a tab is LEFT (the active tab is always the live React
      // state), so switching tabs never needs to read a stale async value.
      const [tabs,setTabs] = React.useState([])
      const [activeTabId,setActiveTabId] = React.useState(null)
      // A dirty tab is never closed silently: this holds the pending question.
      // The confirmation is a real dialog for assistive technology: focus moves
      // into it, Escape cancels it, and focus returns to the tab that asked.
      const tabCloseConfirmRef = React.useRef(null)
      const tabCloseTriggerRef = React.useRef(null)
      const [tabCloseConfirm,setTabCloseConfirm] = React.useState(null)
      React.useEffect(()=>{
        if(!tabCloseConfirm) return
        // Cancel is the safe default: focusing it means Enter never discards.
        tabCloseConfirmRef.current?.querySelector('button:last-of-type')?.focus()
      },[tabCloseConfirm])
      React.useEffect(()=>{
        if(tabCloseConfirm) return
        const trigger=tabCloseTriggerRef.current
        tabCloseTriggerRef.current=null
        if(trigger && trigger.isConnected) trigger.focus?.()
      },[tabCloseConfirm])
      const tabsRef = React.useRef([])
      const tabSeqRef = React.useRef(0)
      const [workspaceFiles,setWorkspaceFiles] = React.useState([])
      const [filesTruncated,setFilesTruncated] = React.useState(false)
      const [notice,setNotice] = React.useState('')
      const [showFiles,setShowFiles] = React.useState(false)
      const [fileSearch,setFileSearch] = React.useState('')
      const [newName,setNewName] = React.useState('')
      const [fileAction,setFileAction] = React.useState(null)
      const [layerMenu,setLayerMenu] = React.useState(null)
      const layerMenuRef = React.useRef(null)
      const layerMenuTriggerRef = React.useRef(null)
      // Pointer-based paint-order gesture. The row itself is the handle: moving
      // 4px starts the preview, hovering a sibling highlights the drop socket,
      // and only the drop sends one `svg-order` patch. Hovering and dragging
      // never write, because no request is issued before pointerup.
      const [layerDrag,setLayerDrag] = React.useState(null)
      const layerDragRef = React.useRef(null)
      const layerDragClickRef = React.useRef(false)
      const layerDragListenersRef = React.useRef(null)
      // A cancelled gesture must never write, even if a pointerup is still
      // delivered after the listeners were removed.
      const layerDragCancelRef = React.useRef(false)
      React.useEffect(()=>{
        if(layerMenu) layerMenuRef.current?.querySelector('button[role="menuitem"]:not(:disabled)')?.focus()
      },[layerMenu])
      // A gesture can lose both pointerup and lostpointercapture (release outside
      // the window). Nothing is written, but the preview must not stay stuck.
      React.useEffect(()=>{
        // Guarded: the harness and unit doubles expose a minimal window.
        if(typeof window==='undefined' || typeof window.addEventListener!=='function')return undefined
        const reset=()=>{
          if(!layerDragRef.current)return
          layerDragRef.current=null
          stopLayerDragListeners()
          setLayerDrag(null)
        }
        const view=typeof document!=='undefined' && typeof document.addEventListener==='function'?document:null
        window.addEventListener('blur',reset)
        view?.addEventListener('visibilitychange',reset)
        return ()=>{
          window.removeEventListener('blur',reset)
          view?.removeEventListener('visibilitychange',reset)
          // A gesture in flight must not outlive the component: its closure holds
          // the whole document and could write through a stale revision.
          stopLayerDragListeners()
        }
      },[])
      // In-memory clipboard: the copied element's exact source slice, so a paste
      // can land in the same document or in another one. Nothing is written to
      // the system clipboard and nothing leaves the renderer until a paste.
      const [clipboard,setClipboard] = React.useState(null)
      const [layerSearch,setLayerSearch] = React.useState('')
      const [previewMode,setPreviewMode] = React.useState(false)
      const [inspectAdvanced,setInspectAdvanced] = React.useState(false)
      const [creating,setCreating] = React.useState(false)
      const [doc,setDoc] = React.useState(null)
      const [source,setSource] = React.useState('')
      const [nodes,setNodes] = React.useState([])
      // Gradients of the open SVG, addressed by id: their stops are the only
      // values the inspector can edit, and only when they already exist.
      const [gradients,setGradients] = React.useState([])
      const [htmlElements,setHtmlElements] = React.useState([])
      const [htmlActive,setHtmlActive] = React.useState('')
      const previewContextRef=React.useRef(null)
      const previewBindingRef=React.useRef(null)
      const [htmlProperty,setHtmlProperty] = React.useState('background-color')
      const [htmlValue,setHtmlValue] = React.useState('')
      const [htmlText,setHtmlText] = React.useState('')
      const [htmlAttrName,setHtmlAttrName] = React.useState('class')
      const [htmlAttrValue,setHtmlAttrValue] = React.useState('')
      const [htmlStylesheets,setHtmlStylesheets] = React.useState([])
      const [htmlPreviewCss,setHtmlPreviewCss] = React.useState('')
      const [htmlPreviewCoverage,setHtmlPreviewCoverage] = React.useState(null)
      const [htmlViewport,setHtmlViewport] = React.useState('auto')
      const [mobilePanel,setMobilePanel] = React.useState('canvas')
      const [htmlStyleMatches,setHtmlStyleMatches] = React.useState([])
      const [returnHtmlRef,setReturnHtmlRef] = React.useState(null)
      const [cssRules,setCssRules] = React.useState([])
      // Conditional rules are a separate surface: addressed by their exact start
      // offset and never presented as unconditional styles.
      const [cssMedia,setCssMedia] = React.useState([])
      const [cssMediaStart,setCssMediaStart] = React.useState(null)
      const [cssMediaProperty,setCssMediaProperty] = React.useState('color')
      const [cssMediaValue,setCssMediaValue] = React.useState('')
      const [cssActive,setCssActive] = React.useState('')
      const [cssProperty,setCssProperty] = React.useState('color')
      const [cssValue,setCssValue] = React.useState('')
      const [textNodes,setTextNodes] = React.useState([])
      const [editingText,setEditingText] = React.useState('')
      const [textDraft,setTextDraft] = React.useState('')
      const [active,setActive] = React.useState('')
      const [extraSelection,setExtraSelection] = React.useState([])
      // Inline layer rename: {id, value} while one row is edited. Escape cancels,
      // Enter asks the Host for one exact `svg-rename` patch.
      const [renaming,setRenaming]=React.useState(null)
      React.useEffect(()=>{
        if(!renaming)return
        if(typeof document==='undefined'||typeof document.querySelector!=='function')return
        const input=document.querySelector('[data-layer-rename-input]')
        if(!input)return
        if(typeof input.focus==='function')input.focus()
        try{if(typeof input.select==='function')input.select()}catch(_){}
      },[renaming?.id])
      const [attribute,setAttribute] = React.useState('')
      const [value,setValue] = React.useState('')
      const [error,setError] = React.useState('')
      const [warning,setWarning] = React.useState('')
      // Outcome of the last alignment attempt. Kept apart from `error`: a
      // selection that is already aligned is a success with zero requests, not
      // a failure the user should read in red.
      const [alignNotice,setAlignNotice] = React.useState('')
      const [busy,setBusy] = React.useState(false)
      // PNG raster export is a local, in-memory conversion: it never touches
      // `busy` (which means "saving") and never writes an Undo entry.
      const [pngScale,setPngScale] = React.useState(1)
      const [pngBusy,setPngBusy] = React.useState(false)
      const [pngReasonId] = React.useState(()=>'dsh-studio-png-reason-'+(++pngReasonSequence))
      const layerMenuActionFocusRef=React.useRef(null)
      React.useEffect(()=>{
        const pending=layerMenuActionFocusRef.current
        if(busy||!pending)return
        layerMenuActionFocusRef.current=null
        if(!pending.trigger?.isConnected && document.activeElement===document.body)pending.fallback?.focus()
      },[busy,nodes])
      const [reloadRequired,setReloadRequired]=React.useState(false)
      const [geometry,setGeometry] = React.useState({artboard:null,handles:[]})
      // Artboard metadata is read from the file by the Host (`/document`). The
      // inputs below must show the declared size, never a computed guess.
      const [artboardMeta,setArtboardMeta] = React.useState(null)
      const [artboardScaleContent,setArtboardScaleContent] = React.useState(false)
      const artboardWidthRef=React.useRef(null)
      const artboardHeightRef=React.useRef(null)
      const [pathNodes,setPathNodes] = React.useState([])
      const [pathDrag,setPathDrag] = React.useState(null)
      const pathDragRef=React.useRef(null)
      const [dragDelta,setDragDelta] = React.useState(null)
      const dragRef=React.useRef(null)
      const panRef=React.useRef(null)
      const viewportRef=React.useRef(null)
      const viewportWheelRef=React.useRef(null)
      const viewportRefCallback=React.useRef(null)
      if(!viewportRefCallback.current) {
        // Callable ref: React calls it on mount, callers may still assign
        // `.current` to provide a synthetic viewport (unit tests do this).
        const callback=node=>{viewportRef.current=node;bindViewportWheel(node)}
        Object.defineProperty(callback,'current',{
          get:()=>viewportRef.current,
          set:value=>{viewportRef.current=value},
          configurable:true,
        })
        viewportRefCallback.current=callback
      }
      const [canvasTool,setCanvasTool]=React.useState('select')
      const [penPathId,setPenPathId]=React.useState('')
      const [penOutgoing,setPenOutgoing]=React.useState(null)
      const [penPreview,setPenPreview]=React.useState(null)
      const penGestureRef=React.useRef(null)
      const shapePendingRef=React.useRef(false)
      const penPendingRef=React.useRef(false)
      const [spaceHeld,setSpaceHeld]=React.useState(false)
      const [camera,setCamera]=React.useState({zoom:1,offsetX:0,offsetY:0})
      const [gridVisible,setGridVisible]=React.useState(false)
      const [snapToGrid,setSnapToGrid]=React.useState(false)
      const [smartGuides,setSmartGuides]=React.useState(true)
      const [gridStep,setGridStep]=React.useState(10)
      const [undoStack,setUndoStack]=React.useState([])
      const [redoStack,setRedoStack]=React.useState([])
      // Every value the journal needs, mirrored after the whole state list is
      // declared so a debounced timer or a `pagehide` listener never reads a
      // value captured by an older render (which could target another scope).
      recoveryRuntimeRef.current = {scope:scopeKey, scopeReady, enabled:recoveryEnabled,
        source:typeof source==='string'?source:'', tabs:tabsRef.current, activeTabId, file}
      function disconnectHtmlPreview() {
        const old=previewBindingRef.current
        previewBindingRef.current=null
        if(old) {
          try{old.frameDoc.removeEventListener('click',old.handler,true)}catch(_){}
        }
      }
      function exportNativeDocument() {
        if(!doc||busy||reloadRequired||refuseTextDraft())return
        if(source!==doc.source){setError('Enregistrez le brouillon source avant l’export.');return}
        const mime=doc.format==='svg'?'image/svg+xml':doc.format==='css'?'text/css':'text/html'
        const url=URL.createObjectURL(new Blob([doc.source],{type:mime+';charset=utf-8'}))
        const anchor=document.createElement('a')
        anchor.href=url;anchor.download=doc.file.split('/').pop()||('design.'+doc.format)
        anchor.click()
        setTimeout(()=>URL.revokeObjectURL(url),0)
      }
      /**
       * Export the CURRENT editor source as a PNG, entirely in memory.
       *
       * Truth is `source` (the visible editor text, including unsaved edits), not
       * `doc.source` on disk. The image is serialised into a Blob, loaded by an
       * `<img>`, painted into a canvas at the chosen scale and downloaded from
       * `canvas.toBlob`. This path has no `save()`, no `/apply` request, no file
       * write and no Undo entry; a refusal leaves the source editable.
       */
      async function exportPngDocument() {
        if(!doc||pngBusy)return
        if(doc.format!=='svg') {
          setError('Export PNG indisponible : la conversion ne s’applique qu’aux documents SVG natifs.')
          return
        }
        if(busy||reloadRequired) {
          setError('Document occupé : terminez l’opération en cours avant l’export PNG.')
          return
        }
        // A text draft lives outside the source textarea; exporting now would
        // silently omit it. The existing refusal asks the user to save or drop it.
        if(refuseTextDraft())return
        const current = typeof source === 'string' ? source : ''
        if(svgSourceHasScript(current)) {
          setError('Export PNG refusé : la source contient un <script>. Le fichier reste éditable en source, mais cette conversion ne prétend pas convertir du contenu actif.')
          return
        }
        const geometry = svgPngGeometry(current)
        if(!geometry.ok) {
          setError('Export PNG refusé : '+geometry.reason)
          return
        }
        const width = Math.round(geometry.width * pngScale)
        const height = Math.round(geometry.height * pngScale)
        if(!(width > 0) || !(height > 0)) {
          setError('Export PNG refusé : la planche ne produit pas une taille de sortie positive.')
          return
        }
        if(Math.max(width, height) > PNG_MAX_SIDE) {
          setError('Export PNG refusé : '+width+'×'+height+' px dépasse la limite de '+PNG_MAX_SIDE+' px par côté. Réduisez l’échelle ou les dimensions de la planche.')
          return
        }
        setPngBusy(true); setError('')
        let objectUrl = ''
        try {
          objectUrl = URL.createObjectURL(new Blob([current],{type:'image/svg+xml;charset=utf-8'}))
          const image = await loadPngImage(objectUrl)
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          const context = canvas.getContext('2d')
          if(!context) throw new Error('canvas 2D indisponible dans ce navigateur.')
          context.drawImage(image, 0, 0, width, height)
          const blob = await canvasToPngBlob(canvas)
          const name = doc.file.split('/').pop() || 'design.svg'
          const filename = /\.svg$/i.test(name) ? name.replace(/\.svg$/i,'.png') : name+'.png'
          downloadBlob(blob, filename)
          setNotice('PNG exporté : '+filename+' · '+width+'×'+height+' px (source actuelle, aucune écriture).')
        } catch(e) {
          setError('Export PNG impossible : '+String(e&&e.message||e))
        } finally {
          if(objectUrl) URL.revokeObjectURL(objectUrl)
          setPngBusy(false)
        }
      }
      function hasTextDraft() {
        const text=textNodes.find(item=>item.id===active)
        return !!text && textDraft!==text.text
      }
      function refuseTextDraft() {
        if(!hasTextDraft())return false
        setError('Texte non enregistré : enregistrez ou abandonnez le brouillon avant une autre action.')
        return true
      }
      /**
       * Canonical tab list + its render mirror, updated together. Anything that
       * needs the CURRENT tab list (including an async open that resumes after
       * an await) reads `tabsRef`, never a captured React value.
       */
      function commitTabs(next) {
        tabsRef.current = next
        setTabs(next)
      }
      /**
       * True when the ACTIVE document differs from its bytes on disk: an edited
       * source, or a pending text draft. This is the same rule the save guards
       * and the status line already used, now also driving the tab dot.
       */
      function isDirty() {
        return !!(doc && (source!==doc.source || hasTextDraft()))
      }
      /**
       * Report one storage refusal, once per reason for this session. The
       * journal functions stay silent (they return a status); the workbench
       * speaks here exactly once, so typing cannot flood the UI.
       */
      function reportRecoveryFailure(reason) {
        if(!reason || recoveryReportedRef.current[reason]) return
        recoveryReportedRef.current[reason] = true
        const messages = {
          'storage-unavailable':'Journal de récupération indisponible : le stockage local de ce navigateur est désactivé ou inaccessible. Les modifications ne sont pas journalisées ; le document reste éditable et enregistrable.',
          'storage-refused':'Journal de récupération impossible : le stockage local a refusé l’écriture (quota dépassé ou accès bloqué). Aucune troncature : le document reste éditable, mais seules les sauvegardes explicites le protègent.',
          'entry-too-large':'Journal de récupération : ce document dépasse la limite de 256 Kio par entrée et n’est pas journalisé (aucune troncature). Enregistrez-le explicitement pour le sécuriser.',
          'journal-full':'Journal de récupération plein : '+RECOVERY_MAX_ENTRIES+' documents sont déjà journalisés dans cet espace de travail. Aucune entrée n’a été remplacée et ce document n’est pas journalisé. Récupérez ou ignorez une entrée existante.',
        }
        setRecoveryNotice(messages[reason] || ('Journal de récupération indisponible ('+reason+').'))
      }
      /**
       * Copy every dirty open tab to the journal, synchronously and without any
       * request. The ACTIVE tab is read from the live mirror; background tabs
       * from their captured state, so a crash does not lose either.
       */
      function journalDirtyTabs() {
        const runtime = recoveryRuntimeRef.current || {}
        if(!runtime.enabled || !runtime.scopeReady || !runtime.scope) return
        const candidates = []
        const activeDoc = currentDocRef.current
        if(activeDoc && runtime.source !== activeDoc.source) {
          candidates.push({file:activeDoc.file, format:activeDoc.format, source:runtime.source,
            baseHash:activeDoc.hash, baseIdentity:activeDoc.identity})
        }
        for(const entry of (runtime.tabs || [])) {
          if(entry.id === runtime.activeTabId) continue
          const state = entry.state
          const tabDoc = state && state.doc
          if(!tabDoc || typeof state.source !== 'string' || state.source === tabDoc.source) continue
          candidates.push({file:tabDoc.file || entry.file, format:tabDoc.format, source:state.source,
            baseHash:tabDoc.hash, baseIdentity:tabDoc.identity})
        }
        if(!candidates.length) return
        const savedAt = Date.now()
        // ADR-035 · D3: an entry keeps the revision its edit started from until a
        // save actually succeeds for that file. The live document hash is the
        // CURRENT disk revision; after a recovery it is no longer the base of
        // the journaled edit, and rewriting it there would make the next reload
        // believe the file never diverged. A just-committed save (tracked in
        // `recoverySavedRef`) is the only rebase that is allowed.
        const existing = new Map(recoveryEntries(runtime.scope).map(entry => [entry.file, entry]))
        for(const candidate of candidates) {
          const previous = existing.get(candidate.file)
          const committed = recoverySavedRef.current && recoverySavedRef.current[candidate.file]
          const base = committed || (previous && previous.baseHash
            ? {baseHash:previous.baseHash, baseIdentity:previous.baseIdentity}
            : {baseHash:candidate.baseHash, baseIdentity:candidate.baseIdentity})
          const result = recoveryWrite(runtime.scope, {...candidate, ...base, savedAt})
          if(result.ok && committed) delete recoverySavedRef.current[candidate.file]
          if(!result.ok) reportRecoveryFailure(result.reason)
        }
      }
      function cancelRecoveryTimer() {
        if(recoveryTimerRef.current === null) return
        if(typeof clearTimeout === 'function') clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = null
      }
      /**
       * Debounced journal write. The delay keeps `localStorage` off the typing
       * path; `pagehide`, `beforeunload` and unmount flush the pending entry, so
       * a crash never depends on one timer having fired.
       */
      function scheduleRecoveryJournal() {
        const runtime = recoveryRuntimeRef.current || {}
        if(!runtime.enabled) { cancelRecoveryTimer(); return }
        if(typeof setTimeout !== 'function') { journalDirtyTabs(); return }
        cancelRecoveryTimer()
        recoveryTimerRef.current = setTimeout(()=>{
          recoveryTimerRef.current = null
          journalDirtyTabs()
        }, 250)
      }
      function visibleRecoveryEntries() {
        const handled = recoveryHandledRef.current || {}
        return recoveryEntries(scopeKey).filter(entry=>!handled[entry.file])
      }
      function refreshRecoveryEntries() {
        if(!scopeReady) { setRecoveryPending([]); return }
        setRecoveryPending(visibleRecoveryEntries())
      }
      /** Changing the preference is the only thing the Options checkbox does. */
      function chooseRecoveryPreference(next) {
        const enabled = !!next
        setRecoveryEnabled(enabled)
        if(!recoverySetPreference(enabled)) reportRecoveryFailure('storage-refused')
        if(!enabled) cancelRecoveryTimer()
        setRecoveryNote(null)
      }
      /** Discard one entry: the explicit “no, I do not want it” answer. */
      function ignoreRecoveryEntry(entry) {
        if(!entry) return
        delete recoveryHandledRef.current[entry.file]
        setRecoveryPending(visibleRecoveryEntries().filter(item=>item.file!==entry.file))
        if(!recoveryClear(scopeKey, entry.file)) reportRecoveryFailure('storage-refused')
        setRecoveryNote({kind:'ignored', file:entry.file, changed:false,
          text:'Récupération ignorée pour '+entry.file+' : la copie locale a été supprimée. Aucune écriture sur le disque.'})
      }
      /**
       * Load one journaled source INTO THE EDITOR. This is the only recovery
       * action and it never writes: it opens the file (read only), compares the
       * current revision with the one the entry was based on, then installs the
       * journaled text as an ordinary unsaved edit. Saving stays explicit and
       * goes through the existing precondition checks.
       */
      async function recoverRecoveryEntry(entry) {
        if(!entry || busy || creating) return
        if(refuseTextDraft()) return
        const openTab = tabsRef.current.find(item=>item.file===entry.file) || null
        if(openTab) {
          const dirty = openTab.id===activeTabId ? isDirty() : !!openTab.dirty
          if(dirty) {
            setError('Des modifications non enregistrées existent déjà pour '+entry.file+
              ' : enregistrez-les ou abandonnez-les avant de récupérer la copie locale.')
            return
          }
        }
        setError(''); setRecoveryNote(null)
        if(openTab) {
          if(!activateTab(openTab.id)) return
          // D4: re-read the current revision even when the tab is already open.
          // A tab opened before an external change holds the revision it was
          // loaded with; comparing that stale value would hide the divergence
          // and the later save would fail with a misleading 409.
          if(!await load(true, entry.file)) return
        } else if(!await openInTab(entry.file)) return
        const current = currentDocRef.current
        if(!current || current.file!==entry.file) {
          setError('Récupération impossible : '+entry.file+' n’a pas pu être ouvert. Aucune écriture n’a été faite.')
          return
        }
        const changed = !!(entry.baseHash && current.hash && entry.baseHash!==current.hash)
        setSource(entry.source)
        recoveryHandledRef.current[entry.file] = true
        setRecoveryPending(visibleRecoveryEntries())
        // D5: the two clauses must never contradict each other. Recovery itself
        // wrote nothing; the disk may still have changed because someone else
        // wrote it, and that is stated as a separate fact.
        setRecoveryNote({kind:'recovered', file:entry.file, changed,
          text:'Source journalisée chargée dans l’éditeur pour '+entry.file+
            '. Aucune écriture : rien n’a été enregistré sur le disque.'+
            (changed?' Attention : ce fichier a changé sur le disque depuis la journalisation (révision différente) ; la version du disque n’a pas été remplacée. Comparez avant d’enregistrer ; un enregistrement explicite remplacerait la version actuelle.':'')})
      }
      // At mount (and on a scope change) offer what can be recovered for THIS
      // workspace. It is only read: no file is opened and nothing is written.
      React.useEffect(()=>{
        refreshRecoveryEntries()
      },[scopeKey])
      // Journal the active and background dirty tabs whenever the document or
      // the tab set changes. A source identical to disk clears a provably stale
      // entry instead of resurfacing work that no longer exists.
      React.useEffect(()=>{
        if(!scopeReady) return
        if(!recoveryEnabled) { cancelRecoveryTimer(); return }
        const current = currentDocRef.current
        if(current && typeof source==='string' && source===current.source) {
          const stale = recoveryEntries(scopeKey).find(item=>item.file===current.file && item.source===current.source)
          if(stale) {
            recoveryClear(scopeKey, current.file)
            delete recoveryHandledRef.current[current.file]
            delete recoverySavedRef.current[current.file]
            setRecoveryPending(visibleRecoveryEntries())
          }
        }
        scheduleRecoveryJournal()
      },[scopeKey,source,doc,tabs,recoveryEnabled])
      // A page hide/reload/unmount must not lose the entry the debounce has not
      // written yet. The listener reads the live mirror, never a stale closure.
      React.useEffect(()=>{
        if(typeof window==='undefined' || !window || typeof window.addEventListener!=='function') return undefined
        const flush = () => { cancelRecoveryTimer(); journalDirtyTabs() }
        window.addEventListener('pagehide',flush)
        window.addEventListener('beforeunload',flush)
        return ()=>{
          window.removeEventListener('pagehide',flush)
          window.removeEventListener('beforeunload',flush)
          flush()
        }
      },[])
      /**
       * Every piece of state that belongs to one document. Missing a field here
       * would leak one document's inspector or selection into another, so the
       * list is deliberately exhaustive and mirrored by `emptyTabState()`.
       */
      function captureTabState() {
        return {
          file, doc, source, nodes, gradients,
          htmlElements, htmlActive, htmlProperty, htmlValue, htmlText, htmlAttrName, htmlAttrValue,
          htmlStylesheets, htmlPreviewCss, htmlPreviewCoverage, htmlStyleMatches,
          cssRules, cssMedia, cssMediaStart, cssMediaProperty, cssMediaValue,
          cssActive, cssProperty, cssValue,
          textNodes, editingText, textDraft, active, extraSelection, renaming, attribute, value,
          geometry, artboardMeta, artboardScaleContent, pathNodes, camera,
          undoStack, redoStack, reloadRequired, warning, alignNotice,
          returnHtmlRef, penPathId, penOutgoing,
        }
      }
      /** Neutral state for a new tab or for the landing screen. */
      function emptyTabState(fileName='design.svg') {
        return {
          file:fileName, doc:null, source:'', nodes:[], gradients:[],
          htmlElements:[], htmlActive:'', htmlProperty:'background-color', htmlValue:'',
          htmlText:'', htmlAttrName:'class', htmlAttrValue:'',
          htmlStylesheets:[], htmlPreviewCss:'', htmlPreviewCoverage:null, htmlStyleMatches:[],
          cssRules:[], cssMedia:[], cssMediaStart:null, cssMediaProperty:'color', cssMediaValue:'',
          cssActive:'', cssProperty:'color', cssValue:'',
          textNodes:[], editingText:'', textDraft:'', active:'', extraSelection:[], renaming:null,
          attribute:'', value:'',
          geometry:{artboard:null,handles:[]}, artboardMeta:null, artboardScaleContent:false,
          pathNodes:[], camera:{zoom:1,offsetX:0,offsetY:0},
          undoStack:[], redoStack:[], reloadRequired:false, warning:'', alignNotice:'',
          returnHtmlRef:null, penPathId:'', penOutgoing:null,
        }
      }
      /**
       * Install one tab's captured state as the live document state. This is a
       * pure renderer operation: no `/document`, no `/apply`, no filesystem
       * access. A gesture in flight is dropped so it can never continue against
       * another document's revision.
       */
      function applyTabState(state) {
        const next = state || emptyTabState()
        disconnectHtmlPreview()
        setFile(next.file); setPathInput(next.file)
        setDoc(next.doc); setSource(next.source)
        currentDocRef.current = next.doc || null
        setNodes(next.nodes||[]); setGradients(next.gradients||[])
        setHtmlElements(next.htmlElements||[]); setHtmlActive(next.htmlActive||'')
        setHtmlProperty(next.htmlProperty||'background-color'); setHtmlValue(next.htmlValue||'')
        setHtmlText(next.htmlText||''); setHtmlAttrName(next.htmlAttrName||'class')
        setHtmlAttrValue(next.htmlAttrValue||'')
        setHtmlStylesheets(next.htmlStylesheets||[]); setHtmlPreviewCss(next.htmlPreviewCss||'')
        setHtmlPreviewCoverage(next.htmlPreviewCoverage||null)
        setHtmlStyleMatches(next.htmlStyleMatches||[])
        setCssRules(next.cssRules||[]); setCssMedia(next.cssMedia||[])
        setCssMediaStart(next.cssMediaStart===undefined?null:next.cssMediaStart)
        setCssMediaProperty(next.cssMediaProperty||'color'); setCssMediaValue(next.cssMediaValue||'')
        setCssActive(next.cssActive||''); setCssProperty(next.cssProperty||'color')
        setCssValue(next.cssValue||'')
        setTextNodes(next.textNodes||[]); setEditingText(next.editingText||'')
        setTextDraft(next.textDraft||''); setActive(next.active||'')
        setExtraSelection(next.extraSelection||[]); setRenaming(next.renaming||null)
        setAttribute(next.attribute||''); setValue(next.value||'')
        setGeometry(next.geometry||{artboard:null,handles:[]})
        setArtboardMeta(next.artboardMeta||null)
        setArtboardScaleContent(!!next.artboardScaleContent)
        setPathNodes(next.pathNodes||[]); setCamera(next.camera||{zoom:1,offsetX:0,offsetY:0})
        setUndoStack(next.undoStack||[]); setRedoStack(next.redoStack||[])
        setReloadRequired(!!next.reloadRequired); setWarning(next.warning||'')
        setAlignNotice(next.alignNotice||'')
        setReturnHtmlRef(next.returnHtmlRef||null)
        setPenPathId(next.penPathId||''); setPenOutgoing(next.penOutgoing||null)
        // Transient gesture state never crosses a tab boundary.
        setPathDrag(null); pathDragRef.current=null
        setDragDelta(null); dragRef.current=null
        setPenPreview(null); penGestureRef.current=null
        shapePendingRef.current=false; penPendingRef.current=false
        panRef.current=null
      }
      /** Drop every per-document state so the landing state is honest again. */
      function closeDocument() {
        applyTabState({...emptyTabState(file), file})
      }
      /**
       * Make one tab active. The state of the tab being left is captured first,
       * so an unsaved source, a text draft, the selection and Undo/Redo all
       * survive the switch. No request is issued: `/apply` stays reserved for an
       * explicit save.
       */
      function activateTab(id) {
        if(busy||creating) return false
        const list = tabsRef.current
        const target = list.find(entry=>entry.id===id)
        if(!target) return false
        if(id===activeTabId) return true
        const dirty = isDirty()
        commitTabs(list.map(entry=>entry.id===activeTabId
          ? {...entry, state:captureTabState(), dirty}
          : entry))
        setActiveTabId(id)
        applyTabState(target.state)
        setError(''); setNotice(''); setTabCloseConfirm(null)
        if(target.stale) {
          // The file was renamed on disk while this tab was in the background:
          // refresh its revision before the user can edit through a stale hash.
          commitTabs(tabsRef.current.map(entry=>entry.id===id?{...entry, stale:false}:entry))
          void load(true, target.file)
        }
        return true
      }
      /**
       * Open a document in its own tab, or activate the tab that already shows
       * it. Opening never writes: it only reads `/document`. Past `MAX_TABS` the
       * request is refused with a message naming the limit.
       */
      async function openInTab(targetFile) {
        if(!scopeReady) { setError(scopeMessage); return false }
        if(busy) return false
        const list = tabsRef.current
        const existing = list.find(entry=>entry.file===targetFile)
        if(existing) return activateTab(existing.id)
        if(list.length>=MAX_TABS) {
          setError('Limite de '+MAX_TABS+' onglets ouverts : fermez un onglet avant d’en ouvrir un autre. Aucun fichier n’a été modifié.')
          return false
        }
        const previousActive = activeTabId
        const previousState = previousActive ? captureTabState() : null
        const previousDirty = previousActive ? isDirty() : false
        const id = 'tab-'+(++tabSeqRef.current)
        const placeholder = {id, file:targetFile, state:{...emptyTabState(targetFile)}, dirty:false, stale:false}
        commitTabs([...list.map(entry=>entry.id===activeTabId
          ? {...entry, state:previousState, dirty:previousDirty}
          : entry), placeholder])
        setActiveTabId(id)
        applyTabState(placeholder.state)
        setError(''); setNotice(''); setTabCloseConfirm(null)
        const opened = await load(true, targetFile)
        if(!opened) {
          // Roll back instead of leaving a dead tab: the previous document is
          // reinstalled exactly as it was, still unsaved, still editable.
          commitTabs(tabsRef.current.filter(entry=>entry.id!==id))
          if(previousActive && previousState) {
            setActiveTabId(previousActive)
            applyTabState(previousState)
          } else {
            setActiveTabId(null)
            closeDocument()
          }
          return false
        }
        return true
      }
      /**
       * Close one tab. A dirty tab is never discarded silently: without an
       * explicit `discard` this only asks the question, leaving the tab and the
       * bytes untouched. Closing never writes.
       */
      function closeTab(id=activeTabId, {discard=false,force=false}={}) {
        // D2: a save reads its base revision from the tab that is open when the
        // POST starts. Closing (or discarding) that tab mid-save would let the
        // in-flight write land for a document the user just dismissed. Refuse
        // until the save settles; internal callers that already own `busy`
        // (file deletion) pass `force`.
        if(busy && !force) {
          setError('Enregistrement en cours : attendez la fin de la sauvegarde avant de fermer cet onglet.')
          return false
        }
        const list = tabsRef.current
        const index = list.findIndex(entry=>entry.id===id)
        if(index<0) return false
        const entry = list[index]
        const dirty = entry.id===activeTabId ? isDirty() : !!entry.dirty
        if(dirty && !discard) {
          tabCloseTriggerRef.current=typeof document!=='undefined'?document.activeElement:null
          setTabCloseConfirm({id, file:entry.file})
          return false
        }
        // D6: “close without saving” is the explicit no for this file's unsaved
        // work, so its journaled copy must go too; otherwise a reload would
        // offer back exactly what the user abandoned.
        if(discard && scopeReady && entry.file) {
          const hadEntry = recoveryEntries(scopeKey).some(item=>item.file===entry.file)
          delete recoveryHandledRef.current[entry.file]
          delete recoverySavedRef.current[entry.file]
          if(hadEntry) {
            if(!recoveryClear(scopeKey, entry.file)) reportRecoveryFailure('storage-refused')
            setRecoveryPending(visibleRecoveryEntries())
          }
        }
        setTabCloseConfirm(null)
        const remaining = list.filter(item=>item.id!==id)
        commitTabs(remaining)
        if(entry.id!==activeTabId) return true
        const next = remaining[index] || remaining[index-1] || null
        if(next) {
          setActiveTabId(next.id)
          applyTabState(next.state)
          setError(''); setNotice('')
          if(next.stale) {
            commitTabs(tabsRef.current.map(item=>item.id===next.id?{...item, stale:false}:item))
            void load(true, next.file)
          }
        } else {
          setActiveTabId(null)
          closeDocument()
        }
        return true
      }
      /**
       * Roving-tabindex keyboard model for the document strip: arrows move the
       * focus, Enter/Space activates. Canvas shortcuts are stopped here, so an
       * arrow key on a tab can never move the selected layer.
       */
      function onTabKeyDown(event, entry) {
        const key = event.key
        if(key==='Enter' || key===' ') {
          event.preventDefault(); event.stopPropagation(); activateTab(entry.id); return
        }
        if(!['ArrowRight','ArrowLeft','Home','End'].includes(key)) return
        event.preventDefault(); event.stopPropagation()
        const root = event.currentTarget?.closest?.('[role="tablist"]')
        const buttons = root ? Array.from(root.querySelectorAll('[role="tab"]')) : []
        const index = buttons.indexOf(event.currentTarget)
        if(!buttons.length || index<0) {
          const list = tabsRef.current
          const current = list.findIndex(item=>item.id===entry.id)
          const delta = key==='ArrowRight' ? 1 : key==='ArrowLeft' ? -1 : 0
          const target = key==='Home' ? list[0]
            : key==='End' ? list[list.length-1]
              : list[(current+delta+list.length)%list.length]
          if(target) activateTab(target.id)
          return
        }
        const next = key==='Home' ? 0
          : key==='End' ? buttons.length-1
            : (index+(key==='ArrowRight'?1:-1)+buttons.length)%buttons.length
        buttons[next]?.focus?.()
      }
      async function load(force=false, targetFile=file, retainSelection='', onLoaded=null) {
        if(!force && refuseTextDraft())return false
        if(!force && doc && source!==doc.source) {setError('Unsaved source changes: save or discard them before opening another file');return false}
        if(!scopeReady) {setError(scopeMessage);return false}
        setBusy(true);setError('')
        try {
          const url='/document?'+scopeQuery+'&file='+encodeURIComponent(targetFile)
          const data=await request(url)
          if(doc?.file!==targetFile) {
            setCamera({zoom:1,offsetX:0,offsetY:0})
            // A selection belongs to the document that owns those ids; keeping
            // it across files would point at layers that no longer exist.
            setExtraSelection([])
            setRenaming(null)
            setCanvasTool('select')
            setPenPathId('');setPenOutgoing(null);setPenPreview(null)
            penGestureRef.current=null;penPendingRef.current=false
            panRef.current=null
            setArtboardScaleContent(false)
          }
          disconnectHtmlPreview()
          setFile(targetFile)
          setPathInput(targetFile)
          setDoc(data.document);setSource(data.document.source);setNodes(data.nodes||[]);setGradients(data.gradients||[])
          // The revision now on disk, kept synchronously so a recovery that
          // resumes after an `await` compares the real one, not a stale render.
          currentDocRef.current = data.document
          setHtmlElements(data.htmlElements||[])
          setHtmlStylesheets(data.stylesheets||[])
          setHtmlPreviewCss(data.previewCss||'')
          setHtmlPreviewCoverage(data.previewCoverage||null)
          setHtmlStyleMatches(data.styleMatches||[])
          setCssRules(data.cssRules||[])
          setCssMedia(data.cssMedia||[])
          if(doc?.file!==targetFile){
            setHtmlActive('');setHtmlValue('')
            setCssActive('');setCssValue('')
            setCssMediaStart(null);setCssMediaValue('')
          } else if(data.cssRules?.length && cssActive){
            const retained=data.cssRules.find(rule=>rule.selector===cssActive)
            setCssValue(retained?.declarations?.find(d=>d.property===cssProperty)?.value||'')
          }
          if(doc?.file===targetFile && cssMediaStart!==null){
            const retainedMedia=(data.cssMedia||[]).find(rule=>rule.start===cssMediaStart)
            if(retainedMedia)setCssMediaValue(retainedMedia.declarations
              .find(d=>d.property===cssMediaProperty)?.value||'')
            else setCssMediaStart(null)
          }
          setReloadRequired(false)
          setAlignNotice('')
          setTextNodes(data.textNodes||[]);setEditingText('')
          setTextDraft((data.textNodes||[]).find(item=>item.id===retainSelection)?.text||'')
          setGeometry(data.geometry||{artboard:null,handles:[]})
          setArtboardMeta(data.artboard||null)
          setPathNodes(data.pathNodes||[])
          setPathDrag(null);pathDragRef.current=null
          setDragDelta(null);dragRef.current=null
          if(!force || (doc && doc.file!==targetFile)) {setUndoStack([]);setRedoStack([])}
          setWarning(data.warning||'')
          // A creation notice belongs to the file it created, not to whatever is
          // opened next.
          if(doc?.file!==targetFile) setNotice('')
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
        if(!scopeReady){setError(scopeMessage);return}
        setBusy(true);setError('')
        try {
          await loadWorkspaceFiles()
          setFileSearch('')
          setShowFiles(true)
          // The picker opens below the File menu; leaving that menu open on top
          // of it made its own controls (the new-file field) swallow the clicks
          // aimed at the picker's rename/delete buttons.
          const openMenu=typeof document!=='undefined'
            ? document.querySelector('.dsh-studio-top details.dsh-studio-menu[open]') : null
          openMenu?.removeAttribute('open')
        }catch(e){setError(String(e.message))}finally{setBusy(false)}
      }
      // Files can appear while the view is open (the conversation creates them),
      // so the list is reloadable instead of captured once at mount.
      async function loadWorkspaceFiles() {
        if(!scopeReady) return false
        try {
          const response=await request('/files?'+scopeQuery)
          setWorkspaceFiles(response.files||[])
          setFilesTruncated(!!response.truncated)
          return true
        } catch(error) { setError('Impossible de lister les fichiers : '+String(error.message));return false }
      }

      // The tab used to open on an empty body: the workspace list only appeared
      // after clicking "Parcourir…", so a first visit looked broken.
      React.useEffect(()=>{
        if(!scopeReady) return undefined
        let cancelled=false
        void loadWorkspaceFiles().then(()=>{ if(cancelled) return })
        return ()=>{cancelled=true}
      },[scopeKey])

      async function openPickedFile(picked) {
        const opened=await openInTab(picked)
        if(opened)setShowFiles(false)
      }
      /**
       * Rename or delete one workspace file through the Host.
       *
       * Both operations are destructive in a way the editor cannot undo (the
       * Host keeps no history for them), so each one requires the opened
       * revision and an explicit confirmation naming the exact path. A file that
       * is not open is read first, because acting on unseen bytes is exactly the
       * silent failure mode this editor refuses everywhere else.
       *
       * Files open in a BACKGROUND tab are handled too: an unsaved tab refuses
       * the operation, a renamed one follows the new path (and refreshes its
       * revision when it is activated), a deleted one is removed with its tab.
       */
      async function manageFile(kind, target, nextPath='') {
        if(busy||creating) return
        const openTab=tabsRef.current.find(entry=>entry.file===target)||null
        const openTarget=!!openTab
        const openDirty=openTab?(openTab.id===activeTabId?isDirty():!!openTab.dirty):false
        if(openTarget && openDirty) {
          setError('Modifications non enregistrées dans '+target+' : enregistrez ou abandonnez-les avant de renommer ou supprimer ce fichier.')
          return
        }
        if(kind==='rename' && !nextPath.trim()) {setError('Indiquez le nouveau nom du fichier.');return}
        setBusy(true);setError('');setNotice('')
        try {
          let baseHash,baseIdentity
          const openDocument=openTab?(openTab.id===activeTabId?doc:openTab.state?.doc):null
          if(openDocument && openDocument.hash) {baseHash=openDocument.hash;baseIdentity=openDocument.identity}
          else {
            const opened=await request('/document?'+scopeQuery+'&file='+encodeURIComponent(target))
            baseHash=opened.document.hash;baseIdentity=opened.document.identity
          }
          if(kind==='rename') {
            const response=await request('/rename',{method:'POST',headers:{'content-type':'application/json'},
              body:JSON.stringify({...scopeBody,file:target,next:nextPath.trim(),baseHash,baseIdentity})})
            setFileAction(null)
            await loadWorkspaceFiles()
            if(openTarget && openTab.id===activeTabId) {
              await load(false,response.document.file)
              commitTabs(tabsRef.current.map(entry=>entry.id===activeTabId
                ?{...entry, file:response.document.file}
                : entry))
            } else if(openTarget) {
              // Bytes are unchanged by a rename, but the identity is not: mark
              // the tab stale so activating it reloads the real revision.
              commitTabs(tabsRef.current.map(entry=>entry.id===openTab.id
                ?{...entry, file:response.document.file, stale:true,
                  state:{...entry.state, file:response.document.file,
                    doc:entry.state?.doc?{...entry.state.doc, file:response.document.file}:null}}
                : entry))
            }
            setNotice('Fichier renommé : '+response.document.file)
          } else {
            await request('/delete',{method:'POST',headers:{'content-type':'application/json'},
              body:JSON.stringify({...scopeBody,file:target,baseHash,baseIdentity})})
            setFileAction(null)
            await loadWorkspaceFiles()
            if(openTarget && openTab.id===activeTabId) closeTab(activeTabId,{discard:true,force:true})
            else if(openTarget) commitTabs(tabsRef.current.filter(entry=>entry.id!==openTab.id))
            setNotice('Fichier supprimé : '+target)
          }
        }catch(e){
          setError(e.code==='already-exists'?'Un fichier occupe déjà ce nom : '+nextPath.trim()
            :e.code==='stale-revision'?'Le fichier a changé sur le disque : rechargez avant d’agir.'
            :e.code==='rename-unsupported'?'Ce système de fichiers ne permet pas de renommer sans risque d’écrasement.'
            :String(e.message))
          setFileAction(null)
        }finally{setBusy(false)}
      }
      /**
       * The exact path a create button will write, computed by the very rule the
       * creation uses, so a preview can never disagree with what lands on disk.
       */
      function creationTarget(format, template=null) {
        const typed=newName.trim()
        const base=typed.replace(/\.(?:svg|html?|css)$/i,'').replace(/^\.+/,'')
        return (base||(template?'graphite-v3':'nouveau-fichier'))+'.'+format
      }
      /**
       * Create a new native document and open it. The Host refuses to replace an
       * existing path, so a duplicate name is reported instead of overwriting a
       * file the user did not mean to touch.
       */
      async function createDocument(format, template=null) {
        if(!scopeReady||creating||busy) return
        if(refuseTextDraft())return
        if(doc && source!==doc.source){setError('Unsaved source changes: save or discard them before creating another file');return}
        const target=creationTarget(format,template)
        // A written file nobody can open would be worse than a refusal, so the
        // tab budget is checked before the Host touches the disk.
        if(tabsRef.current.length>=MAX_TABS && !tabsRef.current.some(entry=>entry.file===target)) {
          setError('Limite de '+MAX_TABS+' onglets ouverts : fermez un onglet avant de créer un document. Aucun fichier n’a été écrit.')
          return
        }
        setCreating(true);setError('');setNotice('')
        try {
          await request('/create',{method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({...scopeBody,file:target,source:template||NEW_TEMPLATES[format]})})
          setNewName('')
          await loadWorkspaceFiles()
          await openInTab(target)
          // State the written path explicitly: silent creation was the friction.
          setNotice('Fichier créé : '+target)
        }catch(e){
          setError(e.code==='already-exists'?'Un fichier occupe déjà ce chemin : '+target
            :e.code==='missing-directory'?'Ce dossier n’existe pas encore dans l’espace de travail.'
            :String(e.message))
        }finally{setCreating(false)}
      }
      async function save(payload, historyMode='record',onSaved=null,retainSelection=null) {
        if(!doc || busy)return false
        if(payload.kind!=='svg-text' && refuseTextDraft())return false
        if(reloadRequired){setError('Document state uncertain. Reload the file before making further changes.');return false}
        if(payload.kind!=='replace-source' && source!==doc.source) {setError('Unsaved source changes: save or discard them first');return false}
        // The exact source this save commits. For a source save it is the text
        // in the request; for every patch kind it is the loaded source the
        // patch is computed from (the guard above proves they are equal).
        const sentSource = payload.kind==='replace-source' && typeof payload.source==='string'
          ? payload.source : doc.source
        const recordHistory = (response) => {
          if(!response.result?.changed || historyMode!=='record') return
          // A rename changes the address of the layer: the entry remembers
          // both names so Undo/Redo can restore the selection coherently.
          const entry={undo:response.result.inverse,redo:response.patches,
            rename:payload.kind==='svg-rename'?{from:payload.id,to:payload.next}:null}
          // Avoid storing dozens of full-document copies in memory.
          const bytes=JSON.stringify(entry).length
          if(bytes<=2*1024*1024) setUndoStack(previous=>[...previous,entry].slice(-30))
          else setUndoStack([])
          setRedoStack([])
        }
        setBusy(true);setError('')
        try {
          const response=await request('/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...scopeBody,file:doc.file,baseHash:doc.hash,baseIdentity:doc.identity,...payload})})
          // D1: typing is not blocked while the POST is in flight. If the live
          // source no longer matches what was saved, reloading the document
          // would silently discard that typing — and the journal entry that
          // could have saved it. Keep the live buffer, adopt only the revision
          // the Host committed, mark it dirty, and let journaling resume on the
          // new source. This branch never clears the entry.
          const liveSource = recoveryRuntimeRef.current && typeof recoveryRuntimeRef.current.source==='string'
            ? recoveryRuntimeRef.current.source : source
          if(liveSource !== sentSource) {
            const result = response && response.result && typeof response.result==='object' ? response.result : {}
            const hash = typeof result.hash==='string' && result.hash ? result.hash : doc.hash
            const identity = typeof result.identity==='string' && result.identity ? result.identity : doc.identity
            const savedSource = payload.kind==='replace-source'
              ? sentSource : (sourceAfterPatches(doc.source, response && response.patches) || doc.source)
            const nextDoc = {...doc, source:savedSource, hash, identity}
            setDoc(nextDoc)
            currentDocRef.current = nextDoc
            if(recoverySavedRef.current) recoverySavedRef.current[doc.file] = {baseHash:hash, baseIdentity:identity}
            setRecoveryNote(previous=>previous && previous.file===doc.file ? null : previous)
            scheduleRecoveryJournal()
            recordHistory(response)
            if(typeof onSaved==='function')onSaved(response)
            return true
          }
          // A successful save makes the journal entry for that file obsolete:
          // the disk now holds those bytes, so nothing is left to recover. The
          // removal is best-effort and never affects the save outcome.
          if(scopeReady && doc?.file) {
            recoveryClear(scopeKey, doc.file)
            delete recoveryHandledRef.current[doc.file]
            delete recoverySavedRef.current[doc.file]
            setRecoveryPending(visibleRecoveryEntries().filter(entry=>entry.file!==doc.file))
            setRecoveryNote(previous=>previous && previous.file===doc.file ? null : previous)
          }
          const reloaded=await load(true,doc.file,response.createdId||retainSelection||active)
          if(!reloaded) {
            setReloadRequired(true)
            setUndoStack([]);setRedoStack([])
            setError('The file may have been saved, but could not be reloaded. Reload before editing; history has been cleared.')
            return false
          }
          recordHistory(response)
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
      /** Rotate or scale the selected layer about its real rendered centre. */
      function transformSelected(kind) {
        if(!selected || busy || reloadRequired || source!==doc?.source) return
        const box=handles.find(item=>item.id===selected.id)
        if(!box || !Number.isFinite(box.x) || !box.width) {
          setError('Transformations are unavailable for this layer: its geometry is not addressable')
          return
        }
        // The transform attribute of an element acts in its PARENT space, so the
        // pivot must be mapped back through the parent chain. Using the artboard
        // centre directly would displace any node that has a transformed ancestor.
        const absolute={x:box.x+box.width/2,y:box.y+box.height/2}
        const pinv=Array.isArray(box.pivotInverse)&&box.pivotInverse.length===6?box.pivotInverse:null
        const rounded=value=>Math.round(value*1000)/1000
        const pivot=pinv?
          {x:rounded(pinv[0]*absolute.x+pinv[2]*absolute.y+pinv[4]),
           y:rounded(pinv[1]*absolute.x+pinv[3]*absolute.y+pinv[5])}
          :{x:rounded(absolute.x),y:rounded(absolute.y)}
        const operation=kind==='rotate'?{type:'rotate',angle:90,pivot}
          :kind==='scaleUp'?{type:'scale',sx:1.1,sy:1.1,pivot}
            :{type:'scale',sx:1/1.1,sy:1/1.1,pivot}
        return save({kind:'svg-transform',id:selected.id,operation})
      }
      async function layerAction(operation) {
        if(!active || busy || reloadRequired || !doc || doc.format!=='svg' || source!==doc.source)return false
        return save({kind:'svg-layer',id:active,operation})
      }
      /** Copy the selected SVG layer's exact bytes into the in-memory clipboard. */
      function copyLayer(id) {
        const target=id||active
        const node=nodes.find(entry=>entry.id===target)
        if(!doc || doc.format!=='svg' || !node) {setError('Sélectionnez un calque SVG à copier.');return}
        if(node.copyContextSafe!==true) {
          setNotice('')
          setError('Copie refusée : le contexte ancestral ou les styles du document ne peuvent pas être préservés. Copiez le groupe parent complet depuis une racine neutre, ou utilisez le code source.')
          return
        }
        if(!Number.isInteger(node.start) || !Number.isInteger(node.end) || node.end<=node.start) {
          setError('Ce document ne peut pas être copié couche par couche : ouvrez-le comme SVG structuré.')
          return
        }
        const fragment=doc.source.slice(node.start,node.end)
        setClipboard({fragment,label:node.tag+' #'+node.id,file:doc.file})
        setNotice('Calque copié : '+node.tag+' #'+node.id)
      }
      /**
       * Paste the copied element into the current SVG document. The Host
       * re-parses the fragment and allocates fresh ids; a fragment that no longer
       * parses is refused instead of being written blindly.
       */
      async function pasteLayer() {
        if(!clipboard) {setError('Le presse-papiers est vide : copiez un calque d’abord.');return}
        if(!doc || doc.format!=='svg') {setError('Le collage n’est disponible que dans un document SVG.');return}
        if(busy||reloadRequired||source!==doc.source) return
        closeLayerMenu()
        await save({kind:'svg-paste',fragment:clipboard.fragment})
      }
      /** Move the selected layer in paint order (SVG has no z-index). */
      async function reorderLayer(direction, id) {
        const target=id||active
        if(!target || busy || reloadRequired || !doc || doc.format!=='svg' || source!==doc.source) return
        await save({kind:'svg-order',id:target,direction})
      }
      /**
       * Right-click menu over a canvas shape or a layer row.
       *
       * It exposes the exact same Host operations as the visible controls: it is
       * a second entry point, never a second implementation. The menu is clamped
       * to the viewport and closed by Escape, by the backdrop or by any action.
       */
      function openLayerMenu(event, id) {
        if(!doc || doc.format!=='svg') return
        const target = id || active
        if(!target) return
        event.preventDefault()
        event.stopPropagation()
        if(id && id!==active) select(id)
        layerMenuTriggerRef.current=event.currentTarget
        const keyboard=event.type==='keydown'
        const rect=keyboard?event.currentTarget.getBoundingClientRect():null
        const width=232, height=460
        const x=Math.max(8,Math.min(keyboard?rect.left:event.clientX, (window.innerWidth||1200)-width-8))
        const y=Math.max(8,Math.min(keyboard?rect.bottom:event.clientY, (window.innerHeight||800)-height-8))
        setLayerMenu({id:target,x,y})
      }
      function closeLayerMenu() {
        setLayerMenu(null)
        if(layerMenu) {
          const trigger=layerMenuTriggerRef.current
          const fallback=layerMenuRef.current?.closest('.dsh-studio-workbench')?.querySelector('[aria-label="Select canvas tool"]')
          if(trigger?.isConnected)trigger.focus()
          else fallback?.focus()
        }
      }
      /**
       * Identity of a layer's parent, used only to decide whether two rows are
       * siblings. `svg-order` moves one exact span among its *real* siblings,
       * so a drag between different parents must be refused rather than
       * guessed. Named parents are exact (`parentId`); depth 1 is the `<svg>`
       * root. An anonymous parent below the root cannot be identified from the
       * Host metadata (ids only, no parent spans), so it is reported as
       * unprovable instead of being treated as equal to another anonymous one.
       */
      function layerParentKey(node) {
        if(!node || node.structure===false || !Number.isInteger(node.depth)) return null
        if(node.depth===0) return 'root'
        if(node.parentId) return 'id:'+node.parentId
        if(node.depth===1) return 'root'
        return null
      }
      /** A locked ancestor locks its descendants for every mutation. */
      function layerLockedByAncestor(node) {
        const ancestors=Array.isArray(node?.ancestorIds)?node.ancestorIds:[]
        return ancestors.some(id=>nodes.find(item=>item.id===id)?.locked===true)
      }
      /**
       * Can this layer be renamed at all? Document availability, pending drafts
       * and the layer's own state are checked before the input is shown, so a
       * locked or read-only row explains itself instead of opening a dead field.
       */
      function renameTargetState(id) {
        const blocked=reason=>({ok:false,reason})
        if(!doc) return blocked('Ouvrez un document SVG pour renommer un calque.')
        if(doc.format!=='svg') return blocked('Renommage indisponible : ce document n’est pas un SVG.')
        if(busy) return blocked('Enregistrement en cours : réessayez ensuite.')
        if(reloadRequired) return blocked('Document à recharger avant de renommer.')
        if(source!==doc.source||hasTextDraft()) {
          return blocked('Modifications non enregistrées : enregistrez ou abandonnez-les avant de renommer.')
        }
        const node=nodes.find(item=>item.id===id)
        if(!node) return blocked('Calque introuvable : resélectionnez-le.')
        if(!node.id) return blocked('Ce calque n’a pas d’identifiant : renommage impossible.')
        if(node.depth===0) return blocked('La racine SVG ne peut pas être renommée : choisissez un calque.')
        if(node.readOnly) return blocked('Lecture seule : ce contenu SVG référencé ne peut pas être renommé.')
        if(node.locked||layerLockedByAncestor(node)) {
          return blocked('Calque verrouillé : déverrouillez #'+id+' avant de le renommer.')
        }
        return {ok:true,node}
      }
      /**
       * Full UI pre-check, mirroring the Host refusals so a collision or a
       * referenced id is explained WITHOUT a request and without a write.
       */
      function layerRenameState(id,next) {
        const target=renameTargetState(id)
        if(!target.ok) return target
        const value=String(next ?? '')
        if(!value) return {ok:false,reason:'Indiquez un nouveau nom de calque.'}
        if(value.length>MAX_SVG_ID_LENGTH) {
          return {ok:false,reason:'Nom trop long : '+MAX_SVG_ID_LENGTH+' caractères maximum.'}
        }
        if(!SVG_ID_PATTERN.test(value)) {
          return {ok:false,reason:'Nom invalide : commencez par une lettre ou _, puis lettres, chiffres, _ . : - uniquement.'}
        }
        if(value===id) return {ok:false,reason:'Le nom est identique à l’actuel : aucune écriture nécessaire.'}
        if(nodes.some(item=>item.id===value)) {
          return {ok:false,reason:'Un calque porte déjà le nom « '+value+' » : renommage refusé (collision d’id).'}
        }
        if(svgIdLooksReferenced(doc.source,id)) {
          return {ok:false,reason:'L’identifiant #'+id+' est référencé dans le document (url(#), href ou xlink:href) : le renommer casserait la référence.'}
        }
        return {ok:true,node:target.node}
      }
      /** Open the inline editor for one row, or explain why it cannot open. */
      function startRename(id) {
        const state=renameTargetState(id)
        if(!state.ok) {
          setNotice('')
          setError(state.reason)
          return false
        }
        setAlignNotice('')
        setError('')
        setNotice('')
        if(id!==active) select(id)
        else setEditingText('')
        setRenaming({id,value:id})
        return true
      }
      /** Close the inline editor and give focus back to the row, never writing. */
      function cancelRename() {
        const pending=renaming
        setRenaming(null)
        if(!pending?.id)return
        if(typeof document==='undefined'||typeof document.querySelector!=='function')return
        // Restore focus after the row is rendered again; a no-match (the layer
        // was replaced meanwhile) is simply ignored. If another inline editor
        // opened in the meantime, focusing an old row would steal its focus.
        setTimeout(()=>{
          if(typeof document==='undefined'||typeof document.querySelector!=='function')return
          if(document.querySelector('[data-layer-rename-input]'))return
          const row=document.querySelector('[data-layer-id="'+pending.id+'"]')
          if(row&&typeof row.focus==='function')row.focus()
        },0)
      }
      /**
       * Commit one rename through the single `svg-rename` Host operation.
       *
       * The editor is closed only AFTER the Host confirms the write. On a
       * refusal (CSS/ARIA/SMIL/encoded reference, ambiguous entity, stale
       * revision) the field stays open with exactly what the user typed and
       * gets focus back, so the reason and the value are both visible. A
       * client-side pre-check refusal never reaches this function.
       */
      async function commitRename() {
        const pending=renaming
        if(!pending)return false
        const state=layerRenameState(pending.id,pending.value)
        if(!state.ok) {
          setNotice('')
          setError(state.reason)
          return false
        }
        const id=pending.id
        const next=String(pending.value)
        setError('');setNotice('')
        const saved=await save({kind:'svg-rename',id,next},'record',()=>{
          // The layer is now addressed by its new name: keep a multi-selection
          // and an in-progress Plume path coherent instead of dropping them.
          // Undo/Redo replay the {from,to} pair symmetrically below.
          setExtraSelection(previous=>rewriteRenameSelection(previous,id,next))
          if(penPathId===id)setPenPathId(next)
          setNotice('Calque renommé : #'+id+' → #'+next)
        })
        if(!saved) {
          // Host refusal: keep the field open with its value and give focus
          // back. `save()` already surfaced the typed reason through `error`.
          setRenaming(previous=>previous?{...previous}:previous)
          if(typeof document!=='undefined'&&typeof document.querySelector==='function') {
            setTimeout(()=>{
              const input=document.querySelector('[data-layer-rename-input]')
              if(input&&typeof input.focus==='function')input.focus()
            },0)
          }
          return false
        }
        setRenaming(null)
        if(typeof document!=='undefined'&&typeof document.querySelector==='function') {
          setTimeout(()=>{
            const row=document.querySelector('[data-layer-id="'+next+'"]')
            if(row&&typeof row.focus==='function')row.focus()
          },0)
        }
        return true
      }
      /**
       * Resolve the current multi-selection into alignment entries, or into one
       * explicit refusal reason. Nothing is approximated here: a layer without a
       * provable x/y coordinate blocks the WHOLE operation (no partial write).
       *
       * Refusal order mirrors the user's mental model: document availability,
       * busy/uncertain state, unsaved drafts, then the selection itself, then
       * each layer's lock/read-only/geometry. Only `rect` and `text` are
       * accepted: both carry a real `x`/`y` attribute, and both already have a
       * transform-aware handle used by the drag gesture. Groups and circle/
       * ellipse are refused rather than converted to `cx`/`cy`/`translate`.
       *
       * `minimum` is 2 for alignment and 3 for distribution, so both gestures
       * share the exact same refusal order and wording family.
       */
      function alignmentSelectionState(minimum=2) {
        const wanted=new Set(extraSelection)
        if(active) wanted.add(active)
        const ids=nodes.filter(node=>wanted.has(node.id)).map(node=>node.id)
        const missing=[...wanted].filter(id=>!nodes.some(node=>node.id===id))
        const blocked=reason=>({ok:false,reason,ids,entries:[]})
        if(!doc) return blocked('Ouvrez un document SVG pour '+(minimum>2?'distribuer':'aligner')+' des calques.')
        if(doc.format!=='svg') return blocked('Alignement indisponible : ce document n’est pas un SVG.')
        if(busy) return blocked('Enregistrement en cours : réessayez ensuite.')
        if(reloadRequired) return blocked('Document à recharger avant de modifier.')
        if(source!==doc.source||hasTextDraft()) {
          return blocked('Modifications non enregistrées : enregistrez ou abandonnez-les avant d’aligner.')
        }
        if(missing.length) return blocked('Un calque sélectionné n’existe plus : resélectionnez les calques.')
        if(ids.length<minimum) {
          return blocked('Sélectionnez au moins '+(minimum>2?'trois':'deux')+' calques (Ctrl+clic) pour '+
            (minimum>2?'distribuer':'aligner')+'.')
        }
        if(ids.length>16) {
          return blocked((minimum>2?'Distribution refusée':'Alignement refusé')+
            ' : 16 calques maximum par écriture (limite du Host).')
        }
        const entries=[]
        for(const id of ids) {
          const node=nodes.find(item=>item.id===id)
          if(!node) return blocked('Un calque sélectionné n’existe plus : resélectionnez les calques.')
          if(node.readOnly) return blocked('Lecture seule : le calque #'+id+' ne peut pas être aligné.')
          if(node.locked||layerLockedByAncestor(node)) {
            return blocked('Calque verrouillé : déverrouillez #'+id+' avant d’aligner.')
          }
          const handle=geometry.handles.find(item=>item.id===id)
          if(!handle) return blocked('Géométrie indisponible pour #'+id+' : alignement refusé.')
          const move=handle.move
          if(!move||move.kind==='translate') {
            return blocked('#'+id+' est un groupe sans attribut x/y : alignement refusé (aucune conversion).')
          }
          if(!Number.isFinite(move.initialX)||!Number.isFinite(move.initialY)||
              !Array.isArray(move.inverse)||move.inverse.length!==4||!move.inverse.every(Number.isFinite)) {
            return blocked('Géométrie non inversible pour #'+id+' : alignement refusé.')
          }
          if(move.x!=='x'||move.y!=='y') {
            return blocked('#'+id+' n’a pas d’attribut x/y (cx/cy) : alignement refusé sans conversion de forme.')
          }
          if(handle.tag!=='rect'&&handle.tag!=='text') {
            return blocked('Forme non prise en charge pour #'+id+' : alignement refusé.')
          }
          if(![handle.x,handle.y,handle.width,handle.height].every(Number.isFinite)||
              handle.width<=0||handle.height<=0) {
            return blocked('Géométrie incomplète pour #'+id+' : alignement refusé.')
          }
          entries.push({id,node,handle,move})
        }
        return {ok:true,reason:'',ids,entries}
      }
      /**
       * Plan one alignment. The box edges are read in artboard space, exactly
       * like a drag preview; `move.inverse` maps the resulting delta back into
       * the layer's local coordinates.
       *
       * A pure local-x move only stays horizontal when the accumulated matrix
       * has b=0 (`inverse[1]=0`); a pure local-y move only stays vertical when
       * c=0 (`inverse[2]=0`). Under a rotation/pivot the single-axis write
       * cannot reach the target, so it is refused instead of approximated.
       * Text is accepted only where its own anchor makes the edge provable
       * (start/left, middle/centre, end/right); its vertical box is estimated,
       * so vertical text alignment is refused.
       */
      function alignmentModePlan(state,mode) {
        if(!state.ok) return {ok:false,reason:state.reason}
        for(const entry of state.entries) {
          const axisRefusal=alignmentAxisRefusal(entry,mode.axis)
          if(axisRefusal) return {ok:false,reason:axisRefusal}
          if(entry.handle.tag==='text') {
            if(mode.axis==='y') {
              return {ok:false,reason:'#'+entry.id+' : alignement vertical du texte non calculable (ligne de base).'}
            }
            // An inherited anchor cannot be resolved from this flat layer model
            // (anonymous groups are not listed), so only an explicit attribute is
            // accepted; it also overrides inheritance by SVG's own rules.
            if(!Object.hasOwn(entry.node.attributes,'text-anchor')) {
              return {ok:false,reason:'#'+entry.id+' : texte sans text-anchor explicite, ancrage hérité non prouvable.'}
            }
            const anchor=String(entry.node.attributes['text-anchor'])
            const expected=mode.edge==='start'?'start':mode.edge==='end'?'end':'middle'
            if(anchor!==expected) {
              return {ok:false,reason:'#'+entry.id+' : texte ancré « '+anchor+
                ' » sans bord '+mode.text.toLowerCase()+' prouvable pour cet alignement.'}
            }
          }
        }
        let unionStart=Infinity,unionEnd=-Infinity
        for(const entry of state.entries) {
          const start=mode.axis==='x'?entry.handle.x:entry.handle.y
          const size=mode.axis==='x'?entry.handle.width:entry.handle.height
          if(!Number.isFinite(start)||!Number.isFinite(size)||size<=0) {
            return {ok:false,reason:'Géométrie incomplète pour #'+entry.id+' : alignement refusé.'}
          }
          unionStart=Math.min(unionStart,start)
          unionEnd=Math.max(unionEnd,start+size)
        }
        if(!Number.isFinite(unionStart)||!Number.isFinite(unionEnd)) {
          return {ok:false,reason:'Géométrie de la sélection indisponible : alignement refusé.'}
        }
        const target=mode.edge==='start'?unionStart:mode.edge==='end'?unionEnd:(unionStart+unionEnd)/2
        const edits=[]
        for(const entry of state.entries) {
          const edge=alignmentEdge(entry.handle,mode)
          if(edge===null) {
            return {ok:false,reason:'Géométrie incomplète pour #'+entry.id+' : alignement refusé.'}
          }
          const delta=target-edge
          if(Math.abs(delta)<=1e-9) continue
          const scale=mode.axis==='x'?entry.move.inverse[0]:entry.move.inverse[3]
          const initial=mode.axis==='x'?entry.move.initialX:entry.move.initialY
          const attribute=mode.axis==='x'?entry.move.x:entry.move.y
          const next=alignmentCoordinate(initial+scale*delta)
          const current=entry.node.attributes[attribute]
          // A layer already on the target must not produce a cosmetic edit
          // (for example rewriting "10.0" as "10"): no change, no request.
          if(typeof current==='string'&&Math.abs(Number(current)-Number(next))<=1e-9) continue
          edits.push({id:entry.id,attribute,value:next})
        }
        return {ok:true,edits}
      }
      /** Execute one alignment through the single atomic `svg-attributes` batch. */
      function alignSelection(modeKey) {
        const mode=ALIGNMENT_MODES.find(item=>item.key===modeKey)
        if(!mode) return
        setAlignNotice('')
        const plan=alignmentModePlan(alignmentSelectionState(),mode)
        if(!plan.ok) {setError(plan.reason);return}
        if(plan.edits.length===0) {
          setError('')
          setAlignNotice('Déjà aligné : aucune écriture nécessaire.')
          return
        }
        setError('')
        const count=plan.edits.length
        void save({kind:'svg-attributes',edits:plan.edits},'record',()=>{
          setAlignNotice(count+' '+(count>1?'calques alignés':'calque aligné')+
            ' · une seule écriture, Undo exact.')
        })
      }
      /**
       * Plan an equal-gap distribution along one axis.
       *
       * The boxes are ordered by their LEADING edge in artboard space; the
       * first and the last one stay strictly fixed, and the remaining space is
       * shared equally between the boxes in between (n-1 equal gaps). Only the
       * leading-edge coordinate that actually changes is written (`x` for the
       * horizontal mode, `y` for the vertical one), through the same
       * `move.inverse` mapping as alignment and the pointer drag.
       *
       * A negative equal gap means the boxes already overlap too much to be
       * distributed: the gesture is refused instead of writing a negative
       * spacing that would push the middle boxes through each other.
       */
      function distributionPlan(state,mode) {
        if(!state.ok) return {ok:false,reason:state.reason}
        for(const entry of state.entries) {
          const axisRefusal=alignmentAxisRefusal(entry,mode.axis)
          if(axisRefusal) return {ok:false,reason:axisRefusal}
          if(entry.handle.tag==='text') {
            // The text box height is a font-size estimate around the baseline:
            // a vertical distribution would space lines from a number that is
            // not the rendered one. A horizontal shift is a pure translation of
            // the same estimated box, so it stays exact -- but only an explicit
            // anchor makes the box provable.
            if(mode.axis==='y') {
              return {ok:false,reason:'#'+entry.id+
                ' : distribution verticale du texte non calculable (ligne de base).'}
            }
            if(!Object.hasOwn(entry.node.attributes,'text-anchor')) {
              return {ok:false,reason:'#'+entry.id+
                ' : texte sans text-anchor explicite, ancrage hérité non prouvable.'}
            }
          }
        }
        const boxes=state.entries.map(entry=>({
          entry,
          start:mode.axis==='x'?entry.handle.x:entry.handle.y,
          size:mode.axis==='x'?entry.handle.width:entry.handle.height,
        }))
        for(const box of boxes) {
          if(!Number.isFinite(box.start)||!Number.isFinite(box.size)||box.size<=0) {
            return {ok:false,reason:'Géométrie incomplète pour #'+box.entry.id+' : distribution refusée.'}
          }
        }
        // Leading edge is the only ordering key; the sort is stable, so equal
        // edges keep the selection (document) order.
        boxes.sort((a,b)=>a.start-b.start)
        const first=boxes[0],last=boxes[boxes.length-1]
        let middleSize=0
        for(let index=1;index<boxes.length-1;index+=1) middleSize+=boxes[index].size
        const span=last.start+last.size-first.start
        const gap=(span-first.size-middleSize-last.size)/(boxes.length-1)
        if(!Number.isFinite(gap)) {
          return {ok:false,reason:'Géométrie de la sélection indisponible : distribution refusée.'}
        }
        if(gap<-1e-9) {
          return {ok:false,reason:'Distribution refusée : les calques se chevauchent, '+
            'l’espacement égal serait négatif ('+alignmentCoordinate(gap)+').'}
        }
        const edits=[]
        let cursor=first.start+first.size+gap
        for(let index=1;index<boxes.length-1;index+=1) {
          const box=boxes[index]
          const delta=cursor-box.start
          if(Math.abs(delta)>1e-9) {
            const inverse=box.entry.move.inverse
            const scale=mode.axis==='x'?inverse[0]:inverse[3]
            const initial=mode.axis==='x'?box.entry.move.initialX:box.entry.move.initialY
            const attribute=mode.axis==='x'?box.entry.move.x:box.entry.move.y
            const next=alignmentCoordinate(initial+scale*delta)
            const current=box.entry.node.attributes[attribute]
            // A layer already on its target produces no cosmetic edit: the
            // whole gesture must stay a no-op when nothing needs to move.
            if(!(typeof current==='string'&&Math.abs(Number(current)-Number(next))<=1e-9)) {
              edits.push({id:box.entry.id,attribute,value:next})
            }
          }
          cursor+=box.size+gap
        }
        return {ok:true,edits}
      }
      /** Execute one distribution through the single atomic `svg-attributes` batch. */
      function distributeSelection(modeKey) {
        const mode=DISTRIBUTION_MODES.find(item=>item.key===modeKey)
        if(!mode) return
        setAlignNotice('')
        const plan=distributionPlan(alignmentSelectionState(3),mode)
        if(!plan.ok) {setError(plan.reason);return}
        if(plan.edits.length===0) {
          setError('')
          setAlignNotice('Déjà distribué : aucune écriture nécessaire.')
          return
        }
        setError('')
        const count=plan.edits.length
        void save({kind:'svg-attributes',edits:plan.edits},'record',()=>{
          setAlignNotice(count+' '+(count>1?'calques distribués':'calque distribué')+
            ' · une seule écriture, Undo exact.')
        })
      }
      /** Row id under a viewport point, or '' when the pointer is outside rows. */
      function layerRowAtPoint(x,y) {
        if(typeof document==='undefined' || typeof document.elementFromPoint!=='function')return ''
        const element=document.elementFromPoint(x,y)
        const row=element?.closest?.('[data-layer-id]')
        return row?.getAttribute?.('data-layer-id')||''
      }
      /**
       * Decide how a drop onto `targetId` would reorder `sourceId`.
       *
       * The direction is derived from the two rows' position inside the *same*
       * parent: later sibling means `forward` (towards the front / down the
       * list), earlier sibling means `backward`. svg-order exposes one step
       * (and the two extremes); it has no "insert at index" direction, so a
       * drop always stays one atomic revision-checked patch -- exactly one
       * Undo step -- and never patches bytes itself. Dropping on a distant row
       * therefore moves one rank towards it; the menu and Ctrl+Shift+] /
       * Ctrl+Shift+[ keep the multi-rank moves explicit.
       */
      function layerDropPlan(sourceId,targetId) {
        const from=nodes.find(node=>node.id===sourceId)
        const to=targetId?nodes.find(node=>node.id===targetId):null
        if(!from)return {ok:false,reason:'Calque source introuvable.'}
        if(!to)return {ok:false,reason:'Déposez le calque sur une autre ligne de calque.'}
        if(from.id===to.id)return {ok:false,same:true}
        if(from.depth===0) {
          return {ok:false,reason:'La racine SVG ne peut pas être réordonnée.'}
        }
        if(from.structure===false) {
          return {ok:false,reason:'Structure SVG indisponible pour ce calque : utilisez Ctrl+] ou Ctrl+[.'}
        }
        if(from.readOnly) {
          return {ok:false,reason:'Ce contenu SVG référencé est en lecture seule.'}
        }
        if(from.locked || layerLockedByAncestor(from)) {
          return {ok:false,reason:'Calque verrouillé : déverrouillez-le avant de le réordonner.'}
        }
        const fromParent=layerParentKey(from)
        const toParent=layerParentKey(to)
        if(fromParent===null || toParent===null) {
          return {ok:false,
            reason:'Impossible de vérifier que ces calques sont frères (groupe sans id) : utilisez Ctrl+] ou Ctrl+[.'}
        }
        if(fromParent!==toParent) {
          return {ok:false,
            reason:'Parents différents : le réordonnancement n’est possible qu’entre calques frères.'}
        }
        const fromIndex=from.siblingIndex
        const toIndex=to.siblingIndex
        if(!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex===toIndex) {
          return {ok:false,reason:'Position des calques indisponible : utilisez Ctrl+] ou Ctrl+[.'}
        }
        // One drop is exactly one rank (one atomic patch, one Undo). Only an
        // adjacent row is *highlighted* as the socket, because that is the true
        // destination; dropping on a farther sibling still moves one rank toward
        // it instead of being refused, which is what the gesture means and avoids
        // losing a drop when the list scrolls mid-drag.
        return {ok:true,direction:fromIndex<toIndex?'forward':'backward',from,to}
      }
      function startLayerDrag(event,id) {
        // A click (and Ctrl/Cmd/Shift selection) must stay a click until the
        // pointer really moved; nothing is prevented or written here.
        layerDragClickRef.current=false
        layerDragCancelRef.current=false
        if(event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || layerMenu)return
        if(!doc || doc.format!=='svg' || !nodes.some(node=>node.id===id))return
        layerDragRef.current={id,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,
          started:false,overId:'',plan:null}
        // The row can be re-rendered (or replaced) between pointerdown and the
        // first move — selecting the layer already re-renders it. The gesture is
        // therefore driven by window listeners, not by pointer capture on a node
        // that may no longer exist; capture is only a convenience.
        if(typeof window!=='undefined' && typeof window.addEventListener==='function' && !layerDragListenersRef.current) {
          const onMove=move=>moveLayerDrag(move)
          const onUp=up=>endLayerDrag(up)
          const onCancel=cancel=>endLayerDrag(cancel,true)
          // Escape must cancel a gesture even when the focus is not inside the
          // workbench (opening a document can move it to a tab or the body).
          const onKey=key=>{
            if(key.key!=='Escape')return
            key.preventDefault()
            if(!layerDragRef.current)return
            layerDragRef.current=null
            layerDragCancelRef.current=true
            layerDragClickRef.current=true
            setLayerDrag(null)
            stopLayerDragListeners()
          }
          window.addEventListener('pointermove',onMove)
          window.addEventListener('pointerup',onUp)
          window.addEventListener('pointercancel',onCancel)
          window.addEventListener('keydown',onKey)
          layerDragListenersRef.current={onMove,onUp,onCancel,onKey}
        }
        try{event.currentTarget?.setPointerCapture?.(event.pointerId)}catch(_){}
      }
      function stopLayerDragListeners() {
        const listeners=layerDragListenersRef.current
        layerDragListenersRef.current=null
        if(!listeners || typeof window==='undefined' || typeof window.removeEventListener!=='function')return
        window.removeEventListener('pointermove',listeners.onMove)
        window.removeEventListener('pointerup',listeners.onUp)
        window.removeEventListener('pointercancel',listeners.onCancel)
        if(listeners.onKey)window.removeEventListener('keydown',listeners.onKey)
      }
      function moveLayerDrag(event) {
        const gesture=layerDragRef.current
        if(!gesture || gesture.pointerId!==event.pointerId)return
        if(!gesture.started) {
          if(Math.abs(event.clientX-gesture.startX)<4 && Math.abs(event.clientY-gesture.startY)<4)return
          gesture.started=true
          // Selection follows the dragged row, exactly as the context menu
          // targets the row the user acted on.
          select(gesture.id)
        }
        const overId=layerRowAtPoint(event.clientX,event.clientY)
        const plan=layerDropPlan(gesture.id,overId)
        gesture.overId=overId
        gesture.plan=plan
        // Preview only: this function never calls save().
        setLayerDrag(previous=>previous && previous.id===gesture.id && previous.overId===overId &&
          previous.plan?.ok===plan.ok && previous.plan?.direction===plan.direction &&
          previous.plan?.same===plan.same && previous.plan?.reason===plan.reason
          ? previous : {id:gesture.id,overId,plan})
      }
      function endLayerDrag(event,cancelled=false) {
        const gesture=layerDragRef.current
        if(!gesture || gesture.pointerId!==event.pointerId)return
        layerDragRef.current=null
        stopLayerDragListeners()
        setLayerDrag(null)
        if(layerDragCancelRef.current) {
          layerDragCancelRef.current=false
          return
        }
        if(!gesture.started) {
          // A fast flick can deliver the release without any intermediate
          // pointermove. Judge by the real distance instead of dropping the
          // gesture: anything past the click threshold is a drag.
          const moved=Math.abs(event.clientX-gesture.startX)>=4 || Math.abs(event.clientY-gesture.startY)>=4
          if(!moved)return
          gesture.started=true
          // Same invariant as a slow drag: the moved row is the selection.
          select(gesture.id)
        }
        // The synthetic click that follows the drop must not re-select (or undo
        // the selection made at drag start).
        layerDragClickRef.current=true
        if(cancelled)return
        // Selection can scroll the layer list mid-gesture, so the row under the
        // release point may not be the row the user aimed at. Try the release
        // row first, then the last row really hovered, and keep the first plan
        // that is valid; if none is, report the release row's reason.
        const releaseId=layerRowAtPoint(event.clientX,event.clientY)
        const candidates=[]
        for(const candidate of [releaseId,gesture.overId]) {
          if(candidate && !candidates.includes(candidate)) candidates.push(candidate)
        }
        let plan=layerDropPlan(gesture.id,releaseId)
        for(const candidate of candidates) {
          const attempt=layerDropPlan(gesture.id,candidate)
          if(attempt.ok) {plan=attempt;break}
        }
        if(!plan.ok) {
          // Same row: no write and no error, just a quiet acknowledgement.
          if(plan.same){setNotice('Calque déposé sur lui-même : aucun changement.');return}
          setNotice('')
          setError(plan.reason)
          return
        }
        if(refuseTextDraft())return
        if(busy){setNotice('Enregistrement en cours : réessayez dans un instant.');return}
        if(reloadRequired) {
          setError('Document state uncertain. Reload the file before making further changes.')
          return
        }
        if(!doc || doc.format!=='svg')return
        if(source!==doc.source) {
          setError('Unsaved source changes: save or discard them first')
          return
        }
        setError('')
        setNotice('')
        // The one and only write: the same Host path as Ctrl+] / the menu.
        void reorderLayer(plan.direction,gesture.id)
      }
      function onLayerMenuKeyDown(event) {
        // Leave Enter/Space defaults to native buttons, but never canvas shortcuts.
        event.stopPropagation()
        if(event.key==='Tab') {closeLayerMenu();return}
        if(event.key==='Escape') {event.preventDefault();closeLayerMenu();return}
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
        event.preventDefault()
        const items=Array.from(event.currentTarget.querySelectorAll('button[role="menuitem"]:not(:disabled)'))
        if(!items.length)return
        const index=items.indexOf(event.target)
        const next=event.key==='Home'?0:event.key==='End'?items.length-1:
          (index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length
        items[next].focus()
      }
      /** One menu row: label, optional shortcut hint, disabled state, action. */
      function layerMenuItem(label, hint, run, disabled, style) {
        return h('button',{type:'button',role:'menuitem',disabled,'aria-label':label,
          style:{...button,display:'flex',justifyContent:'space-between',gap:12,textAlign:'left',
            background:'transparent',border:0,...(style||{})},
          onClick:()=>{
            const trigger=layerMenuTriggerRef.current
            const fallback=layerMenuRef.current?.closest('.dsh-studio-workbench')?.querySelector('[aria-label="Select canvas tool"]')
            closeLayerMenu()
            const result=run()
            if(result?.then)layerMenuActionFocusRef.current={trigger,fallback}
          }},
          h('span',null,label),hint?h('small',{style:{opacity:0.55}},hint):null)
      }
      async function undo() {
        if(busy || reloadRequired || source!==doc?.source || !undoStack.length)return
        const entry=undoStack[undoStack.length-1]
        // Undoing a rename restores the old id: the selection must follow it so
        // the layer stays selected under the name that now exists again.
        const retained=entry.rename?entry.rename.from:null
        if(await save({kind:'patches',patches:entry.undo},'replay',null,retained)) {
          // Undo restores the OLD id. Replaying only the active id would leave
          // the new id in the multi-selection, and the phantom id would then
          // block every alignment ("Un calque sélectionné n'existe plus").
          if(entry.rename) {
            setExtraSelection(previous=>rewriteRenameSelection(previous,entry.rename.to,entry.rename.from))
            setPenPathId(previous=>previous===entry.rename.to?entry.rename.from:previous)
          }
          setUndoStack(previous=>previous.slice(0,-1))
          setRedoStack(previous=>[...previous,entry])
        }
      }
      async function redo() {
        if(busy || reloadRequired || source!==doc?.source || !redoStack.length)return
        const entry=redoStack[redoStack.length-1]
        const retained=entry.rename?entry.rename.to:null
        if(await save({kind:'patches',patches:entry.redo},'replay',null,retained)) {
          if(entry.rename) {
            setExtraSelection(previous=>rewriteRenameSelection(previous,entry.rename.from,entry.rename.to))
            setPenPathId(previous=>previous===entry.rename.from?entry.rename.to:previous)
          }
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
      function bindViewportWheel(node) {
        const binding=viewportWheelRef.current
        if(binding && binding.node===node) return
        if(binding && binding.node) {
          try{binding.node.removeEventListener('wheel',binding.handler,true)}catch(_){}
          viewportWheelRef.current=null
        }
        if(!node || typeof node.addEventListener!=='function') return
        const handler=event=>{
          if(['textarea','input','select'].includes(String(event.target?.tagName||'').toLowerCase()))return
          if(event.cancelable===false) return
          event.__dshWheelPrevented=true
          event.preventDefault()
        }
        node.addEventListener('wheel',handler,{passive:false,capture:true})
        viewportWheelRef.current={node,handler}
      }
      function onCanvasWheel(event) {
        if(['textarea','input','select'].includes(String(event.target?.tagName||'').toLowerCase()))return
        // React attaches wheel listeners passively, so preventDefault() there only
        // warns and the page still scrolls. bindViewportWheel installs a
        // non-passive capture listener that cancels the scroll once per event.
        // React copies a fixed property whitelist into its synthetic event, so the
        // marker installed on the native event must be read from nativeEvent.
        const alreadyPrevented=event.__dshWheelPrevented || event.nativeEvent?.__dshWheelPrevented
        if(!alreadyPrevented) event.preventDefault()
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
        // Professional document navigation. Handle before the text-input guard:
        // Ctrl+Tab is a document command even when the source editor has focus.
        // The active tab is captured by activateTab (including unsaved edits),
        // and no Host write is made. Never steal Ctrl+Alt+Tab or a modal action.
        const isTabCycle=(event.ctrlKey||event.metaKey)&&!event.altKey&&event.key==='Tab'
        if(isTabCycle && tabsRef.current.length>1 && !busy && !creating && !tabCloseConfirm) {
          event.preventDefault()
          event.stopPropagation()
          const list=tabsRef.current
          const index=list.findIndex(entry=>entry.id===activeTabId)
          if(index>=0) {
            const next=(index+(event.shiftKey?-1:1)+list.length)%list.length
            activateTab(list[next].id)
          }
          return
        }
        const tag=String(event.target?.tagName||'').toLowerCase()
        if(['input','textarea','select'].includes(tag)||event.target?.isContentEditable)return
        if(event.key==='Escape' && layerMenu) {event.preventDefault();closeLayerMenu();return}
        if(event.key==='Escape' && layerDragRef.current) {
          // Cancel the gesture without writing; the pointerup that follows is
          // ignored and its synthetic click is suppressed.
          event.preventDefault()
          layerDragRef.current=null
          stopLayerDragListeners()
          layerDragCancelRef.current=true
          setLayerDrag(null)
          layerDragClickRef.current=true
          return
        }
        if(event.key==='Escape' && (dragRef.current || pathDragRef.current || penGestureRef.current)) {
          event.preventDefault()
          dragRef.current=null;pathDragRef.current=null
          penGestureRef.current=null;setPenPreview(null)
          setDragDelta(null);setPathDrag(null)
          return
        }
        if(event.key==='Escape'){setCanvasTool('select');return}
        const command=event.ctrlKey || event.metaKey
        if(!command && !event.altKey && (event.key===' ' || event.code==='Space')) {
          event.preventDefault()
          setSpaceHeld(true)
          return
        }
        if(!command && !event.altKey && !event.shiftKey && ['v','h','p','r','o','t'].includes(event.key)) {
          event.preventDefault()
          if(refuseTextDraft())return
          setCanvasTool(({v:'select',h:'hand',p:'pen',r:'rect',o:'ellipse',t:'text'})[event.key])
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
          }else if(event.key?.toLowerCase()==='c' && active && doc?.format==='svg'){
            event.preventDefault();copyLayer(active)
          }else if(event.key?.toLowerCase()==='v' && doc?.format==='svg'){
            event.preventDefault();void pasteLayer()
          }else if(event.key===']' && active && doc?.format==='svg'){
            event.preventDefault();void reorderLayer(event.shiftKey?'front':'forward')
          }else if(event.key==='[' && active && doc?.format==='svg'){
            event.preventDefault();void reorderLayer(event.shiftKey?'back':'backward')
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
      function select(nodeId, additive=false) {
        if(refuseTextDraft())return
        setAlignNotice('')
        setActive(nodeId)
        setEditingText('')
        setTextDraft(textNodes.find(item=>item.id===nodeId)?.text||'')
        const node=nodes.find(n=>n.id===nodeId)
        const property=Object.keys(node?.attributes||{})[0]||''
        setAttribute(property);setValue(property ? node.attributes[property]:'')
        // Ctrl/Cmd-click extends a structural selection so several sibling
        // layers can be grouped in one exact patch set.
        setExtraSelection(previous=>{
          if(!additive) return []
          // `active` is still the previous primary selection here: it joins the
          // set so the first Ctrl-click already yields two selected layers.
          const base=previous.includes(active)?previous:[...previous,active].filter(Boolean)
          if(base.includes(nodeId)) return base.filter(id=>id!==nodeId)
          return [...base,nodeId]
        })
      }
      /** Selected layer ids in document order (primary selection always included). */
      function selectionIds() {
        const wanted=new Set(extraSelection)
        if(active) wanted.add(active)
        return nodes.filter(node=>wanted.has(node.id)).map(node=>node.id)
      }
      // One validation + six alignment plans + two distribution plans per
      // render is bounded (16 layers max) and keeps the disabled state and its
      // visible reason in sync with the real document, not with a separate
      // optimistic model. Distribution shares the validation, with a
      // three-layer minimum and its own gap/overlap rules.
      const alignmentState=alignmentSelectionState()
      const alignmentPlans={}
      for(const mode of ALIGNMENT_MODES) alignmentPlans[mode.key]=alignmentModePlan(alignmentState,mode)
      const alignmentBlockedReasons=[...new Set(ALIGNMENT_MODES
        .filter(mode=>!alignmentPlans[mode.key].ok)
        .map(mode=>alignmentPlans[mode.key].reason))]
      const distributionState=alignmentSelectionState(3)
      const distributionPlans={}
      for(const mode of DISTRIBUTION_MODES) distributionPlans[mode.key]=distributionPlan(distributionState,mode)
      const distributionBlockedReasons=[...new Set(DISTRIBUTION_MODES
        .filter(mode=>!distributionPlans[mode.key].ok)
        .map(mode=>distributionPlans[mode.key].reason))]
      // A successful gesture must stay visible: the reasons are then only shown
      // in each button's title, never in place of the confirmation. Both
      // families share one visible hint, so a refusal that only affects the
      // distribution (overlap, three-layer minimum, vertical text) is named even
      // when the six alignments themselves stay available.
      const gestureBlockedReasons=[...new Set([
        ...alignmentBlockedReasons,
        ...distributionBlockedReasons,
      ])]
      const alignmentHint=alignNotice || (gestureBlockedReasons.length
        ? gestureBlockedReasons.join(' ')
        : 'Six alignements, deux distributions, une seule écriture · Undo exact.')
      const selected=nodes.find(n=>n.id===active)
      const menuLayer=layerMenu?nodes.find(node=>node.id===layerMenu.id):null
      const menuBlocked=!!(busy||reloadRequired||!doc||doc.format!=='svg'||source!==doc?.source)
      // The PNG control is disabled only when the conversion cannot apply to this
      // document; the visible reason next to it says why, so it is never a dead
      // button. Transient states (busy, conversion running) keep the same title.
      const pngUnavailableReason = !doc ? 'PNG : aucun document SVG ouvert'
        : doc.format!=='svg' ? 'PNG : disponible uniquement pour les documents SVG'
        : null
      const pngDisabled = !doc || doc.format!=='svg' || pngBusy
      const selectedHtml=htmlElements.find(node=>node.id===htmlActive)
      const selectedHtmlRules=htmlStyleMatches.find(entry=>entry.id===htmlActive)?.matches||[]
      const selectedCss=cssRules.find(rule=>rule.selector===cssActive)
      const selectedMedia=cssMedia.find(rule=>rule.start===cssMediaStart)||null
      // Conditional reasons are typed codes; show them as readable text instead
      // of leaking the raw code into the UI.
      const CONDITIONAL_REASONS={
        'unsupported-selector':'sélecteur non pris en charge',
        'duplicate-property':'déclaration dupliquée dans le bloc',
        'empty-block':'bloc de déclarations vide',
        'unsupported-css':'contenu CSS non pris en charge',
        'structure-unavailable':'structure du fichier indisponible',
      }
      const conditionalReason=reason=>CONDITIONAL_REASONS[reason]||'bloc conditionnel non pris en charge'
      const htmlProps=['color','background-color','display','width','height','padding','margin',
        'flex-wrap','align-content','align-self','flex-grow','flex-shrink','flex-basis',
        'grid-template-rows','row-gap','column-gap','justify-items','place-items',
        'max-width','min-width','text-wrap','line-height','object-fit','overflow','z-index',
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
        {property:'flex-wrap',label:'Retour à la ligne · Flex',mode:'flex',
          options:[['nowrap','Non'],['wrap','Oui'],['wrap-reverse','Inversé']]},
        {property:'align-content',label:'Lignes · Flex',mode:'flex',
          options:[['stretch','Étirer'],['flex-start','Début'],['center','Centre'],['space-between','Répartir']]},
        {property:'align-self',label:'Alignement de l’élément',mode:'layout',
          options:[['auto','Auto'],['flex-start','Début'],['center','Centre'],['flex-end','Fin'],['stretch','Étirer']]},
        {property:'flex-grow',label:'Croissance · Flex',mode:'flex',
          options:[['0','0'],['1','1'],['2','2']]},
        {property:'flex-shrink',label:'Rétrécissement · Flex',mode:'flex',
          options:[['0','0'],['1','1']]},
        {property:'flex-basis',label:'Base · Flex',mode:'flex',
          options:[['auto','auto'],['0%','0%'],['25%','25%'],['50%','50%'],['100%','100%']]},
        {property:'grid-template-rows',label:'Lignes · Grid',mode:'grid',
          options:[['1fr','1'],['repeat(2, minmax(0, 1fr))','2'],['repeat(3, minmax(0, 1fr))','3']]},
        {property:'row-gap',label:'Espacement vertical',mode:'layout',
          options:[['0px','0'],['8px','8'],['16px','16'],['24px','24']]},
        {property:'column-gap',label:'Espacement horizontal',mode:'layout',
          options:[['0px','0'],['8px','8'],['16px','16'],['24px','24']]},
        {property:'justify-items',label:'Justification · Grid',mode:'grid',
          options:[['stretch','Étirer'],['start','Début'],['center','Centre'],['end','Fin']]},
        {property:'max-width',label:'Largeur maximale',mode:'layout',
          options:[['none','aucune'],['100%','100%'],['768px','768'],['390px','390']]},
        {property:'overflow',label:'Débordement',mode:'layout',
          options:[['visible','Visible'],['hidden','Masqué'],['auto','Auto'],['scroll','Défilant']]},
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
            background:'var(--dsw-alias-bg-layer-2, #292b2f)',border:'1px solid #474343',borderRadius:8}},
          h('strong',{style:{color:ACCENT}},'Disposition · Flex / Grid'),
          h('small',{style:{color:'var(--dsw-alias-label-secondary, #b6afa7)'}},
            'Préréglages natifs, une propriété par action. CSS externe et cascade non calculés.'),
          layoutGroups.map(group=>{
            const requires=group.mode
            const compatible=!requires || (requires==='layout'
              ?displayMode==='flex'||displayMode==='grid'
              :displayMode===requires)
            if(!compatible && requires && requires!=='layout' && displayMode!=='flex' && displayMode!=='grid')return null
            const off=editingBlocked||!compatible
            return h('div',{key:group.property,style:{display:'grid',gap:5}},
              h('small',{style:{color:'var(--dsw-alias-label-secondary, #d6c7b2)'}},group.label+
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
                      borderColor:values[group.property]===value?ACCENT:'var(--dsw-alias-border-l2, #44464b)'},
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
        // Conditional and unconditional targets are mutually exclusive: a
        // leftover media selection must never stay the edit target.
        setCssMediaStart(null);setCssMediaValue('')
        setCssActive(selector)
        const rule=cssRules.find(item=>item.selector===selector)
        setCssValue(rule?.declarations?.find(item=>item.property===cssProperty)?.value||'')
      }
      function chooseCssProperty(property) {
        setCssProperty(property)
        const rule=cssRules.find(item=>item.selector===cssActive)
        setCssValue(rule?.declarations?.find(item=>item.property===property)?.value||'')
      }
      function chooseCssMedia(start) {
        setCssActive('');setCssValue('')
        setCssMediaStart(start)
        const rule=cssMedia.find(item=>item.start===start)
        setCssMediaValue(rule?.declarations?.find(item=>item.property===cssMediaProperty)?.value||'')
      }
      function chooseCssMediaProperty(property) {
        setCssMediaProperty(property)
        const rule=cssMedia.find(item=>item.start===cssMediaStart)
        setCssMediaValue(rule?.declarations?.find(item=>item.property===property)?.value||'')
      }
      /** Exact source text of a mapped element, or '' when it is not addressable. */
      function htmlElementText(item) {
        if(!item || !Number.isInteger(item.textStart) || !Number.isInteger(item.textEnd)) return ''
        if(source!==doc?.source) return ''
        return source.slice(item.textStart,item.textEnd)
      }
      function chooseHtmlElement(id) {
        setHtmlActive(id)
        const picked=htmlElements.find(node=>node.id===id)
        setHtmlText(htmlElementText(picked))
        setHtmlAttrValue(Array.isArray(picked?.classes)?picked.classes.join(' '):'')
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
        file:doc?.file,identity:doc?.identity,scope:scopeKey,
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
        const expectedFile=doc.file,expectedIdentity=doc.identity,expectedScope=scopeKey
        const handler=event=>{
          // Neutralize hyperlinks, form controls and navigations in the preview.
          event.preventDefault()
          // Browser-generated clicks (mouse/touch/keyboard) are trusted. If
          // scripts ever become possible here, synthetic DOM events are ignored.
          if(event.isTrusted===false)return
          const context=previewContextRef.current
          if(!context || context.file!==expectedFile ||
             context.identity!==expectedIdentity ||
             context.scope!==expectedScope ||
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
        if(hasTextDraft()) {
          if(nodeId!==active){refuseTextDraft();return}
          setEditingText(nodeId);return
        }
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
      // `display` is the declared board size (root width/height when absolute).
      // `artboard` stays the coordinate system: the overlay is laid out inside a
      // content box with the viewBox aspect ratio, so handles keep matching the
      // rendered artwork even when the declared board proportions differ.
      const display=geometry.display||artboard
      const contentRatio=artboard?artboard.width/artboard.height:1
      const displayRatio=display?display.width/display.height:1
      const contentBoxStyle=!display?null:displayRatio>contentRatio
        ?{position:'absolute',top:0,bottom:0,left:'50%',transform:'translateX(-50%)',
          height:'100%',aspectRatio:String(contentRatio)}
        :{position:'absolute',left:0,right:0,top:'50%',transform:'translateY(-50%)',
          width:'100%',aspectRatio:String(contentRatio)}
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
      async function createShapeAtPointer(event) {
        if(!['rect','ellipse','text'].includes(canvasTool)||event.button!==0||spaceHeld||
          busy||reloadRequired||shapePendingRef.current||source!==doc?.source||refuseTextDraft())return
        const point=positionInArtboard(event,event.currentTarget)
        if(!point)return
        event.preventDefault();event.stopPropagation()
        const shape=canvasTool
        shapePendingRef.current=true
        try {
          await save({kind:'svg-add-shape',shape,x:point.x,y:point.y},'record',response=>{
            setCanvasTool('select')
            if(shape==='text')setEditingText(response.createdId)
          })
        } finally {shapePendingRef.current=false}
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
        if(refuseTextDraft())return
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
          // Under a scaled or rotated ancestor the visible delta is not the local
          // one: apply the linear inverse of the accumulated transform matrix.
          const inverse=Array.isArray(item.move?.inverse)&&item.move.inverse.length===4?item.move.inverse:null
          const localX=inverse?inverse[0]*dx+inverse[2]*dy:dx
          const localY=inverse?inverse[1]*dx+inverse[3]*dy:dy
          if(item.move?.kind==='translate') {
            // A group has no x/y attributes: move it with one translate transform.
            // The transform operation takes real numbers, not the string form used
            // for attribute patches.
            const rounded=value=>Math.round(value*1000)/1000
            void save({kind:'svg-transform',id:drag.id,
              operation:{type:'translate',dx:rounded(localX),dy:rounded(localY)}})
            return
          }
          edits=[
            {id:drag.id,attribute:item.move.x,value:number(item.move.initialX+localX)},
            {id:drag.id,attribute:item.move.y,value:number(item.move.initialY+localY)}
          ]
        }
        void save({kind:'svg-attributes',edits})
      }
      // Numeric transformation and fill, straight from the document's own
      // attributes: no second geometry model, so what the inputs show is what
      // the file says. A shape whose attributes are missing stays read-only
      // instead of being given invented values.
      const GEOMETRY_FIELDS = {
        rect:['x','y','width','height'], image:['x','y','width','height'],
        ellipse:['cx','cy','rx','ry'], circle:['cx','cy','r'],
        line:['x1','y1','x2','y2'], text:['x','y'], use:['x','y'],
      }
      const GEOMETRY_LABELS = {x:'X',y:'Y',width:'L',height:'H',cx:'X',cy:'Y',rx:'L',ry:'H',
        r:'R',x1:'X1',y1:'Y1',x2:'X2',y2:'Y2'}
      const geometryFields = selected && !selected.isGroup ? (GEOMETRY_FIELDS[selected.tag]||[]) : []
      const geometryValues = geometryFields.every(key=>selected && selected.attributes &&
        Object.hasOwn(selected.attributes,key)) ? geometryFields : []
      const geometryWritable = geometryValues.length>0 && !selected?.locked &&
        !busy && !reloadRequired && source===doc?.source
      const editable = !busy && !reloadRequired && source===doc?.source && !selected?.locked
      function commitAttributes(next) {
        if(!selected) return
        const edits = Object.entries(next)
          .filter(([, value])=>typeof value==='string' && value.trim().length>0)
          .filter(([attribute, value])=>String(selected.attributes[attribute]??'')!==value.trim())
          .map(([attribute, value])=>({id:selected.id,attribute,value:value.trim()}))
        if(edits.length===0) return
        void save({kind:'svg-attributes',edits})
      }
      // Geometry fields describe a local bounding box, never radii disguised as W/H.
      const attr=selected?.attributes||{}
      const round=value=>String(Math.round(value*1000)/1000)
      const ellipse=selected?.tag==='ellipse'||selected?.tag==='circle'
      const rx=Number(attr[selected?.tag==='circle'?'r':'rx']), ry=Number(attr[selected?.tag==='circle'?'r':'ry'])
      const boxValues=ellipse&&[Number(attr.cx),Number(attr.cy),rx,ry].every(Number.isFinite)
        ?{x:Number(attr.cx)-rx,y:Number(attr.cy)-ry,width:rx*2,height:ry*2}
        :Object.fromEntries(geometryValues.map(key=>[key,attr[key]]))
      function commitGeometry(key,raw) {
        if(!geometryWritable||!selected)return
        const value=Number(raw)
        if(!Number.isFinite(value)||(['width','height'].includes(key)&&value<=0))return
        if(!ellipse){commitAttributes({[key]:String(value)});return}
        const next={...boxValues,[key]:value}
        if(selected.tag==='circle'&&key==='width')next.height=value
        if(selected.tag==='circle'&&key==='height')next.width=value
        commitAttributes(selected.tag==='circle'
          ?{cx:round(next.x+next.width/2),cy:round(next.y+next.height/2),r:round(next.width/2)}
          :{cx:round(next.x+next.width/2),cy:round(next.y+next.height/2),rx:round(next.width/2),ry:round(next.height/2)})
      }
      const displayGeometry=Object.keys(boxValues).length?Object.keys(boxValues):['x','y','width','height']
      /**
       * Planche (artboard) resizing. The displayed size is the one actually read
       * from the file by the Host. One Apply = one Host write; the explicit
       * "Redimensionner le contenu" checkbox changes which attributes move
       * together (viewBox + width/height in a single batch).
       */
      const ARTBOARD_REASONS={
        'invalid-svg':'Document SVG illisible : le redimensionnement est refusé.',
        'unsupported-svg':'Document SVG non pris en charge : le redimensionnement est refusé.',
        'invalid-viewbox':'viewBox invalide (4 nombres finis, largeur et hauteur positives) : redimensionnement refusé.',
        'unsupported-aspect-ratio':'preserveAspectRatio non standard : redimensionnement refusé pour ne pas déformer le dessin.',
        'unresolvable-artboard':'Planche non résoluble : aucun viewBox et aucune taille absolue width/height.',
      }
      const artboardReady=!!doc&&doc.format==='svg'&&artboardMeta?.ok===true&&!busy&&!reloadRequired&&
        source===doc.source
      const artboardSizeText=artboardMeta?.ok===true
        ?`${Number(artboardMeta.width)} × ${Number(artboardMeta.height)} px`
        :''
      const artboardSourceText=artboardMeta?.ok!==true?''
        :artboardMeta.source==='viewBox'
          ?'viewBox '+artboardMeta.viewBox+
            (artboardMeta.widthAttribute!==null||artboardMeta.heightAttribute!==null
              ?' · width '+String(artboardMeta.widthAttribute)+' · height '+String(artboardMeta.heightAttribute)
              :'')
          :'width '+String(artboardMeta.widthAttribute)+' · height '+String(artboardMeta.heightAttribute)
      // A disabled control must explain itself, including while the document is
      // busy, dirty or waiting to be reloaded.
      const artboardBlockedReason=artboardMeta?.ok!==true?null
        :busy?'Enregistrement en cours : la planche sera modifiable ensuite.'
        :reloadRequired?'Document à recharger avant de modifier la planche.'
        :source!==doc?.source?'Brouillon source non enregistré : enregistrez-le ou abandonnez-le avant de redimensionner.'
        :null
      function commitArtboardSize() {
        if(!doc||doc.format!=='svg'||busy||reloadRequired||source!==doc.source)return
        if(!artboardMeta?.ok){setError(ARTBOARD_REASONS[artboardMeta?.reason]||'Planche indisponible : rechargez le document.');return}
        const widthText=String(artboardWidthRef.current?.value??'').trim()
        const heightText=String(artboardHeightRef.current?.value??'').trim()
        const numeric=text=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)&&Number.isFinite(Number(text))
        if(!numeric(widthText)||!numeric(heightText)) {
          setError('Taille de planche invalide : indiquez deux nombres finis en px.')
          return
        }
        const width=Number(widthText),height=Number(heightText)
        if(width<1||height<1||width>20000||height>20000) {
          setError('Taille de planche hors bornes : 1 à 20000 px.')
          return
        }
        if(!artboardScaleContent&&artboardMeta.displayResize!==true) {
          setError('viewBox absent : cochez « Redimensionner le contenu » pour écrire width, height et viewBox ensemble.')
          return
        }
        // Identical display resize: no request, no history entry, no write.
        if(!artboardScaleContent&&width===Number(artboardMeta.width)&&height===Number(artboardMeta.height)) {
          setNotice('Taille inchangée : aucune écriture.')
          return
        }
        void save({kind:'svg-artboard',width,height,scaleContent:artboardScaleContent})
      }
      const artboardInspector=doc?.format==='svg'&&h('section',{className:'dsh-studio-ins-block',
        'data-artboard-inspector':'','data-artboard-ok':artboardMeta?.ok===true?'true':'false',
        'data-artboard-reason':artboardMeta?.ok===true?'':(artboardMeta?.reason||'unavailable')},
        h('div',{className:'dsh-studio-ins-head'},'Planche',h('span',null,'▣')),
        artboardMeta?.ok===true
          ?h(React.Fragment,null,
            h('p',{className:'dsh-studio-hint','data-artboard-size':artboardSizeText},
              'Taille actuelle lue dans le fichier : ',h('strong',null,artboardSizeText),
              h('br'),h('small',null,artboardSourceText)),
            h('div',{className:'dsh-studio-ins-row',style:{rowGap:10}},
              h('label',{className:'dsh-studio-prop'},h('span',null,'L'),
                h('input',{ref:artboardWidthRef,key:'aw:'+doc.file+':'+artboardMeta.width+':'+String(artboardMeta.widthAttribute),
                  type:'number',min:1,max:20000,step:'any',defaultValue:artboardMeta.width,
                  disabled:!artboardReady,'aria-label':'Artboard width'})),
              h('label',{className:'dsh-studio-prop'},h('span',null,'H'),
                h('input',{ref:artboardHeightRef,key:'ah:'+doc.file+':'+artboardMeta.height+':'+String(artboardMeta.heightAttribute),
                  type:'number',min:1,max:20000,step:'any',defaultValue:artboardMeta.height,
                  disabled:!artboardReady,'aria-label':'Artboard height'}))),
            h('label',{style:{display:'flex',alignItems:'center',gap:8,marginTop:10,fontSize:12,
              color:'var(--dsw-alias-label-secondary, #b7b4af)'}},
              h('input',{type:'checkbox',checked:artboardScaleContent,disabled:!artboardReady,
                'aria-label':'Redimensionner le contenu',
                onChange:event=>setArtboardScaleContent(event.target.checked)}),
              'Redimensionner le contenu'),
            artboardBlockedReason&&h('p',{className:'dsh-studio-hint','data-artboard-blocked-reason':''},
              artboardBlockedReason),
            h('p',{className:'dsh-studio-hint','data-artboard-mode':artboardScaleContent?'content':'display'},
              artboardScaleContent
                ?'Coché : viewBox, largeur et hauteur changent ensemble dans une seule écriture. Les formes gardent leurs coordonnées et leur taille en px ; la planche gagne ou perd de l’espace.'
                :'Décoché : seuls largeur et hauteur changent, le viewBox est conservé. Le dessin est mis à l’échelle pour remplir la planche.'),
            h('button',{type:'button',style:{...button,width:'100%',marginTop:8},
              disabled:!artboardReady||(!artboardScaleContent&&artboardMeta.displayResize!==true),
              'aria-label':'Apply artboard size',
              title:!artboardScaleContent&&artboardMeta.displayResize!==true
                ?'viewBox absent : cochez « Redimensionner le contenu »'
                :'Une seule écriture transactionnelle',
              onClick:commitArtboardSize},'Appliquer la taille'),
            !artboardScaleContent&&artboardMeta.displayResize!==true&&
              h('p',{className:'dsh-studio-hint','data-artboard-blocked':''},
                'Sans viewBox, l’écriture cohérente ajoute un viewBox : cochez « Redimensionner le contenu ».'))
          :h('p',{className:'dsh-studio-hint','data-artboard-reason':artboardMeta?.reason||'unavailable'},
            ARTBOARD_REASONS[artboardMeta?.reason]||'Métadonnées de planche indisponibles : rechargez le document.'))
      // Alignment and distribution controls. They are real buttons in the
      // inspector, not canvas commands, so every disabled state carries its
      // reason in the visible hint (a silent no-op button is exactly what this
      // gate forbids).
      const alignmentInspector=h('section',{className:'dsh-studio-ins-block','data-align-panel':''},
        h('div',{className:'dsh-studio-ins-head'},'Alignement',h('span',null,'⌗')),
        ['x','y'].map(axis=>h('div',{key:axis,role:'group',
          'aria-label':axis==='x'?'Alignement horizontal':'Alignement vertical',
          style:{display:'flex',gap:6,marginTop:axis==='y'?6:0}},
          ALIGNMENT_MODES.filter(mode=>mode.axis===axis).map(mode=>{
            const plan=alignmentPlans[mode.key]
            return h('button',{key:mode.key,type:'button',className:'dsh-studio-prop',
              style:{flex:1,justifyContent:'center',padding:'0 6px',fontSize:11},
              'aria-label':mode.label,title:plan.ok?mode.label+' · une seule écriture':plan.reason,
              disabled:!plan.ok,onClick:()=>alignSelection(mode.key)},mode.text)
          }))),
        h('div',{role:'group','aria-label':'Distribution',
          style:{display:'flex',gap:6,marginTop:8}},
          DISTRIBUTION_MODES.map(mode=>{
            const plan=distributionPlans[mode.key]
            return h('button',{key:mode.key,type:'button',className:'dsh-studio-prop',
              style:{flex:1,justifyContent:'center',padding:'0 6px',fontSize:11},
              'aria-label':mode.label,title:plan.ok?mode.label+' · une seule écriture':plan.reason,
              disabled:!plan.ok,onClick:()=>distributeSelection(mode.key)},mode.text)
          })),
        h('p',{className:'dsh-studio-hint','data-align-reason':alignmentHint},alignmentHint))
      const geometryInspector=h('section',{className:'dsh-studio-ins-block'},
        h('div',{className:'dsh-studio-ins-head'},'Transformation',h('span',null,'⌘')),
        h('div',{className:'dsh-studio-ins-row',style:{rowGap:10}},displayGeometry.map(key=>
          h('label',{className:'dsh-studio-prop',key},h('span',null,GEOMETRY_LABELS[key]||key),
            h('input',{key:active+':'+key+':'+boxValues[key],type:'number',step:'any',
              defaultValue:boxValues[key]??'',disabled:!geometryWritable,'aria-label':'Geometry '+key,
              onBlur:e=>commitGeometry(key,e.target.value),onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}})))),
        h('div',{className:'dsh-studio-rowspace'}),
        h('div',{className:'dsh-studio-ins-row'},
          h('button',{className:'dsh-studio-prop','aria-label':'Rotate selected layer 90 degrees',disabled:!selected||!editable,title:'Rotation 90° autour du centre réel',onClick:()=>void transformSelected('rotate')},'↻ 90°'),
          h('button',{className:'dsh-studio-prop',disabled:true,title:'Verrouillage permanent non implémenté ; Shift pendant redimensionnement'},'◇ Proportions libres')),
        selected?.tag==='text'&&h('p',{className:'dsh-studio-hint'},'X/Y : origine de la ligne de base SVG ; taille dans Typographie.'))
      const fillValue=typeof attr.fill==='string'?attr.fill:''
      const hexFill=/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(fillValue)
      const expandedFill=hexFill&&(fillValue.length===4||fillValue.length===5)
        ?'#'+fillValue.slice(1).split('').map(c=>c+c).join(''):fillValue
      const fillRGB=hexFill?expandedFill.slice(0,7):'#000000'
      const fillAlpha=hexFill&&expandedFill.length===9?expandedFill.slice(7):''
      // Dégradé : uniquement un arrêt d'un dégradé réellement référencé par le
      // `fill` de la forme sélectionnée. Un attribut absent n'est jamais inventé :
      // le champ reste inactif et la raison est visible.
      const fillGradient=/^url\(\s*#([A-Za-z_][\w.:-]*)\s*\)$/.exec(fillValue)
      const selectedGradient=fillGradient&&doc?.format==='svg'
        ?gradients.find(item=>item.id===fillGradient[1])||null:null
      const GRADIENT_REASONS={
        'inherited-gradient':'dégradé hérité par href : les attributs de ses arrêts ne sont pas définis localement.',
        'ambiguous-style':'un arrêt porte un attribut style= : la source de vérité est ambiguë.',
        'encoded-attribute':'un arrêt encode un attribut en XML (entité) : la valeur est ambiguë.',
        'no-stops':'ce dégradé ne déclare aucun arrêt.'
      }
      const stopHex=value=>/^#[0-9a-f]{3}$/i.test(value||'')
        ?'#'+value.slice(1).split('').map(c=>c+c).join('')
        :/^#[0-9a-f]{6}$/i.test(value||'')?value:'#000000'
      function commitGradientStop(index,attribute,next,current) {
        if(!selectedGradient||!selectedGradient.usable||!editable)return
        const value=String(next??'').trim()
        // Identical value: no request at all, matching the Host refusal.
        if(value===String(current??'').trim())return
        const valid=attribute==='stop-color'
          ?/^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/.test(value)
          :attribute==='offset'
            ?(/^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(value)
              ?Number(value.slice(0,-1))<=100
              :/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)&&Number(value)<=1)
            :/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)&&Number(value)<=1
        if(!valid) {
          setError(attribute==='stop-color'
            ?'Couleur d’arrêt refusée : utilisez #rgb ou #rrggbb.'
            :attribute==='offset'
              ?'Position d’arrêt refusée : utilisez 0 à 1 ou 0% à 100%.'
              :'Opacité d’arrêt refusée : nombre entre 0 et 1.')
          return
        }
        // One attribute value, one exact patch, one Undo step.
        void save({kind:'svg-gradient-stop',gradientId:selectedGradient.id,index,attribute,value})
      }
      // Structure of the gradient: one complete <stop> inserted or removed as a
      // single exact span, so Undo restores the bytes. Every precondition is
      // re-checked by the Host; these guards only avoid a request that the Host
      // would refuse anyway (last stop, 32-stop ceiling, busy/dirty document).
      const GRADIENT_MAX_STOPS=32
      function addGradientStop() {
        if(!selectedGradient||!selectedGradient.usable||!editable)return
        if(selectedGradient.stops.length>=GRADIENT_MAX_STOPS) {
          setError('Maximum '+GRADIENT_MAX_STOPS+' arrêts par dégradé : aucun arrêt ajouté.')
          return
        }
        void save({kind:'svg-gradient-stop-add',gradientId:selectedGradient.id,
          index:selectedGradient.stops.length})
      }
      function removeGradientStop(index) {
        if(!selectedGradient||!selectedGradient.usable||!editable)return
        if(selectedGradient.stops.length<=1) {
          setError('Impossible de supprimer le dernier arrêt : un dégradé sans arrêt n’a plus de sens.')
          return
        }
        void save({kind:'svg-gradient-stop-remove',gradientId:selectedGradient.id,index})
      }
      const gradientInspector=selectedGradient&&h('section',{className:'dsh-studio-ins-block',
        'data-gradient-section':selectedGradient.id,'data-gradient-usable':selectedGradient.usable?'true':'false'},
        h('div',{className:'dsh-studio-ins-head'},'Dégradé',
          h('span',null,selectedGradient.type==='linear'?'↗':'◎')),
        h('small',{className:'dsh-studio-hint','data-gradient-meta':''},
          selectedGradient.type+'Gradient · #'+selectedGradient.id+' · '+selectedGradient.stops.length+' arrêt(s)'),
        !selectedGradient.usable?
          h(React.Fragment,null,
            h('p',{className:'dsh-studio-hint','data-gradient-reason':selectedGradient.reason},
              'Lecture seule : '+(GRADIENT_REASONS[selectedGradient.reason]||selectedGradient.reason)+' Aucune écriture possible.'),
            h('ul',{style:{margin:'6px 0 0',paddingLeft:16,fontSize:11,color:'var(--muted)'}},
              selectedGradient.stops.map(stop=>h('li',{key:stop.index,'data-gradient-stop':stop.index},
                'Arrêt '+(stop.index+1)+' · offset '+(stop.offset??'0')+' · '+(stop.color??'(sans stop-color)')+
                ' · opacité '+(stop.opacity??'1')))))
          :h(React.Fragment,null,
            selectedGradient.stops.map(stop=>h('div',{key:stop.index,'data-gradient-stop':stop.index,
              style:{display:'grid',gridTemplateColumns:'auto 1fr 64px auto',gap:6,alignItems:'center',marginTop:4}},
              h('span',{style:{display:'flex',flexDirection:'column',minWidth:0}},
                h('span',{style:{fontSize:11,color:ACCENT}},'Arrêt '+(stop.index+1)),
                h('small',{style:{fontSize:10,color:'var(--muted)'},'data-gradient-offset':stop.offset??''},
                  'offset '+(stop.offset??'0')),
                h('input',{type:'text',defaultValue:stop.offset??'',
                  key:active+':stop-offset:'+stop.index+':'+(stop.offset??''),
                  style:{...field,height:26,width:72,fontSize:11},'aria-label':'Gradient stop '+stop.index+' offset',
                  title:stop.offsetSpan?'Position native (0..1 ou 0%..100%)':'offset absent : édition indisponible',
                  disabled:!editable||!stop.offsetSpan,
                  onBlur:e=>commitGradientStop(stop.index,'offset',e.target.value,stop.offset),
                  onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}})),
              h('div',{style:{display:'flex',gap:4,minWidth:0}},
                h('input',{type:'color',value:stopHex(stop.color),
                  'aria-label':'Gradient stop '+stop.index+' colour picker',
                  title:stop.colorSpan?'Couleur native de l’arrêt':'stop-color absent : aucune insertion dans cette tranche',
                  disabled:!editable||!stop.colorSpan||!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(stop.color||''),
                  style:{width:30,height:30,padding:2,flex:'0 0 auto'},
                  onChange:e=>commitGradientStop(stop.index,'stop-color',e.target.value,stop.color)}),
                h('input',{type:'text',defaultValue:stop.color??'',
                  key:active+':stop:'+stop.index+':'+(stop.color??''),spellCheck:false,
                  style:{...field,height:30,minWidth:0},'aria-label':'Gradient stop '+stop.index+' colour',
                  title:stop.colorSpan?'#rgb ou #rrggbb':'stop-color absent : aucune insertion dans cette tranche',
                  disabled:!editable||!stop.colorSpan,
                  onBlur:e=>commitGradientStop(stop.index,'stop-color',e.target.value,stop.color),
                  onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}})),
              // A percentage (`50%`) or an exotic expression is valid SVG but
              // cannot be represented by a number input; showing an empty active
              // field would misreport the file, so it stays read-only with its
              // real value.
              (stop.opacity===null&&stop.opacitySpan===null)||stop.opacity===undefined?
                h('input',{type:'number',min:0,max:1,step:0.01,defaultValue:'',
                  style:{...field,height:30},'aria-label':'Gradient stop '+stop.index+' opacity',
                  title:'stop-opacity absent : aucune insertion dans cette tranche',
                  disabled:true}):
              !/^(?:0|1|0?\.\d+)$/.test(String(stop.opacity||''))&&stop.opacitySpan!==null?
                h('input',{type:'text',defaultValue:String(stop.opacity??''),readOnly:true,
                  style:{...field,height:30,opacity:.7},'aria-label':'Gradient stop '+stop.index+' opacity',
                  title:'Valeur native non numérique : lecture seule dans cette tranche',
                  'data-gradient-readonly':'true'}):
                h('input',{type:'number',min:0,max:1,step:0.01,defaultValue:stop.opacity??'',
                  key:active+':stop-opacity:'+stop.index+':'+(stop.opacity??''),
                  style:{...field,height:30},'aria-label':'Gradient stop '+stop.index+' opacity',
                  title:'Opacité native de l’arrêt (0..1)',
                  disabled:!editable||!stop.opacitySpan,
                  onBlur:e=>commitGradientStop(stop.index,'stop-opacity',e.target.value,stop.opacity),
                  onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}}),
              // N is the 1-based number shown in the panel ("Arrêt N"); the
              // request carries the 0-based `stop.index` the Host expects.
              h('button',{type:'button','aria-label':'Supprimer l’arrêt '+(stop.index+1),
                'data-gradient-remove':stop.index,
                title:selectedGradient.stops.length<=1
                  ?'Dernier arrêt : suppression refusée, un dégradé sans arrêt n’a plus de sens'
                  :'Supprimer cet arrêt (span exact) · 1 écriture, Undo exact',
                disabled:!editable||selectedGradient.stops.length<=1,
                style:{...button,width:26,height:30,padding:0,fontSize:12,flex:'0 0 auto'},
                onClick:()=>void removeGradientStop(stop.index)},'✕'))),
            h('div',{style:{display:'flex',alignItems:'center',gap:8,marginTop:8}},
              h('button',{type:'button','aria-label':'Ajouter un arrêt','data-gradient-add':'',
                disabled:!editable||selectedGradient.stops.length>=GRADIENT_MAX_STOPS,
                title:selectedGradient.stops.length>=GRADIENT_MAX_STOPS
                  ?'Maximum '+GRADIENT_MAX_STOPS+' arrêts atteint · aucun ajout possible'
                  :'Insère un arrêt complet (couleur/opacité de l’arrêt voisin, offset distinct) · 1 écriture, Undo exact',
                style:{...button,height:30},onClick:()=>void addGradientStop()},
              '＋ Ajouter un arrêt'),
              h('small',{className:'dsh-studio-hint',style:{margin:0}},GRADIENT_MAX_STOPS+' max · 1 écriture')),
            selectedGradient.stops.some(stop=>!stop.colorSpan||!stop.opacitySpan)&&
              h('p',{className:'dsh-studio-hint'},'Attribut absent sur un arrêt : cette tranche ne crée pas d’attribut.'),
            h('p',{className:'dsh-studio-hint'},'Une modification = une écriture exacte, annulable (Undo).')))
      /**
       * Stroke editing. Every control writes ONE validated attribute of the
       * selected layer through the same transactional path as the rest of the
       * inspector: a missing declaration is inserted as a single reversible
       * span, an existing one is replaced in place.
       */
      const strokeValue = typeof attr.stroke === 'string' ? attr.stroke : ''
      const strokePaint = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(strokeValue)
      const strokeNone = strokeValue === '' || strokeValue === 'none'
      const strokeInspector = h('section',{className:'dsh-studio-ins-block','data-stroke-panel':''},
        h('div',{className:'dsh-studio-ins-head'},'Contour',h('span',null,'＋')),
        h('div',{style:{display:'flex',gap:6,alignItems:'center'}},
          h('input',{type:'color','aria-label':'Stroke colour',value:strokePaint?strokeValue:'#000000',
            disabled:!selected||!editable,style:{width:30,height:30,padding:2},
            title:strokePaint?'Couleur de trait native':'Aucun trait hexadécimal : choisir une couleur en crée un',
            onChange:e=>commitAttributes({stroke:e.target.value})}),
          h('input',{type:'text',key:active+':stroke:'+strokeValue,'defaultValue':strokeValue||'none',
            'aria-label':'Stroke value',spellCheck:false,disabled:!selected||!editable,
            style:{...field,height:30},title:'none ou couleur hexadécimale',
            onBlur:e=>{
              const next=e.target.value.trim()
              if(next==='none'||/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(next))commitAttributes({stroke:next})
            },
            onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}}),
          h('button',{type:'button',style:{...button,height:30,padding:'0 8px'},
            'aria-label':'Remove stroke',disabled:!selected||!editable||strokeNone,
            onClick:()=>commitAttributes({stroke:'none'})},'Aucun')),
        h('div',{className:'dsh-studio-rowspace'}),
        h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}},
          h('label',null,'Épaisseur',
            h('input',{type:'number',min:0,step:'any',style:field,'aria-label':'Stroke width',
              key:active+':sw:'+(attr['stroke-width']??''),defaultValue:attr['stroke-width']??'',
              placeholder:'1',disabled:!selected||!editable,
              onBlur:e=>{const v=e.target.value.trim();if(v&&Number(v)>=0)commitAttributes({'stroke-width':v})},
              onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}})),
          h('label',null,'Opacité',
            h('input',{type:'number',min:0,max:1,step:'0.05',style:field,'aria-label':'Stroke opacity',
              key:active+':so:'+(attr['stroke-opacity']??''),defaultValue:attr['stroke-opacity']??'',
              placeholder:'1',disabled:!selected||!editable,
              onBlur:e=>{const v=e.target.value.trim();const n=Number(v);if(v&&n>=0&&n<=1)commitAttributes({'stroke-opacity':v})},
              onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}}))),
        h('div',{className:'dsh-studio-rowspace'}),
        h('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}},
          h('label',null,'Extrémités',
            h('select',{style:field,'aria-label':'Stroke line cap',value:attr['stroke-linecap']||'butt',
              disabled:!selected||!editable,
              onChange:e=>void commitAttributes({'stroke-linecap':e.target.value})},
              [['butt','Droit'],['round','Arrondi'],['square','Carré']].map(([value,label])=>
                h('option',{key:value,value},label)))),
          h('label',null,'Jonctions',
            h('select',{style:field,'aria-label':'Stroke line join',value:attr['stroke-linejoin']||'miter',
              disabled:!selected||!editable,
              onChange:e=>void commitAttributes({'stroke-linejoin':e.target.value})},
              [['miter','Angle'],['round','Arrondi'],['bevel','Biseau']].map(([value,label])=>
                h('option',{key:value,value},label))))),
        h('div',{className:'dsh-studio-rowspace'}),
        h('label',null,'Tirets',
          h('input',{type:'text',style:field,'aria-label':'Stroke dash array',spellCheck:false,
            key:active+':sd:'+(attr['stroke-dasharray']??''),defaultValue:attr['stroke-dasharray']??'',
            placeholder:'ex : 4 2 · none',disabled:!selected||!editable,
            onBlur:e=>{
              const v=e.target.value.trim()
              if(v==='none'||/^(?:\d+(?:\.\d*)?|\.\d+)(?:[\s,]+(?:\d+(?:\.\d*)?|\.\d+))*$/.test(v))
                commitAttributes({'stroke-dasharray':v})
            },
            onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}})),
        h('p',{className:'dsh-studio-hint'},'Un seul attribut par action · Undo exact. Les filtres restent hors périmètre.'))

      const appearanceInspector=h(React.Fragment,null,
        h('section',{className:'dsh-studio-ins-block'},h('div',{className:'dsh-studio-ins-head'},'Apparence',h('span',null,'＋')),
           h('div',{className:'dsh-studio-toggle-row'},h('span',null,'Opacité'),
             h('output',{'aria-label':'Saved opacity'},Math.round(Number(attr.opacity??1)*100)+' %')),
           h('input',{type:'range',min:0,max:100,step:1,key:active+':opacity:'+(attr.opacity??''),
             defaultValue:Number(attr.opacity??1)*100,disabled:!selected||!editable,'aria-label':'Opacity',style:{width:'100%'},
             onPointerUp:e=>commitAttributes({opacity:String(Number(e.currentTarget.value)/100)}),
             onKeyUp:e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))commitAttributes({opacity:String(Number(e.currentTarget.value)/100)})}}),
           h('div',{className:'dsh-studio-rowspace'}),
          h('div',{className:'dsh-studio-toggle-row'},h('span',null,'Visibilité'),
            h('button',{className:'dsh-studio-switch'+(!selected?.hidden?' dsh-studio-on':''),type:'button',
              'aria-label':selected?.hidden?'Show selected layer':'Hide selected layer',disabled:!selected||!editable,
              onClick:()=>void save({kind:'svg-visibility',id:selected.id,property:'display',value:selected.hidden?null:'none'})}))),
        h('section',{className:'dsh-studio-ins-block'},h('div',{className:'dsh-studio-ins-head'},'Remplissage',h('span',null,'＋')),
          h('div',{className:'dsh-studio-color-row'},
            h('input',{type:'color',value:fillRGB,'aria-label':'Fill colour',disabled:!selected||!editable||!hexFill,
              title:hexFill?'Couleur native, alpha conservé':'Dégradé ou valeur non hexadécimale : édition couleur indisponible',
              style:{width:30,height:30,padding:2},onChange:e=>commitAttributes({fill:e.target.value+fillAlpha})}),
            h('input',{type:'text',defaultValue:fillValue,key:active+':'+fillValue,'aria-label':'Fill hex',spellCheck:false,
              disabled:!selected||!editable||!hexFill,style:{...field,height:30},
              onBlur:e=>{if(/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(e.target.value))commitAttributes({fill:e.target.value})},
              onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}})),
          h('div',{style:{display:'flex',gap:6,marginTop:8}},
            [['linear','↗ Dégradé linéaire'],['radial','◎ Dégradé radial']].map(([type,label])=>
              h('button',{type:'button',key:type,style:{...button,flex:1,minWidth:0,fontSize:11},
                'aria-label':'Créer un dégradé '+(type==='linear'?'linéaire':'radial'),
                title:'Créer deux arrêts natifs et relier le remplissage · une écriture, Undo exact',
                disabled:!selected||!editable,
                onClick:()=>void save({kind:'svg-gradient-create',id:active,type})},label))),
          h('p',{className:'dsh-studio-hint'},fillValue&&!hexFill?'Valeur native préservée : '+fillValue:'Couleur native · alpha préservé.')),
        gradientInspector)
      const typeLabels={'font-family':'Police','font-size':'Taille','font-weight':'Graisse',
        'font-style':'Style','letter-spacing':'Espacement','text-anchor':'Alignement'}
      const typeChoices={
        'font-family':['Inter,Arial,sans-serif','Inter, Arial','Arial','Georgia','Verdana','Times New Roman','Courier New','system-ui,sans-serif'],
        'font-weight':['normal','300','400','500','600','700','800','900','bold'],
        'font-style':['normal','italic','oblique'],'text-anchor':['start','middle','end']
      }
      function typographyControl(key) {
        const current=attr[key]??''
        const choices=typeChoices[key]
        if(choices)return h('select',{style:field,'aria-label':'Typography '+key,value:current,
          disabled:!editable,onChange:e=>void save({kind:'svg-attribute',id:active,attribute:key,value:e.target.value})},
          !current&&h('option',{value:'',disabled:true},'Hérité'),
          [...new Set([...(current?[current]:[]),...choices])].map(value=>h('option',{key:value,value},value)))
        const numeric=/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(current))
        return h('input',{style:field,type:numeric?'number':'text',step:'any',
          'aria-label':'Typography '+key,key:active+':'+key+':'+current,defaultValue:current,
          readOnly:!!current&&!numeric,disabled:!editable,
          title:current&&!numeric?'Valeur native conservée avec son unité : '+current:undefined,
          onBlur:e=>{if(e.target.value&&e.target.value!==current)void save({kind:'svg-attribute',id:active,attribute:key,value:e.target.value})},
          onKeyDown:e=>{if(e.key==='Enter')e.currentTarget.blur()}})
      }
      const typographyInspector = selected?.tag==='text'&&selectedText&&h('section',{className:'dsh-studio-ins-block'},
        h('div',{className:'dsh-studio-ins-head'},'Texte',h('span',{style:{fontSize:10}},'Édition directe · T')),
        h('label',{className:'dsh-studio-field-label'},'Contenu'),
        h('textarea',{className:'dsh-studio-type-content',value:textDraft,'aria-label':'Text content',
          onChange:e=>setTextDraft(e.target.value),disabled:!editable||!selectedText.editable}),
        h('small',{className:'dsh-studio-type-help'},'Double-cliquez sur le texte du canevas pour le modifier.'),
        h('div',{className:'dsh-studio-type-commit'},
          h('button',{style:button,disabled:!editable||!selectedText.editable||textDraft===selectedText.text,
            onClick:()=>void commitText()},'Save text'),
          hasTextDraft()&&h('button',{type:'button',style:button,'aria-label':'Discard text draft',
            onClick:()=>{setTextDraft(selectedText.text);setEditingText('');setError('')}},'Abandonner le brouillon')),
        h('div',{className:'dsh-studio-rowspace'}),
        h('label',{className:'dsh-studio-field-label'},typeLabels['font-family']),typographyControl('font-family'),
        h('div',{className:'dsh-studio-rowspace'}),
        h('div',{className:'dsh-studio-ins-row',style:{rowGap:8}},
          ['font-size','font-weight','letter-spacing','font-style'].map(key=>h('label',{key,className:'dsh-studio-prop'},
            h('span',null,typeLabels[key]),typographyControl(key)))),
        h('div',{className:'dsh-studio-rowspace'}),
        h('label',{className:'dsh-studio-field-label'},typeLabels['text-anchor']),typographyControl('text-anchor'))
      return h('section',{className:'dsh-studio-workbench','data-preview':previewMode?'true':'false',lang:'fr','aria-label':'DSH Design Studio workbench',onKeyDown:onEditorKeyDown,onKeyUp:onEditorKeyUp,onFocusCapture:event=>{
          const pending=layerMenuActionFocusRef.current
          if(pending&&event.target!==pending.trigger)layerMenuActionFocusRef.current=null
        },style:{height:panelMode?'100%':'min(87vh,920px)',minHeight:0,...(panelMode?{flex:1,minWidth:0}:{}),color:'var(--dsw-alias-label-primary,#e8ebf0)',background:'var(--dsw-alias-bg-base,#202125)',fontSize:12}},
        h('style',null,GRAPHITE_CSS),
        // Right-click menu: the same operations as the inspector, reachable where
        // the user is looking. Nothing here writes on its own.
        layerMenu&&h(React.Fragment,null,
          h('div',{'data-layer-menu-backdrop':'','aria-hidden':true,
            style:{position:'fixed',inset:0,zIndex:70},onPointerDown:closeLayerMenu}),
          h('div',{ref:layerMenuRef,role:'menu','aria-label':'Actions du calque','data-layer-menu':'',
            style:{position:'fixed',left:layerMenu.x,top:layerMenu.y,zIndex:71,minWidth:224,
              display:'flex',flexDirection:'column',gap:2,padding:6,background:'#262a30',
              maxHeight:'min(86vh, 460px)',overflowY:'auto',
              border:'1px solid #3d434c',borderRadius:8,boxShadow:'0 14px 34px #0009'},
            onKeyDown:onLayerMenuKeyDown,onKeyUp:event=>event.stopPropagation()},
            h('small',{style:{padding:'2px 6px 4px',opacity:0.62}},menuLayer?menuLayer.tag+' #'+menuLayer.id:'Aucun calque'),
            layerMenuItem('Dupliquer le calque','Ctrl+D',
              ()=>save({kind:'svg-layer',id:layerMenu.id,operation:'duplicate'}),menuBlocked),
            layerMenuItem('Copier le calque','Ctrl+C',()=>copyLayer(layerMenu.id),menuBlocked),
            layerMenuItem('Coller l’élément copié','Ctrl+V',()=>pasteLayer(),menuBlocked||!clipboard),
            h('span',{role:'separator',style:{height:1,background:'#3d434c',margin:'3px 0'}}),
            layerMenuItem('Avancer d’un plan','Ctrl+]',()=>reorderLayer('forward',layerMenu.id),menuBlocked),
            layerMenuItem('Reculer d’un plan','Ctrl+[',()=>reorderLayer('backward',layerMenu.id),menuBlocked),
            layerMenuItem('Mettre au premier plan','Ctrl+Maj+]',()=>reorderLayer('front',layerMenu.id),menuBlocked),
            layerMenuItem('Mettre à l’arrière-plan','Ctrl+Maj+[',()=>reorderLayer('back',layerMenu.id),menuBlocked),
            layerMenuItem('Supprimer le calque','Suppr',
              ()=>save({kind:'svg-layer',id:layerMenu.id,operation:'delete'}),menuBlocked,
              {color:'var(--dsw-alias-state-error-primary, #e7b2a8)'}),
            h('span',{role:'separator',style:{height:1,background:'#3d434c',margin:'3px 0'}}),
            layerMenuItem('Grouper la sélection','',
              ()=>save({kind:'svg-grouping',operation:'group',ids:selectionIds()}),
              menuBlocked||selectionIds().length<2),
            layerMenuItem('Dégrouper le groupe','',
              ()=>save({kind:'svg-grouping',operation:'ungroup',id:layerMenu.id}),
              menuBlocked||!menuLayer?.isGroup),
            h('span',{role:'separator',style:{height:1,background:'#3d434c',margin:'3px 0'}}),
            layerMenuItem(menuLayer?.hidden?'Afficher le calque':'Masquer le calque','',
              ()=>save({kind:'svg-visibility',id:layerMenu.id,property:'display',
                value:menuLayer?.hidden?null:'none'}),menuBlocked||menuLayer?.locked),
            layerMenuItem(menuLayer?.locked?'Déverrouiller le calque':'Verrouiller le calque','',
              ()=>save({kind:'svg-lock',id:layerMenu.id,locked:!menuLayer?.locked}),menuBlocked),
            h('span',{role:'separator',style:{height:1,background:'#3d434c',margin:'3px 0'}}),
            // Renaming opens the same inline editor as a double-click. The entry
            // stays enabled (unless no write is possible at all) and explains a
            // locked/read-only row instead of being a dead button.
            layerMenuItem('Renommer le calque','Double-clic',()=>startRename(layerMenu.id),menuBlocked),
            layerMenuItem('Fermer le menu','Échap',()=>{},false))),
        h('header',{className:'dsh-studio-top'},
          h('span',{className:'dsh-studio-brandmark'},glyph('brand')),
          h('strong',{className:'dsh-studio-brand'},'DSH ',h('span',{style:{fontWeight:450,color:'var(--muted)'}},'Design Studio')),
          h('span',{className:'dsh-studio-tb-divider'}),
          h('span',{className:'dsh-studio-crumb'},h('b',{title:doc?.file},doc?.file||'Nouveau document')),
          doc&&h('span',{className:'dsh-studio-tag'},doc.format.toUpperCase()+' natif'),h('span',{className:'dsh-studio-grow'}),
          h('span',{className:'dsh-studio-status',style:{fontSize:11,color:'var(--muted)',whiteSpace:'nowrap'}},busy?'Enregistrement…':reloadRequired?'À recharger':doc?source!==doc.source||hasTextDraft()?'Modifications non enregistrées':'✓ Enregistré localement':'Mode local · sans IA'),
          h('details',{className:'dsh-studio-menu'},h('summary',null,'Fichier'),h('div',{className:'dsh-studio-menu-body',style:{left:'auto',right:0}},
            h('input',{style:field,'aria-label':'Workspace file',value:pathInput,onChange:e=>setPathInput(e.target.value),placeholder:'relative/path/file.svg'}),
            h('button',{style:button,onClick:()=>openInTab(pathInput),disabled:busy||!scopeReady},busy?'Loading…':'Open'),
            h('button',{style:button,onClick:()=>void browseFiles(),disabled:busy||!scopeReady,'aria-label':'Browse workspace design files'},'Parcourir…'),doc&&h('div',{role:'group','aria-label':'New design file',style:{display:'flex',gap:6,flexWrap:'wrap'}},h('input',{style:field,value:newName,'aria-label':'New design file name',placeholder:'nom du fichier',onChange:e=>setNewName(e.target.value)}),['svg','html','css'].map(format=>h('button',{key:format,type:'button',style:button,disabled:busy||creating||!scopeReady,'aria-label':'Create '+format.toUpperCase()+' file',title:'Créer '+creationTarget(format),onClick:()=>void createDocument(format)},'+ '+format.toUpperCase()))))),
           h('button',{type:'button',className:'dsh-studio-topbtn dsh-studio-muted',disabled:!doc,
             'aria-label':'Preview native document','aria-pressed':previewMode,
             onClick:()=>setPreviewMode(value=>!value)},glyph('previewBtn'),previewMode?'Retour à l’éditeur':'Aperçu'),
           h('button',{type:'button',className:'dsh-studio-topbtn dsh-studio-primary',
             disabled:!doc||busy||reloadRequired||source!==doc?.source||hasTextDraft(),
             'aria-label':'Export native document',onClick:exportNativeDocument},glyph('export'),
             doc?'Exporter '+doc.format.toUpperCase():'Exporter SVG'),
           h('label',{className:'dsh-studio-png-scale',title:'Échelle de sortie PNG'},
             h('span',null,'PNG'),
             h('select',{'aria-label':'PNG scale',value:pngScale,
               disabled:!doc||doc.format!=='svg'||pngBusy,
               onChange:e=>setPngScale(Number(e.target.value))},
               PNG_SCALES.map(scale=>h('option',{key:scale,value:scale},scale+'×')))),
           h('button',{type:'button',className:'dsh-studio-topbtn',
             disabled:pngDisabled,
             'aria-label':'Export PNG',
             'aria-describedby':pngUnavailableReason?pngReasonId:undefined,
             title:pngUnavailableReason||'Télécharger la source actuelle en PNG (1× ou 2×), sans écrire le fichier.',
             onClick:()=>void exportPngDocument()},glyph('export'),
             pngBusy?'Conversion…':'Exporter PNG'),
           pngUnavailableReason&&h('span',{id:pngReasonId,className:'dsh-studio-png-reason',role:'note'},pngUnavailableReason)),
        h('div',{className:'dsh-studio-toolbar'},          h('div',{className:'dsh-studio-tools',role:'toolbar','aria-label':'SVG creation tools'},
            h('button',{type:'button','data-tool':'select','aria-pressed':canvasTool==='select',className:'dsh-studio-tool'+(canvasTool==='select'?' selected':''),'aria-label':'Select canvas tool',style:{background:canvasTool==='select'?'#51483d':'transparent'},title:'Sélection · V',onClick:()=>setCanvasTool('select')},glyph('select')),
            h('button',{type:'button','data-tool':'frame',className:'dsh-studio-tool',disabled:true,title:'Cadre · non implémenté','aria-label':'Frame tool unavailable'},glyph('frame')),
            ['rect','ellipse'].map(shape=>h('button',{key:shape,type:'button','data-tool':shape,'aria-pressed':canvasTool===shape,className:'dsh-studio-tool','aria-label':'Add '+shape,title:shape==='rect'?'Rectangle · R':shape==='ellipse'?'Ellipse · O':'Texte · T',disabled:!doc||doc.format!=='svg'||busy||reloadRequired||source!==doc.source,onClick:()=>{if(!refuseTextDraft())setCanvasTool(shape)}},glyph(shape))),
            h('button',{type:'button','data-tool':'pen','aria-pressed':canvasTool==='pen',className:'dsh-studio-tool'+(canvasTool==='pen'?' selected':''),'aria-label':'Activate Pen tool',title:'Plume · P',disabled:!doc||doc.format!=='svg'||busy||reloadRequired||source!==doc.source,onClick:()=>{setCanvasTool('pen');setPenPathId('');setPenOutgoing(null)}},glyph('pen')),
            ['text'].map(shape=>h('button',{key:shape,type:'button','data-tool':shape,'aria-pressed':canvasTool===shape,className:'dsh-studio-tool','aria-label':'Add '+shape,title:shape==='rect'?'Rectangle · R':shape==='ellipse'?'Ellipse · O':'Texte · T',disabled:!doc||doc.format!=='svg'||busy||reloadRequired||source!==doc.source,onClick:()=>{if(!refuseTextDraft())setCanvasTool(shape)}},glyph(shape))),
            h('span',{className:'dsh-studio-sdiv'}),
            h('button',{type:'button','data-tool':'hand','aria-pressed':canvasTool==='hand',className:'dsh-studio-tool'+(canvasTool==='hand'?' selected':''),'aria-label':'Pan canvas tool',style:{background:canvasTool==='hand'?'#51483d':'transparent'},title:'Main · H',onClick:()=>setCanvasTool('hand')},glyph('hand')),
            h('span',{className:'dsh-studio-sdiv'}),
            h('button',{type:'button',className:'dsh-studio-tool','aria-label':'Undo saved edit',title:'Annuler · Ctrl+Z',disabled:busy||reloadRequired||!undoStack.length||source!==doc?.source,onClick:()=>void undo()},glyph('undoBtn')),
            h('button',{type:'button',className:'dsh-studio-tool','aria-label':'Redo saved edit',title:'Rétablir · Ctrl+Shift+Z',disabled:busy||reloadRequired||!redoStack.length||source!==doc?.source,onClick:()=>void redo()},glyph('redoBtn'))),
          h('span',{className:'dsh-studio-grow'}),
          h('button',{className:'dsh-studio-tooltext',type:'button','aria-label':'Toggle canvas grid','aria-pressed':gridVisible,onClick:()=>setGridVisible(v=>!v)},glyph('grid'),'Grille'),
          h('span',{className:'dsh-studio-helper'},'Édition manuelle'),h('details',{className:'dsh-studio-menu dsh-studio-settings'},h('summary',null,'Options'),h('div',{className:'dsh-studio-menu-body'},
            h('button',{style:button,'aria-label':'Toggle snap to grid','aria-pressed':snapToGrid,onClick:()=>setSnapToGrid(v=>!v)},'Magnétisme'),
            h('select',{style:field,'aria-label':'Grid spacing',value:gridStep,onChange:e=>setGridStep(Number(e.target.value))},[2,5,8,10,16,20,25,32,50,64,100].map(step=>h('option',{key:step,value:step},step+' u'))),
            h('button',{style:button,'aria-label':'Toggle smart alignment guides','aria-pressed':smartGuides,onClick:()=>setSmartGuides(v=>!v)},'Repères intelligents'),
            // Opt-out journal (ADR-035). The preference is persisted; existing
            // entries are never deleted by toggling it, only by recovery/ignore.
            h('label',{style:{display:'flex',gap:6,alignItems:'center',padding:'4px 2px',fontSize:11.5,cursor:'pointer'}},
              h('input',{type:'checkbox','aria-label':'Journal de récupération',
                checked:recoveryEnabled,onChange:e=>chooseRecoveryPreference(e.target.checked)}),
              'Journal de récupération'),
            h('small',{style:{opacity:.66,lineHeight:1.45}},
              recoveryEnabled
                ?'Copie les documents modifiés non enregistrés dans le stockage local : max '+RECOVERY_MAX_ENTRIES+
                  ' documents, 256 Kio chacun, par espace de travail. Aucune écriture sur le disque, aucune donnée de profil.'
                :'Désactivé : une fermeture brutale peut perdre les modifications non enregistrées. Les entrées déjà présentes restent proposées jusqu’à « Récupérer » ou « Ignorer ».'),
            ['circle','path'].map(shape=>h('button',{key:shape,style:button,'aria-label':'Add '+shape,disabled:!doc||doc.format!=='svg'||busy||reloadRequired||source!==doc.source,onClick:()=>void save({kind:'svg-add-shape',shape})},'Ajouter '+shape)),
            canvasTool==='pen'&&h('button',{style:button,'aria-label':'Start new pen path',disabled:busy||reloadRequired,onClick:()=>{setPenPathId('');setPenOutgoing(null)}},'Nouvelle Plume'),
            canvasTool==='pen'&&h('button',{style:button,'aria-label':'Close current pen path',disabled:busy||reloadRequired||!penPathId||(pathNodes.find(path=>path.id===penPathId)?.points?.filter(p=>p.role==='anchor').length||0)<3,onClick:()=>void closePenPath()},'Fermer le tracé')))),
                showFiles&&doc&&h('div',{className:'dsh-studio-file-picker',style:{
          padding:'10px 14px',background:'#26282b',borderBottom:'1px solid #47484a',
          maxHeight:225,overflow:'auto',display:'flex',flexDirection:'column',gap:8
        }},
          h('div',{style:{display:'flex',gap:8,alignItems:'center',justifyContent:'space-between'}},
            h('strong',null,'Fichiers du workspace'),
            h('small',{style:{color:'var(--dsw-alias-label-secondary, #aaa9a5)'}},workspaceFiles.length+' fichier(s)'+(filesTruncated?' · liste limitée':''))),
          h('input',{style:field,value:fileSearch,'aria-label':'Filter design files',
            placeholder:'Rechercher : nom, dossier, extension…',
            onChange:e=>setFileSearch(e.target.value)}),
          h('div',{role:'list',style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:4}},
            ...workspaceFiles.filter(item=>item.path.toLocaleLowerCase().includes(fileSearch.toLocaleLowerCase())).slice(0,100).map(item=>
              h('div',{key:item.path,role:'listitem',
                style:{display:'flex',gap:4,alignItems:'center',background:'#2c2e31',border:'1px solid #43454a',borderRadius:6,padding:'2px 4px'}},
                h('button',{style:{...button,flex:1,minWidth:0,textAlign:'left',overflowWrap:'anywhere',background:'transparent',border:0},
                  'aria-label':'Open file '+item.path,disabled:busy,
                  title:item.path+' · '+item.size+' bytes',
                  onClick:()=>void openPickedFile(item.path)},
                  h('span',{style:{color:ACCENT,marginRight:8,fontWeight:650}},item.format.toUpperCase()),
                  item.path),
                h('button',{style:{...button,whiteSpace:'nowrap'},'aria-label':'Rename '+item.path,
                  title:'Renommer '+item.path,disabled:busy||creating,
                  onClick:()=>{setError('');setFileAction({kind:'rename',file:item.path,next:item.path})}},'Renommer'),
                h('button',{style:{...button,whiteSpace:'nowrap'},'aria-label':'Delete '+item.path,
                  title:'Supprimer '+item.path,disabled:busy||creating,
                  onClick:()=>{setError('');setFileAction({kind:'delete',file:item.path})}},'Supprimer')))),
          // Deleting is not undoable, so the confirmation names the exact path
          // and the file is never removed on a single click.
          fileAction&&h('div',{role:'group','aria-label':'Confirm file '+fileAction.kind,
            style:{...pane,padding:10,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',
              border:'1px solid '+(fileAction.kind==='delete'?'#8a4b45':'#43454a')}},
            fileAction.kind==='rename'
              ? h('span',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}},
                  h('span',null,'Renommer ',h('code',null,fileAction.file),' en'),
                  h('input',{style:{...field,maxWidth:300},value:fileAction.next,'aria-label':'New path for '+fileAction.file,
                    autoFocus:true,
                    onChange:e=>setFileAction(previous=>({...previous,next:e.target.value})),
                    onKeyDown:e=>{if(e.key==='Enter')void manageFile('rename',fileAction.file,fileAction.next)
                      else if(e.key==='Escape')setFileAction(null)}}),
                  h('button',{style:button,'aria-label':'Confirm rename of '+fileAction.file,disabled:busy,
                    onClick:()=>void manageFile('rename',fileAction.file,fileAction.next)},'Confirmer le renommage'))
              : h('span',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}},
                  h('span',null,'Supprimer définitivement ',h('code',null,fileAction.file),' ? Le fichier ne sera pas mis à la corbeille.'),
                  h('button',{style:button,'aria-label':'Confirm delete of '+fileAction.file,disabled:busy,
                    onClick:()=>void manageFile('delete',fileAction.file)},'Confirmer la suppression')),
            h('button',{style:button,'aria-label':'Cancel file action',disabled:busy,
              onClick:()=>setFileAction(null)},'Annuler')),
          workspaceFiles.length===0&&h('small',{style:{color:'var(--dsw-alias-label-secondary, #aaa9a5)'}},'Aucun fichier SVG, HTML ou CSS détecté.')
        ),

        h('div',{className:'dsh-studio-alerts'},
        // Unsaved-recovery journal (ADR-035). The banner only OFFERS a source:
        // it never opens, applies or saves anything by itself, and it states
        // that the file on disk is untouched.
        recoveryPending.length>0&&h('div',{role:'alert','data-recovery-banner':recoveryPending[0].file,
          'aria-label':'Récupération après fermeture pour '+recoveryPending[0].file,
          style:{...pane,padding:'10px 12px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',
            border:'1px solid '+ACCENT,background:'var(--dsw-alias-bg-layer-2, #2a2c31)'}},
          h('strong',null,'Modifications non enregistrées récupérables'),
          h('span',null,' : ',h('code',null,recoveryPending[0].file),' · '+recoveryAge(recoveryPending[0].savedAt)+
            (recoveryPending.length>1?' · '+(recoveryPending.length-1)+' autre'+
              (recoveryPending.length>2?'s':'')+' document journalisé':'')+
            ' · rien n’a été écrit sur le disque'),
          h('span',{style:{flex:1}}),
          h('button',{type:'button',style:button,
            'aria-label':'Récupérer les modifications de '+recoveryPending[0].file,
            disabled:busy||creating,
            title:'Charger cette source dans l’éditeur, sans écrire le fichier',
            onClick:()=>void recoverRecoveryEntry(recoveryPending[0])},'Récupérer les modifications'),
          h('button',{type:'button',style:button,
            'aria-label':'Ignorer la récupération de '+recoveryPending[0].file,
            disabled:busy||creating,
            title:'Supprimer la copie locale de ce document',
            onClick:()=>ignoreRecoveryEntry(recoveryPending[0])},'Ignorer')),
        recoveryNotice&&h('div',{role:'status','data-recovery-warning':'','aria-live':'polite',
          style:{color:'var(--dsw-alias-state-warn-primary, #f5c36a)',padding:'8px 12px',lineHeight:1.5}},
          recoveryNotice),
        recoveryNote&&h('div',{role:'status','data-recovery-note':recoveryNote.kind,
          style:{color:recoveryNote.changed?'var(--dsw-alias-state-warn-primary, #f5c36a)'
              :'var(--dsw-alias-label-secondary, #bbb9b4)',padding:'8px 12px',lineHeight:1.5}},
          recoveryNote.text),
        error&&h('div',{role:'alert',style:{color:'var(--dsw-alias-state-error-primary, #ff8585)',padding:'8px 12px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}},
          h('span',null,error),
          reloadRequired&&h('button',{type:'button',style:button,'aria-label':'Reload after save error',
            disabled:busy,onClick:()=>void load(true,doc?.file||pathInput)},'Recharger le fichier')),
        warning&&h('div',{role:'status',style:{color:'var(--dsw-alias-state-warn-primary, #f5c36a)'}},warning)),
                h('nav',{className:'dsh-studio-mobile-tabs',role:'tablist',
          'aria-label':'Mobile editor panels'},
          [['layers','Calques'],['canvas','Canevas'],['inspector','Propriétés']].map(([tab,label])=>
            h('button',{key:tab,type:'button',role:'tab',
              'aria-label':'Mobile panel '+tab,'aria-selected':mobilePanel===tab,
              style:{...button,background:mobilePanel===tab?'#574939':button.background,
                borderColor:mobilePanel===tab?ACCENT:'var(--dsw-alias-border-l2, #44464b)'},
              onClick:()=>setMobilePanel(tab)},label))),

                h('div',{className:'dsh-studio-layout'},
          h('aside',{className:'dsh-studio-rail','aria-label':'Editor panels'},
            h('button',{type:'button','aria-label':'Show layers panel','aria-pressed':true,
              title:'Calques',onClick:()=>setMobilePanel('layers')},
              h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,
                strokeLinejoin:'round','aria-hidden':'true'},
                h('path',{d:'m3 8 9-5 9 5-9 5Z'}),h('path',{d:'m3 12 9 5 9-5M3 16l9 5 9-5'}))),
            ['Composants','Ressources','Historique'].map(name=>h('button',{key:name,type:'button',className:'dsh-studio-railbtn',disabled:true,'aria-label':name+' unavailable',title:name+' · non implémenté'},glyph(name))),
             h('span',{className:'dsh-studio-spacer'}),
             h('button',{type:'button',className:'dsh-studio-railbtn dsh-studio-bottom',
               'aria-label':'Editor options',title:'Réglages',onClick:event=>{
                 const root=event.currentTarget.closest('.dsh-studio-workbench')
                 const options=root?.querySelector('.dsh-studio-settings')
                 if(options)options.open=!options.open
               }},glyph('Réglages'))),
          h('aside',{className:'dsh-studio-sidebar'+(mobilePanel==='layers'?' dsh-studio-mobile-active':'')},
            h('div',{className:'dsh-studio-sidehead'},
              h('span',null,'Explorer'),
              h('span',{style:{fontWeight:400,color:'var(--g-sub)',fontSize:10.5}},
                String(doc?.format==='css'?cssRules.length+cssMedia.length:doc?.format==='html'||doc?.format==='htm'?htmlElements.length:nodes.length))),
            h('div',{className:'dsh-studio-tabs',role:'tablist','aria-label':'Left panel tabs'},
              h('button',{type:'button',role:'tab',className:'dsh-studio-tab dsh-studio-selected','aria-selected':true},'Calques'),
              h('button',{type:'button',role:'tab',className:'dsh-studio-tab','aria-selected':false,disabled:true,
                title:'Non implémenté dans cette version'},'Ressources'),
              h('button',{type:'button',role:'tab','aria-selected':false,disabled:true,
                title:'Non implémenté dans cette version'},'Composants')),
            h('input',{className:'dsh-studio-layer-search',value:layerSearch,
              'aria-label':'Filter layers',placeholder:'Rechercher des calques',
              onChange:e=>setLayerSearch(e.target.value)}),
            h('div',{className:'dsh-studio-group'},'Pages'),
            h('div',{className:'dsh-studio-item',style:{margin:'0 7px'}},h('span',{className:'dsh-studio-mini'},'▦'),h('span',{className:'dsh-studio-label'},doc?.file||'Nouveau document')),
            h('div',{className:'dsh-studio-group',style:{marginTop:9}},'Calques',h('span',{style:{float:'right',letterSpacing:0}},nodes.length)),
            h('div',{className:'dsh-studio-layer-list'},
              doc?.format==='css'?
                ((cssRules.length||cssMedia.length)?[
                  ...cssRules.map(rule=>h('button',{
                    key:'top:'+rule.selector,type:'button','aria-label':'Select CSS rule '+rule.selector,
                    style:{...button,textAlign:'left',background:cssActive===rule.selector?'#494034':'transparent'},
                    onClick:()=>chooseCssRule(rule.selector)},
                    rule.selector+(rule.editable?'':' · lecture seule'))),
                  ...cssMedia.map((rule,mediaIndex)=>h('button',{
                    key:'media:'+rule.start,type:'button',
                    'aria-label':'Select conditional CSS rule '+rule.condition+' '+rule.selector+
                      ' block '+(mediaIndex+1),
                    style:{...button,textAlign:'left',paddingLeft:16,background:cssMediaStart===rule.start?'#494034':'transparent'},
                    onClick:()=>chooseCssMedia(rule.start)},
                    h('span',{style:{opacity:.75,fontSize:11}},'@media '+rule.condition+' · '),
                    rule.selector+(rule.conditionalEditable?'':' · lecture seule')+
                      (cssMedia.filter(other=>other.condition===rule.condition&&
                        other.selector===rule.selector).length>1?' · bloc '+(mediaIndex+1):'')))]:
                  h('small',null,'Règles simples #id ou .classe uniquement.')):
              (doc?.format==='html'||doc?.format==='htm')?
                (htmlElements.length?htmlElements.map(n=>h('button',{key:n.id,type:'button',
                  'aria-label':'Select HTML element '+n.id,
                  style:{...button,textAlign:'left',background:htmlActive===n.id?'#494034':'transparent'},
                  onClick:()=>chooseHtmlElement(n.id)},n.tag+' #'+n.id+(n.editable?'':' · lecture seule'))):
                  h('small',null,'HTML visuel : ajoutez des id uniques aux éléments à éditer.')):
                (nodes.length?nodes.filter(n=>!layerSearch||
                    (n.tag+' #'+n.id).toLowerCase().includes(layerSearch.toLowerCase())).map(n=>renaming?.id===n.id
                  // Inline rename: a real input, never a fake button. Enter asks
                  // the Host for one exact patch; Escape closes without writing.
                  ? h('div',{key:n.id,className:'dsh-studio-item dsh-studio-renaming','data-layer-id':n.id,
                    style:{width:'100%',paddingLeft:10+(Math.max(0,Math.min(12,n.depth||0))*11)}},
                    h('span',{className:'dsh-studio-mini'},n.isGroup?'▤':n.tag==='text'?'T':n.tag==='ellipse'||n.tag==='circle'?'◯':n.tag==='path'?'⌁':'▢'),
                    h('input',{className:'dsh-studio-rename-input','data-layer-rename-input':'',type:'text',
                      style:{...field,flex:1,minWidth:0,height:25,padding:'2px 6px'},
                      value:renaming.value,
                      title:'Entrée : valider · Échap : annuler',
                      'aria-label':'Nouveau nom du calque #'+n.id,
                      autoFocus:true,
                      onChange:e=>setRenaming(previous=>previous?{...previous,value:e.target.value}:previous),
                      onFocus:e=>{try{e.currentTarget.select()}catch(_){}},
                      onKeyDown:e=>{
                        if(e.key==='Enter'){e.preventDefault();e.stopPropagation();void commitRename()}
                        else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelRename()}
                      },
                      onBlur:()=>cancelRename()}))
                  : h('button',{key:n.id,
                  type:'button',className:'dsh-studio-item'+(active===n.id?' dsh-studio-active':'')+
                    (layerDrag?.id===n.id?' dsh-studio-layer-dragging':'')+
                    (layerDrag?.overId===n.id&&layerDrag?.plan?.ok?' dsh-studio-drop-target':'')+
                    (layerDrag?.overId===n.id&&layerDrag?.plan&&!layerDrag.plan.ok&&!layerDrag.plan.same
                      ?' dsh-studio-drop-refused':''),
                  'data-layer-id':n.id,
                  title:'Double-clic : renommer · Glisser : réordonner · Ctrl+] avancer · Ctrl+[ reculer',
                  'aria-label':'Select layer '+n.tag+' #'+n.id+
                    (n.hidden?' (hidden)':'')+(n.locked?' (locked)':'')+
                    (extraSelection.includes(n.id)?' (in selection)':''),
                  'aria-pressed':active===n.id,
                  style:{width:'100%',paddingLeft:10+(Math.max(0,Math.min(12,n.depth||0))*11),
                    opacity:n.hidden?0.55:1,...(extraSelection.includes(n.id)&&active!==n.id?{background:'#3a3630'}:{})},
                  onClick:event=>{
                    // A drop ends with a synthetic click; it must not re-select
                    // (or extend) the row the pointer happened to land on.
                    if(layerDragClickRef.current){layerDragClickRef.current=false;return}
                    select(n.id,!!(event?.ctrlKey||event?.metaKey||event?.shiftKey))
                  },
                  onDoubleClick:event=>{event.preventDefault();startRename(n.id)},
                  onPointerDown:event=>startLayerDrag(event,n.id),
                  onPointerMove:event=>moveLayerDrag(event),
                  onPointerUp:event=>endLayerDrag(event),
                  onPointerCancel:event=>endLayerDrag(event,true),
                  onLostPointerCapture:()=>{
                    const gesture=layerDragRef.current
                    if(!gesture)return
                    layerDragRef.current=null
                    stopLayerDragListeners()
                    setLayerDrag(null)
                    // A lost capture without a real drag must not swallow the
                    // click that follows a plain selection.
                    if(gesture.started)layerDragClickRef.current=true
                  },
                  onContextMenu:event=>openLayerMenu(event,n.id),
                  onKeyDown:event=>{
                    if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openLayerMenu(event,n.id)
                  }},
                   h('span',{className:'dsh-studio-mini'},n.isGroup?'▤':n.tag==='text'?'T':n.tag==='ellipse'||n.tag==='circle'?'◯':n.tag==='path'?'⌁':'▢'),
                   h('span',{className:'dsh-studio-label'},n.tag+' #'+n.id),
                   h('span',{className:'dsh-studio-eye','aria-hidden':'true'},n.locked?'◇':n.hidden?'◌':'◉'),
                   h('span',{className:'dsh-studio-grip','aria-hidden':'true'},'⠿'))):
                  h('small',null,'Aucun nœud SVG adressable (un id unique est requis).'))),
            layerDrag&&h('div',{className:'dsh-studio-drop-status',role:'status','data-layer-drop-status':'',
              'data-invalid':layerDrag.plan&&!layerDrag.plan.ok&&!layerDrag.plan.same?'true':'false'},
              layerDrag.plan?.same?'Même ligne : aucun déplacement.'
                :layerDrag.plan?.ok?(layerDrag.plan.direction==='forward'
                  ?'Déposer pour avancer d’un plan (Ctrl+])'
                  :'Déposer pour reculer d’un plan (Ctrl+[)')
                :layerDrag.plan?.reason||'Déposez sur une ligne sœur pour changer l’ordre de peinture.'),
            h('div',{className:'dsh-studio-panel-note'},'Cliquez un calque pour le sélectionner ; les propriétés apparaissent à droite. Glissez une ligne sur une autre pour changer l’ordre de peinture (Ctrl+] / Ctrl+[ restent disponibles).')),
          h('main',{className:'dsh-studio-canvas'+(mobilePanel==='canvas'?' dsh-studio-mobile-active':''),style:{display:'flex',flexDirection:'column',minWidth:0}},
            // One tab per open document, above the canvas. A tab keeps its own
            // source, selection, Undo/Redo and text draft; switching tabs never
            // writes, and a dirty tab shows a dot until an explicit save.
            tabs.length>0&&h('div',{className:'dsh-studio-doc-tabs',role:'tablist',
              'aria-label':'Documents ouverts','aria-orientation':'horizontal'},
              tabs.map(entry=>{
                const selected=entry.id===activeTabId
                const dirty=selected?isDirty():!!entry.dirty
                const label=entry.file+(dirty?' · modifications non enregistrées':'')
                return h('div',{key:entry.id,role:'presentation',
                  className:'dsh-studio-doc-tab'+(selected?' dsh-studio-selected':''),
                  'data-doc-tab':entry.id,'data-doc-tab-file':entry.file},
                  h('button',{type:'button',role:'tab',id:'doc-tab-'+entry.id,
                    'aria-selected':selected,'aria-controls':'doc-tabpanel-canvas',
                    tabIndex:selected?0:-1,
                    'aria-label':label,title:label,
                    onClick:()=>activateTab(entry.id),
                    onKeyDown:event=>onTabKeyDown(event,entry)},
                    h('span',{className:'dsh-studio-doc-name'},entry.file),
                    dirty&&h('span',{className:'dsh-studio-doc-dirty','aria-hidden':'true',
                      title:'Modifications non enregistrées'},'●')),
                  h('button',{type:'button',className:'dsh-studio-doc-close',
                    'aria-label':'Fermer '+entry.file,title:'Fermer '+entry.file,
                    disabled:busy,onClick:()=>closeTab(entry.id)},'×'))
              })),
            tabCloseConfirm&&h('div',{ref:tabCloseConfirmRef,role:'alertdialog',
              'aria-label':'Fermer l’onglet '+tabCloseConfirm.file,'data-tab-close-confirm':tabCloseConfirm.file,
              onKeyDown:event=>{
                if(event.key!=='Escape')return
                event.preventDefault()
                event.stopPropagation()
                setTabCloseConfirm(null)
              }},
              h('span',null,'Fermer ',h('code',null,tabCloseConfirm.file),
                ' ? Des modifications ne sont pas enregistrées : elles seront perdues.'),
              h('button',{type:'button',style:button,disabled:busy,
                onClick:()=>closeTab(tabCloseConfirm.id,{discard:true})},'Fermer sans enregistrer'),
              h('button',{type:'button',style:button,
                onClick:()=>setTabCloseConfirm(null)},'Annuler')),
            h('div',{className:'dsh-studio-stage-top'},
              h('b',{title:doc?.file||'Document'},doc?.file||'Document'),
              h('span',{'aria-hidden':'true'},'›'),
              h('span',null,doc?doc.format.toUpperCase()+' natif':'Bienvenue'),
              doc?.format==='svg'&&artboard&&h('span',{className:'dsh-studio-tag'},
                Math.round(artboard.width)+' × '+Math.round(artboard.height)),
              h('span',{style:{flex:1}}),
              notice&&h('span',{className:'dsh-studio-tag','data-created':notice,role:'status','aria-live':'polite',
                title:'Fichier écrit dans l’espace de travail'},notice),
              h('span',{className:'dsh-studio-helper'},doc?'Fichier éditable':'Mode local')),
            h('div',{className:'dsh-studio-workspace',id:'doc-tabpanel-canvas',
              role:tabs.length?'tabpanel':undefined,style:{minHeight:0},
              'aria-labelledby':tabs.length?'doc-tab-'+activeTabId:undefined},!doc?h('div',{className:'dsh-studio-welcome',role:'region',
          'aria-label':'Open a design file',
          style:{...pane,minHeight:340,padding:20,display:'flex',flexDirection:'column',gap:10,
            justifyContent:'flex-start',overflow:'auto'}},
          h('strong',{style:{fontSize:18,fontWeight:600}},'Votre espace de création'),
           h('small',{style:{color:'var(--muted)'}},'SVG · HTML · CSS natifs'),
           h('button',{style:button,type:'button','aria-label':'Create Graphite reference SVG',title:'Créer '+creationTarget('svg','graphite-v3'),disabled:busy||creating||!scopeReady,onClick:()=>void createDocument('svg',GRAPHITE_EXAMPLE)},'Créer la maquette SVG'),
          h('small',{style:{opacity:0.78,maxWidth:640,lineHeight:1.5}},
            'Choisissez un fichier de cet espace de travail ci-dessous, ou saisissez son chemin puis « Open ». '+
            'Le canevas, les calques et les propriétés apparaissent dès qu’un document est ouvert.'),
          h('div',{style:{display:'flex',gap:8,alignItems:'center'}},
            h('button',{type:'button',style:button,disabled:busy||!scopeReady,
              'aria-label':'Refresh workspace design files',
              onClick:()=>void loadWorkspaceFiles()},'Actualiser'),
            h('small',{style:{opacity:0.7}},workspaceFiles.length+
              (workspaceFiles.length===1?' fichier de design':' fichiers de design')+
              (filesTruncated?' · liste limitée':''))),
          // Creating a file is the first thing a user looks for; it used to be
          // impossible from the workbench (the Host had no create path at all).
          h('div',{role:'group','aria-label':'New design file',
            style:{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:2}},
            h('span',{style:{fontSize:11.5,opacity:0.8}},'Nouveau :'),
            h('input',{style:{...field,maxWidth:260},value:newName,'aria-label':'New design file name',
              placeholder:'nom (ex. accueil.svg)',
              onChange:e=>setNewName(e.target.value),
              onKeyDown:e=>{if(e.key==='Enter')void createDocument('svg')}}),
            h('button',{type:'button',style:button,disabled:busy||creating||!scopeReady,
              'aria-label':'Create SVG file',title:'Créer '+creationTarget('svg'),onClick:()=>void createDocument('svg')},'+ SVG'),
            h('button',{type:'button',style:button,disabled:busy||creating||!scopeReady,
              'aria-label':'Create HTML file',title:'Créer '+creationTarget('html'),onClick:()=>void createDocument('html')},'+ HTML'),
            h('button',{type:'button',style:button,disabled:busy||creating||!scopeReady,
              'aria-label':'Create CSS file',title:'Créer '+creationTarget('css'),onClick:()=>void createDocument('css')},'+ CSS')),
          // Show where a new file will land before the click: the Host writes
          // into the workspace root, and a silent write was the actual friction.
          h('small',{style:{opacity:0.72,overflowWrap:'anywhere',lineHeight:1.5}},
            'Destination : ',
            h('code',null,'espace de travail/'+
              (newName.trim().replace(/\.(?:svg|html?|css)$/i,'').replace(/^\.+/,'')||'nouveau-fichier')),
            h('code',null,'.{svg,html,css}')),
          workspaceFiles.length
            ? h('input',{style:{...field,maxWidth:420},value:fileSearch,'aria-label':'Filter design files',
                placeholder:'Filtrer : nom, dossier, extension…',
                onChange:e=>setFileSearch(e.target.value)})
            : null,
          workspaceFiles.length
            ? h('div',{role:'list','aria-label':'Workspace design files',
                style:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:6,marginTop:4}},
                ...workspaceFiles.filter(item=>item.path.toLocaleLowerCase().includes(fileSearch.toLocaleLowerCase()))
                  .slice(0,60)
                  .map(item=>h('button',{key:item.path,type:'button',
                    style:{...button,textAlign:'left',overflowWrap:'anywhere'},
                    'aria-label':'Open file '+item.path,disabled:busy,
                    onClick:()=>void openPickedFile(item.path)},item.path)))
            : h('div',{role:'status',style:{...pane,padding:12,marginTop:4,background:'var(--dsw-alias-bg-layer-1, #232529)'}},
                h('span',null,'Aucun fichier SVG, HTML ou CSS dans cet espace de travail.'),
                h('small',{style:{opacity:0.7,display:'block',marginTop:4}},
                  'Ajoutez-en un depuis la conversation, ou ouvrez un dossier qui en contient un.'))):
doc?.format==='css'?
                  h('div',{className:'dsh-studio-css-rule-preview',
                    style:{background:'var(--dsw-alias-bg-layer-2, #24262a)',border:'1px solid #414142',borderRadius:8,
                      padding:18,minHeight:240,display:'grid',alignContent:'start',gap:12}},
                    h('strong',{style:{color:ACCENT}},selectedCss?.selector||'Feuille de style native'),
                    h('small',{style:{color:'var(--dsw-alias-label-secondary, #bbb9b4)'}},
                      'Sélectionne une règle simple à gauche. Les changements ciblent le fichier .css ouvert.'),
                    selectedCss?.declarations?.map(declaration=>h('div',{key:declaration.property,
                      style:{display:'flex',gap:8,justifyContent:'space-between'}},
                      h('code',{style:{color:'#ccc'}},declaration.property),
                      h('code',{style:{color:'#e8cdb1'}},declaration.value))
                    )
                  ):
              artboard && doc?.format==='svg'?
                h('div',{className:'dsh-studio-viewport',ref:viewportRefCallback.current,
                  'aria-label':'Canvas viewport',
                  onWheel:onCanvasWheel,
                  onPointerDown:startPan,
                  onPointerMove:movePan,
                  onPointerUp:endPan,
                  onPointerCancel:endPan,
                  style:{position:'relative',width:'100%',height:'100%',minHeight:340,flex:'1 1 auto',
                    containerType:'size',
                    overflow:'hidden',touchAction:'none',borderRadius:6,
                    cursor:panRef.current?'grabbing':canvasTool==='pen'?'crosshair':canvasTool==='hand'||spaceHeld?'grab':'default',
                    background:'transparent'}},
                  h('div',{className:'dsh-studio-artboard',
                    style:{position:'absolute',left:'50%',top:'50%',
                      // Fit BOTH dimensions: a wide viewBox must never be clipped
                      // vertically, otherwise top-left handles become unreachable
                      // and every hit target drifts away from the rendered shape.
                      width:'min(100cqw, calc(100cqh * '+(display.width/display.height)+'))',
                      maxWidth:'100%',maxHeight:'100%',
                      '--art-ratio':display.width/display.height,'--art-width':display.width+'px',aspectRatio:display.width+' / '+display.height,background:'#fff',
                      transform:'translate(-50%, -50%) translate('+camera.offsetX+'px, '+camera.offsetY+'px) scale('+camera.zoom+')',
                      transformOrigin:'center center',
                      boxShadow:'0 10px 42px #0009'}},
                  h('div',{className:'dsh-studio-artboard-label'},doc.file,h('span',null,Math.round(display.width)+' × '+Math.round(display.height))),
                  h('div',{className:'dsh-studio-artboard-content',style:contentBoxStyle},
                   h('iframe',{title:'Isolated SVG preview',sandbox:'',referrerPolicy:'no-referrer',srcDoc:safePreview(source,'svg'),style:{width:'100%',height:'100%',position:'absolute',inset:0,border:'none',pointerEvents:'none'}}),
                  gridVisible&&h('div',{className:'dsh-studio-document-grid','aria-hidden':true,style:{
                    position:'absolute',inset:0,pointerEvents:'none',zIndex:1,
                    backgroundImage:'linear-gradient(to right, #927f6670 1px, transparent 1px), linear-gradient(to bottom, #927f6670 1px, transparent 1px)',
                    backgroundSize:(gridStep/artboard.width*100)+'% '+(gridStep/artboard.height*100)+'%',
                    opacity:0.48
                  }}),
                  h('div',{style:{position:'absolute',inset:0,touchAction:'none',zIndex:2,
                      cursor:['rect','ellipse','text'].includes(canvasTool)?'crosshair':undefined},'aria-label':'Direct manipulation overlay',
                      onPointerDownCapture:createShapeAtPointer},
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
                          minWidth:5,minHeight:5,border:active===handle.id?'1.5px solid #c6aa89':'0',
                          borderRadius:active!==handle.id&&(handle.tag==='circle'||handle.tag==='ellipse')?'50%':0,
                          background:'transparent',boxSizing:'border-box',cursor:busy?'wait':canvasTool==='hand'||spaceHeld?'grab':'move',touchAction:'none',padding:0},
                        onPointerDown:event=>startDrag(event,handle),
                        onContextMenu:event=>openLayerMenu(event,handle.id),
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
                          border:'2px solid '+(control?'#bca991':'var(--dsw-alias-bg-layer-2, #292a2d)'),
                          borderRadius:control?'50%':'3px',
                          background:control?'var(--dsw-alias-bg-layer-2, #292a2d)':'#e4c3a2'},
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
                          fill:'#bda991',stroke:'var(--dsw-alias-border-l2, #262626)',strokeWidth:artboard.width/500}))
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
                  )
                ):
                  ['html','htm'].includes(doc?.format)?
                    h('div',{className:'dsh-studio-responsive-preview',
                      // The tab strip reduces the canvas height: anchor the HTML
                      // preview to the top and let it scroll, instead of letting
                      // a centred taller panel slide under the stage header (where
                      // its own toolbar would stop being clickable).
                      style:{width:'100%',display:'grid',gap:8,alignContent:'start',
                        alignSelf:'flex-start',maxHeight:'100%',overflow:'auto'}},
                      h('div',{role:'toolbar','aria-label':'HTML responsive viewport',
                        style:{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}},
                        [['auto','Auto'],['desktop','1280'],['tablet','768'],['mobile','390']].map(([mode,label])=>
                          h('button',{type:'button',key:mode,
                            'aria-label':'HTML viewport '+mode,'aria-pressed':htmlViewport===mode,
                            style:{...button,background:htmlViewport===mode?'#574939':button.background},
                            onClick:()=>setHtmlViewport(mode)},label)),
                        h('small',{style:{color:'var(--dsw-alias-label-secondary, #aaa9a5)',marginLeft:7}},
                          htmlViewport==='auto'?'Largeur disponible':({desktop:'1280 px',tablet:'768 px',mobile:'390 px'})[htmlViewport])
                      ),
                      h('small',{role:'status',style:{color:'var(--dsw-alias-state-warn-primary, #d6b787)',fontSize:11}},
                        'Aperçu partiel · CSS locaux simples uniquement (pas de cascade calculée). '+
                        (htmlPreviewCoverage?.includedDeclarations||0)+' déclarations compatibles, '+
                        (htmlPreviewCoverage?.omittedDeclarations||0)+' ignorées'+
                        (htmlPreviewCoverage?.truncated?' · limite atteinte':'')+'.'),
                      h('div',{className:'dsh-studio-html-frame-scroll',
                        style:{width:'100%',maxWidth:'100%',overflowX:'auto',overflowY:'hidden',
                          border:'1px solid #474747',borderRadius:8,background:'var(--dsw-alias-bg-layer-2, #17191b)',
                          padding:8,boxSizing:'border-box'}},
                        h('iframe',{title:'Isolated design preview',sandbox:'allow-same-origin',
                          referrerPolicy:'no-referrer',onLoad:connectHtmlPreview,
                          srcDoc:safePreview(source,doc?.format,htmlActive,htmlPreviewCss),
                          style:{display:'block',
                            width:({auto:'100%',desktop:'1280px',tablet:'768px',mobile:'390px'})[htmlViewport],
                            maxWidth:'none',height:520,border:'none',background:'#fff',borderRadius:6}})
                      )
                    ):
                    h('iframe',{title:'Isolated design preview',sandbox:'',
                      referrerPolicy:'no-referrer',onLoad:connectHtmlPreview,
                      srcDoc:safePreview(source,doc?.format,htmlActive),
                      style:{width:'100%',height:350,border:'none',background:'#fff',borderRadius:6}})),
artboard&&doc?.format==='svg'&&h('div',{className:'dsh-studio-canvas-bottom',role:'toolbar','aria-label':'Canvas navigation'},
h('button',{type:'button',style:button,'aria-label':'Zoom out canvas',
                  onClick:()=>changeZoom(1/1.25)},'−'),
                h('output',{'aria-label':'Canvas zoom level',style:{fontVariantNumeric:'tabular-nums',minWidth:48,textAlign:'center',color:ACCENT}},
                  Math.round(camera.zoom*100)+'%'),
                h('button',{type:'button',style:button,'aria-label':'Zoom in canvas',
                  onClick:()=>changeZoom(1.25)},'+'),
                h('button',{type:'button',style:button,'aria-label':'Fit canvas view',
                  onClick:resetView,title:'Recentrer / adapter au canevas · 0'},'Fit'),
                ),
          ),
          h('aside',{className:'dsh-studio-inspector'+(mobilePanel==='inspector'?' dsh-studio-mobile-active':''),style:{...pane,overflow:'auto',borderRadius:0,borderWidth:'0 0 0 1px',background:'var(--dsw-alias-bg-layer-1, #232529)'}},
             h('div',{className:'dsh-studio-inspect-top'},
               h('button',{className:'dsh-studio-it'+(!inspectAdvanced?' dsh-studio-on':''),type:'button',onClick:()=>setInspectAdvanced(false)},'Design'),
               h('button',{className:'dsh-studio-it',type:'button',disabled:true,title:'Non implémenté'},'Prototype'),
               h('button',{className:'dsh-studio-it'+(inspectAdvanced?' dsh-studio-on':''),type:'button',onClick:()=>setInspectAdvanced(true)},'Inspecter')),
            h('div',{className:'dsh-studio-inspect-scroll'},
            h('div',{className:'dsh-studio-inspect-head'},
              glyph(selected?.tag==='text'?'text':selected?.isGroup?'Calques':selected?.tag==='ellipse'||selected?.tag==='circle'?'ellipse':'rect'),
              h('div',null,h('div',{className:'dsh-studio-inspect-title'},selectedCss?.selector||selectedMedia?.selector||selectedHtml?.id||selected?.id||'Aucune sélection'),
                h('div',{className:'dsh-studio-inspect-detail'},selectedHtml?'Élément HTML natif':selectedMedia?'Règle CSS conditionnelle · @media '+selectedMedia.condition:selectedCss?'Règle CSS native':selected?selected.tag+' · SVG natif':'Sélectionnez un calque'))),
            artboardInspector,alignmentInspector,(!doc||doc.format==='svg')&&geometryInspector,(!doc||doc.format==='svg')&&appearanceInspector,typographyInspector,
            (!doc||doc.format==='svg')&&strokeInspector,
            (!doc||doc.format==='svg')&&h('section',{className:'dsh-studio-ins-block'},h('div',{className:'dsh-studio-ins-head'},'Effets',h('span',null,'＋')),h('button',{className:'dsh-studio-addprop',type:'button',disabled:true,title:'Les filtres SVG ne sont pas éditables dans ce périmètre'},'＋ Ajouter un effet'),h('p',{className:'dsh-studio-hint'},'Hors périmètre : filtres SVG éditables. Source native préservée.')),
            h(doc&&doc.format!=='svg'?'section':'details',{className:'dsh-studio-technical',
               ...(doc&&doc.format!=='svg'?{}:{open:inspectAdvanced,onToggle:event=>{
                 setInspectAdvanced(event.currentTarget.open)
                 if(event.currentTarget.open)event.currentTarget.scrollIntoView?.({block:'nearest'})
               }})},(!doc||doc.format==='svg')&&h('summary',null,'Contrôles natifs avancés'),
              selectedMedia?
              h('div',{style:{display:'flex',flexDirection:'column',gap:9,marginTop:12}},
                h('strong',{style:{color:ACCENT}},'@media '+selectedMedia.condition),
                h('code',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary, #a9a6a1)'}},selectedMedia.selector),
                h('small',{style:{color:'var(--dsw-alias-label-secondary, #a9a6a1)'}},
                  'Règle conditionnelle adressée par sa position exacte. L’aperçu HTML ne l’applique pas : aucune valeur calculée ni cascade n’est affichée.'),
                !selectedMedia.conditionalEditable?h('small',{style:{color:'var(--dsw-alias-state-error-primary, #e7b2a8)'}},
                  'Lecture seule : '+conditionalReason(selectedMedia.reason)):
                  h('div',{style:{display:'grid',gap:8}},
                    h('label',null,'Propriété',
                      h('select',{style:field,'aria-label':'Conditional CSS rule property',
                        value:cssMediaProperty,onChange:e=>chooseCssMediaProperty(e.target.value)},
                        htmlProps.map(property=>h('option',{key:property,value:property},property)))),
                    h('label',null,'Valeur',
                      h('input',{style:field,'aria-label':'Conditional CSS rule value',
                        value:cssMediaValue,placeholder:'ex : 12px, flex, #bda991',
                        onChange:e=>setCssMediaValue(e.target.value)})),
                    h('button',{style:{...button,borderColor:ACCENT},
                      'aria-label':'Apply conditional CSS rule style',
                      disabled:busy||reloadRequired||source!==doc?.source||!cssMediaValue,
                      onClick:()=>void save({kind:'css-media',start:selectedMedia.start,
                        condition:selectedMedia.condition,property:cssMediaProperty,value:cssMediaValue})
                    },'Appliquer dans @media · sans IA'),
                    h('small',{style:{opacity:.7}},
                      'Un seul emplacement modifié ; Undo/Redo natif. Les autres blocs identiques restent intacts.')))
              :selectedCss?
              h('div',{style:{display:'flex',flexDirection:'column',gap:9,marginTop:12}},
                h('strong',{style:{color:ACCENT}},selectedCss.selector),
                returnHtmlRef&&h('button',{type:'button',style:button,
                  'aria-label':'Return to linked HTML page',
                  disabled:busy||reloadRequired||source!==doc.source,
                  onClick:()=>void returnToHtml()},'← Retour à la page HTML'),
                h('small',{style:{color:'var(--dsw-alias-label-secondary, #a9a6a1)'}},
                  'Édition ciblée d’une règle dans le fichier CSS natif. Les sélecteurs complexes restent en lecture seule ; un bloc @media simple s’édite depuis sa propre ligne.'),
                !selectedCss.editable?h('small',{style:{color:'var(--dsw-alias-state-error-primary, #e7b2a8)'}},
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
                h('small',{style:{color:'var(--dsw-alias-label-secondary, #a9a6a1)'}},'HTML natif : clic dans l’aperçu pour sélectionner un élément à id unique. Scripts bloqués ; propriétés inline ciblées.'),
                h('div',{className:'dsh-studio-linked-css',style:{display:'grid',gap:5,padding:8,
                  background:'var(--dsw-alias-bg-layer-2, #282a2d)',border:'1px solid #3e4042',borderRadius:6}},
                  h('strong',{style:{fontSize:12,color:'#c5ae94'}},'CSS externe · correspondances possibles'),
                  h('small',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary, #aaa9a5)'}},
                    'Ce ne sont pas des styles calculés. Cascade, !important, media queries et héritage non résolus.'),
                  htmlStylesheets.filter(link=>link.status!=='inspected').map((link,index)=>
                    h('small',{key:'blocked-'+index,style:{color:'var(--dsw-alias-state-warn-primary, #e5b39b)'}},
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
                        h('small',{style:{color:'var(--dsw-alias-label-secondary, #bdbbb7)'}},
                          'Spécificité indicative '+match.specificity+
                          (match.editable?'':' · règle en lecture seule')+
                          (match.duplicateAcrossFiles?' · sélecteur répété':'')
                        )
                      )
                    ):
                    h('small',{style:{color:'var(--dsw-alias-label-secondary, #aaa9a5)'}},
                      'Aucune règle simple #id ou .classe reconnue dans les CSS locaux référencés.')
                ),
                !selectedHtml.editable?h('small',{style:{color:'var(--dsw-alias-state-error-primary, #f1b6aa)'}},
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
                  h('div',{role:'group','aria-label':'HTML text and attributes',style:{display:'grid',gap:8,
                    padding:8,background:'var(--dsw-alias-bg-layer-2, #282a2d)',border:'1px solid #3e4042',borderRadius:6}},
                    h('strong',{style:{fontSize:12,color:'#c5ae94'}},'Texte et attributs natifs'),
                    h('label',null,'Texte de l’élément',
                      h('input',{style:{...field,marginTop:4},'aria-label':'HTML element text',
                        value:htmlText,placeholder:'texte affiché',
                        onChange:e=>setHtmlText(e.target.value)})),
                    h('button',{style:{...button,borderColor:ACCENT},
                      'aria-label':'Apply HTML element text',
                      disabled:busy||reloadRequired||source!==doc.source||
                        !selectedHtml.key||htmlText.length===0||htmlText===htmlElementText(selectedHtml),
                      onClick:()=>void save({kind:'html-text',key:selectedHtml.key,id:selectedHtml.id,
                        value:htmlText})
                    },'Appliquer le texte'),
                    h('small',{role:'status',style:{color:'var(--dsw-alias-label-secondary, #aaa9a5)',fontSize:11}},
                      'Uniquement les éléments dont le contenu est du texte simple ; le balisage est refusé.'),
                    h('label',null,'Attribut',
                      h('select',{style:{...field,marginTop:4},'aria-label':'HTML attribute name',
                        value:htmlAttrName,onChange:e=>setHtmlAttrName(e.target.value)},
                        ['class','title','alt','hidden','lang','dir'].map(name=>
                          h('option',{key:name,value:name},name)))),
                    h('label',null,'Valeur',
                      h('input',{style:{...field,marginTop:4},'aria-label':'HTML attribute value',
                        value:htmlAttrValue,placeholder:'valeur autorisée',
                        onChange:e=>setHtmlAttrValue(e.target.value)})),
                    h('button',{style:{...button,borderColor:ACCENT},
                      'aria-label':'Apply HTML attribute',
                      disabled:busy||reloadRequired||source!==doc.source||!selectedHtml.key,
                      onClick:()=>void save({kind:'html-attribute',key:selectedHtml.key,id:selectedHtml.id,
                        attribute:htmlAttrName,value:htmlAttrValue})
                    },'Appliquer l’attribut'),
                    h('small',{role:'status',style:{color:'var(--dsw-alias-label-secondary, #aaa9a5)',fontSize:11}},
                      'Liste blanche : class, title, alt, hidden, lang, dir, data-*. src, href, on* et style sont refusés côté Host.')
                  ),
                  renderLayoutControls('html',selectedHtml))):
              selected?
              h('div',{style:{display:'flex',flexDirection:'column',gap:8,marginTop:12}},
                h('div',null,selected.tag+' #'+selected.id),
                h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
                  h('button',{style:button,'aria-label':'Duplicate selected layer',disabled:busy||source!==doc.source,
                    onClick:()=>void layerAction('duplicate'),title:'Dupliquer le calque · Ctrl+D'},'⧉ Dupliquer'),
                  h('button',{style:{...button,color:'var(--dsw-alias-state-error-primary, #e7b2a8)'},'aria-label':'Delete selected layer',
                    disabled:busy||source!==doc.source,
                    onClick:()=>void layerAction('delete'),title:'Supprimer le calque · Delete (annulable)'},'⌫ Supprimer')
                ),
                h('div',{role:'group','aria-label':'Layer structure',style:{display:'grid',gap:6,
                  padding:8,background:'var(--dsw-alias-bg-layer-2, #282a2d)',border:'1px solid #3e4042',borderRadius:6}},
                  h('small',{style:{color:'#c5ae94'}},'Structure · '+(selected.isGroup?'groupe':'forme')+
                    ' · profondeur '+(selected.depth||0)+
                    (extraSelection.length?' · '+(extraSelection.length+1)+' calques sélectionnés':'')),
                  h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
                    h('button',{type:'button',style:button,'aria-label':'Group selected layers',
                      disabled:busy||source!==doc.source||selectionIds().length<2,
                      title:'Grouper les calques frères sélectionnés dans un nouveau <g>',
                      onClick:()=>void save({kind:'svg-grouping',operation:'group',ids:selectionIds()})},
                      '▣ Grouper'),
                    h('button',{type:'button',style:button,'aria-label':'Ungroup selected layer',
                      disabled:busy||source!==doc.source||!selected.isGroup,
                      title:'Supprimer le groupe et remonter ses enfants',
                      onClick:()=>void save({kind:'svg-grouping',operation:'ungroup',id:selected.id})},
                      '▤ Dégrouper')
                  ),
                  h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
                    h('button',{type:'button',style:button,
                      'aria-label':selected.hidden?'Show layer from native source':'Hide layer from native source',
                      disabled:busy||source!==doc.source||selected.locked,
                      onClick:()=>void save({kind:'svg-visibility',id:selected.id,property:'display',
                        value:selected.hidden?null:'none'})},
                      selected.hidden?'◉ Afficher':'◌ Masquer'),
                    h('button',{type:'button',style:button,
                      'aria-label':selected.locked?'Unlock selected layer':'Lock selected layer',
                      disabled:busy||source!==doc.source,
                      onClick:()=>void save({kind:'svg-lock',id:selected.id,locked:!selected.locked})},
                      selected.locked?'⛔ Verrouillé':'🔓 Verrouiller')
                  ),
                  h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},
                    h('button',{type:'button',style:button,'aria-label':'Rotate layer from native source 90 degrees',
                      disabled:busy||source!==doc.source||selected.locked,
                      title:'Rotation de 90° autour du centre réel de la forme',
                      onClick:()=>void transformSelected('rotate')},'⟳ Pivoter 90°'),
                    h('button',{type:'button',style:button,'aria-label':'Scale selected layer up',
                      disabled:busy||source!==doc.source||selected.locked,
                      onClick:()=>void transformSelected('scaleUp')},'＋ Échelle ×1.1'),
                    h('button',{type:'button',style:button,'aria-label':'Scale selected layer down',
                      disabled:busy||source!==doc.source||selected.locked,
                      onClick:()=>void transformSelected('scaleDown')},'－ Échelle ÷1.1')
                  ),
                  h('small',{style:{opacity:.7}},
                    'Une seule matrice normalisée par action, pivot au centre de la forme, Undo exact.')
                ),
                selected.tag==='path'&&h('div',{style:{display:'grid',gap:6,padding:'10px 0'}},
                  h('strong',{style:{color:ACCENT}},'Tracé vectoriel · Nœuds'),
                  selectedPath?.editable?
                    h('div',{style:{display:'grid',gap:8}},
                      h('small',{style:{color:'var(--dsw-alias-label-secondary, #aaa9a5)'}},selectedPath.points.length+
                        ' points · ancres carrées, poignées Bézier rondes. Les boutons + insèrent un point au milieu du segment.'),
                      h('small',{style:{color:'var(--dsw-alias-label-tertiary, #989690)'}},
                        'Insertion sur ligne ou courbe : le segment est subdivisé. Suppression limitée aux points terminant une ligne simple.'),
                      selectedPath.penExtendable&&h('button',{style:button,type:'button',
                        'aria-label':'Resume selected path with pen tool',
                        disabled:busy||reloadRequired||source!==doc.source,
                        onClick:()=>{setPenPathId(selectedPath.id);setPenOutgoing(null);setCanvasTool('pen')}
                      },'✒ Reprendre le tracé avec la Plume'),
                      h('div',{style:{display:'flex',flexDirection:'column',gap:5,maxHeight:190,overflow:'auto'}},
                        (selectedPath.segments||[]).map(segment=>
                          h('div',{key:segment.commandIndex,style:{display:'flex',gap:5,alignItems:'center'}},
                            h('small',{style:{flex:1,color:'var(--dsw-alias-label-secondary, #aaa9a5)'}},
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
                    h('small',{style:{color:'var(--dsw-alias-state-error-primary, #e7b2a8)'}},'Tracé non pris en charge en édition visuelle ('+
                      (selectedPath?.reason||'unsupported-path')+'). Utiliser le code source sans conversion forcée.')
                ),
                h('label',null,'Property',h('select',{style:field,value:attribute,onChange:e=>{setAttribute(e.target.value);setValue(selected.attributes[e.target.value]||'')}},Object.keys(selected.attributes).map(k=>h('option',{value:k,key:k},k)))),
                attribute&&h('label',null,'Value',h('input',{style:field,value,onChange:e=>setValue(e.target.value)})),
                h('button',{style:button,disabled:busy||!attribute,onClick:()=>save({kind:'svg-attribute',id:active,attribute,value})},'Apply without AI')):
              h('p',{style:{opacity:0.65}},'Sélectionnez un calque pour éditer ses attributs.')),
            h('section',{className:'dsh-studio-ins-block'},h('div',{className:'dsh-studio-ins-head'},'Fichier et code'),h('p',{className:'dsh-studio-panel-sub'},'Format natif · édition manuelle locale · aucune requête IA'))))),
        doc&&h('details',{className:'dsh-studio-source',style:{padding:'10px 14px',borderTop:'1px solid #36383b',background:'var(--dsw-alias-bg-layer-1, #222427)'}},h('summary',{style:{cursor:'pointer'}},'Code source natif · avancé'),
          h('textarea',{spellCheck:false,value:source,onChange:e=>setSource(e.target.value),style:{...field,minHeight:220,font:'12px monospace',marginTop:8}}),
          h('div',{style:{display:'flex',gap:8,marginTop:8}},
            h('button',{style:button,disabled:busy||reloadRequired||source===doc.source,onClick:()=>save({kind:'replace-source',source})},'Save source'),
            h('button',{style:button,onClick:()=>setSource(doc.source)},'Discard unsaved text'))),

        h('footer',{className:'dsh-studio-footer'},h('span',null,'◇ DSH Design Studio'),h('span',null,h('kbd',null,'V'),' Sélection'),h('span',null,h('kbd',null,'H'),' Main'),h('span',null,h('kbd',null,'P'),' Plume'),h('span',null,'Ctrl + molette : zoom'),h('span',null,'SVG · HTML · CSS natifs'),h('span',null,'● Mode local · expérimental'))
      )
    }
    /**
     * Sidebar entry glyph. DSH owns the sidebar button, its accessible name and
     * its label; a panel icon only supplies the drawing at the requested size,
     * so it inherits the current text colour and exposes nothing to a11y.
     */
    function StudioPanelIcon(props) {
      const size = props && Number.isFinite(props.size) ? props.size : 16
      return h('svg',{width:size,height:size,viewBox:'0 0 16 16',fill:'none',stroke:'currentColor',
        strokeWidth:1.3,strokeLinejoin:'round','aria-hidden':'true',focusable:'false'},
        h('path',{d:'M8 1.6 14.4 8 8 14.4 1.6 8z'}),
        h('path',{d:'M8 5.3 10.7 8 8 10.7 5.3 8z',fill:'currentColor',stroke:'none'}))
    }
    /**
     * Sidebar panel (ADR-024). It has no conversation, so it edits a registered
     * workspace: the Host lists the workspaces it owns, this component picks
     * one by id and the same workbench edits it. No path is ever sent here, and
     * the Host refuses a path-shaped id.
     */
    function StudioPanel(props) {
      const [listed,setListed] = React.useState({state:'loading',workspaces:[],available:true})
      const [selected,setSelected] = React.useState('')
      const [attempt,setAttempt] = React.useState(0)
      React.useEffect(()=>{
        let cancelled=false
        setListed(current=>({...current,state:'loading'}))
        void (async()=>{
          try {
            const response=await fetch(new URL('/'+api+'/workspaces',document.baseURI),{credentials:'same-origin'})
            const data=await response.json()
            if(cancelled) return
            const workspaces=Array.isArray(data&&data.workspaces)?data.workspaces:[]
            setListed({state:'ready',workspaces,available:data?data.available!==false:false})
            setSelected(current=>{
              if(current && workspaces.some(item=>item.id===current)) return current
              const first=workspaces.find(item=>item.status==='ok')||workspaces[0]
              return first?first.id:''
            })
          } catch(_) {
            if(!cancelled) setListed({state:'error',workspaces:[],available:false})
          }
        })()
        return ()=>{cancelled=true}
      },[attempt])
      const current = listed.workspaces.find(item=>item.id===selected)
      const note = {padding:'14px 4px',opacity:0.8,lineHeight:1.5,fontSize:12}
      return h('div',{className:'dsh-studio-panel',lang:'fr',
        'aria-label':'Design Studio panel',
        style:{display:'flex',flexDirection:'column',minHeight:0,height:'100%',padding:'10px 12px',gap:8,
          boxSizing:'border-box',background:'var(--dsw-alias-bg-base, #202124)',
          color:'var(--dsw-alias-label-primary, #e8e7e2)',
          fontFamily:'var(--dsw-font-family, system-ui, sans-serif)'}},
        h('div',{style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}},
          h('strong',{style:{fontSize:12.5,letterSpacing:'.02em'}},'Design Studio'),
          listed.workspaces.length>1
            ? h('label',{style:{display:'flex',gap:6,alignItems:'center',fontSize:11.5,opacity:0.9}},
                'Espace de travail',
                h('select',{style:{...field,maxWidth:300,width:'auto'},'aria-label':'Workspace',
                  value:selected,onChange:e=>setSelected(e.target.value)},
                  listed.workspaces.map(item=>h('option',{key:item.id,value:item.id,
                    disabled:item.status!=='ok'},
                    (item.title||item.id)+(item.status==='ok'?'':' · dossier introuvable')))))
            : current?h('span',{style:{fontSize:11.5,opacity:0.8}},current.title||current.id):null,
          h('button',{type:'button',style:{...button,padding:'3px 8px',marginLeft:'auto'},
            disabled:listed.state==='loading','aria-label':'Refresh workspaces',
            onClick:()=>setAttempt(n=>n+1)},'Actualiser')),
        listed.state==='loading'
          ? h('div',{role:'status',style:note},'Chargement des espaces de travail…')
          : listed.state==='error'
            ? h('div',{role:'alert',style:{...note,color:'var(--dsw-alias-state-error-primary, #e7b2a8)'}},
                'Impossible de lister les espaces de travail du Host. Réessayez avec « Actualiser ».')
            : listed.available===false
              ? h('div',{role:'status',style:note},
                  'Le registre d’espaces de travail n’est pas disponible dans ce Host. ',
                  'L’onglet Design Studio d’une conversation reste utilisable.')
              : listed.workspaces.length===0
                ? h('div',{role:'status',style:note},
                    'Aucun espace de travail enregistré dans DSH. Enregistrez un dossier, puis « Actualiser ».')
                : !current
                  ? h('div',{role:'status',style:note},'Sélectionnez un espace de travail.')
                  : current.status!=='ok'
                    ? h('div',{role:'alert',style:{...note,color:'var(--dsw-alias-state-error-primary, #e7b2a8)'}},
                        'Le dossier de cet espace de travail est introuvable : restaurez-le avant d’éditer.')
                    : h('div',{style:{flex:1,minHeight:0,minWidth:0,display:'flex',flexDirection:'column'}},
                        h(Studio,{key:selected,workspaceId:selected,panel:true})))
    }
    return {
      inject:['slots'],
      apply(ctx) {
        const slots=ctx.slots
        if (!slots || typeof slots.inject!=='function') return
        // Each cell is registered on its own: an older host that lacks one slot
        // must still get the others, and a refused cell must never make the
        // already working conversation view disappear.
        const mount=(slot,register)=>{
          try { slots.inject(slot,register) }
          catch (error) { console.error('[dsh-design-studio] could not register '+slot, error) }
        }
        mount('conversation.view',()=>slots.register({name:'conversation.view',id:'dsh-design-studio',order:25,label:()=> 'Design Studio'},Studio))
        // A sidebar entry is the first place a user looks for an installed
        // plugin. The list id addresses the main cell of the same name, so both
        // registrations must keep one id: `design-studio`.
        mount('sidebar.panellist',()=>slots.register({name:'sidebar.panellist',id:'design-studio',order:20,label:()=> 'Design Studio'},StudioPanelIcon))
        mount('main',()=>slots.register({name:'main',key:'design-studio'},StudioPanel))
      },
    }
  },
})
