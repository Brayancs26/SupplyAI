// ============================================================
// GITHUB SYNC — Inventario Cíclico usa el propio repo como base
// de datos: el programa y los resultados de conteo se guardan
// como archivos JSON dentro de la carpeta conteo/.
// ============================================================

const GH_CONFIG_KEY = 'inventario_ciclico_gh_config';
const RUTA_PROGRAMA = 'conteo/programa.json';
const RUTA_RESULTADOS = 'conteo/resultados';

function obtenerConfigGitHub() {
  const raw = localStorage.getItem(GH_CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}
function guardarConfigGitHub(owner, repo, token, branch) {
  localStorage.setItem(GH_CONFIG_KEY, JSON.stringify({ owner, repo, token, branch: branch || 'main' }));
}

function detectarRepoDesdeURL() {
  const host = window.location.hostname;
  const path = window.location.pathname;
  if (host.endsWith('.github.io')) {
    const owner = host.split('.')[0];
    const partes = path.split('/').filter(Boolean);
    const repo = partes[0];
    if (owner && repo) return { owner, repo, branch: 'main' };
  }
  return null;
}

function configEfectiva() {
  const guardada = obtenerConfigGitHub();
  const detectada = detectarRepoDesdeURL();
  return {
    owner: (guardada && guardada.owner) || (detectada && detectada.owner) || '',
    repo: (guardada && guardada.repo) || (detectada && detectada.repo) || '',
    branch: (guardada && guardada.branch) || 'main',
    token: (guardada && guardada.token) || '',
  };
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Lee un archivo JSON público del repo, directo de raw.githubusercontent —
 * no necesita token, funciona igual en el celular del personal.
 */
async function leerJSONPublico(ruta) {
  const cfg = configEfectiva();
  if (!cfg.owner || !cfg.repo) throw new Error('No se detectó el repositorio (usuario/repo).');
  const url = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${ruta}?_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

/**
 * URL del Worker de Cloudflare que guarda de forma segura — reemplázala por
 * la tuya después de desplegarlo (ver instrucciones). Mientras esté vacía,
 * la app avisa que falta configurar el Worker en vez de fallar en silencio.
 */
const WORKER_URL = 'https://billowing-union-4c0dsupplymind.bryancardenassilva.workers.dev';

/**
 * Escribe (crea o actualiza) un archivo JSON en el repo — pasa por el
 * Worker, que es quien realmente tiene el token de GitHub. Ningún
 * navegador necesita configurar nada.
 */
async function escribirJSON(ruta, objeto, mensaje) {
  if (!WORKER_URL || WORKER_URL.includes('TU-SUBDOMINIO')) {
    throw new Error('Falta configurar la URL del Worker en github-sync.js (WORKER_URL).');
  }
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: ruta, content: objeto, message: mensaje }),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw new Error(`Error guardando (${res.status}): ${texto}`);
  }
  return res.json();
}

/**
 * Lista los archivos dentro de una carpeta del repo (para leer todos los
 * conteos guardados). Funciona sin token en repos públicos.
 */
async function listarCarpeta(ruta) {
  const cfg = configEfectiva();
  if (!cfg.owner || !cfg.repo) throw new Error('No se detectó el repositorio (usuario/repo).');
  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${ruta}?ref=${cfg.branch}`;
  const res = await fetch(apiUrl, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return [];
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`No se pudo listar ${ruta} (${res.status}): ${err.message || ''}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data.filter((f) => f.type === 'file' && f.name.endsWith('.json')) : [];
}

async function leerVariosJSON(archivos) {
  const resultados = await Promise.all(
    archivos.map(async (f) => {
      try {
        const res = await fetch(f.download_url, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    })
  );
  return resultados.filter(Boolean);
}

window.GitHubSync = {
  WORKER_URL,
  RUTA_PROGRAMA,
  RUTA_RESULTADOS,
  obtenerConfigGitHub,
  guardarConfigGitHub,
  detectarRepoDesdeURL,
  configEfectiva,
  leerJSONPublico,
  escribirJSON,
  listarCarpeta,
  leerVariosJSON,
};
