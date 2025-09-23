// server/index.js
import 'dotenv/config'
import express from 'express'
import fetch from 'node-fetch'

const app = express()
app.use(express.json())

// ── Config ──────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001)
const API_BASE = process.env.DATADOG_API_BASE || 'https://api.datadoghq.com/api/v1'
const API_KEY  = process.env.DATADOG_API_KEY
const APP_KEY  = process.env.DATADOG_APP_KEY
const APP_BASE = process.env.DATADOG_APP_BASE || 'https://app.datadoghq.com'

// ── Healthcheck ─────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'datadog-proxy', port: PORT, ts: new Date().toISOString() })
})

// ── Helpers ─────────────────────────────────────────────────────────────
function mapMonitor(m) {
  return {
    id: m.id,
    name: m.name,
    overall_state: m?.overall_state ?? 'Unknown',
    tags: m?.tags ?? [],
    overall_url: `${APP_BASE}/monitors/${m.id}`, // enlace directo al monitor
  }
}

// ── Endpoint: Monitors v1 ───────────────────────────────────────────────
// Acepta ?name= (nuevo) y ?search= (compat) y ?tags=
app.get('/api/monitors', async (req, res) => {
  if (!API_KEY || !APP_KEY) {
    return res.status(500).json({ error: 'Faltan DATADOG_API_KEY / DATADOG_APP_KEY en server/.env' })
  }

  const name = (req.query.name || req.query.search || '').toString()
  const tags = (req.query.tags || '').toString()

  const params = new URLSearchParams()
  if (name) params.set('name', name)
  if (tags) params.set('tags', tags)

  const url = `${API_BASE}/monitor?${params.toString()}`
  try {
    console.log('[datadog] GET', url)
    const ddRes = await fetch(url, {
      headers: {
        'DD-API-KEY': API_KEY,
        'DD-APPLICATION-KEY': APP_KEY,
      },
    })

    const text = await ddRes.text()
    if (!ddRes.ok) {
      console.error('[datadog] ERROR', ddRes.status, text.slice(0, 300))
      return res.status(ddRes.status).json({ error: 'Datadog API error', status: ddRes.status, body: text })
    }

    let monitors = []
    try { monitors = JSON.parse(text) } catch { monitors = [] }
    const list = Array.isArray(monitors) ? monitors.map(mapMonitor) : []
    res.json({ monitors: list })
  } catch (err) {
    console.error('[datadog] EXCEPTION', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Robustez: que nada muera en silencio ────────────────────────────────
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e))
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e))

// ── Start ───────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[datadog-proxy] listening on http://localhost:${PORT}`)
  console.log(`[datadog-proxy] API_BASE=${API_BASE}`)
  console.log(`[datadog-proxy] APP_BASE=${APP_BASE}`)
})
