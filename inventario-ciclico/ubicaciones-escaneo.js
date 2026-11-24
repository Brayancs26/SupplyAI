// ============================================================
// CELULAR · Verificación de ubicaciones.
// Escanea el QR del estante → ve qué dice SAP que hay ahí →
// confirma, marca "no está" o agrega lo que encontró.
// Lo marcado se guarda en el celular y se sube solo a GitHub.
// ============================================================

const UbicCel = (() => {
  const us = {
    envio: null, items: new Map(), porUbic: new Map(),
    otras: {}, mias: {}, actual: null, qr: null, ultimo: { t: '', at: 0 },
    timer: null, subiendo: false, firmaSubida: '', ultimaSubida: null,
  };
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nombre = () => (typeof nombreContador === 'function' ? nombreContador() : '');
  const claveLocal = () => `ubic_marcas_${us.envio.campana}`;

  // ---------- carga ----------
  async function cargar() {
    let envio = null;
    try { envio = await GitHubSync.leerJSONFresco(Ubic.RUTA_ENVIO); } catch (e) { /* sin datos */ }
    window.ubicActiva = !!(envio && envio.activa && (envio.items || []).length);
    $('panel-ubic-boton').style.display = window.ubicActiva ? 'block' : 'none';
    if (typeof actualizarVistaVacia === 'function') actualizarVistaVacia();
    if (!window.ubicActiva) return false;
    us.envio = envio;
    us.items.clear(); us.porUbic.clear();
    envio.items.forEach((i) => {
      const k = Ubic.clave(i.m, i.a);
      us.items.set(k, { k, ...i });
      if (i.u) { if (!us.porUbic.has(i.u)) us.porUbic.set(i.u, []); us.porUbic.get(i.u).push(k); }
    });
    try { us.mias = JSON.parse(localStorage.getItem(claveLocal()) || '{}'); } catch (e) { us.mias = {}; }
    $('ubic-btn-abrir').innerHTML = `Verificar ubicaciones<span>${envio.items.length} materiales · ${us.porUbic.size} ubicaciones</span>`;
    return true;
  }

  async function cargarOtras() {
    // lo que ya marcaron otras personas (para no repetir trabajo)
    try {
      const archivos = (await GitHubSync.listarCarpeta(Ubic.CARPETA)).filter((f) => f.name.startsWith(Ubic.PREFIJO_MARCAS));
      const propio = Ubic.PREFIJO_MARCAS + Ubic.slug(nombre()) + '.json';
      const datos = await GitHubSync.leerVariosJSON(archivos.filter((f) => f.name !== propio));
      us.otras = Ubic.unirMarcas(datos, us.envio.campana);
      renderUbic(); progreso();
    } catch (e) { /* sin conexión: se trabaja solo con lo propio */ }
  }

  function marcaDe(k) {
    const a = us.mias[k], b = us.otras[k];
    if (a && b) return String(a.t) >= String(b.t) ? a : b;
    return a || b;
  }
  const estadoDe = (it) => Ubic.estado(it.u, marcaDe(it.k), null);

  // ---------- abrir ----------
  function abrir() {
    if (typeof requerirNombre === 'function' && !requerirNombre()) return;
    $('ubic-formulario').style.display = 'block';
    $('ubic-formulario').scrollIntoView({ behavior: 'smooth' });
    progreso();
    cargarOtras();
    setTimeout(() => $('ubic-manual').focus(), 300);
  }

  // ---------- escaneo ----------
  function leer(txt) {
    txt = String(txt || '').trim();
    if (!txt) return;
    const ahora = Date.now();
    if (txt === us.ultimo.t && ahora - us.ultimo.at < 2500) return;
    us.ultimo = { t: txt, at: ahora };
    if (Ubic.RX_UBIC.test(txt) || us.porUbic.has(txt)) { abrirUbic(txt); pitido(true); return; }
    const codigo = txt.split('|')[0].trim(); // tarjeta de material: "código|ubicación"
    const it = [...us.items.values()].find((i) => i.m === codigo);
    if (it) {
      if (!us.actual) { aviso('Primero escanea el QR de la ubicación'); pitido(false); return; }
      asignar(it.k); pitido(true); return;
    }
    aviso(`No reconocido: ${txt}`); pitido(false);
  }

  function abrirUbic(u) {
    us.actual = u;
    $('ubic-manual').value = '';
    $('ubic-actual-box').style.display = 'flex';
    $('ubic-lista-panel').style.display = 'block';
    renderUbic();
    $('ubic-actual-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function marcar(k, s, n) {
    if (typeof requerirNombre === 'function' && !requerirNombre()) return;
    us.mias[k] = { n: n || '', s, t: new Date().toISOString(), por: nombre() };
    persistir();
    renderUbic(); progreso();
  }
  function asignar(k) {
    const it = us.items.get(k);
    const prev = marcaDe(k);
    if (prev && prev.s === 'ok' && prev.n && prev.n !== us.actual) aviso(`${it.m} estaba confirmado en ${prev.n}. Se cambia a ${us.actual}.`, 3500);
    else aviso(`${it.m} → ${us.actual}`);
    marcar(k, it.u === us.actual ? 'ok' : 'mov', us.actual);
  }

  // ---------- pantalla de una ubicación ----------
  function renderUbic() {
    if (!us.actual) return;
    const u = us.actual;
    const esperados = us.porUbic.get(u) || [];
    const traidos = [...us.items.keys()].filter((k) => { const m = marcaDe(k); return m && m.n === u && m.s !== 'nf' && m.s !== 'pend' && !esperados.includes(k); });
    const lista = [...esperados, ...traidos].map((k) => us.items.get(k));
    const hechos = lista.filter((i) => estadoDe(i) !== 'pend').length;
    $('ubic-actual-codigo').textContent = u;
    $('ubic-actual-sub').textContent = `${esperados.length} material(es) según SAP · ${hechos}/${lista.length} revisados`;
    lista.sort((a, b) => (estadoDe(a) === 'pend' ? 0 : 1) - (estadoDe(b) === 'pend' ? 0 : 1) || a.m.localeCompare(b.m));
    $('ubic-lista').innerHTML = lista.length ? lista.map(tarjeta).join('')
      : '<p class="muted centrado" style="padding:18px">SAP no tiene materiales en esta ubicación.<br>Si hay algo físicamente, agrégalo abajo.</p>';
  }

  function tarjeta(it) {
    const est = estadoDe(it);
    const m = marcaDe(it.k);
    const aqui = it.u === us.actual;
    const chip = { ok: 'chip-verde', mov: 'chip-amarillo', nf: 'chip-rojo', sap: 'chip-morado' }[est] || 'chip-gris';
    const nota = !aqui ? `<span class="ubic-nota">En SAP: <strong>${esc(it.u || 'sin ubicación')}</strong> → encontrado aquí</span>`
      : est === 'mov' ? `<span class="ubic-nota">Encontrado en <strong>${esc(m.n)}</strong></span>`
      : est === 'nf' ? '<span class="ubic-nota">No está en esta ubicación</span>' : '';
    const quien = m && m.s !== 'pend' && m.por && m.por !== nombre() ? `<span class="ubic-nota">Marcado por ${esc(m.por)}</span>` : '';
    const k = esc(it.k);
    const botones = [];
    if (est === 'pend' || est === 'nf' || (est === 'mov' && aqui)) botones.push(`<button type="button" class="ubic-btn ubic-si" data-acc="si" data-k="${k}">✔ Está aquí</button>`);
    if (est === 'pend' && aqui) botones.push(`<button type="button" class="ubic-btn ubic-no" data-acc="no" data-k="${k}">✗ No está</button>`);
    if (est !== 'pend') botones.push(`<button type="button" class="ubic-btn" data-acc="deshacer" data-k="${k}">↺ Deshacer</button>`);
    return `<div class="ubic-item ubic-${est}">
      <div class="ubic-item-cab"><div><span class="fila-conteo-material">${esc(it.m)}</span><span class="fila-conteo-desc">${esc(it.d)}</span>${nota}${quien}</div>
      <span class="chip-estado ${chip}">${Ubic.ESTADOS[est]}</span></div>
      <div class="ubic-item-acc">${botones.join('')}</div></div>`;
  }

  function progreso() {
    if (!us.envio) return;
    let rev = 0, sap = 0, nf = 0;
    us.items.forEach((it) => { const e = estadoDe(it); if (e !== 'pend') rev++; if (e === 'mov') sap++; if (e === 'nf') nf++; });
    $('ubic-progreso').innerHTML = `<strong>${rev}</strong>/${us.items.size} revisados · <span class="dif-mal">${sap} por corregir</span> · ${nf} no encontrados`;
    $('ubic-progreso-barra').style.width = `${us.items.size ? (rev / us.items.size) * 100 : 0}%`;
  }

  // ---------- guardar (celular + nube) ----------
  function persistir() {
    try { localStorage.setItem(claveLocal(), JSON.stringify(us.mias)); } catch (e) { /* sin storage */ }
    estadoNube('Pendiente de subir…');
    clearTimeout(us.timer);
    us.timer = setTimeout(subir, 4000);
  }
  async function subir() {
    if (!us.envio || us.subiendo) return;
    const firma = JSON.stringify(us.mias);
    if (firma === us.firmaSubida) return;
    if (!Object.keys(us.mias).length) return;
    us.subiendo = true;
    try {
      const por = nombre();
      await GitHubSync.escribirJSON(
        `${Ubic.CARPETA}/${Ubic.PREFIJO_MARCAS}${Ubic.slug(por)}.json`,
        { campana: us.envio.campana, por, actualizadoEn: new Date().toISOString(), marcas: us.mias },
        `Ubicaciones verificadas por ${por || 'sin nombre'} — ${Object.keys(us.mias).length}`
      );
      us.firmaSubida = firma;
      us.ultimaSubida = new Date();
      estadoNube(`✓ Guardado en la nube ${us.ultimaSubida.toLocaleTimeString('es-PE', { timeStyle: 'short' })}`, 'ok');
    } catch (e) {
      estadoNube('Sin conexión — queda guardado en el celular y se reintenta.', 'error');
      clearTimeout(us.timer); us.timer = setTimeout(subir, 20000);
    } finally { us.subiendo = false; if (JSON.stringify(us.mias) !== us.firmaSubida) persistirSoloTimer(); }
  }
  function persistirSoloTimer() { clearTimeout(us.timer); us.timer = setTimeout(subir, 4000); }
  function estadoNube(t, cls = '') { const el = $('ubic-nube'); if (el) { el.className = 'estado-publicar ' + cls; el.textContent = t; } }

  // ---------- utilidades ----------
  function aviso(t, ms = 2200) { const el = $('ubic-toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(el._t); el._t = setTimeout(() => (el.style.display = 'none'), ms); }
  function pitido(ok) {
    try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(); o.frequency.value = ok ? 880 : 300; o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.12); } catch (e) { /* sin audio */ }
    if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]);
  }

  async function camara() {
    const btn = $('ubic-btn-camara');
    if (us.qr) { await us.qr.stop().catch(() => {}); us.qr = null; $('ubic-reader').style.display = 'none'; btn.textContent = '📷 Abrir cámara'; return; }
    if (typeof Html5Qrcode === 'undefined') { aviso('No cargó el lector QR'); return; }
    $('ubic-reader').style.display = 'block';
    us.qr = new Html5Qrcode('ubic-reader');
    try {
      await us.qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, leer);
      btn.textContent = '✕ Cerrar cámara';
    } catch (e) {
      aviso('No se pudo abrir la cámara. Revisa el permiso del navegador.', 4000);
      $('ubic-reader').style.display = 'none'; us.qr = null;
    }
  }

  function bind() {
    $('ubic-btn-abrir').addEventListener('click', abrir);
    $('ubic-btn-camara').addEventListener('click', camara);
    $('ubic-btn-ir').addEventListener('click', () => { us.ultimo = { t: '', at: 0 }; leer($('ubic-manual').value); });
    $('ubic-manual').addEventListener('keydown', (e) => { if (e.key === 'Enter') { us.ultimo = { t: '', at: 0 }; leer(e.target.value); e.target.value = ''; } });
    $('ubic-lista').addEventListener('click', (e) => {
      const b = e.target.closest('[data-acc]'); if (!b) return;
      const k = b.dataset.k;
      if (b.dataset.acc === 'si') asignar(k);
      if (b.dataset.acc === 'no') marcar(k, 'nf', '');
      if (b.dataset.acc === 'deshacer') marcar(k, 'pend', '');
    });
    $('ubic-btn-restantes').addEventListener('click', () => {
      const p = (us.porUbic.get(us.actual) || []).filter((k) => estadoDe(us.items.get(k)) === 'pend');
      if (!p.length) { aviso('No hay pendientes en esta ubicación'); return; }
      if (!confirm(`¿Marcar ${p.length} pendiente(s) como NO están en ${us.actual}?`)) return;
      const t = new Date().toISOString();
      p.forEach((k) => (us.mias[k] = { n: '', s: 'nf', t, por: nombre() }));
      persistir(); renderUbic(); progreso();
    });
    const caja = $('ubic-buscar'), res = $('ubic-resultados');
    caja.addEventListener('input', () => {
      const q = Ubic.norm(caja.value);
      if (q.length < 2) { res.style.display = 'none'; return; }
      const hits = [...us.items.values()].filter((i) => i.m.includes(q) || Ubic.norm(i.d).includes(q)).slice(0, 20);
      res.innerHTML = hits.length ? hits.map((i) => `<button type="button" data-k="${esc(i.k)}"><strong>${esc(i.m)}</strong> · ${esc(i.d)}<span>SAP: ${esc(i.u || '—')} · ${Ubic.ESTADOS[estadoDe(i)]}</span></button>`).join('')
        : '<p class="muted" style="padding:10px">Sin coincidencias</p>';
      res.style.display = 'block';
    });
    res.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      if (!us.actual) { aviso('Primero escanea la ubicación'); return; }
      asignar(b.dataset.k); caja.value = ''; res.style.display = 'none';
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && us.envio) { clearTimeout(us.timer); subir(); } });
  }

  async function init() {
    if (!$('panel-ubic-boton') || new URLSearchParams(location.search).get('ver') === '1') return;
    bind();
    const hay = await cargar();
    if (hay && new URLSearchParams(location.search).get('tipo') === 'ubicaciones') abrir();
  }
  return { init, leer, _us: us };
})();

document.addEventListener('DOMContentLoaded', () => UbicCel.init());
