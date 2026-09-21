// ============================================================
// SupplyMind — Cliente de IA
// Habla con el mismo Worker de Cloudflare que ya usas para
// GitHub, pero por la ruta /ia — ahí vive de forma segura la
// llave de Anthropic, nunca en el navegador.
// ============================================================

function urlWorkerIA() {
  const base = window.GitHubSync ? window.GitHubSync.WORKER_URL : null;
  if (!base || base.includes('TU-SUBDOMINIO')) {
    throw new Error('Falta configurar la URL del Worker (la misma que usas para GitHub, en github-sync.js).');
  }
  return base.replace(/\/$/, '') + '/ia';
}

async function llamarIA(modo, payload) {
  const res = await fetch(urlWorkerIA(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modo, ...payload }),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw new Error(`Error de IA (${res.status}): ${texto}`);
  }
  const data = await res.json();
  return data.respuesta;
}

/** Pregúntale a tus datos — pregunta libre + un resumen del estado actual. */
async function preguntarIA(pregunta, contexto) {
  return llamarIA('chat', { pregunta, contexto });
}

/** Explicación automática de un material puntual. */
async function explicarConIA(contexto) {
  return llamarIA('explicar', { contexto });
}

window.IAClient = { preguntarIA, explicarConIA };
