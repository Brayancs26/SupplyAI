// ============================================================
// UBICACIONES — lógica compartida entre el admin (PC) y la página
// del celular. La verificación vive en conteo/especiales/:
//   ubicaciones.json              → lo que se envía al celular (desde el MB52)
//   ubicaciones_marcas_<nombre>.json → lo que marca cada persona al escanear
//   ubicaciones_sap.json          → lo que el admin ya grabó en SAP
// ============================================================

const Ubic = (() => {
  const CARPETA = 'conteo/especiales';
  const RUTA_ENVIO = `${CARPETA}/ubicaciones.json`;
  const RUTA_SAP = `${CARPETA}/ubicaciones_sap.json`;
  const PREFIJO_MARCAS = 'ubicaciones_marcas_';
  const RX_UBIC = /^\d\.\d{2}\.\d\.\d{2}$/; // 1.05.1.09 (almacén.rack.nivel.columna)

  const ESTADOS = {
    pend: 'Pendiente',
    ok: 'Correcto',
    mov: 'Actualizar en SAP',
    nf: 'No encontrado',
    sap: 'Actualizado en SAP',
  };

  const clave = (material, almacen) => `${material}|${almacen}`;
  const slug = (t) => String(t || 'sin-nombre').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sin-nombre';
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  /** Filas del MB52 → una por material + almacén con su ubicación (LGPBE). */
  function itemsDesdeMB52(filasMB52, almacen) {
    const mapa = new Map();
    filasMB52.forEach((r) => {
      const a = String(r['Almacén'] || '').trim();
      if (almacen && a !== almacen) return;
      const m = String(r['Material'] || '').trim();
      if (!m) return;
      const k = clave(m, a);
      const u = String(r['Ubicación'] || '').trim();
      if (!mapa.has(k)) {
        mapa.set(k, { m, d: String(r['Texto breve de material'] || '').trim(), c: String(r['Centro'] || '').trim(), a, u });
      } else if (!mapa.get(k).u && u) {
        mapa.get(k).u = u;
      }
    });
    return [...mapa.values()].sort((x, y) => x.m.localeCompare(y.m));
  }

  /**
   * Junta las marcas de todas las personas: para cada material gana la más reciente.
   * archivos = [{ campana, por, marcas: { clave: { n, s, t } } }]
   */
  function unirMarcas(archivos, campana) {
    const final = {};
    archivos.forEach((f) => {
      if (!f || f.campana !== campana || !f.marcas) return;
      Object.entries(f.marcas).forEach(([k, mk]) => {
        if (!final[k] || String(mk.t) > String(final[k].t)) final[k] = { ...mk, por: mk.por || f.por || '' };
      });
    });
    return final;
  }

  /**
   * Estado de un material.
   * ubicSap = ubicación que hoy tiene SAP (MB52 más reciente si se tiene).
   * marca   = { n: ubicación física, s: 'ok'|'mov'|'nf' } o undefined.
   * enSap   = registro de "ya lo grabé en SAP" del admin.
   */
  function estado(ubicSap, marca, enSap) {
    if (!marca || !marca.s || marca.s === 'pend') return 'pend'; // 'pend' = alguien deshizo su marca
    if (marca.s === 'nf') return 'nf';
    if (enSap && enSap.n === marca.n) return 'sap';
    if (marca.n === ubicSap) return marca.s === 'mov' ? 'sap' : 'ok'; // el MB52 nuevo ya trae la ubicación corregida
    return 'mov';
  }

  return { CARPETA, RUTA_ENVIO, RUTA_SAP, PREFIJO_MARCAS, RX_UBIC, ESTADOS, clave, slug, norm, itemsDesdeMB52, unirMarcas, estado };
})();
window.Ubic = Ubic;
