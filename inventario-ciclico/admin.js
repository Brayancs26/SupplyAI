// ============================================================
// ADMIN — Resultados de conteo y configuración de GitHub.
// "Programar" se movió a Abastecimiento → Reportes de Inventario.
// ============================================================

const state = { resultados: [] };

const fmtNum = (n, dec = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString('es-PE', { maximumFractionDigits: dec, minimumFractionDigits: dec });

// ---------------- TABS ----------------
function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ---------------- ESTADO DE INVENTARIOS ENVIADOS ----------------
const TIPOS_ENVIO = [
  { tipo: 'combustibles', titulo: 'Combustible' },
  { tipo: 'gases', titulo: 'Balones de Gases' },
  { tipo: 'iqbf', titulo: 'IQBF (Insumos Químicos)' },
];
const fmtFechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function urlConteo(tipo) {
  return new URL(`index.html?tipo=${tipo}`, window.location.href).href;
}
function urlVer(tipo) {
  return new URL(`index.html?tipo=${tipo}&ver=1`, window.location.href).href;
}
function iconosEnlace(tipo) {
  const url = urlConteo(tipo);
  return `<a class="icono-enlace" href="${url}" target="_blank" rel="noopener" title="Abrir el enlace de conteo de esta toma" aria-label="Abrir enlace de conteo">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></a>
    <a class="icono-enlace" href="${urlVer(tipo)}" target="_blank" rel="noopener" title="Ver el avance del operario en vivo (solo lectura)" aria-label="Ver en vivo">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>
    <button type="button" class="icono-enlace btn-copiar-enlace" data-url="${url}" title="Copiar el enlace para enviarlo" aria-label="Copiar enlace">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>`;
}

async function cargarEstadoEnvios() {
  const tbody = document.getElementById('tabla-estado-envios-body');
  const filas = await Promise.all(
    TIPOS_ENVIO.map(async (t) => {
      try {
        const [datos, estado] = await Promise.all([
          GitHubSync.leerJSONFresco(`conteo/especiales/${t.tipo}.json`),
          GitHubSync.leerJSONFresco(`conteo/especiales/${t.tipo}_estado.json`).catch(() => null),
        ]);
        return { ...t, datos, estado };
      } catch (e) { return { ...t, datos: null, estado: null }; }
    })
  );
  tbody.innerHTML = filas
    .map(({ tipo, titulo, datos, estado }) => {
      if (!datos) return `<tr><td>${titulo}</td><td class="num">—</td><td>—</td><td><span class="chip-estado chip-gris">Sin enviar</span></td><td>—</td><td>—</td><td></td></tr>`;
      const hecho = estado && estado.generadoEn === datos.generadoEn ? estado : datos.completadoEn ? datos : null;
      const terminado = !!hecho;
      return `<tr>
        <td>${titulo}</td>
        <td class="num">${(datos.items || []).length}</td>
        <td>${fmtFechaHora(datos.generadoEn)}</td>
        <td><span class="chip-estado ${terminado ? 'chip-verde' : 'chip-amarillo'}">${terminado ? 'Terminado' : 'Pendiente de contar'}</span></td>
        <td>${terminado ? fmtFechaHora(hecho.completadoEn) : '—'}</td>
        <td>${terminado ? hecho.completadoPor || '—' : '—'}</td>
        <td class="num">${terminado ? '' : iconosEnlace(tipo)}</td>
      </tr>`;
    })
    .join('');
  tbody.querySelectorAll('.btn-copiar-enlace').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.url); btn.classList.add('copiado'); setTimeout(() => btn.classList.remove('copiado'), 1500); }
      catch (e) { window.prompt('Copia el enlace:', btn.dataset.url); }
    });
  });
}

// ---------------- RESULTADOS ----------------
async function cargarResultados() {
  const estado = document.getElementById('estado-resultados');
  const boton = document.getElementById('btn-cargar-resultados');
  boton.disabled = true;
  estado.textContent = 'Buscando conteos…';
  try {
    const archivos = await GitHubSync.listarCarpeta(GitHubSync.RUTA_RESULTADOS);
    const conteos = await GitHubSync.leerVariosJSON(archivos);
    state.resultados = conteos;
    renderResultados(conteos);
    cargarEstadoEnvios();
    estado.className = 'estado-publicar ok';
    estado.textContent = `✓ ${conteos.length} conteo(s) encontrados.`;
  } catch (err) {
    console.error(err);
    estado.className = 'estado-publicar error';
    estado.textContent = 'Error: ' + err.message;
  } finally {
    boton.disabled = false;
  }
}

// Muestra "sistema → físico" solo cuando cambió; "—" si no hay dato (conteos por zona no lo traen)
function cambioTexto(sistema, fisico) {
  const s = sistema || '';
  const f = fisico === undefined || fisico === null ? s : fisico;
  if (!s && !f) return '—';
  if (s === f) return s || '—';
  return `<strong>${s || '—'} → ${f || '—'}</strong>`;
}

function renderResultados(conteos) {
  const filas = [];
  conteos.forEach((c) => {
    const items = (c.items || []).filter((it) => it.cantidadFisica !== null && it.cantidadFisica !== undefined);
    const conDiferencia = CicloEngine.calcularDiferencias(items);
    conDiferencia.forEach((it) => {
      filas.push({ zona: c.zona, fecha: c.fecha, contadoPor: c.contadoPor || '—', ...it });
    });
  });

  filas.sort((a, b) => (b.fecha < a.fecha ? -1 : 1));

  document.getElementById('kpi-resultados').style.display = 'grid';
  document.getElementById('kpi-total-conteos').textContent = conteos.length;
  document.getElementById('kpi-total-materiales').textContent = filas.length;
  const conDiferenciaGrande = filas.filter((f) => Math.abs(f.pctDiferencia) > 10).length;
  document.getElementById('kpi-con-diferencia').textContent = conDiferenciaGrande;

  const tbody = document.getElementById('tabla-resultados-body');
  if (filas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="muted centrado">Todavía no hay conteos guardados.</td></tr>';
    return;
  }
  tbody.innerHTML = filas
    .map((f) => {
      const claseDif = Math.abs(f.pctDiferencia) > 10 ? 'fila-diferencia' : '';
      return `<tr class="${claseDif}">
      <td>${f.zona}</td>
      <td>${f.fecha}</td>
      <td>${f.contadoPor}</td>
      <td>${f.material}</td>
      <td class="desc">${f.descripcion}</td>
      <td>${cambioTexto(f.loteSistema, f.loteFisico)}</td>
      <td>${cambioTexto(f.ubicacionSistema, f.ubicacionFisica)}</td>
      <td class="num">${fmtNum(f.cantidadSistema, 2)}</td>
      <td class="num">${fmtNum(f.cantidadFisica, 2)}</td>
      <td class="num">${f.diferencia > 0 ? '+' : ''}${fmtNum(f.diferencia, 2)}</td>
      <td class="num">${f.pctDiferencia > 0 ? '+' : ''}${fmtNum(f.pctDiferencia, 1)}%</td>
    </tr>`;
    })
    .join('');
}

// ---------------- CONFIGURACIÓN ----------------
function bindConfig() {
  const cfg = GitHubSync.configEfectiva();
  document.getElementById('input-gh-owner').value = cfg.owner;
  document.getElementById('input-gh-repo').value = cfg.repo;
  document.getElementById('input-gh-branch').value = cfg.branch;

  document.getElementById('form-github').addEventListener('submit', (e) => {
    e.preventDefault();
    GitHubSync.guardarConfigGitHub(
      document.getElementById('input-gh-owner').value.trim(),
      document.getElementById('input-gh-repo').value.trim(),
      '', // el token ya no se guarda en el navegador — vive en el Worker
      document.getElementById('input-gh-branch').value.trim() || 'main'
    );
    const msg = document.getElementById('guardado-gh-msg');
    msg.style.opacity = '1';
    setTimeout(() => (msg.style.opacity = '0'), 1800);
  });
}

// ---------------- INIT ----------------
document.addEventListener('DOMContentLoaded', () => {
  bindTabs();
  bindConfig();
  cargarEstadoEnvios();
  document.getElementById('btn-actualizar-estado').addEventListener('click', cargarEstadoEnvios);
  document.getElementById('btn-cargar-resultados').addEventListener('click', cargarResultados);
});
