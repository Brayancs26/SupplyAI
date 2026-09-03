// ============================================================
// ADMIN — Programar el ciclo, ver resultados, configurar GitHub.
// ============================================================

const state = {
  mb52Rows: null,
  zonasGeneradas: null,
  cicloSemanas: 4,
  fechaInicio: null,
  resultados: [],
};

const fmtNum = (n, dec = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString('es-PE', { maximumFractionDigits: dec, minimumFractionDigits: dec });

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}
function proximoLunesISO() {
  const d = new Date();
  const dia = d.getDay();
  const diasHastaLunes = dia === 0 ? 1 : dia === 1 ? 0 : 8 - dia;
  d.setDate(d.getDate() + diasHastaLunes);
  return d.toISOString().slice(0, 10);
}

function setEstadoCarga(on, mensaje) {
  const overlay = document.getElementById('loading-overlay');
  overlay.style.display = on ? 'flex' : 'none';
  if (mensaje) document.getElementById('loading-msg').textContent = mensaje;
}

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

// ---------------- PROGRAMAR ----------------
function bindProgramar() {
  const dz = document.getElementById('dropzone-mb52');
  const input = document.getElementById('file-input-mb52');
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => cargarMB52(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((evt) => dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((evt) => dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove('dragging'); }));
  dz.addEventListener('drop', (e) => cargarMB52(e.dataTransfer.files[0]));

  document.getElementById('input-fecha-inicio').value = proximoLunesISO();

  ['input-nivel-agrupacion', 'input-ciclo-semanas'].forEach((id) => {
    document.getElementById(id).addEventListener('change', actualizarPreviewZonas);
  });

  document.getElementById('btn-generar-programa').addEventListener('click', generarPrograma);
  document.getElementById('btn-publicar-programa').addEventListener('click', publicarPrograma);
}

async function cargarMB52(file) {
  if (!file) return;
  setEstadoCarga(true, 'Leyendo MB52…');
  try {
    const wb = await leerArchivoComoWorkbookLocal(file);
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
    if (!filas.some((f) => 'Libre utilización' in f && 'Ubicación' in f)) {
      alert('Ese archivo no parece un MB52 (faltan columnas "Libre utilización" o "Ubicación").');
      setEstadoCarga(false);
      return;
    }
    state.mb52Rows = filas;
    const dz = document.getElementById('dropzone-mb52');
    dz.classList.add('dropzone-cargado');
    dz.querySelector('.dropzone-mini-texto').textContent = `✓ MB52 cargado (${filas.length.toLocaleString('es-PE')} filas)`;
    actualizarPreviewZonas();
  } catch (err) {
    console.error(err);
    alert('Error leyendo el archivo: ' + err.message);
  } finally {
    setEstadoCarga(false);
  }
}

function leerArchivoComoWorkbookLocal(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer ' + file.name));
    reader.readAsArrayBuffer(file);
  });
}

function actualizarPreviewZonas() {
  if (!state.mb52Rows) return;
  const nivel = Number(document.getElementById('input-nivel-agrupacion').value);
  const zonas = CicloEngine.agruparPorZonaConNivel(state.mb52Rows, 'L001', nivel);
  const totalMateriales = zonas.reduce((a, z) => a + z.materiales.length, 0);
  document.getElementById('preview-zonas').textContent =
    `Con este nivel: ${zonas.length} zonas, ${totalMateriales} materiales en total.`;
}

function generarPrograma() {
  if (!state.mb52Rows) {
    alert('Primero carga tu MB52.');
    return;
  }
  const nivel = Number(document.getElementById('input-nivel-agrupacion').value);
  const cicloSemanas = Math.max(1, Number(document.getElementById('input-ciclo-semanas').value) || 4);
  const fechaInicio = document.getElementById('input-fecha-inicio').value || proximoLunesISO();

  const zonas = CicloEngine.agruparPorZonaConNivel(state.mb52Rows, 'L001', nivel);
  const conSemana = CicloEngine.asignarSemanas(zonas, cicloSemanas);

  state.zonasGeneradas = conSemana;
  state.cicloSemanas = cicloSemanas;
  state.fechaInicio = fechaInicio;

  const tbody = document.getElementById('tabla-preview-programa-body');
  tbody.innerHTML = conSemana
    .map((z) => `<tr><td class="num">${z.semana}</td><td>${z.zona}</td><td class="num">${z.materiales.length}</td></tr>`)
    .join('');
  document.getElementById('panel-preview-programa').style.display = 'block';
  document.getElementById('btn-publicar-programa').disabled = false;
  document.getElementById('estado-publicar-programa').textContent = '';
}

async function publicarPrograma() {
  const estado = document.getElementById('estado-publicar-programa');
  const boton = document.getElementById('btn-publicar-programa');
  boton.disabled = true;
  estado.className = 'estado-publicar';
  estado.textContent = 'Publicando…';
  try {
    const objeto = {
      publicadoEn: new Date().toISOString(),
      fechaInicio: state.fechaInicio,
      cicloSemanas: state.cicloSemanas,
      zonas: state.zonasGeneradas,
    };
    await GitHubSync.escribirJSON(GitHubSync.RUTA_PROGRAMA, objeto, 'Actualizar programa de inventario cíclico');
    estado.className = 'estado-publicar ok';
    estado.textContent = '✓ Programa publicado — ya está disponible en la página de Contar.';
  } catch (err) {
    console.error(err);
    estado.className = 'estado-publicar error';
    estado.textContent = 'Error: ' + err.message;
  } finally {
    boton.disabled = false;
  }
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
  bindProgramar();
  bindConfig();
  document.getElementById('btn-cargar-resultados').addEventListener('click', cargarResultados);
});
