import React, { useEffect, useMemo, useRef, useState } from 'react'

function StatusPill({ state }) {
  const map = { OK: 'ok', Warn: 'warn', Alert: 'alert', NoData: 'warn', Unknown: 'warn' }
  const cls = map[state] || 'warn'
  return <span className={['pill', cls].join(' ')}>{state}</span>
}

function useDebouncedValue(value, delay = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(()=>setV(value), delay); return ()=>clearTimeout(t) }, [value, delay])
  return v
}

function useQueryState() {
  // restaura desde URL y localStorage
  const params = new URLSearchParams(location.search)
  const [search, setSearch] = useState(params.get('q') ?? localStorage.getItem('q') ?? '')
  const [tags, setTags] = useState(params.get('tags') ?? localStorage.getItem('tags') ?? '')
  const [stateFilter, setStateFilter] = useState(params.get('state') ?? localStorage.getItem('state') ?? 'ALL')
  const [onlyProd, setOnlyProd] = useState((params.get('prod') ?? localStorage.getItem('prod') ?? '0') === '1')
  const [hideOK, setHideOK] = useState((params.get('hideok') ?? localStorage.getItem('hideok') ?? '0') === '1')
  const [pageSize, setPageSize] = useState(Number(params.get('ps') ?? localStorage.getItem('ps') ?? 50))
  const [page, setPage] = useState(Number(params.get('p') ?? 1))

  // persiste en URL + localStorage
  useEffect(() => {
    const p = new URLSearchParams()
    if (search) p.set('q', search)
    if (tags) p.set('tags', tags)
    if (stateFilter !== 'ALL') p.set('state', stateFilter)
    if (onlyProd) p.set('prod', '1')
    if (hideOK) p.set('hideok', '1')
    if (pageSize !== 50) p.set('ps', String(pageSize))
    if (page !== 1) p.set('p', String(page))
    history.replaceState(null, '', '?' + p.toString())
    localStorage.setItem('q', search)
    localStorage.setItem('tags', tags)
    localStorage.setItem('state', stateFilter)
    localStorage.setItem('prod', onlyProd ? '1' : '0')
    localStorage.setItem('hideok', hideOK ? '1' : '0')
    localStorage.setItem('ps', String(pageSize))
  }, [search, tags, stateFilter, onlyProd, hideOK, pageSize, page])

  return { search, setSearch, tags, setTags, stateFilter, setStateFilter, onlyProd, setOnlyProd, hideOK, setHideOK, pageSize, setPageSize, page, setPage }
}

function useMonitors(query, { autoRefresh, refreshMs }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState([])

  const debouncedSearch = useDebouncedValue(query.search, 300)
  const debouncedTags = useDebouncedValue(query.tags, 300)

  async function fetchData(signal) {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('name', debouncedSearch)
      if (debouncedTags) params.set('tags', debouncedTags)
      const res = await fetch('/api/monitors?' + params.toString(), { signal })
      if (!res.ok) throw new Error('Server error ' + res.status)
      const payload = await res.json()
      setData(payload.monitors || [])
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // primera carga y cuando cambian filtros
  useEffect(() => {
    const ctrl = new AbortController()
    fetchData(ctrl.signal)
    return () => ctrl.abort()
  }, [debouncedSearch, debouncedTags])

  // auto-refresh
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => fetchData(), refreshMs)
    return () => clearInterval(id)
  }, [autoRefresh, refreshMs, debouncedSearch, debouncedTags])

  return { loading, error, data, reload: fetchData }
}

export default function App() {
  // estado de filtros y UI
  const {
    search, setSearch, tags, setTags,
    stateFilter, setStateFilter,
    onlyProd, setOnlyProd,
    hideOK, setHideOK,
    pageSize, setPageSize,
    page, setPage
  } = useQueryState()

  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshMs, setRefreshMs] = useState(30000) // 30s
  const searchRef = useRef(null)

  const { loading, error, data } = useMonitors(
    { search, tags: onlyProd ? [tags, 'env:production'].filter(Boolean).join(',') : tags },
    { autoRefresh, refreshMs }
  )

  // atajo: "s" enfoca input de búsqueda
  useEffect(() => {
    const onKey = (e) => { if (e.key === 's' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ordenar por severidad
  const severityOrder = { Alert: 0, Warn: 1, NoData: 2, Unknown: 3, OK: 4 }
  // filtrado por estado + ocultar OK
  const filtered = useMemo(() => {
    let arr = data
    if (stateFilter !== 'ALL') arr = arr.filter(m => (m.overall_state || 'Unknown') === stateFilter)
    if (hideOK) arr = arr.filter(m => (m.overall_state || 'Unknown') !== 'OK')
    // sort por severidad y luego nombre
    return arr.slice().sort((a, b) => {
      const sa = severityOrder[a.overall_state || 'Unknown'] ?? 9
      const sb = severityOrder[b.overall_state || 'Unknown'] ?? 9
      if (sa !== sb) return sa - sb
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [data, stateFilter, hideOK])

  // agrupar por service:*
  function extractService(tagsArr) {
    const t = tagsArr || []
    const s = t.find(x => x.startsWith('service:'))
    return s ? s.split(':',2)[1] : 'sin-service'
  }
  const groups = useMemo(() => {
    const g = new Map()
    for (const m of filtered) {
      const svc = extractService(m.tags)
      if (!g.has(svc)) g.set(svc, [])
      g.get(svc).push(m)
    }
    return Array.from(g.entries()).sort((a,b)=>a[0].localeCompare(b[0]))
  }, [filtered])

  // KPIs
  const stats = useMemo(() => {
    const total = filtered.length
    const byState = { OK:0, Warn:0, Alert:0, NoData:0, Unknown:0 }
    for (const m of filtered) {
      const st = m.overall_state || 'Unknown'
      byState[st] = (byState[st] || 0) + 1
    }
    return { total, byState }
  }, [filtered])

  // paginación en cliente
  const visibleGroups = useMemo(() => {
    // aplanar por orden de grupos conservando items
    const flat = []
    for (const [, items] of groups) for (const it of items) flat.push(it)
    const slice = flat.slice(0, page * pageSize)
    // volver a reagrupar lo visible para render
    const g = new Map()
    for (const m of slice) {
      const svc = extractService(m.tags)
      if (!g.has(svc)) g.set(svc, [])
      g.get(svc).push(m)
    }
    return Array.from(g.entries())
  }, [groups, page, pageSize])

  const canLoadMore = useMemo(() => {
    let total = 0
    for (const [, items] of groups) total += items.length
    return page * pageSize < total
  }, [groups, page, pageSize])

  return (
    <div className="container">
      <header>
        <h1>Dashboard Centralizado Kueski · v2.0</h1>
        <div className="hint">Front-end React + Proxy Node (keys seguras en el server)</div>
      </header>

      <div className="controls toolbar">
        <input
          ref={searchRef}
          placeholder="Buscar por nombre… (atajo: s)"
          value={search}
          onChange={(e)=>{ setSearch(e.target.value); setPage(1) }}
        />
        <input
          placeholder="Filtrar por tags (comma-separated)"
          value={tags}
          onChange={(e)=>{ setTags(e.target.value); setPage(1) }}
        />

        <div className="state-chips">
          {['ALL','OK','Warn','Alert','NoData','Unknown'].map(s => (
            <div
              key={s}
              className={'chip ' + (stateFilter === s ? 'active' : '')}
              onClick={()=>{ setStateFilter(s); setPage(1) }}
              title={"Filtrar: " + s}
            >
              {s}
            </div>
          ))}
        </div>

        <label className="switch">
          <input type="checkbox" checked={onlyProd} onChange={e=>{ setOnlyProd(e.target.checked); setPage(1) }} />
          Solo producción (env:production)
        </label>

        <label className="switch">
          <input type="checkbox" checked={hideOK} onChange={e=>{ setHideOK(e.target.checked); setPage(1) }} />
          Ocultar OK
        </label>

        <select value={pageSize} onChange={e=>{ setPageSize(Number(e.target.value)); setPage(1) }}>
          <option value={25}>25 por página</option>
          <option value={50}>50 por página</option>
          <option value={100}>100 por página</option>
          <option value={200}>200 por página</option>
        </select>

        <button onClick={()=>{ setSearch(''); setTags(''); setStateFilter('ALL'); setOnlyProd(false); setHideOK(false); setPage(1) }}>Limpiar</button>

        <label className="switch" title="Auto-refresh cada 30s">
          <input type="checkbox" checked={autoRefresh} onChange={e=>setAutoRefresh(e.target.checked)} />
          Auto-refresh 30s
        </label>
      </div>

      <div className="grid">
        <div className="card" style={{gridColumn:'span 4'}}>
          <div className="stat">
            <div className="label">Total Monitors</div>
            <div className="kpi">{stats.total}</div>
          </div>
        </div>
        <div className="card" style={{gridColumn:'span 8'}}>
          <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
            <div className="stat"><div className="label">OK</div><div className="kpi"> {stats.byState.OK || 0}</div></div>
            <div className="stat"><div className="label">Warn</div><div className="kpi"> {stats.byState.Warn || 0}</div></div>
            <div className="stat"><div className="label">Alert</div><div className="kpi"> {stats.byState.Alert || 0}</div></div>
            <div className="stat"><div className="label">NoData</div><div className="kpi"> {stats.byState.NoData || 0}</div></div>
            <div className="stat"><div className="label">Unknown</div><div className="kpi"> {stats.byState.Unknown || 0}</div></div>
          </div>
        </div>
      </div>

      <div className="card" style={{marginTop:16}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
          <div>Monitores</div>
          {loading && <div className="help">Cargando…</div>}
          {error && <div className="help">Error: {error}</div>}
        </div>

        {visibleGroups.map(([svc, items]) => (
          <div key={svc} className="section">
            <h3>service: {svc === 'sin-service' ? '(sin tag service:*)' : svc} · {items.length}</h3>
            <div className="list">
              {items.map(m => (
                <div key={m.id} className="row">
                  <div className="name">
                    <span className={"status-dot status-" + (m.overall_state?.toLowerCase() || 'warn')}></span>
                    {m.name}
                    <div><small>{m.tags?.join(', ')}</small></div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <StatusPill state={m.overall_state || 'Unknown'} />
                  </div>
                  <div style={{textAlign:'right'}}>
                    <a href={m.overall_url || '#'} target="_blank" rel="noreferrer">Abrir en Datadog</a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {!loading && visibleGroups.length === 0 && <div className="help">Sin resultados. Ajusta filtros.</div>}

        {canLoadMore && (
          <div style={{marginTop:12, display:'flex', justifyContent:'center'}}>
            <button onClick={()=>setPage(p => p + 1)}>Cargar más</button>
          </div>
        )}
      </div>

      <div className="footer">
        Usa <code>server/.env</code> para llaves y región. Cambia <code>DATADOG_APP_BASE</code> si usas EU/US3/US5/AP1.
      </div>
    </div>
  )
}
