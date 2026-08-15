/* Explorador del catálogo normativo. Vanilla, sin dependencias.
   Datos: data/documents.jsonl (catálogo) + data/wiki.json + data/wiki/*.md (páginas). */
(() => {
  'use strict'

  const $ = (s) => document.querySelector(s)
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const fmt = (n) => n.toLocaleString('en-US')

  const SERIES = ['gas', 'petroleo', 'ambos', 'dudosa']            // orden fijo del stack
  const COLORS = { gas: '#1f6a9b', petroleo: '#c24b22', ambos: '#0f8a57', dudosa: '#94a3b8' }
  const LABELS = { gas: 'Gas', petroleo: 'Petróleo', ambos: 'Ambos', dudosa: 'Dudosa', fuera: 'Fuera de alcance' }
  const PRE = 1959                                                 // bucket "‹1960"

  const state = {
    q: '', org: '', tipo: '', anio: null, sel: null, shown: 250,
    rel: new Set(['gas', 'petroleo', 'ambos', 'dudosa']),          // 'fuera' apagado por defecto
    view: 'catalogo', wikiPage: null,
  }
  let docs = [], wiki = [], byId = new Map()
  const wikiCache = new Map()

  /* ---------- carga ---------- */

  async function load() {
    $('#list-count').textContent = 'Cargando el catálogo…'
    const [jsonl, wikiIdx] = await Promise.all([
      fetch('data/documents.jsonl').then((r) => r.text()),
      fetch('data/wiki.json').then((r) => r.json()).catch(() => []),
    ])
    docs = jsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    for (const d of docs) {
      d._s = norm([d.titulo, d.organismo, d.numero, d.tipo_norma, d.doc_id].join(' '))
      d._y = d.anio == null ? null : (d.anio < 1960 ? PRE : d.anio)
      byId.set(d.doc_id, d)
    }
    docs.sort((a, b) => (b.fecha || '') < (a.fecha || '') ? -1 : 1)
    wiki = wikiIdx
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
    const rel = [...state.rel].sort().join(',')
    if (rel !== 'ambos,dudosa,gas,petroleo') p.set('rel', rel)
    if (state.sel) p.set('doc', state.sel)
    if (state.view === 'wiki') p.set('view', 'wiki')
    if (state.wikiPage) p.set('wp', state.wikiPage)
    const h = p.toString()
    history.replaceState(null, '', h ? '#' + h : location.pathname)
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1))
    state.q = p.get('q') || ''
    state.org = p.get('org') || ''
    state.tipo = p.get('tipo') || ''
    state.anio = p.has('anio') ? Number(p.get('anio')) : null
    state.sel = p.get('doc') || null
    state.view = p.get('view') === 'wiki' ? 'wiki' : 'catalogo'
    state.wikiPage = p.get('wp') || null
    if (p.has('rel')) state.rel = new Set(p.get('rel').split(',').filter((r) => LABELS[r]))
    $('#f-q').value = state.q
    $('#f-org').value = state.org
    $('#f-tipo').value = state.tipo
  }

  /* ---------- filtros ---------- */

  function matches(d, { ignoreYear = false, ignoreRel = false } = {}) {
    if (!ignoreRel && !state.rel.has(d.relevance)) return false
    if (state.org && d.organismo !== state.org) return false
    if (state.tipo && d.tipo_norma !== state.tipo) return false
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
      Object.assign(state, { q: '', org: '', tipo: '', anio: null, shown: 250 })
      state.rel = new Set(SERIES)
      $('#f-q').value = ''; $('#f-org').value = ''; $('#f-tipo').value = ''
      update()
    })
    $('#list-more').addEventListener('click', () => { state.shown += 250; renderList() })
    document.querySelectorAll('.view-tab').forEach((b) =>
      b.addEventListener('click', () => { state.view = b.dataset.view; update() }))
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

  function update() { writeHash(); renderAll() }

  /* ---------- render ---------- */

  function renderAll() {
    $('#view-catalogo').hidden = state.view !== 'catalogo'
    $('#view-wiki').hidden = state.view !== 'wiki'
    document.querySelectorAll('.view-tab').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.view === state.view)))
    if (state.view === 'wiki') { renderWiki(); return }

    const counts = {}
    for (const r of [...SERIES, 'fuera']) counts[r] = 0
    for (const d of docs) if (matches(d, { ignoreRel: true })) counts[d.relevance]++
    document.querySelectorAll('#legend button').forEach((b) => {
      const r = b.dataset.rel
      b.setAttribute('aria-pressed', String(state.rel.has(r)))
      b.querySelector('.n').textContent = fmt(counts[r])
    })
    const active = state.q || state.org || state.tipo || state.anio != null ||
      [...state.rel].sort().join(',') !== 'ambos,dudosa,gas,petroleo'
    $('#f-clear').hidden = !active

    renderChart()
    renderList()
    renderDetail()
  }

  /* Histograma apilado por año. Muestra solo las series con matiz + dudosa;
     'fuera' queda para la lista. Gaps de 2px entre segmentos y barras. */
  function renderChart() {
    const years = [PRE]
    for (let y = 1960; y <= 2026; y++) years.push(y)
    const idx = new Map(years.map((y, i) => [y, i]))
    const data = years.map(() => ({ gas: 0, petroleo: 0, ambos: 0, dudosa: 0 }))
    for (const d of docs) {
      if (d._y == null || !SERIES.includes(d.relevance)) continue
      if (!matches(d, { ignoreYear: true })) continue
      if (!state.rel.has(d.relevance)) continue
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
      if (yy !== PRE && (yy % 10 !== 0 || yy === 1960)) continue  // 1960 pisa a "‹1960"
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
        const h = Math.max(0, y0 - y1 - (acc ? 2 : 0))     // 2px de aire entre segmentos
        if (h > 0) segs.push(`<rect x="${x}" y="${y1}" width="${barW}" height="${h}" rx="1.5" fill="${COLORS[k]}"/>`)
        acc += v
      }
      const selected = state.anio === yy
      if (selected) segs.push(`<rect x="${x - 1.5}" y="${y(acc) - 3}" width="${barW + 3}" height="3" rx="1.5" fill="var(--pd-text)"/>`)
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
    $('.results').classList.toggle('has-detail', !!d)
    el.hidden = !d
    if (!d) return
    const rows = [
      ['Fecha', d.fecha || 's/f'], ['Organismo', d.organismo],
      ['Tipo', d.tipo_norma], ['Número', d.numero],
      ['Relevancia', LABELS[d.relevance] || d.relevance],
      ['Estado', d.state === 'ingested' ? 'ingerida al wiki' : d.state],
      ['ID', d.doc_id],
    ].filter(([, v]) => v)
    const wikiBtn = d.wiki_page
      ? `<button class="btn" id="d-wiki">Página del wiki →</button>` : ''
    el.innerHTML = `<button class="detail-close" id="d-close" aria-label="Cerrar">×</button>
      <h3>${esc(d.titulo || d.doc_id)}</h3>
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${d.resumen ? `<p style="font-size:var(--pd-fs-sm)">${esc(d.resumen)}</p>` : ''}
      <div class="detail-actions">
        ${d.url ? `<a class="btn btn--primary" href="${esc(d.url.replace('http://', 'https://'))}" target="_blank" rel="noopener">Texto oficial (InfoLEG) ↗</a>` : ''}
        ${wikiBtn}
      </div>`
    $('#d-close').addEventListener('click', () => { state.sel = null; update() })
    if (d.wiki_page) $('#d-wiki').addEventListener('click', () => {
      state.view = 'wiki'
      state.wikiPage = d.wiki_page.replace(/^wiki\//, '').replace(/\.md$/, '')
      update()
    })
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

  /* Mini-markdown para el schema acotado del wiki: headings, listas, negrita,
     código, links, [[wikilinks]] y citas (fuente: raw/...). */
  function renderMd(src) {
    let meta = null
    if (src.startsWith('---\n')) {
      const end = src.indexOf('\n---\n', 4)
      if (end > 0) { meta = src.slice(4, end); src = src.slice(end + 5) }
    }
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, tgt, lbl) => wikilink(tgt.trim(), lbl))
      .replace(/\[\[([^\]|]+)\]\]/g, (m, tgt) => wikilink(tgt.trim(), tgt.trim()))
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\(fuente: (raw\/[^)]+)\)/g, (m, ref) => cite(ref))
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

    /* Cada bloque (párrafo o ítem) se acumula entero antes de aplicar inline(),
       para que una cita partida en dos líneas del .md siga matcheando. */
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
