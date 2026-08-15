/* Explorador del catálogo normativo. Vanilla, sin dependencias.
   Datos: data/documents.jsonl + entities.json + graph.json + senales.json + wiki/. */
(() => {
  'use strict'

  const $ = (s) => document.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const fmt = (n) => n.toLocaleString('en-US')

  const SERIES = ['gas', 'petroleo', 'ambos', 'dudosa']
  const COLORS = { gas: '#1f6a9b', petroleo: '#c24b22', ambos: '#0f8a57', dudosa: '#94a3b8' }
  const LABELS = { gas: 'Gas', petroleo: 'Petróleo', ambos: 'Ambos', dudosa: 'Dudosa', fuera: 'Fuera de alcance' }
  const KIND_COLORS = { org: '#1f6a9b', company: '#0f8a57', tema: '#c24b22', area: '#8a6412' }
  const KIND_LABELS = { org: 'organismo', company: 'empresa', tema: 'instrumento', area: 'área' }
  const PRE = 1959

  const state = {
    q: '', org: '', tipo: '', anio: null, sel: null, shown: 250, ent: null,
    rel: new Set(['gas', 'petroleo', 'ambos', 'dudosa']),
    view: 'catalogo', wikiPage: null, gsel: null,
  }
  let docs = [], wiki = [], graph = null, senales = null
  const byId = new Map(), entById = new Map(), entDocs = new Map()
  const wikiCache = new Map()

  /* ---------- carga ---------- */

  async function load() {
    $('#list-count').textContent = 'Cargando el catálogo…'
    const [jsonl, ents, g, sen, wikiIdx] = await Promise.all([
      fetch('data/documents.jsonl').then((r) => r.text()),
      fetch('data/entities.json').then((r) => r.json()),
      fetch('data/graph.json').then((r) => r.json()),
      fetch('data/senales.json').then((r) => r.json()),
      fetch('data/wiki.json').then((r) => r.json()).catch(() => []),
    ])
    docs = jsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    for (const d of docs) {
      d._s = norm([d.titulo, d.organismo, d.numero, d.tipo_norma, d.doc_id].join(' '))
      d._y = d.anio == null ? null : (d.anio < 1960 ? PRE : d.anio)
      byId.set(d.doc_id, d)
      for (const e of d.e || []) {
        if (!entDocs.has(e)) entDocs.set(e, [])
        entDocs.get(e).push(d)
      }
    }
    docs.sort((a, b) => (b.fecha || '') < (a.fecha || '') ? -1 : 1)
    for (const arr of entDocs.values()) arr.sort((a, b) => (b.fecha || '') < (a.fecha || '') ? -1 : 1)
    for (const e of ents) entById.set(e.id, e)
    graph = g; senales = sen; wiki = wikiIdx
    buildFilters()
    buildLegend()
    readHash()
    renderAll()
    window.addEventListener('hashchange', () => { readHash(); renderAll() })
  }

  /* ---------- estado ↔ hash ---------- */

  function writeHash() {
    const p = new URLSearchParams()
    if (state.q) p.set('q', state.q)
    if (state.org) p.set('org', state.org)
    if (state.tipo) p.set('tipo', state.tipo)
    if (state.anio != null) p.set('anio', state.anio)
    if (state.ent) p.set('ent', state.ent)
    const rel = [...state.rel].sort().join(',')
    if (rel !== 'ambos,dudosa,gas,petroleo') p.set('rel', rel)
    if (state.sel) p.set('doc', state.sel)
    if (state.view !== 'catalogo') p.set('view', state.view)
    if (state.wikiPage) p.set('wp', state.wikiPage)
    if (state.gsel) p.set('gsel', state.gsel)
    const h = p.toString()
    history.replaceState(null, '', h ? '#' + h : location.pathname)
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1))
    state.q = p.get('q') || ''
    state.org = p.get('org') || ''
    state.tipo = p.get('tipo') || ''
    state.anio = p.has('anio') ? Number(p.get('anio')) : null
    state.ent = p.get('ent') || null
    state.sel = p.get('doc') || null
    state.view = ['grafo', 'senales', 'wiki'].includes(p.get('view')) ? p.get('view') : 'catalogo'
    state.wikiPage = p.get('wp') || null
    state.gsel = p.get('gsel') || null
    if (p.has('rel')) state.rel = new Set(p.get('rel').split(',').filter((r) => LABELS[r]))
    $('#f-q').value = state.q
    $('#f-org').value = state.org
    $('#f-tipo').value = state.tipo
  }

  function update() { writeHash(); renderAll() }

  /* ---------- filtros del catálogo ---------- */

  function matches(d, { ignoreYear = false, ignoreRel = false } = {}) {
    if (!ignoreRel && !state.rel.has(d.relevance)) return false
    if (state.org && d.organismo !== state.org) return false
    if (state.tipo && d.tipo_norma !== state.tipo) return false
    if (state.ent && !(d.e || []).includes(state.ent)) return false
    if (!ignoreYear && state.anio != null && d._y !== state.anio) return false
    if (state.q) {
      const toks = norm(state.q).split(/\s+/).filter(Boolean)
      if (!toks.every((t) => d._s.includes(t))) return false
    }
    return true
  }

  function buildFilters() {
    const orgCount = new Map(), tipoCount = new Map()
    for (const d of docs) {
      orgCount.set(d.organismo, (orgCount.get(d.organismo) || 0) + 1)
      tipoCount.set(d.tipo_norma, (tipoCount.get(d.tipo_norma) || 0) + 1)
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    $('#f-org').innerHTML = '<option value="">Organismo: todos</option>' +
      top(orgCount, 24).map(([o, n]) => `<option value="${esc(o)}">${esc(o)} (${fmt(n)})</option>`).join('')
    $('#f-tipo').innerHTML = '<option value="">Tipo: todos</option>' +
      top(tipoCount, 15).map(([t, n]) => `<option value="${esc(t)}">${esc(t)} (${fmt(n)})</option>`).join('')

    $('#f-q').addEventListener('input', (e) => { state.q = e.target.value; state.shown = 250; update() })
    $('#f-org').addEventListener('change', (e) => { state.org = e.target.value; state.shown = 250; update() })
    $('#f-tipo').addEventListener('change', (e) => { state.tipo = e.target.value; state.shown = 250; update() })
    $('#f-clear').addEventListener('click', () => {
      Object.assign(state, { q: '', org: '', tipo: '', anio: null, shown: 250, ent: null })
      state.rel = new Set(SERIES)
      $('#f-q').value = ''; $('#f-org').value = ''; $('#f-tipo').value = ''
      update()
    })
    $('#list-more').addEventListener('click', () => { state.shown += 250; renderList() })
    document.querySelectorAll('.view-tab').forEach((b) =>
      b.addEventListener('click', () => { state.view = b.dataset.view; update() }))

    const dl = $('#g-nodes')
    if (graph) dl.innerHTML = graph.nodes.map((n) => `<option value="${esc(n.label)}">`).join('')
    $('#g-q').addEventListener('change', (e) => {
      const n = graph.nodes.find((x) => norm(x.label) === norm(e.target.value))
      if (n) { state.gsel = n.id; update(); centerNode(n.id) }
    })
  }

  function buildLegend() {
    const el = $('#legend')
    el.innerHTML = [...SERIES, 'fuera'].map((r) => {
      const dot = r === 'fuera'
        ? '<span class="dot dot--outline"></span>'
        : `<span class="dot" style="background:${COLORS[r]}"></span>`
      return `<button data-rel="${r}" aria-pressed="true">${dot}${LABELS[r]} <span class="n"></span></button>`
    }).join('')
    el.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const r = b.dataset.rel
        state.rel.has(r) ? state.rel.delete(r) : state.rel.add(r)
        state.shown = 250
        update()
      }))
  }

  /* ---------- render ---------- */

  function renderAll() {
    for (const v of ['catalogo', 'grafo', 'senales', 'wiki']) {
      $(`#view-${v}`).hidden = state.view !== v
      $(`#tab-${v}`).setAttribute('aria-selected', String(state.view === v))
    }
    if (state.view === 'wiki') { renderWiki(); stopGraph(); return }
    if (state.view === 'senales') { renderSenales(); stopGraph(); return }
    if (state.view === 'grafo') { startGraph(); renderFicha(); return }
    stopGraph()

    const counts = {}
    for (const r of [...SERIES, 'fuera']) counts[r] = 0
    for (const d of docs) if (matches(d, { ignoreRel: true })) counts[d.relevance]++
    document.querySelectorAll('#legend button').forEach((b) => {
      const r = b.dataset.rel
      b.setAttribute('aria-pressed', String(state.rel.has(r)))
      b.querySelector('.n').textContent = fmt(counts[r])
    })
    const active = state.q || state.org || state.tipo || state.anio != null || state.ent ||
      [...state.rel].sort().join(',') !== 'ambos,dudosa,gas,petroleo'
    $('#f-clear').hidden = !active

    const pill = $('#ent-pill')
    if (state.ent) {
      const e = entById.get(state.ent)
      pill.innerHTML = `<span class="ent-pill">entidad: ${esc(e ? e.label : state.ent)}
        <button aria-label="Quitar filtro" id="ent-x">×</button></span>`
      $('#ent-x').addEventListener('click', () => { state.ent = null; update() })
    } else pill.innerHTML = ''

    renderChart()
    renderList()
    renderDetail()
  }

  /* Histograma apilado por año (idéntico a v1; 'fuera' no se grafica). */
  function renderChart() {
    const years = [PRE]
    for (let y = 1960; y <= 2026; y++) years.push(y)
    const idx = new Map(years.map((y, i) => [y, i]))
    const data = years.map(() => ({ gas: 0, petroleo: 0, ambos: 0, dudosa: 0 }))
    for (const d of docs) {
      if (d._y == null || !SERIES.includes(d.relevance)) continue
      if (!matches(d, { ignoreYear: true })) continue
      data[idx.get(d._y)][d.relevance]++
    }
    const totals = data.map((b) => SERIES.reduce((s, k) => s + b[k], 0))
    const maxT = Math.max(1, ...totals)
    const W = 1000, H = 240, M = { t: 8, r: 8, b: 26, l: 40 }
    const iw = W - M.l - M.r, ih = H - M.t - M.b
    const bw = iw / years.length
    const barW = Math.max(3, bw - 2)
    const y = (v) => M.t + ih - (v / maxT) * ih
    const gridVals = [Math.round(maxT / 2), maxT]

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Documentos por año, apilados por relevancia">`
    s += '<g class="grid">'
    for (const v of gridVals) s += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/>`
    s += '</g><g class="axis">'
    for (const v of gridVals) s += `<text x="${M.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`
    for (const yy of years) {
      if (yy !== PRE && (yy % 10 !== 0 || yy === 1960)) continue
      const x = M.l + idx.get(yy) * bw + bw / 2
      s += `<text x="${x}" y="${H - 8}" text-anchor="middle">${yy === PRE ? '‹1960' : yy}</text>`
    }
    s += '</g>'
    years.forEach((yy, i) => {
      const x = M.l + i * bw + (bw - barW) / 2
      let acc = 0
      const segs = []
      for (const k of SERIES) {
        const v = data[i][k]
        if (!v) continue
        const y1 = y(acc + v), y0 = y(acc)
        const h = Math.max(0, y0 - y1 - (acc ? 2 : 0))
        if (h > 0) segs.push(`<rect x="${x}" y="${y1}" width="${barW}" height="${h}" rx="1.5" fill="${COLORS[k]}"/>`)
        acc += v
      }
      if (state.anio === yy) segs.push(`<rect x="${x - 1.5}" y="${y(acc) - 3}" width="${barW + 3}" height="3" rx="1.5" fill="var(--pd-text)"/>`)
      const label = `${yy === PRE ? 'Antes de 1960' : yy}: ${fmt(totals[i])} documentos`
      s += `<g class="bar-hit" tabindex="0" role="button" data-y="${yy}" aria-label="${label}. Filtrar.">`
        + `<rect x="${M.l + i * bw}" y="${M.t}" width="${bw}" height="${ih}" fill="transparent"/>${segs.join('')}</g>`
    })
    s += '</svg>'
    $('#chart').innerHTML = s

    let tip = $('.chart-tip')
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.appendChild(tip) }
    $('#chart').querySelectorAll('.bar-hit').forEach((g) => {
      const yy = Number(g.dataset.y), b = data[idx.get(yy)]
      const rows = SERIES.filter((k) => b[k])
        .map((k) => `<span class="row"><span>${LABELS[k]}</span><span>${fmt(b[k])}</span></span>`).join('')
      const html = `<b>${yy === PRE ? 'Antes de 1960' : yy} · ${fmt(SERIES.reduce((t, k) => t + b[k], 0))}</b>${rows}`
      g.addEventListener('mousemove', (e) => {
        tip.innerHTML = html; tip.style.display = 'block'
        tip.style.left = Math.min(e.clientX + 14, innerWidth - 180) + 'px'
        tip.style.top = (e.clientY + 14) + 'px'
      })
      g.addEventListener('mouseleave', () => { tip.style.display = 'none' })
      const toggle = () => { state.anio = state.anio === yy ? null : yy; state.shown = 250; update() }
      g.addEventListener('click', toggle)
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } })
    })
  }

  function chipHtml(rel) {
    const dot = rel === 'fuera'
      ? '<span class="dot dot--outline"></span>'
      : `<span class="dot" style="background:${COLORS[rel]}"></span>`
    return `<span class="doc-chip">${dot}${LABELS[rel] || esc(rel)}</span>`
  }

  function renderList() {
    const all = docs.filter((d) => matches(d))
    const slice = all.slice(0, state.shown)
    $('#list-count').textContent =
      `${fmt(Math.min(state.shown, all.length))} de ${fmt(all.length)} documentos` +
      (all.length !== docs.length ? ` (catálogo: ${fmt(docs.length)})` : '')
    $('#list').innerHTML = slice.map((d) => {
      const num = [d.tipo_norma, d.numero && d.numero !== 'S/N' ? d.numero : ''].filter(Boolean).join(' ')
      return `<button class="doc-row" data-id="${esc(d.doc_id)}" aria-current="${d.doc_id === state.sel}">
        <span class="d-fecha">${esc(d.fecha || 's/f')}</span>
        <span class="d-tit"><strong>${esc(num)}</strong>${num ? ' · ' : ''}${esc(d.titulo || '(sin título)')}</span>
        ${chipHtml(d.relevance)}
        <span class="d-org">${esc(d.organismo || '')}</span>
      </button>`
    }).join('')
    $('#list-more').hidden = all.length <= state.shown
    $('#list').querySelectorAll('.doc-row').forEach((r) =>
      r.addEventListener('click', () => { state.sel = r.dataset.id; update() }))
  }

  function renderDetail() {
    const el = $('#detail')
    const d = state.sel && byId.get(state.sel)
    document.querySelector('#view-catalogo .results').classList.toggle('has-detail', !!d)
    el.hidden = !d
    if (!d) return
    const rows = [
      ['Fecha', d.fecha || 's/f'], ['Organismo', d.organismo],
      ['Tipo', d.tipo_norma], ['Número', d.numero],
      ['Relevancia', LABELS[d.relevance] || d.relevance],
      ['Estado', d.state === 'ingested' ? 'ingerida al wiki' : d.state],
      ['ID', d.doc_id],
    ].filter(([, v]) => v)
    const chips = (d.e || []).map((id) => {
      const e = entById.get(id)
      if (!e) return ''
      return `<button data-ent="${esc(id)}"><i style="background:${KIND_COLORS[e.kind]}"></i>${esc(e.label)}</button>`
    }).join('')
    el.innerHTML = `<button class="detail-close" id="d-close" aria-label="Cerrar">×</button>
      <h3>${esc(d.titulo || d.doc_id)}</h3>
      ${chips ? `<div class="ent-chips">${chips}</div>` : ''}
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${d.resumen ? `<p style="font-size:var(--pd-fs-sm)">${esc(d.resumen)}</p>` : ''}
      <div class="detail-actions">
        ${d.url ? `<a class="btn btn--primary" href="${esc(d.url.replace('http://', 'https://'))}" target="_blank" rel="noopener">Texto oficial (InfoLEG) ↗</a>` : ''}
        ${d.wiki_page ? '<button class="btn" id="d-wiki">Página del wiki →</button>' : ''}
      </div>`
    $('#d-close').addEventListener('click', () => { state.sel = null; update() })
    el.querySelectorAll('[data-ent]').forEach((b) =>
      b.addEventListener('click', () => openFicha(b.dataset.ent)))
    if (d.wiki_page) $('#d-wiki').addEventListener('click', () => {
      state.view = 'wiki'
      state.wikiPage = d.wiki_page.replace(/^wiki\//, '').replace(/\.md$/, '')
      update()
    })
  }

  function openFicha(entId) {
    state.view = 'grafo'
    state.gsel = entId
    update()
    centerNode(entId)
  }

  function openDoc(docId) {
    state.view = 'catalogo'
    state.sel = docId
    const d = byId.get(docId)
    if (d && !state.rel.has(d.relevance)) state.rel.add(d.relevance)
    update()
  }

  /* ---------- grafo de fuerza (canvas, sin dependencias) ---------- */

  const G = { nodes: [], edges: [], adj: new Map(), running: false, raf: 0,
              s: 1, tx: 0, ty: 0, alpha: 0, hover: null, drag: null, moved: false }

  function initGraph() {
    if (G.nodes.length || !graph) return
    const maxN = Math.max(...graph.nodes.map((n) => n.n))
    G.nodes = graph.nodes.map((n, i) => {
      const a = (i / graph.nodes.length) * Math.PI * 2
      const R = n.kind === 'org' ? 60 : n.kind === 'tema' ? 160 : 300
      return { ...n, x: Math.cos(a) * R + Math.random() * 40, y: Math.sin(a) * R + Math.random() * 40,
               vx: 0, vy: 0, r: 4 + 14 * Math.sqrt(n.n / maxN) }
    })
    const byIdG = new Map(G.nodes.map((n) => [n.id, n]))
    G.edges = graph.edges.filter((e) => byIdG.has(e.s) && byIdG.has(e.t))
      .map((e) => ({ ...e, a: byIdG.get(e.s), b: byIdG.get(e.t) }))
    for (const e of G.edges) {
      if (!G.adj.has(e.s)) G.adj.set(e.s, new Set())
      if (!G.adj.has(e.t)) G.adj.set(e.t, new Set())
      G.adj.get(e.s).add(e.t); G.adj.get(e.t).add(e.s)
    }
    G.byId = byIdG
    bindGraphEvents()
  }

  function fitCanvas() {
    const c = $('#graph')
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth, h = c.clientHeight
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr }
    if (!G.fitted) { G.tx = w / 2; G.ty = h / 2; G.fitted = true }
    return [w, h, dpr]
  }

  function startGraph() {
    initGraph()
    if (!G.nodes.length) return
    G.alpha = Math.max(G.alpha, 0.6)
    if (!G.running) { G.running = true; tick() }
  }

  function stopGraph() {
    G.running = false
    cancelAnimationFrame(G.raf)
  }

  function tick() {
    if (!G.running) return
    if (G.alpha > 0.015) {
      for (let i = 0; i < G.nodes.length; i++) {
        const a = G.nodes[i]
        for (let j = i + 1; j < G.nodes.length; j++) {
          const b = G.nodes[j]
          let dx = a.x - b.x, dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
          if (d2 > 90000) continue
          const f = 1500 / d2 * G.alpha
          const d = Math.sqrt(d2)
          dx /= d; dy /= d
          a.vx += dx * f; a.vy += dy * f
          b.vx -= dx * f; b.vy -= dy * f
        }
      }
      for (const e of G.edges) {
        const rest = 46 + 130 / Math.sqrt(e.w)
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y
        const d = Math.max(1, Math.hypot(dx, dy))
        const f = (d - rest) * 0.012 * Math.min(3, Math.sqrt(e.w)) * G.alpha
        const ux = dx / d, uy = dy / d
        e.a.vx += ux * f; e.a.vy += uy * f
        e.b.vx -= ux * f; e.b.vy -= uy * f
      }
      for (const n of G.nodes) {
        if (G.drag && G.drag.node === n) { n.vx = 0; n.vy = 0; continue }
        n.vx -= n.x * 0.0025 * G.alpha
        n.vy -= n.y * 0.0025 * G.alpha
        n.vx *= 0.82; n.vy *= 0.82
        n.x += n.vx; n.y += n.vy
      }
      G.alpha *= 0.992
    }
    drawGraph()
    G.raf = requestAnimationFrame(tick)
  }

  function drawGraph() {
    const c = $('#graph')
    const [w, h, dpr] = fitCanvas()
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const css = getComputedStyle(document.documentElement)
    ctx.fillStyle = css.getPropertyValue('--pd-data-bg').trim() || '#f6f7f8'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(G.tx, G.ty)
    ctx.scale(G.s, G.s)

    const focus = state.gsel || (G.hover && G.hover.id)
    const nbrs = focus ? (G.adj.get(focus) || new Set()) : null
    const dim = (id) => focus && id !== focus && !(nbrs && nbrs.has(id))

    for (const e of G.edges) {
      const on = focus && (e.s === focus || e.t === focus)
      ctx.strokeStyle = on ? 'rgba(31,106,155,.55)' : `rgba(110,116,128,${focus ? 0.06 : 0.16})`
      ctx.lineWidth = (0.4 + Math.log2(1 + e.w) * 0.55) / G.s * (on ? 1.6 : 1)
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke()
    }

    const labelMin = [...G.nodes].sort((a, b) => b.n - a.n)[Math.min(24, G.nodes.length - 1)].n
    for (const n of G.nodes) {
      const dimmed = dim(n.id)
      ctx.globalAlpha = dimmed ? 0.18 : 1
      ctx.fillStyle = KIND_COLORS[n.kind] || '#666'
      ctx.strokeStyle = css.getPropertyValue('--pd-bg').trim() || '#fff'
      ctx.lineWidth = 1.5 / G.s
      const r = n.r
      ctx.beginPath()
      if (n.kind === 'org') ctx.rect(n.x - r, n.y - r, 2 * r, 2 * r)
      else if (n.kind === 'tema') { ctx.moveTo(n.x, n.y - r * 1.2); ctx.lineTo(n.x + r * 1.2, n.y); ctx.lineTo(n.x, n.y + r * 1.2); ctx.lineTo(n.x - r * 1.2, n.y); ctx.closePath() }
      else if (n.kind === 'area') { ctx.moveTo(n.x, n.y - r * 1.2); ctx.lineTo(n.x + r * 1.1, n.y + r); ctx.lineTo(n.x - r * 1.1, n.y + r); ctx.closePath() }
      else ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()
      if (n.id === state.gsel) {
        ctx.strokeStyle = css.getPropertyValue('--pd-text').trim() || '#16181d'
        ctx.lineWidth = 2 / G.s
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 4 / G.s, 0, Math.PI * 2); ctx.stroke()
      }
      const showLabel = !dimmed && (n.n >= labelMin || n.id === focus || (nbrs && nbrs.has(n.id)) || G.s > 1.8)
      if (showLabel) {
        const fs = Math.max(9, Math.min(13, 9 + n.r * 0.3)) / G.s
        ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`
        ctx.textAlign = 'center'
        ctx.lineWidth = 3 / G.s
        ctx.strokeStyle = css.getPropertyValue('--pd-data-bg').trim() || '#f6f7f8'
        ctx.strokeText(n.label, n.x, n.y - n.r - 5 / G.s)
        ctx.fillStyle = css.getPropertyValue('--pd-text-muted').trim() || '#4a5361'
        ctx.fillText(n.label, n.x, n.y - n.r - 5 / G.s)
      }
      ctx.globalAlpha = 1
    }
  }

  function graphPos(ev) {
    const rect = $('#graph').getBoundingClientRect()
    return [(ev.clientX - rect.left - G.tx) / G.s, (ev.clientY - rect.top - G.ty) / G.s]
  }

  function nodeAt(x, y) {
    let best = null, bd = 1e9
    for (const n of G.nodes) {
      const d = Math.hypot(n.x - x, n.y - y)
      if (d < n.r + 6 / G.s && d < bd) { best = n; bd = d }
    }
    return best
  }

  function bindGraphEvents() {
    const c = $('#graph')
    c.addEventListener('pointerdown', (ev) => {
      const [x, y] = graphPos(ev)
      const n = nodeAt(x, y)
      G.drag = n ? { node: n, ox: x - n.x, oy: y - n.y } : { pan: true, sx: ev.clientX, sy: ev.clientY, tx: G.tx, ty: G.ty }
      G.moved = false
      c.classList.add('dragging')
      c.setPointerCapture(ev.pointerId)
    })
    c.addEventListener('pointermove', (ev) => {
      if (G.drag) {
        G.moved = true
        if (G.drag.node) {
          const [x, y] = graphPos(ev)
          G.drag.node.x = x - G.drag.ox
          G.drag.node.y = y - G.drag.oy
          G.alpha = Math.max(G.alpha, 0.25)
        } else {
          G.tx = G.drag.tx + ev.clientX - G.drag.sx
          G.ty = G.drag.ty + ev.clientY - G.drag.sy
        }
      } else {
        const [x, y] = graphPos(ev)
        const n = nodeAt(x, y)
        if (n !== G.hover) { G.hover = n; c.style.cursor = n ? 'pointer' : 'grab' }
      }
    })
    c.addEventListener('pointerup', (ev) => {
      c.classList.remove('dragging')
      if (G.drag && !G.moved) {
        const n = G.drag.node
        state.gsel = n && n.id !== state.gsel ? n.id : null
        writeHash(); renderFicha()
      }
      G.drag = null
    })
    c.addEventListener('wheel', (ev) => {
      ev.preventDefault()
      const rect = c.getBoundingClientRect()
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
      const k = ev.deltaY < 0 ? 1.15 : 1 / 1.15
      const ns = Math.min(4, Math.max(0.35, G.s * k))
      G.tx = mx - (mx - G.tx) * (ns / G.s)
      G.ty = my - (my - G.ty) * (ns / G.s)
      G.s = ns
    }, { passive: false })
    window.addEventListener('resize', () => { if (state.view === 'grafo') fitCanvas() })
  }

  function centerNode(entId) {
    initGraph()
    const n = G.byId && G.byId.get(entId)
    if (!n) return
    const c = $('#graph')
    G.s = Math.max(G.s, 1.1)
    G.tx = c.clientWidth / 2 - n.x * G.s
    G.ty = c.clientHeight / 2 - n.y * G.s
  }

  /* ---------- ficha de entidad ---------- */

  function sparkline(years, color) {
    const ks = Object.keys(years).map(Number)
    if (!ks.length) return ''
    const y0 = Math.min(...ks), y1 = Math.max(...ks)
    const span = Math.max(1, y1 - y0)
    const W = 260, H = 42, max = Math.max(...Object.values(years))
    const bw = Math.max(2, Math.min(10, W / (span + 1) - 1))
    let s = `<svg class="spark" viewBox="0 0 ${W} ${H + 14}" width="100%" role="img" aria-label="Normas por año, ${y0} a ${y1}">`
    for (const [yy, n] of Object.entries(years)) {
      const x = ((Number(yy) - y0) / span) * (W - bw)
      const h = Math.max(2, (n / max) * H)
      s += `<rect x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="1" fill="${color}"><title>${yy}: ${n}</title></rect>`
    }
    s += `<text x="0" y="${H + 11}" font-size="9" font-family="IBM Plex Mono,monospace" fill="var(--pd-text-faint)">${y0}</text>`
    s += `<text x="${W}" y="${H + 11}" font-size="9" text-anchor="end" font-family="IBM Plex Mono,monospace" fill="var(--pd-text-faint)">${y1}</text>`
    return s + '</svg>'
  }

  function renderFicha() {
    const el = $('#ficha')
    const e = state.gsel && entById.get(state.gsel)
    el.hidden = !e
    if (!e) { drawGraphSafe(); return }
    const dlist = (entDocs.get(e.id) || []).filter((d) => d.relevance !== 'fuera')
    const co = (e.top || []).map(([id, n]) => {
      const o = entById.get(id)
      return o ? `<button data-ent="${esc(id)}">${esc(o.label)} · ${n}</button>` : ''
    }).join('')
    el.innerHTML = `<button class="ficha-close" id="ficha-x" aria-label="Cerrar">×</button>
      <p class="ficha-kind">${KIND_LABELS[e.kind] || e.kind}</p>
      <h3>${esc(e.label)}</h3>
      <p class="ficha-stats">${fmt(e.n)} normas${e.first ? ` · ${e.first.slice(0, 7)} → ${e.last.slice(0, 7)}` : ''}</p>
      ${e.years ? sparkline(e.years, KIND_COLORS[e.kind]) : ''}
      ${co ? `<h4>Co-apariciones</h4><div class="co-chips">${co}</div>` : ''}
      <h4>Últimas normas</h4>
      <ul class="ficha-docs">${dlist.slice(0, 8).map((d) => `
        <li><button data-doc="${esc(d.doc_id)}"><span class="fd-fecha">${esc((d.fecha || 's/f').slice(0, 7))}</span>${esc(d.titulo || d.doc_id)}</button></li>`).join('')}
      </ul>
      <div class="ficha-actions">
        <button class="btn" id="ficha-cat">Ver las ${fmt(dlist.length)} en el catálogo →</button>
      </div>`
    $('#ficha-x').addEventListener('click', () => { state.gsel = null; update() })
    $('#ficha-cat').addEventListener('click', () => {
      state.ent = e.id; state.view = 'catalogo'; state.shown = 250
      state.rel = new Set([...SERIES, 'fuera'])
      update()
    })
    el.querySelectorAll('[data-ent]').forEach((b) =>
      b.addEventListener('click', () => { state.gsel = b.dataset.ent; update(); centerNode(b.dataset.ent) }))
    el.querySelectorAll('[data-doc]').forEach((b) =>
      b.addEventListener('click', () => openDoc(b.dataset.doc)))
  }

  function drawGraphSafe() { if (G.nodes.length) drawGraph() }

  /* ---------- señales ---------- */

  function docItem(id) {
    const d = byId.get(id)
    if (!d) return ''
    const comp = (d.e || []).filter((x) => x.startsWith('c:'))
      .map((x) => entById.get(x)).filter(Boolean).map((e) => e.label).slice(0, 2).join(', ')
    return `<li><button data-doc="${esc(id)}"><span class="s-meta">${esc((d.fecha || 's/f').slice(0, 7))}</span>
      ${comp ? `<strong>${esc(comp)}</strong> · ` : ''}${esc((d.titulo || '').slice(0, 80))}</button></li>`
  }

  function renderSenales() {
    if (!senales) return
    const s = senales
    const cards = []

    cards.push(`<div class="senal"><h3>Primeras apariciones</h3>
      <p class="senal-sub">empresas que un título oficial nombra por primera vez (24 meses)</p>
      <ul>${s.nuevos_jugadores.map((x) => `
        <li><button data-ent="${esc(x.id)}"><span class="s-meta">${esc(x.first.slice(0, 7))}</span>
        <strong>${esc(x.label)}</strong> · ${x.n} normas</button></li>`).join('')}</ul></div>`)

    const temaCard = (title, sub, card, entId) => `<div class="senal"><h3>${title}</h3>
      <p class="senal-big">${fmt(card.total)}</p><p class="senal-sub">${sub}</p>
      <ul>${card.docs.slice(0, 5).map(docItem).join('')}</ul>
      <ul><li><button data-entcat="${entId}">Ver todas en el catálogo →</button></li></ul></div>`

    cards.push(temaCard('RIGI', 'normas que lo mencionan, todo el período', s.rigi, 't:rigi'))
    cards.push(temaCard('Exportación', 'autorizaciones y normas de los últimos 12 meses', s.exportacion_12m, 't:exportacion'))
    cards.push(temaCard('GNL', 'normas de los últimos 24 meses', s.gnl, 't:gnl'))
    cards.push(temaCard('Cesiones', 'traspasos de titularidad, últimos 12 meses', s.cesiones_12m, 't:cesion'))
    cards.push(temaCard('Adjudicaciones', 'últimos 12 meses', s.adjudicaciones_12m, 't:adjudicacion'))
    cards.push(temaCard('Comercializadores', 'registro y autorizaciones, últimos 12 meses', s.comercializadores, 't:comercializacion'))

    cards.push(`<div class="senal"><h3>Más reguladas</h3>
      <p class="senal-sub">normas que las nombran en 12 meses (y en los 12 previos)</p>
      <ul>${s.mas_reguladas_12m.map((x) => `
        <li><button data-ent="${esc(x.id)}"><strong>${esc(x.label)}</strong>
        · ${x.n} <span class="s-meta">(antes ${x.prev})</span>
        ${x.n > x.prev ? '<span class="s-delta-up">↑</span>' : ''}</button></li>`).join('')}</ul></div>`)

    const grid = $('#senales-grid')
    grid.innerHTML = cards.join('')
    grid.querySelectorAll('[data-doc]').forEach((b) =>
      b.addEventListener('click', () => openDoc(b.dataset.doc)))
    grid.querySelectorAll('[data-ent]').forEach((b) =>
      b.addEventListener('click', () => openFicha(b.dataset.ent)))
    grid.querySelectorAll('[data-entcat]').forEach((b) =>
      b.addEventListener('click', () => {
        state.ent = b.dataset.entcat; state.view = 'catalogo'
        state.rel = new Set([...SERIES])
        update()
      }))
  }

  /* ---------- wiki ---------- */

  const CATS = {
    norms: 'Normas', agencies: 'Organismos', companies: 'Empresas', basins: 'Cuencas',
    areas: 'Áreas', infrastructure: 'Infraestructura', projects: 'Proyectos y EIAs',
    concepts: 'Conceptos', queries: 'Queries',
  }

  function renderWiki() {
    const nav = $('#wiki-nav')
    const groups = new Map()
    for (const p of wiki) {
      const cat = p.file.split('/')[0]
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat).push(p)
    }
    nav.innerHTML = [...groups.entries()].map(([cat, pages]) =>
      `<h4>${CATS[cat] || esc(cat)}</h4>` + pages.map((p) => {
        const key = p.file.replace(/\.md$/, '')
        return `<a href="#view=wiki&wp=${encodeURIComponent(key)}" data-wp="${esc(key)}"
          aria-current="${key === state.wikiPage ? 'page' : 'false'}">${esc(p.title || p.id)}</a>`
      }).join('')).join('')
    nav.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', (e) => { e.preventDefault(); state.wikiPage = a.dataset.wp; update() }))

    if (!state.wikiPage && wiki.length) state.wikiPage = wiki[0].file.replace(/\.md$/, '')
    if (state.wikiPage) loadWikiPage(state.wikiPage)
  }

  async function loadWikiPage(key) {
    const el = $('#wiki-page')
    if (!wikiCache.has(key)) {
      const r = await fetch(`data/wiki/${key}.md`)
      if (!r.ok) { el.innerHTML = '<p class="wiki-hint">Página no encontrada.</p>'; return }
      wikiCache.set(key, await r.text())
    }
    el.innerHTML = renderMd(wikiCache.get(key))
    el.querySelectorAll('a[data-wp]').forEach((a) =>
      a.addEventListener('click', (e) => { e.preventDefault(); state.wikiPage = a.dataset.wp; update() }))
  }

  function renderMd(src) {
    let meta = null
    if (src.startsWith('---\n')) {
      const end = src.indexOf('\n---\n', 4)
      if (end > 0) { meta = src.slice(4, end); src = src.slice(end + 5) }
    }
    const wikilink = (tgt, lbl) => wiki.some((p) => p.file.replace(/\.md$/, '') === tgt)
      ? `<a href="#" data-wp="${esc(tgt)}">${esc(lbl)}</a>`
      : `<span class="wl-pending" title="Página pendiente">${esc(lbl)}</span>`
    const cite = (ref) => {
      const m = ref.match(/^raw\/infoleg\/norms\/[^/]+\/(\d+)\.html(.*)$/)
      const d = m && byId.get(`infoleg-${m[1]}`)
      const inner = d && d.url
        ? `<a href="${esc(d.url.replace('http://', 'https://'))}" target="_blank" rel="noopener">${esc(ref)}</a>`
        : esc(ref)
      return `<span class="cite">(fuente: ${inner})</span>`
    }
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, tgt, lbl) => wikilink(tgt.trim(), lbl))
      .replace(/\[\[([^\]|]+)\]\]/g, (m, tgt) => wikilink(tgt.trim(), tgt.trim()))
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\(fuente: (raw\/[^)]+)\)/g, (m, ref) => cite(ref))

    const out = []
    let list = false, para = [], li = null
    const flushLi = () => { if (li !== null) { out.push(`<li>${inline(li)}</li>`); li = null } }
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = [] } }
    const closeList = () => { flushLi(); if (list) { out.push('</ul>'); list = false } }
    for (const line of src.split('\n')) {
      const l = line.trimEnd()
      if (/^#{1,3} /.test(l)) {
        flushPara(); closeList()
        const n = l.match(/^#+/)[0].length
        out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`)
      } else if (/^- /.test(l)) {
        flushPara(); flushLi()
        if (!list) { out.push('<ul>'); list = true }
        li = l.slice(2)
      } else if (l === '') {
        flushPara(); closeList()
      } else if (li !== null && /^\s+/.test(line)) {
        li += ' ' + l.trim()
      } else {
        closeList(); para.push(l)
      }
    }
    flushPara(); closeList()

    let metaHtml = ''
    if (meta) {
      const get = (k) => (meta.match(new RegExp(`^${k}: (.+)$`, 'm')) || [])[1]
      const bits = [get('type'), get('updated') && `actualizada ${get('updated')}`].filter(Boolean)
      metaHtml = `<p class="wiki-meta">${esc(bits.join(' · '))}</p>`
    }
    return metaHtml + out.join('\n')
  }

  load().catch((e) => { $('#list-count').textContent = `Error cargando datos: ${e.message}` })
})()
