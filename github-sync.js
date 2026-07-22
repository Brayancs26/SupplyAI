// ============================================================
// GITHUB SYNC — usa el propio repo de GitHub como "backend":
// - Publicar (solo el dueño, con su token): sube un JSON con los
//   resultados calculados vía la API de contenidos de GitHub.
// - Leer (cualquiera con el link): descarga ese JSON directo de
//   raw.githubusercontent.com, sin token, sin login.
// ============================================================

const GH_CONFIG_KEY = 'github_publish_config';
const RUTA_SNAPSHOT = 'data/snapshot.json';

function obtenerConfigGitHub() {
  const raw = localStorage.getItem(GH_CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}
function guardarConfigGitHub(owner, repo, token, branch) {
  localStorage.setItem(GH_CONFIG_KEY, JSON.stringify({ owner, repo, token, branch: branch || 'main' }));
}
function borrarConfigGitHub() {
  localStorage.removeItem(GH_CONFIG_KEY);
}

/**
 * Si la página está corriendo en GitHub Pages (usuario.github.io/repo/),
 * deduce el usuario y el repo directo de la URL — así cualquiera que abra
 * el link puede LEER el snapshot publicado sin configurar nada.
 */
function detectarRepoDesdeURL() {
  const host = window.location.hostname;
  const path = window.location.pathname;
  if (host.endsWith('.github.io')) {
    const owner = host.split('.')[0];
    const repo = path.split('/').filter(Boolean)[0];
    if (owner && repo) return { owner, repo, branch: 'main' };
  }
  return null;
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Publica el snapshot actual en el repo (requiere token con permiso de
 * escritura sobre ESE repo — ver panel "Compartir" en la app).
 */
async function publicarSnapshot(payload) {
  const cfg = obtenerConfigGitHub();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    throw new Error('Falta configurar GitHub (usuario, repositorio y token) en la pestaña Compartir.');
  }

  const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${RUTA_SNAPSHOT}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' };

  let sha = null;
  const getRes = await fetch(`${apiUrl}?ref=${cfg.branch}`, { headers });
  if (getRes.status === 200) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error(`No se pudo verificar el archivo existente (${getRes.status}): ${err.message || ''}`);
  }

  const body = {
    message: `Publicar snapshot ${new Date().toISOString()}`,
    content: utf8ToBase64(JSON.stringify(payload)),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(`Error publicando (${putRes.status}): ${err.message || ''}`);
  }
  return putRes.json();
}

/**
 * Lee el snapshot publicado — SIN token, funciona para cualquier visitante
 * mientras el repo sea público.
 */
async function obtenerSnapshotPublicado(owner, repo, branch) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch || 'main'}/${RUTA_SNAPSHOT}?_=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

window.GitHubSync = {
  obtenerConfigGitHub,
  guardarConfigGitHub,
  borrarConfigGitHub,
  detectarRepoDesdeURL,
  publicarSnapshot,
  obtenerSnapshotPublicado,
};
