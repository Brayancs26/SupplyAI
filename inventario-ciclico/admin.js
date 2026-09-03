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
    tbody.innerHTML = '<tr><td colspan="9" class="muted centrado">Todavía no hay conteos guardados.</td></tr>';
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
  document.getElementById('input-gh-token').value = cfg.token;

  document.getElementById('form-github').addEventListener('submit', (e) => {
    e.preventDefault();
    GitHubSync.guardarConfigGitHub(
      document.getElementById('input-gh-owner').value.trim(),
      document.getElementById('input-gh-repo').value.trim(),
      document.getElementById('input-gh-token').value.trim(),
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
  document.getElementById('btn-cargar-resultados').addEventListener('click', cargarResultados);
});
