// ============================================================
// APP — Abastecimiento L001 (arrastra y suelta, todo en el navegador)
// ============================================================

const ALMACEN = 'L001';
const ALMACEN_PLANTA = 'PI01';

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
  planificados: [],
  params: { Z: 1.645, S: 50, H: 0.2, diasAnio: 365 },
  umbralAlta: 1.3,
  umbralBaja: 0.5,
  filtroTexto: '',
  filtroRiesgo: 'TODOS',
  filtroConfianza: 'TODAS',
  filtroABC: 'TODAS',
  filtroXYZ: 'TODAS',
  filtroCategoria: 'TODAS',
  filtroTratamiento: 'TODOS',
  marcados: {},
  coberturaIdealDias: 12,
  filtroCategoriaCobertura: 'Insumos',
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

// ---------------- LISTA DE PEDIDO (marcados) ----------------
function cargarMarcados() {
  const raw = localStorage.getItem('pedido_marcados_v1');
  state.marcados = raw ? JSON.parse(raw) : {};
}
function guardarMarcados() {
  localStorage.setItem('pedido_marcados_v1', JSON.stringify(state.marcados));
}
function marcarMaterial(material, marcado) {
  if (marcado) {
    if (!(material in state.marcados)) {
      const m = state.calculados.find((x) => x.material === material);
      const sugerida = m && m.ropCalculado !== null ? Math.max(0, Math.round(m.ropCalculado - m.stockFisico)) : 0;
      state.marcados[material] = sugerida;
    }
  } else {
    delete state.marcados[material];
  }
  guardarMarcados();
}
function actualizarCantidadPedido(material, cantidad) {
  state.marcados[material] = Math.max(0, Number(cantidad) || 0);
  guardarMarcados();
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
  setEstadoCarga(true, 'Calculando estacionalidad y SS/ROP/EOQ…');
  // pequeño timeout para que el navegador pinte el overlay antes de bloquear el hilo
  setTimeout(() => {
    try {
      const dataRows = state.archivos.DATA.filas;
      const mrpRows = state.archivos.MRP.filas;
      const mb52Rows = state.archivos.MB52.filas;

      const materialesInsumos = SupplyEngine.materialesPorCategoria(mrpRows, 'Insumos');
      const materialesCombustible = SupplyEngine.materialesPorCategoria(mrpRows, 'Combustibles');

      state.consumoReal = SupplyEngine.filtrarConsumoReal(dataRows, ALMACEN, {
        materialesConAlmacenExtra: materialesInsumos,
        almacenExtra: ALMACEN_PLANTA,
        materialesCombustible,
      });
      const fechas = state.consumoReal.map((r) => r.fechaISO).sort();
      state.fechaMin = fechas[0];
      state.fechaMax = fechas[fechas.length - 1];

      state.indiceEstacional = SupplyEngine.calcularIndiceEstacional(state.consumoReal);
      state.mesATemporada = SupplyEngine.clasificarTemporadas(state.indiceEstacional, state.umbralAlta, state.umbralBaja);
      const diasTemp = SupplyEngine.diasPorTemporada(state.fechaMin, state.fechaMax, state.mesATemporada);
      state.statsPorTemporada = SupplyEngine.calcularStatsPorTemporada(state.consumoReal, state.mesATemporada, diasTemp);
      state.mb52Map = SupplyEngine.agregarMB52(mb52Rows, ALMACEN);

      const movClasificacionMap = SupplyEngine.calcularClasificacionMovimiento(state.consumoReal, state.fechaMin, state.fechaMax);

      state.calculados = SupplyEngine.calcularMateriales(
        mrpRows,
        state.statsPorTemporada,
        state.mesATemporada,
        state.mb52Map,
        state.params,
        hoyISO(),
        movClasificacionMap
      );

      state.planificados = state.calculados.filter((m) => m.incluidoEnPlanificacion);

      const statsMensuales = SupplyEngine.calcularStatsMensualesGenerales(state.consumoReal, state.fechaMin, state.fechaMax);
      state.planificados = SupplyEngine.calcularABCXYZ(state.planificados, statsMensuales);

      const stockTodosAlmacenes = SupplyEngine.agregarStockPorAlmacenTodos(mb52Rows);
      state.planificados = SupplyEngine.enriquecerConTraslados(state.planificados, stockTodosAlmacenes, ALMACEN);

      const transitoMap = SupplyEngine.extraerTransitoPorMaterial(mb52Rows);
      state.planificados = SupplyEngine.enriquecerConCobertura(
        state.planificados, stockTodosAlmacenes, transitoMap, ALMACEN, ALMACEN_PLANTA, state.coberturaIdealDias
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
  renderMaterialesPlanificados();
  renderEstacionalidad();
  renderParametros();
  renderTablaMateriales();
  renderInmovilizados();
  renderABCXYZ();
  renderCobertura();
  renderListaPedido();
  poblarListaTendencia();
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
  const total = state.planificados.length;
  const rojo = state.planificados.filter((m) => m.riesgo === 'ROJO').length;
  const amarillo = state.planificados.filter((m) => m.riesgo === 'AMARILLO').length;
  const verde = state.planificados.filter((m) => m.riesgo === 'VERDE').length;
  const alta = state.planificados.filter((m) => m.confianza === 'Alta').length;
  const media = state.planificados.filter((m) => m.confianza === 'Media').length;
  const baja = state.planificados.filter((m) => m.confianza === 'Baja').length;
  const sinDatos = state.planificados.filter((m) => m.confianza === 'Sin datos').length;

  document.getElementById('kpi-total').textContent = total;
  document.getElementById('kpi-rojo').textContent = rojo;
  document.getElementById('kpi-amarillo').textContent = amarillo;
  document.getElementById('kpi-verde').textContent = verde;
  document.getElementById('kpi-confianza').textContent = `${alta} alta · ${media} media · ${baja} baja · ${sinDatos} sin datos`;

  const pctSalud = total > 0 ? Math.round((verde / total) * 100) : 0;
  const gauge = document.getElementById('gauge-salud');
  const color = pctSalud >= 80 ? '#22c55e' : pctSalud >= 60 ? '#f5a623' : '#ef4444';
  gauge.style.setProperty('--pct', pctSalud);
  gauge.style.setProperty('--gauge-color', color);
  document.getElementById('gauge-valor').textContent = `${pctSalud}%`;

  const tempHoy = state.mesATemporada[new Date().getMonth() + 1];
  document.getElementById('temporada-actual').textContent = tempHoy;
  document.getElementById('temporada-actual').className = 'chip chip-' + (tempHoy === 'Alta' ? 'roja' : tempHoy === 'Media' ? 'amarilla' : 'verde');

  const prioritarios = state.planificados
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
  document.getElementById('filtro-tratamiento').addEventListener('change', (e) => {
    state.filtroTratamiento = e.target.value;
    renderTablaMateriales();
  });

  document.getElementById('umbral-moderado').addEventListener('change', renderInmovilizados);
  document.getElementById('umbral-critico').addEventListener('change', renderInmovilizados);
  document.getElementById('filtro-antiguedad-inmov').addEventListener('change', renderInmovilizados);
  document.getElementById('filtro-valor-inmov').addEventListener('change', renderInmovilizados);

  document.getElementById('btn-nuevos-archivos').addEventListener('click', () => {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('pantalla-carga').style.display = 'block';
  });

  document.getElementById('btn-exportar').addEventListener('click', exportarExcel);
  document.getElementById('btn-exportar-pedido').addEventListener('click', exportarListaPedido);

  document.getElementById('buscar-tendencia').addEventListener('change', (e) => {
    mostrarTendenciaMaterial(e.target.value);
  });

  document.getElementById('filtro-categoria-abcxyz').addEventListener('change', (e) => {
    state.filtroCategoria = e.target.value;
    state.filtroABC = 'TODAS';
    state.filtroXYZ = 'TODAS';
    renderABCXYZ();
  });

  document.getElementById('filtro-categoria-cobertura').addEventListener('change', renderCobertura);
  document.getElementById('input-cobertura-ideal').addEventListener('change', renderCobertura);
}

function flashGuardado() {
  const el = document.getElementById('guardado-msg');
  el.style.opacity = '1';
  setTimeout(() => (el.style.opacity = '0'), 1800);
}

// ---------------- TABLA MATERIALES ----------------
function riesgoChip(r) {
  const map = { ROJO: 'roja', AMARILLO: 'amarilla', VERDE: 'verde', 'N/A': 'nd' };
  const label = { ROJO: 'Riesgo de quiebre', AMARILLO: 'Vigilar', VERDE: 'OK', 'N/A': 'No planificado' };
  return `<span class="chip chip-${map[r] || 'nd'}">${label[r] || r}</span>`;
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
  if (state.filtroTratamiento === 'PLANIFICADOS') rows = rows.filter((m) => m.incluidoEnPlanificacion);
  if (state.filtroTratamiento === 'EXCLUIDOS') rows = rows.filter((m) => !m.incluidoEnPlanificacion);

  document.getElementById('conteo-materiales').textContent = `${rows.length} de ${state.calculados.length} materiales`;

  const tbody = document.getElementById('tabla-materiales-body');
  const MAX_FILAS = 400;
  tbody.innerHTML = rows
    .slice(0, MAX_FILAS)
    .map(
      (m) => `<tr>
      <td class="centrado"><input type="checkbox" class="chk-marcar" data-material="${m.material}" ${m.material in state.marcados ? 'checked' : ''} /></td>
      <td class="num"><input type="number" min="0" step="1" class="input-cantidad-pedido" data-material="${m.material}" value="${m.material in state.marcados ? state.marcados[m.material] : ''}" placeholder="—" /></td>
      <td>${m.material}</td>
      <td class="desc">${m.descripcion || ''}</td>
      <td>${m.clasificacion}</td>
      <td>${m.clasificacionFinal}${m.reclasificadoDesdeUIN ? ' <span class="chip chip-reclasificado">reclasificado</span>' : ''}</td>
      <td>${m.temporadaObjetivo}</td>
      <td class="num">${fmtNum(m.leadTime, 0)}</td>
      <td class="num">${fmtNum(m.stockFisico, 0)}</td>
      <td class="num">${fmtNum(m.ssActual, 0)}</td>
      <td class="num">${fmtNum(m.ssCalculado, 1)}</td>
      <td class="num">${fmtNum(m.ropActual, 0)}</td>
      <td class="num">${fmtNum(m.ropCalculado, 1)}</td>
      <td>${confianzaChip(m.confianza)}</td>
      <td>${m.ultimaFechaConsumo || '<span class="muted">sin consumo</span>'}</td>
      <td class="num">${m.costoUnitario ? fmtSoles(m.costoUnitario) : '<span class="muted">—</span>'}</td>
      <td class="num">${m.eoq !== null ? fmtNum(m.eoq, 0) : '<span class="muted">—</span>'}</td>
      <td>${riesgoChip(m.riesgo)}</td>
    </tr>`
    )
    .join('');

  if (rows.length > MAX_FILAS) {
    tbody.innerHTML += `<tr><td colspan="18" class="muted centrado">… mostrando los primeros ${MAX_FILAS} — afina el filtro para ver más.</td></tr>`;
  }

  tbody.querySelectorAll('.chk-marcar').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      marcarMaterial(e.target.dataset.material, e.target.checked);
      renderTablaMateriales();
      renderListaPedido();
    });
  });
  tbody.querySelectorAll('.input-cantidad-pedido').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      actualizarCantidadPedido(e.target.dataset.material, e.target.value);
      renderListaPedido();
    });
  });
}

// ---------------- INMOVILIZADOS ----------------
function renderInmovilizados() {
  const umbralMod = Number(document.getElementById('umbral-moderado').value || 180);
  const umbralCrit = Number(document.getElementById('umbral-critico').value || 365);
  const antiguedadMin = Number(document.getElementById('filtro-antiguedad-inmov').value || 0);
  const valorMin = Number(document.getElementById('filtro-valor-inmov').value || 0);
  const totalDiasObs = SupplyEngine.diasPorTemporada
    ? Object.values(SupplyEngine.diasPorTemporada(state.fechaMin, state.fechaMax, state.mesATemporada)).reduce((a, b) => a + b, 0)
    : 0;
  let inmov = SupplyEngine.calcularInmovilizados(state.calculados, umbralMod, umbralCrit, totalDiasObs);

  const totalSinFiltrar = inmov.length;
  if (antiguedadMin > 0) inmov = inmov.filter((m) => m.diasSinMovimientoEfectivo >= antiguedadMin);
  if (valorMin > 0) inmov = inmov.filter((m) => (m.valorInmovilizado || 0) >= valorMin);

  const criticos = inmov.filter((m) => m.severidadInmovilizado === 'Crítico');
  const moderados = inmov.filter((m) => m.severidadInmovilizado === 'Moderado');
  const valorTotal = inmov.reduce((acc, m) => acc + (m.valorInmovilizado || 0), 0);
  const conValor = inmov.filter((m) => m.valorInmovilizado !== null).length;

  document.getElementById('kpi-inmov-total').textContent = inmov.length;
  document.getElementById('kpi-inmov-critico').textContent = criticos.length;
  document.getElementById('kpi-inmov-moderado').textContent = moderados.length;
  document.getElementById('kpi-inmov-valor').textContent = fmtSoles(valorTotal) + ` (${conValor} con costo)`;
  document.getElementById('conteo-inmov').textContent = `${inmov.length} de ${totalSinFiltrar}`;

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
      <td>${m.fechaVencimiento || '<span class="muted">sin vencimiento</span>'}</td>
      <td><span class="chip chip-${m.severidadInmovilizado === 'Crítico' ? 'roja' : 'amarilla'}">${m.severidadInmovilizado}</span></td>
      <td class="num">${m.valorInmovilizado !== null ? fmtSoles(m.valorInmovilizado) : '<span class="muted">—</span>'}</td>
    </tr>`
    )
    .join('');
}

// ---------------- ABC-XYZ ----------------
const DESCRIPCION_CELDA = {
  AX: 'Alto valor, demanda predecible — control estricto, SS ajustado',
  AY: 'Alto valor, demanda variable — vigilar de cerca',
  AZ: 'Alto valor, demanda errática — el mayor riesgo financiero',
  BX: 'Valor medio, predecible — control estándar',
  BY: 'Valor medio, variable — revisión periódica',
  BZ: 'Valor medio, errático — considerar mayor SS',
  CX: 'Bajo valor, predecible — control simple',
  CY: 'Bajo valor, variable — bajo esfuerzo de gestión',
  CZ: 'Bajo valor, errático — mínimo esfuerzo, aceptar quiebres ocasionales',
};

function renderABCXYZ() {
  const filasABC = ['A', 'B', 'C'];
  const colsXYZ = ['X', 'Y', 'Z', 'N/D'];

  const base = state.filtroCategoria === 'TODAS'
    ? state.planificados
    : state.planificados.filter((m) => m.categoria === state.filtroCategoria);

  const conteos = {};
  filasABC.forEach((a) => colsXYZ.forEach((x) => (conteos[a + x] = 0)));
  base.forEach((m) => {
    const clave = m.claseABC + m.claseXYZ;
    if (conteos[clave] !== undefined) conteos[clave]++;
  });

  const grid = document.getElementById('grid-abcxyz');
  let html = '<div class="abcxyz-row abcxyz-header"><div></div>' +
    colsXYZ.map((x) => `<div class="abcxyz-col-label">${x}</div>`).join('') + '</div>';
  filasABC.forEach((a) => {
    html += `<div class="abcxyz-row"><div class="abcxyz-row-label">${a}</div>`;
    colsXYZ.forEach((x) => {
      const clave = a + x;
      const n = conteos[clave];
      const activa = state.filtroABC === a && state.filtroXYZ === x;
      html += `<button type="button" class="abcxyz-celda celda-${x === 'N/D' ? 'ND' : x} ${activa ? 'activa' : ''}" data-abc="${a}" data-xyz="${x}" title="${DESCRIPCION_CELDA[a + x] || ''}">
        <span class="celda-valor">${n}</span>
      </button>`;
    });
    html += '</div>';
  });
  grid.innerHTML = html;

  grid.querySelectorAll('.abcxyz-celda').forEach((btn) => {
    btn.addEventListener('click', () => {
      const abc = btn.dataset.abc;
      const xyz = btn.dataset.xyz;
      if (state.filtroABC === abc && state.filtroXYZ === xyz) {
        state.filtroABC = 'TODAS';
        state.filtroXYZ = 'TODAS';
      } else {
        state.filtroABC = abc;
        state.filtroXYZ = xyz;
      }
      renderABCXYZ();
    });
  });

  let rows = base;
  if (state.filtroABC !== 'TODAS') rows = rows.filter((m) => m.claseABC === state.filtroABC);
  if (state.filtroXYZ !== 'TODAS') rows = rows.filter((m) => m.claseXYZ === state.filtroXYZ);
  rows = [...rows].sort((a, b) => b.valorConsumoAnual - a.valorConsumoAnual);

  document.getElementById('conteo-abcxyz').textContent =
    state.filtroABC === 'TODAS' ? `${base.length} materiales` : `${rows.length} materiales en ${state.filtroABC}${state.filtroXYZ}`;

  const tbody = document.getElementById('tabla-abcxyz-body');
  const MAX_FILAS = 300;
  tbody.innerHTML = rows
    .slice(0, MAX_FILAS)
    .map(
      (m) => `<tr>
      <td>${m.material}</td>
      <td class="desc">${m.descripcion || ''}</td>
      <td>${m.denomGrupoArticulo || ''}</td>
      <td><span class="chip chip-cat-${m.categoria.toLowerCase()}">${m.categoria}</span></td>
      <td class="num">${m.valorConsumoAnual > 0 ? fmtSoles(m.valorConsumoAnual) : '<span class="muted">—</span>'}</td>
      <td><span class="chip chip-abc">${m.claseABC}</span></td>
      <td><span class="chip chip-xyz-${m.claseXYZ === 'N/D' ? 'nd' : m.claseXYZ.toLowerCase()}">${m.claseXYZ}</span></td>
      <td class="num">${fmtNum(m.stockFisico, 0)}</td>
      <td>${riesgoChip(m.riesgo)}</td>
    </tr>`
    )
    .join('');

  if (rows.length > MAX_FILAS) {
    tbody.innerHTML += `<tr><td colspan="9" class="muted centrado">… mostrando los primeros ${MAX_FILAS} — filtra por celda o categoría para ver un grupo más chico.</td></tr>`;
  }
}

// ---------------- COBERTURA (Insumos y Materia Prima) ----------------
function renderCobertura() {
  const coberturaIdeal = Number(document.getElementById('input-cobertura-ideal').value) || 12;
  state.coberturaIdealDias = coberturaIdeal;
  state.filtroCategoriaCobertura = document.getElementById('filtro-categoria-cobertura').value;

  let base = state.planificados;
  if (state.filtroCategoriaCobertura !== 'TODAS') {
    base = base.filter((m) => m.categoria === state.filtroCategoriaCobertura);
  }

  const filas = base.map((m) => {
    const stockIdealVivo = m.demandaDiariaPromedio * coberturaIdeal;
    const coberturaDiasVivo = m.demandaDiariaPromedio > 0 ? m.stockDisponibleTotal / m.demandaDiariaPromedio : null;
    const solicitarVivo = Math.max(0, stockIdealVivo - m.stockDisponibleTotal);
    return { ...m, stockIdealVivo, coberturaDiasVivo, solicitarVivo };
  });

  filas.sort((a, b) => (a.coberturaDiasVivo ?? Infinity) - (b.coberturaDiasVivo ?? Infinity));

  const bajoCobertura = filas.filter((m) => m.coberturaDiasVivo !== null && m.coberturaDiasVivo < coberturaIdeal);
  document.getElementById('kpi-cob-total').textContent = filas.length;
  document.getElementById('kpi-cob-bajo').textContent = bajoCobertura.length;
  document.getElementById('kpi-cob-solicitar').textContent = fmtNum(filas.reduce((acc, m) => acc + m.solicitarVivo, 0), 0);

  const tbody = document.getElementById('tabla-cobertura-body');
  const MAX_FILAS = 300;
  tbody.innerHTML = filas
    .slice(0, MAX_FILAS)
    .map((m) => {
      const claseColor = m.coberturaDiasVivo === null ? 'nd' : m.coberturaDiasVivo < coberturaIdeal ? 'roja' : 'verde';
      return `<tr>
      <td>${m.grupoArticulo || ''}</td>
      <td>${m.material}</td>
      <td class="desc">${m.descripcion || ''}</td>
      <td class="num">${fmtNum(m.demandaDiariaPromedio, 2)}</td>
      <td class="num">${fmtNum(m.demandaDiariaDesvest, 2)}</td>
      <td class="num">${coberturaIdeal}</td>
      <td class="num">${fmtNum(m.stockIdealVivo, 0)}</td>
      <td class="num">${fmtNum(m.stockFisico, 0)}</td>
      <td class="num"><span class="dot-cobertura dot-${claseColor}"></span>${m.coberturaDiasVivo === null ? '—' : fmtNum(m.coberturaDiasVivo, 0)}</td>
      <td class="num">${fmtNum(m.solicitarVivo, 0)}</td>
      <td class="num">${fmtNum(m.transito, 0)}</td>
      <td class="num">${fmtNum(m.planta, 0)}</td>
      <td>${m.stSAP ?? '<span class="muted">—</span>'}</td>
    </tr>`;
    })
    .join('');

  if (filas.length > MAX_FILAS) {
    tbody.innerHTML += `<tr><td colspan="13" class="muted centrado">… mostrando los primeros ${MAX_FILAS}.</td></tr>`;
  }
}

// ---------------- LISTA DE PEDIDO ----------------
function renderListaPedido() {
  const materialesMarcados = Object.keys(state.marcados);
  const items = materialesMarcados
    .map((material) => state.calculados.find((m) => m.material === material))
    .filter(Boolean);

  const total = items.length;
  const cantidadTotal = items.reduce((acc, m) => acc + (state.marcados[m.material] || 0), 0);
  const valorTotal = items.reduce((acc, m) => acc + (state.marcados[m.material] || 0) * (m.costoUnitario || 0), 0);
  const enRiesgo = items.filter((m) => m.riesgo === 'ROJO').length;

  document.getElementById('kpi-pedido-total').textContent = total;
  document.getElementById('kpi-pedido-cantidad').textContent = fmtNum(cantidadTotal, 0);
  document.getElementById('kpi-pedido-valor').textContent = fmtSoles(valorTotal);
  document.getElementById('kpi-pedido-rojo').textContent = enRiesgo;
  document.getElementById('conteo-pedido').textContent = `${total} materiales`;

  const tbody = document.getElementById('tabla-pedido-body');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted centrado">Todavía no marcaste ningún material — hazlo desde la pestaña Materiales, casilla "Pedir".</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .sort((a, b) => (b.riesgo === 'ROJO' ? 1 : 0) - (a.riesgo === 'ROJO' ? 1 : 0))
    .map((m) => {
      const cantidad = state.marcados[m.material] || 0;
      const valor = cantidad * (m.costoUnitario || 0);
      return `<tr>
      <td>${m.material}</td>
      <td class="desc">${m.descripcion || ''}</td>
      <td class="num">${fmtNum(m.stockFisico, 0)}</td>
      <td class="num">${fmtNum(m.ropCalculado, 1)}</td>
      <td class="num"><input type="number" min="0" step="1" class="input-cantidad-pedido" data-material="${m.material}" value="${cantidad}" /></td>
      <td class="num">${m.costoUnitario ? fmtSoles(m.costoUnitario) : '<span class="muted">—</span>'}</td>
      <td class="num">${m.costoUnitario ? fmtSoles(valor) : '<span class="muted">—</span>'}</td>
      <td>${riesgoChip(m.riesgo)}</td>
      <td><button type="button" class="btn-quitar-pedido" data-material="${m.material}">Quitar</button></td>
    </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.input-cantidad-pedido').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      actualizarCantidadPedido(e.target.dataset.material, e.target.value);
      renderListaPedido();
    });
  });
  tbody.querySelectorAll('.btn-quitar-pedido').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const material = e.target.dataset.material;
      delete state.marcados[material];
      guardarMarcados();
      renderListaPedido();
      renderTablaMateriales();
    });
  });
}

function exportarListaPedido() {
  const items = Object.keys(state.marcados)
    .map((material) => state.calculados.find((m) => m.material === material))
    .filter(Boolean);
  if (items.length === 0) {
    alert('No hay materiales marcados para exportar.');
    return;
  }
  const headers = ['Material', 'Descripción', 'Stock Real', 'ROP Calculado', 'Cantidad a Pedir', 'Costo Unitario', 'Valor Estimado', 'Riesgo'];
  const rows = items.map((m) => {
    const cantidad = state.marcados[m.material] || 0;
    return [
      m.material, m.descripcion, m.stockFisico, m.ropCalculado, cantidad,
      m.costoUnitario, cantidad * (m.costoUnitario || 0), m.riesgo,
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lista de Pedido');
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Lista_Pedido_L001_${fecha}.xlsx`);
}

// ---------------- MATERIALES PLANIFICADOS ----------------
function renderMaterialesPlanificados() {
  const planificados = state.planificados;
  const total = planificados.length;
  const reclasificados = planificados.filter((m) => m.reclasificadoDesdeUIN);
  const conStock = planificados.filter((m) => m.stockFisico > 0).length;
  const estrategicos = planificados.filter((m) => m.clasificacionFinal === 'Estratégico').length;

  document.getElementById('kpi-plan-total').textContent = total;
  document.getElementById('kpi-plan-reclasificados').textContent = reclasificados.length;
  document.getElementById('kpi-plan-stock').textContent = total > 0 ? `${Math.round((conStock / total) * 100)}%` : '0%';
  document.getElementById('kpi-plan-estrategicos').textContent = total > 0 ? `${Math.round((estrategicos / total) * 100)}%` : '0%';

  const sinTratamiento = planificados.filter((m) => m.ssActual === 0 && m.ropActual === 0);
  const sinTratAltaBaja = sinTratamiento.filter((m) => m.clasificacionFinal === 'Alta Rotación' || m.clasificacionFinal === 'Baja Rotación');
  document.getElementById('kpi-sintrat-total').textContent = sinTratamiento.length;
  document.getElementById('kpi-sintrat-altabaja').textContent = sinTratAltaBaja.length;
  document.getElementById('kpi-sintrat-pct').textContent = total > 0 ? `${Math.round((sinTratamiento.length / total) * 100)}%` : '0%';

  const excluidos = state.calculados.filter((m) => !m.incluidoEnPlanificacion);
  const porMotivo = {};
  excluidos.forEach((m) => {
    porMotivo[m.clasificacionFinal] = (porMotivo[m.clasificacionFinal] || 0) + 1;
  });
  const tbodyExcl = document.getElementById('tabla-exclusiones-body');
  tbodyExcl.innerHTML = Object.entries(porMotivo)
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, n]) => `<tr><td>${motivo}</td><td class="num">${n}</td></tr>`)
    .join('') || '<tr><td colspan="2" class="muted centrado">Ningún material quedó excluido.</td></tr>';

  const tbodyReclas = document.getElementById('tabla-reclasificados-body');
  tbodyReclas.innerHTML = reclasificados
    .sort((a, b) => b.diasConConsumo - a.diasConConsumo)
    .map(
      (m) => `<tr>
      <td>${m.material}</td>
      <td class="desc">${m.descripcion || ''}</td>
      <td><span class="chip ${m.clasificacionFinal === 'Alta Rotación' ? 'chip-verde' : 'chip-amarilla'}">${m.clasificacionFinal}</span></td>
      <td class="num">${m.motivoExclusion ? (m.motivoExclusion.match(/(\d+) de (\d+)/) || [])[0] || '' : ''}</td>
      <td class="num">${fmtNum(m.stockFisico, 0)}</td>
      <td>${riesgoChip(m.riesgo)}</td>
    </tr>`
    )
    .join('') || '<tr><td colspan="6" class="muted centrado">No hubo materiales Uso Inmediato con consumo suficiente para reclasificar.</td></tr>';
}

// ---------------- TENDENCIA POR PRODUCTO ----------------
function poblarListaTendencia() {
  const datalist = document.getElementById('lista-materiales-tendencia');
  datalist.innerHTML = state.calculados
    .map((m) => `<option value="${m.material} — ${(m.descripcion || '').replace(/"/g, '')}"></option>`)
    .join('');
}

function mostrarTendenciaMaterial(valorInput) {
  const codigo = (valorInput || '').split('—')[0].trim();
  const material = state.calculados.find((m) => m.material === codigo);

  if (!material) {
    document.getElementById('tendencia-vacio').style.display = 'block';
    document.getElementById('tendencia-contenido').style.display = 'none';
    return;
  }

  const serie = SupplyEngine.serieMensualPorMaterial(state.consumoReal, codigo);

  document.getElementById('tendencia-vacio').style.display = 'none';
  document.getElementById('tendencia-contenido').style.display = 'block';
  document.getElementById('tendencia-material-nombre').textContent = `${material.material} — ${material.descripcion || ''}`;
  document.getElementById('tendencia-material-clasif').textContent = `${material.clasificacion} · Temporada objetivo: ${material.temporadaObjetivo}`;

  if (serie.length === 0) {
    document.getElementById('tendencia-total').textContent = '0';
    document.getElementById('tendencia-promedio').textContent = '0';
    document.getElementById('tendencia-pico').textContent = '—';
    document.getElementById('tendencia-valle').textContent = '—';
    document.getElementById('tendencia-grafico').innerHTML = '<p class="muted centrado">Este material no registra consumo real en el período analizado.</p>';
    return;
  }

  const total = serie.reduce((a, p) => a + p.total, 0);
  const promedio = total / serie.length;
  const pico = serie.reduce((a, b) => (b.total > a.total ? b : a));
  const valle = serie.reduce((a, b) => (b.total < a.total ? b : a));

  document.getElementById('tendencia-total').textContent = fmtNum(total, 0);
  document.getElementById('tendencia-promedio').textContent = fmtNum(promedio, 1);
  document.getElementById('tendencia-pico').textContent = `${pico.mes} (${fmtNum(pico.total, 0)})`;
  document.getElementById('tendencia-valle').textContent = `${valle.mes} (${fmtNum(valle.total, 0)})`;

  document.getElementById('tendencia-grafico').innerHTML = construirGraficoLinea(serie);
}

function construirGraficoLinea(serie) {
  const W = 1000;
  const H = 260;
  const PAD_L = 50;
  const PAD_B = 30;
  const PAD_T = 20;
  const maxVal = Math.max(...serie.map((p) => p.total), 1);

  const puntos = serie.map((p, i) => {
    const x = PAD_L + (i / Math.max(serie.length - 1, 1)) * (W - PAD_L - 20);
    const y = PAD_T + (1 - p.total / maxVal) * (H - PAD_T - PAD_B);
    return { x, y, ...p };
  });

  const linea = puntos.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${PAD_L},${H - PAD_B} ${linea} ${puntos[puntos.length - 1].x.toFixed(1)},${H - PAD_B}`;

  const circulos = puntos
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#22d3ee" />`)
    .join('');

  const etiquetasX = puntos
    .filter((_, i) => i % Math.ceil(puntos.length / 12) === 0)
    .map((p) => `<text x="${p.x.toFixed(1)}" y="${H - 8}" font-size="10" fill="#8b96ab" text-anchor="middle">${p.mes.slice(2)}</text>`)
    .join('');

  const lineasGuia = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = PAD_T + f * (H - PAD_T - PAD_B);
    return `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - 20}" y2="${y.toFixed(1)}" stroke="#232d40" stroke-width="1" />`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">
    <defs>
      <linearGradient id="gradTendencia" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.35" />
        <stop offset="100%" stop-color="#22d3ee" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${lineasGuia}
    <polygon points="${area}" fill="url(#gradTendencia)" />
    <polyline points="${linea}" fill="none" stroke="#22d3ee" stroke-width="2.5" />
    ${circulos}
    ${etiquetasX}
  </svg>`;
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
  cargarMarcados();
  bindDropzone();
  bindTabs();
  bindFormularios();
  await cargarCacheAlIniciar();
});
