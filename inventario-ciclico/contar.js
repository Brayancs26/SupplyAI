// ============================================================
// CONTAR — página simple para el celular del personal.
// Entra, ve qué zona toca esta semana, cuenta, guarda. Sin pestañas.
// ============================================================

const state = {
  programa: null,
  zonaSeleccionada: null,
};

const fmtNum = (n, dec = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString('es-PE', { maximumFractionDigits: dec, minimumFractionDigits: dec });

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------- NOMBRE DEL CONTADOR (obligatorio) ----------------
const CLAVE_NOMBRE = 'contador_nombre';
function nombreContador() {
  const el = document.getElementById('input-nombre-contador');
  return el ? el.value.trim() : '';
}
/** Devuelve true si ya hay nombre; si no, avisa, marca el campo y sube hasta él. */
function requerirNombre() {
  if (nombreContador().length >= 2) return true;
  const el = document.getElementById('input-nombre-contador');
  const ayuda = document.getElementById('nombre-ayuda');
  el.classList.add('input-error');
  ayuda.textContent = 'Primero escribe tu nombre — sin nombre no puedes contar.';
  ayuda.classList.add('texto-error');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus();
  return false;
}
function iniciarCampoNombre() {
  const el = document.getElementById('input-nombre-contador');
  try { el.value = localStorage.getItem(CLAVE_NOMBRE) || ''; } catch (e) { /* sin storage */ }
  el.addEventListener('input', () => {
    try { localStorage.setItem(CLAVE_NOMBRE, el.value.trim()); } catch (e) { /* sin storage */ }
    if (el.value.trim().length >= 2) {
      el.classList.remove('input-error');
      const ayuda = document.getElementById('nombre-ayuda');
      ayuda.textContent = 'Escribe tu nombre para poder empezar. Es obligatorio.';
      ayuda.classList.remove('texto-error');
    }
  });
}

function setEstadoCarga(on, mensaje) {
  const overlay = document.getElementById('loading-overlay');
  overlay.style.display = on ? 'flex' : 'none';
  if (mensaje) document.getElementById('loading-msg').textContent = mensaje;
}

async function cargarProgramaParaContar() {
  const estadoTexto = document.getElementById('estado-programa');
  try {
    const programa = await GitHubSync.leerJSONPublico(GitHubSync.RUTA_PROGRAMA);
    if (!programa) {
      state.hayPrograma = false;
      actualizarVistaVacia();
      return;
    }
    state.hayPrograma = true;
    state.programa = programa;
    document.getElementById('contar-contenido').style.display = 'block';
    actualizarVistaVacia();
    mostrarSemanaActual();
    poblarSelectorZonas();
  } catch (err) {
    console.error(err);
    state.hayPrograma = false;
    actualizarVistaVacia();
  }
}

function mostrarSemanaActual() {
  const { semanaEnCiclo } = CicloEngine.semanaActualDelCiclo(state.programa.fechaInicio, state.programa.cicloSemanas, hoyISO());
  document.getElementById('semana-actual-valor').textContent = `${semanaEnCiclo} / ${state.programa.cicloSemanas}`;
  state.semanaEnCicloActual = semanaEnCiclo;

  const zonasSemana = state.programa.zonas.filter((z) => z.semana === semanaEnCiclo);
  const cont = document.getElementById('zonas-esta-semana-botones');
  if (zonasSemana.length === 0) {
    cont.innerHTML = '<p class="muted">No hay zonas asignadas esta semana.</p>';
    return;
  }
  cont.innerHTML = zonasSemana
    .map((z) => `<button type="button" class="btn-zona" data-zona="${z.zona}">${z.zona}<span>${z.materiales.length} materiales</span></button>`)
    .join('');
  cont.querySelectorAll('.btn-zona').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('selector-zona').value = btn.dataset.zona;
      mostrarFormularioConteo(btn.dataset.zona);
      document.getElementById('conteo-formulario').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

function poblarSelectorZonas() {
  const sel = document.getElementById('selector-zona');
  const zonas = [...state.programa.zonas].sort((a, b) => a.zona.localeCompare(b.zona));
  sel.innerHTML =
    '<option value="">— Elige una zona —</option>' +
    zonas.map((z) => `<option value="${z.zona}">${z.zona} (semana ${z.semana}) — ${z.materiales.length} materiales</option>`).join('');
  sel.addEventListener('change', () => mostrarFormularioConteo(sel.value));
}

function mostrarFormularioConteo(zonaNombre) {
  const contenedor = document.getElementById('conteo-formulario');
  if (!zonaNombre) {
    contenedor.style.display = 'none';
    return;
  }
  if (!requerirNombre()) {
    const sel = document.getElementById('selector-zona');
    if (sel) sel.value = '';
    contenedor.style.display = 'none';
    return;
  }
  const zona = state.programa.zonas.find((z) => z.zona === zonaNombre);
  if (!zona) return;
  state.zonaSeleccionada = zona;

  document.getElementById('zona-titulo').textContent = `Zona: ${zona.zona}`;
  document.getElementById('zona-subtitulo').textContent = `${zona.materiales.length} materiales — anota lo que cuentes físicamente.`;

  const lista = document.getElementById('lista-conteo-movil');
  lista.innerHTML = zona.materiales
    .map(
      (m) => `<div class="fila-conteo-movil">
      <div class="fila-conteo-info">
        <span class="fila-conteo-material">${m.material}</span>
        <span class="fila-conteo-desc">${m.descripcion}</span>
        <span class="fila-conteo-sistema">Sistema: ${fmtNum(m.cantidadSistema, 2)} ${m.um || ''}</span>
      </div>
      <input type="number" inputmode="decimal" step="0.01" class="input-fisico-movil" data-material="${m.material}" placeholder="0" />
    </div>`
    )
    .join('');

  contenedor.style.display = 'block';
  document.getElementById('estado-guardar-conteo').textContent = '';
}

async function guardarConteo() {
  const zona = state.zonaSeleccionada;
  if (!zona) return;
  if (!requerirNombre()) return;
  const estado = document.getElementById('estado-guardar-conteo');
  const boton = document.getElementById('btn-guardar-conteo');

  const items = zona.materiales.map((m) => {
    const input = document.querySelector(`.input-fisico-movil[data-material="${m.material}"]`);
    const cantidadFisica = input && input.value !== '' ? Number(input.value) : null;
    return { material: m.material, descripcion: m.descripcion, cantidadSistema: m.cantidadSistema, cantidadFisica };
  });

  const sinContar = items.filter((it) => it.cantidadFisica === null).length;
  if (sinContar > 0 && !confirm(`Te faltan ${sinContar} materiales sin cantidad física. ¿Guardar igual?`)) return;

  boton.disabled = true;
  estado.className = 'estado-publicar';
  estado.textContent = 'Guardando…';

  const fecha = hoyISO();
  const contadoPor = nombreContador();
  const ruta = `${GitHubSync.RUTA_RESULTADOS}/${CicloEngine.slugZona(zona.zona)}_${fecha}.json`;

  try {
    await GitHubSync.escribirJSON(
      ruta,
      { zona: zona.zona, fecha, contadoPor: contadoPor || null, items },
      `Conteo de zona ${zona.zona} — ${fecha}`
    );
    estado.className = 'estado-publicar ok';
    estado.textContent = '✓ Guardado — gracias.';
  } catch (err) {
    console.error(err);
    estado.className = 'estado-publicar error';
    estado.textContent = 'Error: ' + err.message;
  } finally {
    boton.disabled = false;
  }
}

// ============================================================
// TOMA POR CATEGORÍA (Combustibles / Gases / IQBF)
// El administrador envía las filas desde Abastecimiento → Reportes.
// Aquí el personal anota cantidad, lote y ubicación reales.
// ============================================================
const TIPOS_ESPECIALES = [
  { tipo: 'combustibles', titulo: 'Combustible' },
  { tipo: 'gases', titulo: 'Balones de Gases' },
  { tipo: 'iqbf', titulo: 'IQBF (Insumos Químicos)' },
];
const espState = { tipo: null, datos: {}, filas: [] }; // filas = lo que se ve en pantalla

const esc = (t) => String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function claveBorrador(tipo) { return `toma_${tipo}_borrador`; }
function leerBorrador(tipo) {
  try { return JSON.parse(localStorage.getItem(claveBorrador(tipo)) || 'null'); } catch (e) { return null; }
}
function guardarBorrador(tipo, filas) {
  try { localStorage.setItem(claveBorrador(tipo), JSON.stringify({ fecha: hoyISO(), filas })); } catch (e) { /* sin storage */ }
}
function borrarBorrador(tipo) {
  try { localStorage.removeItem(claveBorrador(tipo)); } catch (e) { /* sin storage */ }
}

// Una toma se considera terminada si hay un "estado" con el mismo envío (generadoEn),
// o si este celular ya la guardó (por si GitHub aún no refleja el cambio).
function terminadaLocal(tipo, generadoEn) {
  try { return localStorage.getItem(`toma_terminada_${tipo}`) === String(generadoEn); } catch (e) { return false; }
}
function marcarTerminadaLocal(tipo, generadoEn) {
  try { localStorage.setItem(`toma_terminada_${tipo}`, String(generadoEn)); } catch (e) { /* sin storage */ }
}

async function cargarEspeciales() {
  const cont = document.getElementById('especiales-botones');
  const resultados = await Promise.all(
    TIPOS_ESPECIALES.map(async (t) => {
      try {
        const [datos, estado] = await Promise.all([
          GitHubSync.leerJSONPublico(`conteo/especiales/${t.tipo}.json`),
          GitHubSync.leerJSONPublico(`conteo/especiales/${t.tipo}_estado.json`).catch(() => null),
        ]);
        return { ...t, datos, estado };
      } catch (e) { return { ...t, datos: null, estado: null }; }
    })
  );
  // Solo se muestran las tomas enviadas que aún no se terminaron
  const pendientes = resultados.filter(
    (r) =>
      r.datos && (r.datos.items || []).length > 0 &&
      !r.datos.completadoEn &&
      !(r.estado && r.estado.generadoEn === r.datos.generadoEn) &&
      !terminadaLocal(r.tipo, r.datos.generadoEn)
  );
  espState.pendientes = pendientes.length;
  pendientes.forEach((r) => (espState.datos[r.tipo] = r.datos));
  cont.innerHTML = pendientes
    .map((r) => {
      const cuando = r.datos.generadoEn ? new Date(r.datos.generadoEn).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '';
      return `<button type="button" class="btn-zona" data-tipo="${r.tipo}">${r.titulo}<span>${r.datos.items.length} filas · enviado ${cuando}</span></button>`;
    })
    .join('');
  document.getElementById('panel-especiales').style.display = pendientes.length ? 'block' : 'none';
  cont.querySelectorAll('.btn-zona[data-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => abrirEspecial(btn.dataset.tipo));
  });
  actualizarVistaVacia();
}

// Muestra "nada pendiente" solo si no hay tomas por categoría ni programa por zonas
function actualizarVistaVacia() {
  if (state.hayPrograma === undefined || espState.pendientes === undefined) return;
  const vacio = !state.hayPrograma && espState.pendientes === 0;
  const panel = document.getElementById('panel-nada-pendiente');
  if (panel && !panel.dataset.fijo) panel.style.display = vacio ? 'block' : 'none';
  document.getElementById('panel-nombre').style.display = vacio ? 'none' : 'block';
}

function filaEspecialDesdeItem(it) {
  return {
    id: it.id, material: it.material, descripcion: it.descripcion, um: it.um || '',
    almacen: it.almacen || '', loteSistema: it.lote || '', ubicacionSistema: it.ubicacion || '',
    cantidadSistema: it.cantidadSistema, cantidadFisica: '', loteFisico: it.lote || '', ubicacionFisica: it.ubicacion || '',
    agregada: false,
  };
}

function abrirEspecial(tipo) {
  const datos = espState.datos[tipo];
  if (!datos) return;
  if (terminadaLocal(tipo, datos.generadoEn)) { cargarEspeciales(); return; }
  if (!requerirNombre()) return;
  espState.tipo = tipo;
  let filas = datos.items.map(filaEspecialDesdeItem);
  const borrador = leerBorrador(tipo);
  if (borrador && borrador.fecha === hoyISO() && Array.isArray(borrador.filas) && borrador.filas.length && confirm('Tienes una toma sin guardar de hoy. ¿Continuar donde la dejaste?')) {
    filas = borrador.filas;
  }
  espState.filas = filas;
  espState.abiertos = new Set();
  document.getElementById('especial-titulo').textContent = datos.titulo;
  document.getElementById('especial-subtitulo').textContent = 'Anota la cantidad real. Lote y ubicación vienen del sistema — cámbialos solo si son distintos.';
  renderEspecial();
  document.getElementById('especial-formulario').style.display = 'block';
  document.getElementById('estado-especial-guardar').textContent = '';
  document.getElementById('especial-formulario').scrollIntoView({ behavior: 'smooth' });
}

const sumaNum = (arr) => arr.reduce((s, v) => s + (Number(v) || 0), 0);

function resumenGrupoHTML(filas) {
  const totalSistema = sumaNum(filas.map((f) => f.cantidadSistema));
  const contadas = filas.filter((f) => f.cantidadFisica !== '' && f.cantidadFisica !== null);
  const um = esc(filas[0].um);
  if (contadas.length === 0) {
    return `<span class="grupo-real grupo-real-vacio">Real: —</span><span class="grupo-sistema">Sistema: ${fmtNum(totalSistema, 2)} ${um}</span>`;
  }
  const totalReal = sumaNum(contadas.map((f) => f.cantidadFisica));
  const dif = totalReal - totalSistema;
  const claseDif = Math.abs(dif) < 1e-9 ? 'dif-ok' : 'dif-mal';
  return `<span class="grupo-real">Real: ${fmtNum(totalReal, 2)} ${um}</span><span class="grupo-sistema">Sistema: ${fmtNum(totalSistema, 2)} · <span class="${claseDif}">Dif: ${dif > 0 ? '+' : ''}${fmtNum(dif, 2)}</span></span>`;
}

function filaLoteHTML(f, i) {
  return `<div class="lote-fila${f.agregada ? ' lote-fila-nueva' : ''}">
    <div class="lote-fila-cab">
      <span class="lote-fila-sistema">Lote <strong>${esc(f.loteSistema) || 'nuevo'}</strong> · Stock: <strong>${fmtNum(f.cantidadSistema, 2)} ${esc(f.um)}</strong> · Ubic.: <strong>${esc(f.ubicacionSistema) || '—'}</strong></span>
      ${f.agregada ? `<button type="button" class="btn-quitar-fila" data-i="${i}">Quitar</button>` : ''}
    </div>
    <div class="fila-especial-campos">
      <label>Cantidad real<input type="number" inputmode="decimal" step="0.01" data-i="${i}" data-campo="cantidadFisica" value="${esc(f.cantidadFisica)}" placeholder="0" /></label>
      <label>Lote<input type="text" data-i="${i}" data-campo="loteFisico" value="${esc(f.loteFisico)}" placeholder="—" /></label>
      <label>Ubicación<input type="text" data-i="${i}" data-campo="ubicacionFisica" value="${esc(f.ubicacionFisica)}" placeholder="—" /></label>
    </div>
  </div>`;
}

function renderEspecial() {
  const lista = document.getElementById('lista-especial');
  if (!espState.abiertos) espState.abiertos = new Set();
  // agrupar por material conservando el índice real de cada fila
  const grupos = new Map();
  espState.filas.forEach((f, i) => {
    if (!grupos.has(f.material)) grupos.set(f.material, []);
    grupos.get(f.material).push(i);
  });
  lista.innerHTML = [...grupos.entries()]
    .map(([material, indices]) => {
      const filas = indices.map((i) => espState.filas[i]);
      const abierto = espState.abiertos.has(material);
      return `<div class="grupo-material${abierto ? ' abierto' : ''}" data-material="${esc(material)}">
        <button type="button" class="grupo-cab" data-material="${esc(material)}">
          <span class="chevron">▸</span>
          <span class="grupo-info"><span class="fila-conteo-material">${esc(material)}</span><span class="grupo-desc">${esc(filas[0].descripcion)}</span></span>
          <span class="grupo-totales">${resumenGrupoHTML(filas)}</span>
        </button>
        <div class="grupo-cuerpo">
          ${indices.map((i) => filaLoteHTML(espState.filas[i], i)).join('')}
          <button type="button" class="btn-secundario btn-agregar-lote" data-material="${esc(material)}">+ Agregar lote</button>
        </div>
      </div>`;
    })
    .join('');

  lista.querySelectorAll('.grupo-cab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!requerirNombre()) return;
      const m = btn.dataset.material;
      const cont = btn.closest('.grupo-material');
      if (espState.abiertos.has(m)) espState.abiertos.delete(m); else espState.abiertos.add(m);
      cont.classList.toggle('abierto', espState.abiertos.has(m));
    });
  });
  lista.querySelectorAll('input[data-campo]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const f = espState.filas[Number(inp.dataset.i)];
      f[inp.dataset.campo] = inp.value;
      guardarBorrador(espState.tipo, espState.filas);
      if (inp.dataset.campo === 'cantidadFisica') {
        const grupo = inp.closest('.grupo-material');
        const filasGrupo = espState.filas.filter((x) => x.material === f.material);
        grupo.querySelector('.grupo-totales').innerHTML = resumenGrupoHTML(filasGrupo);
      }
    });
  });
  lista.querySelectorAll('.btn-quitar-fila').forEach((btn) => {
    btn.addEventListener('click', () => {
      espState.filas.splice(Number(btn.dataset.i), 1);
      guardarBorrador(espState.tipo, espState.filas);
      renderEspecial();
    });
  });
  lista.querySelectorAll('.btn-agregar-lote').forEach((btn) => {
    btn.addEventListener('click', () => agregarLoteAMaterial(btn.dataset.material));
  });
}

function agregarLoteAMaterial(material) {
  const base = espState.filas.find((f) => f.material === material);
  if (!base) return;
  espState.filas.push({
    id: `nueva|${Date.now()}`, material, descripcion: base.descripcion, um: base.um,
    almacen: base.almacen, loteSistema: '', ubicacionSistema: '', cantidadSistema: 0,
    cantidadFisica: '', loteFisico: '', ubicacionFisica: base.ubicacionSistema || '', agregada: true,
  });
  espState.abiertos.add(material);
  guardarBorrador(espState.tipo, espState.filas);
  renderEspecial();
}

async function guardarEspecial() {
  const tipo = espState.tipo;
  if (!tipo) return;
  if (!requerirNombre()) return;
  const estado = document.getElementById('estado-especial-guardar');
  const boton = document.getElementById('btn-especial-guardar');
  const titulo = espState.datos[tipo].titulo;

  const items = espState.filas.map((f) => ({
    material: f.material,
    descripcion: f.descripcion,
    almacen: f.almacen,
    cantidadSistema: f.cantidadSistema,
    cantidadFisica: f.cantidadFisica === '' ? null : Number(f.cantidadFisica),
    loteSistema: f.loteSistema,
    loteFisico: String(f.loteFisico || '').trim(),
    ubicacionSistema: f.ubicacionSistema,
    ubicacionFisica: String(f.ubicacionFisica || '').trim(),
    agregada: !!f.agregada,
  }));
  const sinContar = items.filter((it) => it.cantidadFisica === null).length;
  if (sinContar > 0 && !confirm(`Te faltan ${sinContar} filas sin cantidad real. ¿Guardar igual?`)) return;

  boton.disabled = true;
  estado.className = 'estado-publicar';
  estado.textContent = 'Guardando…';
  const fecha = hoyISO();
  const contadoPor = nombreContador();
  try {
    await GitHubSync.escribirJSON(
      `${GitHubSync.RUTA_RESULTADOS}/ESPECIAL-${tipo.toUpperCase()}_${fecha}.json`,
      { zona: titulo, categoria: tipo, fecha, contadoPor: contadoPor || null, items },
      `Toma de inventario ${titulo} — ${fecha}`
    );
    // Marca la toma como terminada (archivo aparte, para no pisar un envío nuevo del administrador)
    const generadoEn = espState.datos[tipo].generadoEn;
    marcarTerminadaLocal(tipo, generadoEn);
    await GitHubSync.escribirJSON(
      `conteo/especiales/${tipo}_estado.json`,
      { generadoEn, completadoEn: new Date().toISOString(), completadoPor: contadoPor || null },
      `Toma terminada — ${titulo}`
    );
    borrarBorrador(tipo);
    delete espState.datos[tipo];
    espState.tipo = null;
    espState.filas = [];
    document.getElementById('lista-especial').innerHTML = '';
    document.getElementById('especial-formulario').style.display = 'none';
    const panel = document.getElementById('panel-nada-pendiente');
    document.getElementById('nada-titulo').textContent = `✓ ${titulo} guardado — gracias`;
    document.getElementById('nada-sub').textContent = 'Tu conteo ya quedó registrado.';
    panel.dataset.fijo = '1';
    panel.style.display = 'block';
    await cargarEspeciales();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    estado.className = 'estado-publicar error';
    estado.textContent = 'Error: ' + err.message;
  } finally {
    boton.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  iniciarCampoNombre();
  document.getElementById('btn-guardar-conteo').addEventListener('click', guardarConteo);
  document.getElementById('btn-especial-guardar').addEventListener('click', guardarEspecial);
  cargarEspeciales().then(() => {
    const t = new URLSearchParams(location.search).get('tipo');
    if (t && espState.datos[t]) abrirEspecial(t);
  });
  cargarProgramaParaContar();
});
