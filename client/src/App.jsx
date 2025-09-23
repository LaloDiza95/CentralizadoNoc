import React, { useEffect, useMemo, useRef, useState } from "react";

/* =========================================================
   Helpers
   ========================================================= */

// Tags que NO deben mostrarse en la vista principal (comparación en lowercase)
const EXCLUDED_TAGS = [
  "excludemonitor:yes",
  "initiative:common-user-journeys",
  "only_noc", // tu tag suele llegar como "Only_Noc"; lo normalizamos
];

// ¿tiene un tag excluido?
function hasExcludedTag(tags = []) {
  const low = (tags || []).map((t) => t.toLowerCase());
  return EXCLUDED_TAGS.some((x) => low.includes(x));
}

// prioridad desde tag "priority:p1..p5" (default P3)
function priorityFromTags(tags = []) {
  const t = (tags || []).find((x) => /^priority:p[1-5]$/i.test(x));
  return t ? t.split(":", 2)[1].toUpperCase() : "P3";
}
const prioOrder = (p) => ["P1", "P2", "P3", "P4", "P5"].indexOf((p || "").toUpperCase());

// “hace X tiempo” (para Triggered de sesión)
function since(ts) {
  if (!ts) return "—";
  const d = Date.now() - new Date(ts).getTime();
  const s = Math.floor(d / 1000),
    m = Math.floor(s / 60),
    h = Math.floor(m / 60),
    days = Math.floor(h / 24);
  if (days > 0) return `${days}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

// input con debounce sencillo (para búsqueda)
function useDebouncedValue(value, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

/* =========================================================
   Column component (circle header + table)
   ========================================================= */

function StateColumn({ state, items, alertFirstSeen }) {
  const color = state === "Alert" ? "alert" : state === "Warn" ? "warn" : "ok";

  const sorted = items
    .slice()
    .sort(
      (a, b) =>
        prioOrder(priorityFromTags(a.tags)) - prioOrder(priorityFromTags(b.tags)) ||
        (a.name || "").localeCompare(b.name || "")
    );

  return (
    <div className="stateCard">
      <div className="stateHeader">
        <div className={`circle ${color}`}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{state}</div>
          <div style={{ fontSize: 46, lineHeight: "46px", fontWeight: 900 }}>{sorted.length}</div>
        </div>
      </div>

      <div className="stateTable">
        <div className="stateHead">
          <div>PRIORITY</div>
          <div>STATUS</div>
          <div>MONITOR NAME</div>
          <div>TRIGGERED</div>
        </div>

        {sorted.map((m) => (
          <div key={m.id} className="stateRow">
            <div>{priorityFromTags(m.tags)}</div>
            <div>
              <span className={`pill ${(m.overall_state || "").toLowerCase()}`}>
                {m.overall_state || "Unknown"}
              </span>
            </div>
            <div>
              <a className="link" href={m.overall_url || "#"} target="_blank" rel="noreferrer">
                {m.name}
              </a>
            </div>
            <div className="cell-muted" title={alertFirstSeen[m.id] || ""}>
              {state === "OK" ? "—" : since(alertFirstSeen[m.id])}
            </div>
          </div>
        ))}

        {sorted.length === 0 && <div className="empty">No monitors</div>}
      </div>
    </div>
  );
}

/* =========================================================
   Main App
   ========================================================= */

export default function App() {
  // datos crudos desde el backend
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // filtros sencillos
  const [q, setQ] = useState(""); // búsqueda por nombre
  const qDeb = useDebouncedValue(q, 350);

  // Triggered “primera vez visto en sesión” para Alert/Warn
  const [alertFirstSeen, setAlertFirstSeen] = useState({}); // { [id]: ISO }

  // auto-refresh
  const [autorefresh, setAutorefresh] = useState(true);
  const timerRef = useRef(null);

  // Fetch monitores
  async function load() {
    try {
      setLoading(true);
      setErr("");
      const res = await fetch("/api/monitors"); // el proxy de Vite redirige a 3001
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      // si tu server devuelve {monitors:[...]} en lugar de array
      const arr = Array.isArray(list) ? list : list.monitors || [];
      setData(arr);
    } catch (e) {
      setErr(e.message || "Error loading monitors");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!autorefresh) return;
    timerRef.current = setInterval(load, 60_000);
    return () => clearInterval(timerRef.current);
  }, [autorefresh]);

  // búsqueda + EXCLUSIONES (antes de todo)
  const filtered = useMemo(() => {
    let arr = data.filter((m) => !hasExcludedTag(m.tags));
    if (qDeb.trim()) {
      const s = qDeb.trim().toLowerCase();
      arr = arr.filter(
        (m) =>
          (m.name || "").toLowerCase().includes(s) ||
          (m.tags || []).some((t) => t.toLowerCase().includes(s))
      );
    }
    return arr;
  }, [data, qDeb]);

  // partición por estado
  const { alerts, warns, oks } = useMemo(() => {
    const out = { alerts: [], warns: [], oks: [] };
    for (const m of filtered) {
      const s = m.overall_state || "Unknown";
      if (s === "Alert") out.alerts.push(m);
      else if (s === "Warn") out.warns.push(m);
      else if (s === "OK") out.oks.push(m);
    }
    return out;
  }, [filtered]);

  // registrar “primera vez visto en sesión” (para Alert/Warn)
  useEffect(() => {
    if (![...alerts, ...warns].length) return;
    const now = new Date().toISOString();
    setAlertFirstSeen((prev) => {
      const copy = { ...prev };
      for (const m of [...alerts, ...warns]) if (!copy[m.id]) copy[m.id] = now;
      return copy;
    });
  }, [alerts, warns]);

  // KPIs simples
  const stats = useMemo(() => {
    const by = { OK: 0, Warn: 0, Alert: 0, NoData: 0, Unknown: 0 };
    for (const m of filtered) by[m.overall_state || "Unknown"] = (by[m.overall_state || "Unknown"] || 0) + 1;
    return { total: filtered.length, byState: by };
  }, [filtered]);

  return (
    <div className="container">
      {/* header */}
      <header className="sticky">
        <h1>Dashboard Centralizado · v2.0</h1>
        <div className="hint">Front-end React + Proxy Node (keys seguras en el server)</div>
      </header>

      {/* toolbar */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="toolbar">
          <input
            placeholder="Buscar por nombre o tag…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button onClick={load} disabled={loading}>
            {loading ? "Cargando…" : "Refrescar"}
          </button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={autorefresh}
              onChange={(e) => setAutorefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <div style={{ marginLeft: "auto", opacity: 0.85 }}>
            Total: <b>{stats.total}</b> · Alert: <b>{stats.byState.Alert || 0}</b> · Warn:{" "}
            <b>{stats.byState.Warn || 0}</b> · OK: <b>{stats.byState.OK || 0}</b>
          </div>
        </div>
        {err && <div className="help">Error: {err}</div>}
      </div>

      {/* tablero 3 columnas */}
      <div className="board">
        <StateColumn state="Alert" items={alerts} alertFirstSeen={alertFirstSeen} />
        <StateColumn state="Warn" items={warns} alertFirstSeen={alertFirstSeen} />
        <StateColumn state="OK" items={oks} alertFirstSeen={alertFirstSeen} />
      </div>

      {/* loading skeleton simple */}
      {loading && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton"></div>
          ))}
        </div>
      )}

      {/* empty state */}
      {!loading && stats.total === 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty">Sin resultados (o todos fueron excluidos por tags).</div>
        </div>
      )}
    </div>
  );
}
