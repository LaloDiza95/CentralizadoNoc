# Datadog Dashboard Starter (React + Express Proxy)

Frontend en React (Vite) y backend en Node/Express como **proxy seguro** para consumir la API de Datadog sin exponer tus llaves en el navegador.

## Estructura
```text
datadog-dashboard-starter/
├─ client/          # Vite + React
│  ├─ src/
│  │  ├─ App.jsx
│  │  ├─ main.jsx
│  │  └─ styles.css
│  ├─ index.html
│  └─ package.json
└─ server/          # Node + Express
   ├─ index.js
   ├─ .env.example  # copia a .env y rellena llaves
   └─ package.json
```

## Requisitos
- Node 18+
- Llaves de Datadog: **DATADOG_API_KEY** y **DATADOG_APP_KEY** (no las pongas en el cliente).

## Pasos de arranque
1) Instalar deps
```bash
cd server && npm i
cd ../client && npm i
```

2) Configurar llaves en el server
```bash
cd server
cp .env.example .env
# edita .env y coloca tus llaves reales
```

3) Levantar el proxy
```bash
cd server
npm run dev
# escuchando en http://localhost:3001
```

4) Levantar el frontend
```bash
cd client
npm run dev
# abre http://localhost:5173
```

## Uso básico en el UI
- Caja de **Buscar por nombre** → filtra por `name` de monitor
- **Filtrar por tags** → usa tags separados por comas (por ej: `env:prod,service:payments`)
- La tabla muestra el `overall_state` de cada monitor (OK/Warn/Alert/NoData/Unknown) y un enlace para abrir en Datadog.

## Notas
- El servidor usa el endpoint v1 `/api/v1/monitor`. Si necesitas v2 u otros recursos (incidents, metrics, monitors/search), agrega rutas nuevas en `server/index.js`.
- Si tu organización usa `datadoghq.eu` u otro sitio, cambia `DATADOG_API_BASE` en `.env` (server).
- Mantener llaves **solo** en el server protege tu App Key: nunca la envíes al navegador.
- Para despliegue, corre ambos servicios detrás de un reverse proxy o sirve el build del cliente desde el mismo Node server (agrega middleware `express.static` si lo deseas).
# CentralizadoNoc
# CentralizadoNoc
# CentralizadoNoc
