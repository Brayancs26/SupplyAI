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
      estadoTexto.textContent = 'Todavía no hay un programa publicado — avísale al administrador.';
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-guardar-conteo').addEventListener('click', guardarConteo);
  cargarProgramaParaContar();
});
