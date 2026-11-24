// ============================================================
// ADMIN · Verificación de ubicaciones (una sola tarjeta).
// Usa el MB52 que Abastecimiento ya guardó en este navegador,
// lo envía al celular y junta lo que se escaneó para pasarlo a SAP.
// ============================================================

const UbicAdmin = (() => {
  const ALMACEN = 'L001';
  const st = { envio: null, marcas: {}, sap: { cargados: {} }, mb52: null, mb52Fecha: null, filtro: 'mov', filas: [] };
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtFecha = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  // ---- MB52 guardado por Abastecimiento (mismo sitio → misma IndexedDB) ----
  function leerMB52() {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open('abastecimiento_l001_db', 1); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('archivos')) req.result.createObjectStore('archivos', { keyPath: 'tipo' }); };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const g = req.result.transaction('archivos', 'readonly').objectStore('archivos').get('MB52');
          g.onsuccess = () => resolve(g.result || null);
          g.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      };
    });
  }

  function mensaje(txt, tipo = '') {
    const el = $('ubic-estado');
    el.className = 'estado-publicar ' + tipo;
    el.textContent = txt;
  }

  // ---- Enviar al celular ----
  async function enviar(desdeCero) {
    if (!st.mb52) { mensaje('Primero carga tu MB52 en Abastecimiento (en esta misma PC y navegador).', 'error'); return; }
    const items = Ubic.itemsDesdeMB52(st.mb52.filas, ALMACEN);
    if (!items.length) { mensaje(`El MB52 no trae filas del almacén ${ALMACEN}.`, 'error'); return; }
    const sinUbic = items.filter((i) => !i.u).length;
    const sigueActiva = st.envio && st.envio.activa && !desdeCero;
    if (desdeCero && st.envio && st.envio.activa &&
      !confirm('Empezar de cero descarta todo lo escaneado en la verificación actual. ¿Seguro?')) return;
    const ahora = new Date().toISOString();
    const envio = {
      titulo: 'Verificación de ubicaciones',
      almacen: ALMACEN,
      campana: sigueActiva ? st.envio.campana : ahora,
      generadoEn: ahora,
      activa: true,
      mb52Fecha: st.mb52.fechaCarga || null,
      items,
    };
    $('ubic-btn-enviar').disabled = true;
    mensaje('Enviando al celular…');
    try {
      await GitHubSync.escribirJSON(Ubic.RUTA_ENVIO, envio, `Verificación de ubicaciones — ${items.length} materiales`);
      st.envio = envio;
      if (!sigueActiva) { st.marcas = {}; st.sap = { campana: envio.campana, cargados: {} }; }
      mensaje(`✓ Enviado: ${items.length} materiales de ${ALMACEN}${sinUbic ? ` (${sinUbic} sin ubicación en SAP)` : ''}.`, 'ok');
      render();
    } catch (e) {
      mensaje('Error al enviar: ' + e.message, 'error');
    } finally { $('ubic-btn-enviar').disabled = false; }
  }

  async function cerrar() {
    if (!st.envio || !st.envio.activa) return;
    if (!confirm('¿Cerrar la verificación? Deja de aparecer en los celulares; los resultados se conservan aquí.')) return;
    try {
      const envio = { ...st.envio, activa: false, cerradaEn: new Date().toISOString() };
      await GitHubSync.escribirJSON(Ubic.RUTA_ENVIO, envio, 'Verificación de ubicaciones cerrada');
      st.envio = envio;
      mensaje('✓ Verificación cerrada.', 'ok');
      render();
    } catch (e) { mensaje('Error: ' + e.message, 'error'); }
  }

  // ---- Leer lo escaneado ----
  async function actualizar() {
    const btn = $('ubic-btn-actualizar');
    btn.disabled = true;
    mensaje('Leyendo lo escaneado…');
    try {
      const [envio, sap, archivos] = await Promise.all([
        GitHubSync.leerJSONFresco(Ubic.RUTA_ENVIO).catch(() => null),
        GitHubSync.leerJSONFresco(Ubic.RUTA_SAP).catch(() => null),
        GitHubSync.listarCarpeta(Ubic.CARPETA).catch(() => []),
      ]);
      st.envio = envio;
      const deMarcas = archivos.filter((f) => f.name.startsWith(Ubic.PREFIJO_MARCAS));
      const marcas = await Promise.all(deMarcas.map((f) => GitHubSync.leerJSONFresco(`${Ubic.CARPETA}/${f.name}`).catch(() => null)));
      st.marcas = envio ? Ubic.unirMarcas(marcas, envio.campana) : {};
      st.sap = sap && envio && sap.campana === envio.campana ? sap : { campana: envio && envio.campana, cargados: {} };
      const personas = new Set(Object.values(st.marcas).map((m) => m.por).filter(Boolean));
      mensaje(envio ? `✓ ${Object.keys(st.marcas).length} materiales revisados${personas.size ? ' por ' + [...personas].join(', ') : ''}.` : 'Todavía no se ha enviado ninguna verificación.', envio ? 'ok' : '');
      render();
    } catch (e) {
      mensaje('Error: ' + e.message, 'error');
    } finally { btn.disabled = false; }
  }

  // ---- Armar filas con el estado de cada material ----
  function armarFilas() {
    if (!st.envio) return [];
    // la ubicación "de SAP" sale del MB52 más reciente que tengas cargado (así detecta lo ya corregido)
    const hoy = new Map();
    if (st.mb52) Ubic.itemsDesdeMB52(st.mb52.filas, ALMACEN).forEach((i) => hoy.set(Ubic.clave(i.m, i.a), i.u));
    return st.envio.items.map((i) => {
      const k = Ubic.clave(i.m, i.a);
      const ubicSap = hoy.has(k) ? hoy.get(k) : i.u;
      const mk = st.marcas[k];
      return {
        k, material: i.m, descripcion: i.d, centro: i.c, almacen: i.a, ubicSap,
        ubicFisica: mk && mk.s !== 'nf' ? mk.n : '',
        estado: Ubic.estado(ubicSap, mk, st.sap.cargados[k]),
        fecha: mk ? mk.t : '', por: mk ? mk.por : '',
      };
    });
  }

  function render() {
    const cont = $('ubic-cuerpo');
    $('ubic-mb52').innerHTML = st.mb52
      ? `Se lee (sin modificarlo) el MB52 de este navegador: <strong>${esc(st.mb52.nombreArchivo || 'MB52')}</strong> · ${fmtFecha(st.mb52.fechaCarga)}`
      : '<span class="texto-error">No hay MB52 en este navegador — cárgalo primero en Abastecimiento.</span>';
    const activa = st.envio && st.envio.activa;
    $('ubic-btn-enviar').textContent = activa ? 'Reenviar lista al celular' : 'Enviar al celular';
    $('ubic-btn-cero').style.display = activa ? '' : 'none';
    $('ubic-btn-cerrar').style.display = activa ? '' : 'none';
    $('ubic-enlaces').style.display = activa ? 'inline-flex' : 'none';
    $('ubic-envio-info').textContent = st.envio
      ? `${activa ? 'En curso' : 'Cerrada'} · enviada ${fmtFecha(st.envio.generadoEn)} · ${st.envio.items.length} materiales`
      : '';
    if (!st.envio) { cont.style.display = 'none'; return; }
    cont.style.display = 'block';

    st.filas = armarFilas();
    const c = { pend: 0, ok: 0, mov: 0, nf: 0, sap: 0 };
    st.filas.forEach((f) => c[f.estado]++);
    const revisados = c.ok + c.mov + c.nf + c.sap;
    const exactitud = revisados ? (c.ok / revisados) * 100 : null;
    const kpis = [
      ['mov', 'Actualizar en SAP', c.mov, 'kpi-ambar'],
      ['nf', 'No encontrados', c.nf, 'kpi-rojo'],
      ['ok', 'Correctos', c.ok, 'kpi-verde'],
      ['sap', 'Actualizados en SAP', c.sap, 'kpi-morado'],
      ['pend', 'Pendientes', c.pend, ''],
      ['todos', 'Todos', st.filas.length, ''],
    ];
    $('ubic-kpis').innerHTML = kpis.map(([f, l, v, cls]) =>
      `<button type="button" class="kpi-card ubic-kpi ${cls} ${st.filtro === f ? 'sel' : ''}" data-f="${f}"><span class="kpi-label">${l}</span><span class="kpi-value">${v}</span></button>`).join('') +
      `<div class="kpi-card"><span class="kpi-label">Exactitud de ubicación</span><span class="kpi-value">${exactitud === null ? '—' : exactitud.toLocaleString('es-PE', { maximumFractionDigits: 1 }) + '%'}</span><span class="ubic-kpi-sub">${revisados}/${st.filas.length} revisados</span></div>`;
    $('ubic-kpis').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { st.filtro = b.dataset.f; render(); }));

    const soloSap = st.filtro === 'mov';
    $('ubic-acciones-sap').style.display = soloSap ? 'flex' : 'none';
    const q = Ubic.norm($('ubic-filtro').value);
    const filas = st.filas
      .filter((f) => (st.filtro === 'todos' || f.estado === st.filtro) &&
        (!q || f.material.includes(q) || Ubic.norm(f.descripcion).includes(q) || (f.ubicSap + ' ' + f.ubicFisica).includes(q)))
      .sort((a, b) => (a.ubicFisica || a.ubicSap).localeCompare(b.ubicFisica || b.ubicSap) || a.material.localeCompare(b.material));
    const tb = $('ubic-tabla-body');
    const max = 800;
    tb.innerHTML = filas.length
      ? filas.slice(0, max).map((f) => `<tr>
          <td>${esc(f.material)}</td><td class="desc">${esc(f.descripcion)}</td><td>${esc(f.centro)}</td>
          <td>${esc(f.ubicSap) || '—'}</td>
          <td>${f.ubicFisica && f.ubicFisica !== f.ubicSap ? `<strong class="ubic-nueva">${esc(f.ubicFisica)}</strong>` : esc(f.ubicFisica) || '—'}</td>
          <td><span class="chip-estado ${chip(f.estado)}">${Ubic.ESTADOS[f.estado]}</span></td>
          <td>${fmtFecha(f.fecha)}</td><td>${esc(f.por) || '—'}</td></tr>`).join('') +
        (filas.length > max ? `<tr><td colspan="8" class="muted centrado">Se muestran ${max} de ${filas.length}. Usa el filtro o exporta a Excel.</td></tr>` : '')
      : '<tr><td colspan="8" class="muted centrado">Nada en este filtro.</td></tr>';
  }
  const chip = (e) => ({ ok: 'chip-verde', mov: 'chip-amarillo', nf: 'chip-rojo', sap: 'chip-morado' }[e] || 'chip-gris');

  // ---- Salidas para SAP ----
  const paraSap = () => st.filas.filter((f) => f.estado === 'mov').sort((a, b) => a.material.localeCompare(b.material));
  async function copiar(txt, n, que) {
    try { await navigator.clipboard.writeText(txt); } catch (e) { window.prompt('Copia:', txt); return; }
    mensaje(`✓ ${n} ${que} copiados — pégalos en la transacción Ingreso Ubicación.`, 'ok');
  }
  function excel(filas, nombre) {
    if (!filas.length) { mensaje('No hay filas para exportar.', 'error'); return; }
    if (typeof XLSX === 'undefined') { mensaje('No cargó la librería de Excel.', 'error'); return; }
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = Object.keys(filas[0]).map((k) => ({ wch: Math.max(12, k.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nombre.slice(0, 30));
    XLSX.writeFile(wb, `${nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  async function marcarCargados() {
    const r = paraSap();
    if (!r.length) { mensaje('No hay materiales pendientes de SAP.', 'error'); return; }
    if (!confirm(`¿Ya grabaste estos ${r.length} materiales en SAP? Pasarán a "Actualizado en SAP".`)) return;
    const cargados = { ...(st.sap.cargados || {}) };
    const t = new Date().toISOString();
    r.forEach((f) => (cargados[f.k] = { n: f.ubicFisica, t }));
    try {
      const sap = { campana: st.envio.campana, cargados };
      await GitHubSync.escribirJSON(Ubic.RUTA_SAP, sap, `Ubicaciones grabadas en SAP — ${r.length}`);
      st.sap = sap;
      mensaje(`✓ ${r.length} marcados como actualizados en SAP.`, 'ok');
      render();
    } catch (e) { mensaje('Error: ' + e.message, 'error'); }
  }

  function bind() {
    $('ubic-btn-enviar').addEventListener('click', () => enviar(false));
    $('ubic-btn-cero').addEventListener('click', () => enviar(true));
    $('ubic-btn-cerrar').addEventListener('click', cerrar);
    $('ubic-btn-actualizar').addEventListener('click', actualizar);
    $('ubic-filtro').addEventListener('input', render);
    $('ubic-btn-copiar-mat').addEventListener('click', () => { const r = paraSap(); if (r.length) copiar(r.map((f) => f.material).join('\n'), r.length, 'materiales'); });
    $('ubic-btn-copiar-ubic').addEventListener('click', () => { const r = paraSap(); if (r.length) copiar(r.map((f) => f.ubicFisica).join('\n'), r.length, 'ubicaciones'); });
    $('ubic-btn-excel-sap').addEventListener('click', () => excel(paraSap().map((f) => ({
      Material: f.material, Centro: f.centro, 'Almacén': f.almacen, 'Denominación': f.descripcion,
      'Ubic.Ant (SAP)': f.ubicSap, 'Ubic.Actual': f.ubicFisica, 'Verificó': f.por, Fecha: fmtFecha(f.fecha),
    })), 'Ubicaciones_para_SAP'));
    $('ubic-btn-excel-todo').addEventListener('click', () => excel(st.filas.map((f) => ({
      Material: f.material, Centro: f.centro, 'Almacén': f.almacen, 'Denominación': f.descripcion,
      'Ubic. SAP': f.ubicSap, 'Ubic. física': f.ubicFisica, Estado: Ubic.ESTADOS[f.estado], 'Verificó': f.por, Fecha: fmtFecha(f.fecha),
    })), 'Verificacion_ubicaciones'));
    $('ubic-btn-marcar').addEventListener('click', marcarCargados);
    const url = new URL('index.html?tipo=ubicaciones', window.location.href).href;
    $('ubic-link-abrir').href = url;
    $('ubic-link-copiar').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); $('ubic-link-copiar').classList.add('copiado'); setTimeout(() => $('ubic-link-copiar').classList.remove('copiado'), 1500); }
      catch (e) { window.prompt('Copia el enlace:', url); }
    });
  }

  async function init() {
    if (!$('ubic-cuerpo')) return;
    bind();
    st.mb52 = await leerMB52();
    render();
    actualizar();
  }
  return { init, _st: st, _render: render };
})();

document.addEventListener('DOMContentLoaded', () => UbicAdmin.init());
