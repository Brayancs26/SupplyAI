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
      estadoTexto.textContent = 'Todavía no hay un programa por zonas publicado — avísale al administrador. (La toma por categoría de arriba sí está disponible.)';
      return;
    }
    state.programa = programa;
    document.getElementById('panel-sin-programa').style.display = 'none';
    document.getElementById('contar-contenido').style.display = 'block';
    mostrarSemanaActual();
    poblarSelectorZonas();
  } catch (err) {
    console.error(err);
    estadoTexto.textContent = 'Error leyendo el programa: ' + err.message;
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
  const contadoPor = document.getElementById('input-contado-por').value.trim();
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

async function cargarEspeciales() {
  const cont = document.getElementById('especiales-botones');
  cont.innerHTML = '<p class="muted">Buscando…</p>';
  const resultados = await Promise.all(
    TIPOS_ESPECIALES.map(async (t) => {
      try { return { ...t, datos: await GitHubSync.leerJSONPublico(`conteo/especiales/${t.tipo}.json`) }; }
      catch (e) { return { ...t, datos: null }; }
    })
  );
  cont.innerHTML = resultados
    .map((r) => {
      if (!r.datos || !(r.datos.items || []).length) {
        return `<button type="button" class="btn-zona" disabled style="opacity:.5">${r.titulo}<span>Sin datos — el administrador debe enviarlos</span></button>`;
      }
      espState.datos[r.tipo] = r.datos;
      const cuando = r.datos.generadoEn ? new Date(r.datos.generadoEn).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '';
      return `<button type="button" class="btn-zona" data-tipo="${r.tipo}">${r.titulo}<span>${r.datos.items.length} filas · datos del ${cuando}</span></button>`;
    })
    .join('');
  cont.querySelectorAll('.btn-zona[data-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => abrirEspecial(btn.dataset.tipo));
  });
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
  espState.tipo = tipo;
  let filas = datos.items.map(filaEspecialDesdeItem);
  const borrador = leerBorrador(tipo);
  if (borrador && borrador.fecha === hoyISO() && Array.isArray(borrador.filas) && borrador.filas.length && confirm('Tienes una toma sin guardar de hoy. ¿Continuar donde la dejaste?')) {
    filas = borrador.filas;
  }
  espState.filas = filas;
  document.getElementById('especial-titulo').textContent = datos.titulo;
  document.getElementById('especial-subtitulo').textContent = 'Anota la cantidad real. Lote y ubicación vienen del sistema — cámbialos solo si son distintos.';
  renderEspecial();
  document.getElementById('especial-formulario').style.display = 'block';
  document.getElementById('estado-especial-guardar').textContent = '';
  document.getElementById('especial-formulario').scrollIntoView({ behavior: 'smooth' });
}

function renderEspecial() {
  const lista = document.getElementById('lista-especial');
  lista.innerHTML = espState.filas
    .map(
      (f, i) => `<div class="fila-especial${f.agregada ? ' fila-especial-nueva' : ''}">
      <div class="fila-especial-cab">
        <span class="fila-conteo-material">${esc(f.material)}</span>
        ${f.agregada ? `<button type="button" class="btn-quitar-fila" data-i="${i}">Quitar</button>` : ''}
      </div>
      <div class="fila-especial-desc">${esc(f.descripcion)}</div>
      <div class="fila-especial-sistema">
        Sistema: <strong>${fmtNum(f.cantidadSistema, 2)} ${esc(f.um)}</strong>
        · Lote: <strong>${esc(f.loteSistema) || '—'}</strong>
        · Ubic.: <strong>${esc(f.ubicacionSistema) || '—'}</strong>
      </div>
      <div class="fila-especial-campos">
        <label>Cantidad real<input type="number" inputmode="decimal" step="0.01" data-i="${i}" data-campo="cantidadFisica" value="${esc(f.cantidadFisica)}" placeholder="0" /></label>
        <label>Lote<input type="text" data-i="${i}" data-campo="loteFisico" value="${esc(f.loteFisico)}" placeholder="—" /></label>
        <label>Ubicación<input type="text" data-i="${i}" data-campo="ubicacionFisica" value="${esc(f.ubicacionFisica)}" placeholder="—" /></label>
      </div>
    </div>`
    )
    .join('');
  lista.querySelectorAll('input[data-campo]').forEach((inp) => {
    inp.addEventListener('input', () => {
      espState.filas[Number(inp.dataset.i)][inp.dataset.campo] = inp.value;
      guardarBorrador(espState.tipo, espState.filas);
    });
  });
  lista.querySelectorAll('.btn-quitar-fila').forEach((btn) => {
    btn.addEventListener('click', () => {
      espState.filas.splice(Number(btn.dataset.i), 1);
      guardarBorrador(espState.tipo, espState.filas);
      renderEspecial();
    });
  });
}

function agregarFilaEspecial() {
  const datos = espState.datos[espState.tipo];
  if (!datos) return;
  // materiales distintos de esta categoría
  const materiales = [];
  const vistos = new Set();
  datos.items.forEach((it) => { if (!vistos.has(it.material)) { vistos.add(it.material); materiales.push(it); } });
  let elegido = materiales[0];
  if (materiales.length > 1) {
    const opciones = materiales.map((m, i) => `${i + 1}) ${m.material} — ${m.descripcion}`).join('\n');
    const resp = prompt(`¿Para qué material es la fila nueva? Escribe el número:\n${opciones}`);
    const idx = Number(resp) - 1;
    if (!(idx >= 0 && idx < materiales.length)) return;
    elegido = materiales[idx];
  }
  espState.filas.push({
    id: `nueva|${Date.now()}`, material: elegido.material, descripcion: elegido.descripcion, um: elegido.um || '',
    almacen: elegido.almacen || '', loteSistema: '', ubicacionSistema: '', cantidadSistema: 0,
    cantidadFisica: '', loteFisico: '', ubicacionFisica: elegido.ubicacion || '', agregada: true,
  });
  guardarBorrador(espState.tipo, espState.filas);
  renderEspecial();
}

async function guardarEspecial() {
  const tipo = espState.tipo;
  if (!tipo) return;
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
  const contadoPor = document.getElementById('input-especial-contado-por').value.trim();
  try {
    await GitHubSync.escribirJSON(
      `${GitHubSync.RUTA_RESULTADOS}/ESPECIAL-${tipo.toUpperCase()}_${fecha}.json`,
      { zona: titulo, categoria: tipo, fecha, contadoPor: contadoPor || null, items },
      `Toma de inventario ${titulo} — ${fecha}`
    );
    borrarBorrador(tipo);
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-guardar-conteo').addEventListener('click', guardarConteo);
  document.getElementById('btn-especial-agregar').addEventListener('click', agregarFilaEspecial);
  document.getElementById('btn-especial-guardar').addEventListener('click', guardarEspecial);
  cargarEspeciales();
  cargarProgramaParaContar();
});
