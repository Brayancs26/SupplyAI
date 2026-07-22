// ============================================================
// APP — Abastecimiento L001 (arrastra y suelta, todo en el navegador)
// ============================================================

const ALMACEN = 'L001';

const state = {
  archivos: { MRP: null, DATA: null, MB52: null },
  consumoReal: [],
  fechaMin: null,
  fechaMax: null,
  indiceEstacional: null,
  mesATemporada: null,
  statsPorTemporada: null,
  mb52Map: null,
  calculados: [],
  params: { Z: 1.645, S: 50, H: 0.2, diasAnio: 365 },
  umbralAlta: 1.3,
  umbralBaja: 0.5,
  filtroTexto: '',
  filtroRiesgo: 'TODOS',
  filtroConfianza: 'TODAS',
  modoPublicado: false,
  publicadoEn: null,
};

const fmtNum = (n, dec = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString('es-PE', { maximumFractionDigits: dec, minimumFractionDigits: dec });
const fmtSoles = (n) =>
  n === null || n === undefined ? '—' : 'S/. ' + Number(n).toLocaleString('es-PE', { maximumFractionDigits: 0 });

function hoyISO() {
  const d = new Date();
  return SupplyEngine.toISODate(d);
}

function formatearFecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

// ---------------- COMPARTIR (GitHub como backend) ----------------
async function revisarSnapshotPublicado() {
  const repoInfo = GitHubSync.detectarRepoDesdeURL();
  if (!repoInfo) return; // no estamos en GitHub Pages (ej. abierto como archivo local)
  const snapshot = await GitHubSync.obtenerSnapshotPublicado(repoInfo.owner, repoInfo.repo, repoInfo.branch);
  if (!snapshot) return;

  const banner = document.getElementById('banner-publicado');
  banner.style.display = 'flex';
  document.getElementById('publicado-fecha').textContent = 'publicada el ' + formatearFecha(snapshot.publicadoEn);

  document.getElementById('btn-ver-publicado').addEventListener('click', () => {
    cargarSnapshotEnState(snapshot);
    mostrarDashboard();
    renderTodo();
  });
}

function cargarSnapshotEnState(snapshot) {
  state.modoPublicado = true;
  state.publicadoEn = snapshot.publicadoEn;
  state.fechaMin = snapshot.fechaMin;
  state.fechaMax = snapshot.fechaMax;
  state.indiceEstacional = snapshot.indiceEstacional;
  state.mesATemporada = snapshot.mesATemporada;
  state.calculados = snapshot.calculados;
  state.params = snapshot.params || state.params;

  const aviso = document.getElementById('aviso-modo-publicado');
  aviso.style.display = 'block';
  document.getElementById('publicado-fecha-2').textContent = 'publicada el ' + formatearFecha(snapshot.publicadoEn);
}

function bindGitHubForm() {
  const cfg = GitHubSync.obtenerConfigGitHub();
  const detectado = GitHubSync.detectarRepoDesdeURL();
  document.getElementById('input-gh-owner').value = (cfg && cfg.owner) || (detectado && detectado.owner) || '';
  document.getElementById('input-gh-repo').value = (cfg && cfg.repo) || (detectado && detectado.repo) || '';
  document.getElementById('input-gh-branch').value = (cfg && cfg.branch) || 'main';
  document.getElementById('input-gh-token').value = (cfg && cfg.token) || '';

  document.getElementById('form-github').addEventListener('submit', (e) => {
    e.preventDefault();
    GitHubSync.guardarConfigGitHub(
      document.getElementById('input-gh-owner').value.trim(),
      document.getElementById('input-gh-repo').value.trim(),
      document.getElementById('input-gh-token').value.trim(),
      document.getElementById('input-gh-branch').value.trim() || 'main'
    );
    const el = document.getElementById('guardado-gh-msg');
    el.style.opacity = '1';
    setTimeout(() => (el.style.opacity = '0'), 1800);
  });

  document.getElementById('btn-publicar').addEventListener('click', async () => {
    const estadoEl = document.getElementById('estado-publicar');
    estadoEl.className = 'estado-publicar';
    estadoEl.textContent = 'Publicando…';
    try {
      const payload = {
        publicadoEn: new Date().toISOString(),
        fechaMin: state.fechaMin,
        fechaMax: state.fechaMax,
        params: state.params,
        indiceEstacional: state.indiceEstacional,
        mesATemporada: state.mesATemporada,
        calculados: state.calculados,
      };
      await GitHubSync.publicarSnapshot(payload);
      estadoEl.textContent = 'Publicado ✓ — ya está disponible para quien abra el link';
      estadoEl.classList.add('ok');
    } catch (err) {
      estadoEl.textContent = err.message;
      estadoEl.classList.add('error');
    }
  });
}

// ---------------- CACHÉ (IndexedDB) ----------------
async function cargarCacheAlIniciar() {
  const cache = await Storage.obtenerTodos();
  ['MRP', 'DATA', 'MB52'].forEach((tipo) => {
    if (cache[tipo]) {
      state.archivos[tipo] = {
        nombreArchivo: cache[tipo].nombreArchivo,
        filas: cache[tipo].filas,
        fechaCarga: cache[tipo].fechaCarga,
        deCache: true,
      };
    }
  });
  actualizarEstadoArchivos();
  actualizarBotonContinuar();
}

// ---------------- CARGA DE PARÁMETROS GUARDADOS ----------------
function cargarParametrosGuardados() {
  const raw = localStorage.getItem('parametros_abastecimiento_v2');
  if (raw) {
    const p = JSON.parse(raw);
    state.params = { ...state.params, ...p.params };
    if (p.umbralAlta) state.umbralAlta = p.umbralAlta;
    if (p.umbralBaja) state.umbralBaja = p.umbralBaja;
  }
}
function guardarParametros() {
  localStorage.setItem(
    'parametros_abastecimiento_v2',
    JSON.stringify({ params: state.params, umbralAlta: state.umbralAlta, umbralBaja: state.umbralBaja })
  );
}

// ---------------- DRAG & DROP ----------------
function bindDropzone() {
  const zone = document.getElementById('dropzone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => manejarArchivos(e.target.files));

  ['dragenter', 'dragover'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('dragging');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('dragging');
    })
  );
  zone.addEventListener('drop', (e) => manejarArchivos(e.dataTransfer.files));

  // Reemplazo individual por chip
  document.querySelectorAll('.btn-reemplazar').forEach((btn) => {
    const tipo = btn.dataset.tipo;
    const inputIndividual = document.querySelector(`.input-individual[data-tipo="${tipo}"]`);
    btn.addEventListener('click', () => inputIndividual.click());
    inputIndividual.addEventListener('change', (e) => manejarArchivos(e.target.files));
  });

  document.getElementById('btn-continuar').addEventListener('click', () => {
    if (state.archivos.MRP && state.archivos.DATA && state.archivos.MB52) calcularTodo();
  });

  document.getElementById('btn-borrar-cache').addEventListener('click', async () => {
    if (!confirm('¿Borrar los 3 archivos guardados en este navegador? Vas a tener que volver a cargarlos.')) return;
    await Storage.borrarTodo();
    state.archivos = { MRP: null, DATA: null, MB52: null };
    actualizarEstadoArchivos();
    actualizarBotonContinuar();
  });
}

function actualizarBotonContinuar() {
  const listo = state.archivos.MRP && state.archivos.DATA && state.archivos.MB52;
  document.getElementById('btn-continuar').disabled = !listo;
}

async function manejarArchivos(fileList) {
  if (!fileList || fileList.length === 0) return;
  setEstadoCarga(true, 'Leyendo archivos…');
  const resultado = await FileParser.procesarArchivos(fileList);

  const persistencias = [];
  ['MRP', 'DATA', 'MB52'].forEach((tipo) => {
    if (resultado[tipo]) {
      state.archivos[tipo] = { ...resultado[tipo], deCache: false };
      persistencias.push(Storage.guardarArchivo(tipo, resultado[tipo].nombreArchivo, resultado[tipo].filas));
    }
  });
  await Promise.all(persistencias);

  actualizarEstadoArchivos();
  actualizarBotonContinuar();

  if (resultado.desconocidos.length || resultado.errores.length) {
    mostrarAvisoArchivos(resultado.desconocidos, resultado.errores);
  } else {
    document.getElementById('aviso-archivos').style.display = 'none';
  }

  setEstadoCarga(false);

  if (state.archivos.MRP && state.archivos.DATA && state.archivos.MB52) {
    calcularTodo();
  }
}

function mostrarAvisoArchivos(desconocidos, errores) {
  const partes = [];
  if (desconocidos.length) partes.push(`No reconocí el tipo de: ${desconocidos.join(', ')}`);
  if (errores.length) partes.push(...errores);
  const el = document.getElementById('aviso-archivos');
  el.textContent = partes.join(' · ');
  el.style.display = partes.length ? 'block' : 'none';
}

function actualizarEstadoArchivos() {
  ['MRP', 'DATA', 'MB52'].forEach((tipo) => {
    const chip = document.getElementById(`chip-${tipo}`);
    const info = state.archivos[tipo];
    if (info) {
      chip.classList.add('chip-listo');
      const filas = info.filas.length.toLocaleString('es-PE');
      const origen = info.deCache ? `guardado el ${formatearFecha(info.fechaCarga)}` : 'recién cargado';
      chip.querySelector('.chip-status').textContent = `✓ ${info.nombreArchivo} · ${filas} filas · ${origen}`;
    } else {
      chip.classList.remove('chip-listo');
      chip.querySelector('.chip-status').textContent = 'Esperando archivo…';
    }
  });
}

function setEstadoCarga(on, mensaje) {
  const overlay = document.getElementById('loading-overlay');
  overlay.style.display = on ? 'flex' : 'none';
  if (mensaje) document.getElementById('loading-msg').textContent = mensaje;
}

// ---------------- CÁLCULO ----------------
function calcularTodo() {
  state.modoPublicado = false;
  document.getElementById('aviso-modo-publicado').style.display = 'none';
  setEstadoCarga(true, 'Calculando estacionalidad y SS/ROP/EOQ…');
  // pequeño timeout para que el navegador pinte el overlay antes de bloquear el hilo
  setTimeout(() => {
    try {
      const dataRows = state.archivos.DATA.filas;
      const mrpRows = state.archivos.MRP.filas;
      const mb52Rows = state.archivos.MB52.filas;

      state.consumoReal = SupplyEngine.filtrarConsumoReal(dataRows, ALMACEN);
      const fechas = state.consumoReal.map((r) => r.fechaISO).sort();
      state.fechaMin = fechas[0];
      state.fechaMax = fechas[fechas.length - 1];

      state.indiceEstacional = SupplyEngine.calcularIndiceEstacional(state.consumoReal);
      state.mesATemporada = SupplyEngine.clasificarTemporadas(state.indiceEstacional, state.umbralAlta, state.umbralBaja);
      const diasTemp = SupplyEngine.diasPorTemporada(state.fechaMin, state.fechaMax, state.mesATemporada);
      state.statsPorTemporada = SupplyEngine.calcularStatsPorTemporada(state.consumoReal, state.mesATemporada, diasTemp);
      state.mb52Map = SupplyEngine.agregarMB52(mb52Rows, ALMACEN);

      state.calculados = SupplyEngine.calcularMateriales(
        mrpRows,
        state.statsPorTemporada,
        state.mesATemporada,
        state.mb52Map,
        state.params,
        hoyISO()
      );

      mostrarDashboard();
      renderTodo();
    } catch (err) {
      console.error(err);
      alert('Error calculando: ' + err.message);
    } finally {
      setEstadoCarga(false);
    }
  }, 50);
}

function recalcularConParametrosActuales() {
  if (!state.archivos.MRP || !state.archivos.DATA || !state.archivos.MB52) return;
  calcularTodo();
}

function mostrarDashboard() {
  document.getElementById('pantalla-carga').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
}

function renderTodo() {
  renderResumen();
  renderEstacionalidad();
  renderParametros();
  renderTablaMateriales();
  renderInmovilizados();
}

// ---------------- NAV ----------------
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

// ---------------- RESUMEN ----------------
function renderResumen() {
  const total = state.calculados.length;
  const rojo = state.calculados.filter((m) => m.riesgo === 'ROJO').length;
  const amarillo = state.calculados.filter((m) => m.riesgo === 'AMARILLO').length;
  const verde = state.calculados.filter((m) => m.riesgo === 'VERDE').length;
  const alta = state.calculados.filter((m) => m.confianza === 'Alta').length;
  const media = state.calculados.filter((m) => m.confianza === 'Media').length;
  const baja = state.calculados.filter((m) => m.confianza === 'Baja').length;
  const sinDatos = state.calculados.filter((m) => m.confianza === 'Sin datos').length;

  document.getElementById('kpi-total').textContent = total;
  document.getElementById('kpi-rojo').textContent = rojo;
  document.getElementById('kpi-amarillo').textContent = amarillo;
  document.getElementById('kpi-verde').textContent = verde;
  document.getElementById('kpi-confianza').textContent = `${alta} alta · ${media} media · ${baja} baja · ${sinDatos} sin datos`;

  const tempHoy = state.mesATemporada[new Date().getMonth() + 1];
  document.getElementById('temporada-actual').textContent = tempHoy;
  document.getElementById('temporada-actual').className = 'chip chip-' + (tempHoy === 'Alta' ? 'roja' : tempHoy === 'Media' ? 'amarilla' : 'verde');

  const prioritarios = state.calculados
    .filter((m) => m.riesgo === 'ROJO' && (m.confianza === 'Alta' || m.confianza === 'Media'))
    .sort((a, b) => (b.ropCalculado - b.stockFisico) - (a.ropCalculado - a.stockFisico))
    .slice(0, 25);

  const tbody = document.getElementById('tabla-prioritarios-body');
  tbody.innerHTML = prioritarios
    .map(
      (m) => `<tr>
      <td>${m.material}</td>
      <td class="desc">${m.descripcion || ''}</td>
      <td>${m.clasificacion}</td>
      <td>${m.temporadaObjetivo}</td>
      <td class="num">${fmtNum(m.stockFisico, 0)}</td>
      <td class="num">${fmtNum(m.ropCalculado, 0)}</td>
      <td>${confianzaChip(m.confianza)}</td>
    </tr>`
    )
    .join('');
}

// ---------------- ESTACIONALIDAD ----------------
function renderEstacionalidad() {
  const cont = document.getElementById('grafico-estacional');
  const maxIdx = Math.max(...Object.values(state.indiceEstacional));
  cont.innerHTML = SupplyEngine.NOMBRES_MES.map((nombre, i) => {
    const mes = i + 1;
    const idx = state.indiceEstacional[mes];
    const temp = state.mesATemporada[mes];
    const alturaPct = Math.max(4, (idx / maxIdx) * 100);
    const claseColor = temp === 'Alta' ? 'barra-roja' : temp === 'Media' ? 'barra-amarilla' : 'barra-verde';
    return `<div class="barra-mes">
      <span class="barra-valor">${idx.toFixed(2)}</span>
      <div class="barra ${claseColor}" style="height:${alturaPct}%"></div>
      <span class="barra-label">${nombre}</span>
    </div>`;
  }).join('');

  document.getElementById('rango-fechas').textContent = `${state.fechaMin} a ${state.fechaMax}`;
}

// ---------------- PARAMETROS ----------------
function renderParametros() {
  document.getElementById('input-z').value = state.params.Z;
  document.getElementById('input-s').value = state.params.S;
  document.getElementById('input-h').value = (state.params.H * 100).toFixed(1);
  document.getElementById('input-umbral-alta').value = state.umbralAlta;
  document.getElementById('input-umbral-baja').value = state.umbralBaja;
}

function bindFormularios() {
  document.getElementById('form-parametros').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.modoPublicado) {
      alert('Estás viendo una versión publicada — no hay datos crudos cargados para recalcular. Usa "Cargar mis archivos" primero.');
      return;
    }
    state.params.Z = Number(document.getElementById('input-z').value);
    state.params.S = Number(document.getElementById('input-s').value);
    state.params.H = Number(document.getElementById('input-h').value) / 100;
    state.umbralAlta = Number(document.getElementById('input-umbral-alta').value);
    state.umbralBaja = Number(document.getElementById('input-umbral-baja').value);
    guardarParametros();
    recalcularConParametrosActuales();
    flashGuardado();
  });

  document.getElementById('buscar-material').addEventListener('input', (e) => {
    state.filtroTexto = e.target.value.toLowerCase();
    renderTablaMateriales();
  });
  document.getElementById('filtro-riesgo').addEventListener('change', (e) => {
    state.filtroRiesgo = e.target.value;
    renderTablaMateriales();
  });
  document.getElementById('filtro-confianza').addEventListener('change', (e) => {
    state.filtroConfianza = e.target.value;
    renderTablaMateriales();
  });

  document.getElementById('umbral-moderado').addEventListener('change', renderInmovilizados);
  document.getElementById('umbral-critico').addEventListener('change', renderInmovilizados);

  document.getElementById('btn-nuevos-archivos').addEventListener('click', () => {
    state.modoPublicado = false;
    document.getElementById('aviso-modo-publicado').style.display = 'none';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('pantalla-carga').style.display = 'block';
  });

  document.getElementById('btn-exportar').addEventListener('click', exportarExcel);
}

function flashGuardado() {
  const el = document.getElementById('guardado-msg');
  el.style.opacity = '1';
  setTimeout(() => (el.style.opacity = '0'), 1800);
}

// ---------------- TABLA MATERIALES ----------------
function riesgoChip(r) {
  const map = { ROJO: 'roja', AMARILLO: 'amarilla', VERDE: 'verde' };
  const label = { ROJO: 'Riesgo de quiebre', AMARILLO: 'Vigilar', VERDE: 'OK' };
  return `<span class="chip chip-${map[r]}">${label[r]}</span>`;
}
function confianzaChip(c) {
  const map = { Alta: 'alta', Media: 'media', Baja: 'baja', 'Sin datos': 'sindatos' };
  return `<span class="chip chip-${map[c]}">${c}</span>`;
}

function renderTablaMateriales() {
  let rows = state.calculados;
  if (state.filtroTexto) {
    rows = rows.filter(
      (m) =>
        m.material.toLowerCase().includes(state.filtroTexto) ||
        (m.descripcion || '').toLowerCase().includes(state.filtroTexto)
    );
  }
  if (state.filtroRiesgo !== 'TODOS') rows = rows.filter((m) => m.riesgo === state.filtroRiesgo);
  if (state.filtroConfianza !== 'TODAS') rows = rows.filter((m) => m.confianza === state.filtroConfianza);

  document.getElementById('conteo-materiales').textContent = `${rows.length} de ${state.calculados.length} materiales`;

  const tbody = document.getElementById('tabla-materiales-body');
  const MAX_FILAS = 400;
  tbody.innerHTML = rows
    .slice(0, MAX_FILAS)
    .map(
      (m) => `<tr>
      <td>${m.material}</td>
      <td class="desc">${m.descripcion || ''}</td>
      <td>${m.clasificacion}</td>
      <td>${m.temporadaObjetivo}</td>
      <td class="num">${fmtNum(m.leadTime, 0)}</td>
      <td class="num">${fmtNum(m.stockFisico, 0)}</td>
      <td class="num">${fmtNum(m.ssActual, 0)}</td>
      <td class="num">${fmtNum(m.ssCalculado, 1)}</td>
      <td class="num">${fmtNum(m.ropActual, 0)}</td>
      <td class="num">${fmtNum(m.ropCalculado, 1)}</td>
      <td>${confianzaChip(m.confianza)}</td>
      <td class="num">${m.costoUnitario ? fmtSoles(m.costoUnitario) : '<span class="muted">—</span>'}</td>
      <td class="num">${m.eoq !== null ? fmtNum(m.eoq, 0) : '<span class="muted">—</span>'}</td>
      <td>${riesgoChip(m.riesgo)}</td>
    </tr>`
    )
    .join('');

  if (rows.length > MAX_FILAS) {
    tbody.innerHTML += `<tr><td colspan="14" class="muted centrado">… mostrando los primeros ${MAX_FILAS} — afina el filtro para ver más.</td></tr>`;
  }
}

// ---------------- INMOVILIZADOS ----------------
function renderInmovilizados() {
  const umbralMod = Number(document.getElementById('umbral-moderado').value || 180);
  const umbralCrit = Number(document.getElementById('umbral-critico').value || 365);
  const totalDiasObs = SupplyEngine.diasPorTemporada
    ? Object.values(SupplyEngine.diasPorTemporada(state.fechaMin, state.fechaMax, state.mesATemporada)).reduce((a, b) => a + b, 0)
    : 0;
  const inmov = SupplyEngine.calcularInmovilizados(state.calculados, umbralMod, umbralCrit, totalDiasObs);

  const criticos = inmov.filter((m) => m.severidadInmovilizado === 'Crítico');
  const moderados = inmov.filter((m) => m.severidadInmovilizado === 'Moderado');
  const valorTotal = inmov.reduce((acc, m) => acc + (m.valorInmovilizado || 0), 0);
  const conValor = inmov.filter((m) => m.valorInmovilizado !== null).length;

  document.getElementById('kpi-inmov-total').textContent = inmov.length;
  document.getElementById('kpi-inmov-critico').textContent = criticos.length;
  document.getElementById('kpi-inmov-moderado').textContent = moderados.length;
  document.getElementById('kpi-inmov-valor').textContent = fmtSoles(valorTotal) + ` (${conValor} con costo)`;

  const tbody = document.getElementById('tabla-inmovilizados-body');
  tbody.innerHTML = inmov
    .map(
      (m) => `<tr>
      <td>${m.material}</td>
      <td class="desc">${m.descripcion || ''}</td>
      <td>${m.clasificacion}</td>
      <td class="num">${fmtNum(m.stockFisico, 0)}</td>
      <td class="num">${m.diasSinMovimientoEfectivo}</td>
      <td>${m.ultimaFechaConsumo || '<span class="muted">sin consumo en el período</span>'}</td>
      <td><span class="chip chip-${m.severidadInmovilizado === 'Crítico' ? 'roja' : 'amarilla'}">${m.severidadInmovilizado}</span></td>
      <td class="num">${m.valorInmovilizado !== null ? fmtSoles(m.valorInmovilizado) : '<span class="muted">—</span>'}</td>
    </tr>`
    )
    .join('');
}

// ---------------- EXPORTAR ----------------
function exportarExcel() {
  const headers = [
    'Material', 'Descripción', 'Clasificación', 'Temporada Objetivo', 'Lead Time',
    'Stock Físico', 'SS Actual', 'SS Calculado', 'ROP Actual', 'ROP Calculado',
    'Confianza', 'Costo Unitario', 'EOQ', 'Riesgo', 'Días Sin Movimiento',
  ];
  const rows = state.calculados.map((m) => [
    m.material, m.descripcion, m.clasificacion, m.temporadaObjetivo, m.leadTime,
    m.stockFisico, m.ssActual, m.ssCalculado, m.ropActual, m.ropCalculado,
    m.confianza, m.costoUnitario, m.eoq, m.riesgo, m.diasSinMovimiento,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Calculo');
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Abastecimiento_L001_${fecha}.xlsx`);
}

// ---------------- INIT ----------------
document.addEventListener('DOMContentLoaded', async () => {
  cargarParametrosGuardados();
  bindDropzone();
  bindTabs();
  bindFormularios();
  bindGitHubForm();
  await cargarCacheAlIniciar();
  await revisarSnapshotPublicado();
});
