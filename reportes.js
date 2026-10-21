// ============================================================
// REPORTES DE INVENTARIO — genera los formatos oficiales de
// conciliación (LISTADO FINAL Y DESCARGO DE DIFERENCIAS) a partir
// de una plantilla real, sobrescribiendo solo los valores que
// vienen de MB52 y dejando intacto todo el formato, fórmulas y
// firmas del documento original.
//
// Dos modos:
// - Combustibles: 1 sola fila por material, con el stock TOTAL
//   sumado (varios lotes se agregan en un solo número).
// - Gases / IQBF: UNA FILA POR LOTE — cada lote de MB52 (Libre
//   utilización de un material+almacén+lote específico) es su
//   propia fila en el reporte, igual que en tus plantillas reales.
// ============================================================

// ---------- Combustibles (1 fila agregada por material) ----------
const FUENTES_COMBUSTIBLE = [
  { sheet: 'R500', material: '30000528' },
  { sheet: 'DIESEL', material: '30000527' },
];

// ---------- Gases e IQBF (una fila por lote) ----------
const CONFIG_GASES = {
  archivo: 'templates/plantilla_gases.xlsx',
  hoja: 'GASES',
  materiales: ['20000669', '20000670', '20000671', '20000699'],
  almacenes: null, // todos los almacenes (L001, L002, L004, PI04, PI05…): se cuenta todo el stock
  ubicacionExacta: null, // la ubicación varía por lote, no filtra por eso
  filaInicio: 9,
  filaFin: 38,
};

const CONFIG_IQBF = {
  archivo: 'templates/plantilla_iqbf.xlsx',
  hoja: 'IQBF',
  materiales: ['10200045', '31008189', '31010949', '31011665'],
  almacenes: ['L001'],
  ubicacionExacta: 'I.Q.B.F.',
  filaInicio: 9,
  filaFin: 39,
};

const CONFIG_COMBUSTIBLES = {
  materiales: FUENTES_COMBUSTIBLE.map((f) => f.material),
  almacenes: ['L001'],
  ubicacionExacta: null,
  incluirStockCero: true, // los tanques se listan siempre, aunque estén en cero
};

/** Materiales que se cuentan por separado (no entran a las zonas del inventario cíclico). */
const MATERIALES_ESPECIALES = [
  ...CONFIG_COMBUSTIBLES.materiales,
  ...CONFIG_GASES.materiales,
  ...CONFIG_IQBF.materiales,
];

const TOMAS_ESPECIALES = {
  combustibles: { titulo: 'Combustible', config: CONFIG_COMBUSTIBLES },
  gases: { titulo: 'Balones de Gases', config: CONFIG_GASES },
  iqbf: { titulo: 'IQBF (Insumos Químicos)', config: CONFIG_IQBF },
};

/**
 * Arma las filas de la toma de inventario de una categoría especial
 * (una fila por material + almacén + ubicación + lote) a partir del MB52.
 */
function construirFilasToma(tipo, mb52Rows) {
  const def = TOMAS_ESPECIALES[tipo];
  if (!def) throw new Error('Categoría de inventario desconocida: ' + tipo);
  const cfg = def.config;
  const filas = new Map();
  mb52Rows.forEach((row) => {
    const material = String(row['Material'] || '').trim();
    const almacen = String(row['Almacén'] || '').trim();
    const ubicacion = String(row['Ubicación'] || '').trim();
    if (!cfg.materiales.includes(material)) return;
    if (cfg.almacenes && !cfg.almacenes.includes(almacen)) return;
    if (cfg.ubicacionExacta && ubicacion !== cfg.ubicacionExacta) return;
    const stock = Number(row['Libre utilización']) || 0;
    if (!cfg.incluirStockCero && stock <= 0) return;
    const lote = String(row['Lote'] || '').trim();
    const id = [material, almacen, ubicacion, lote].join('|');
    if (!filas.has(id)) {
      filas.set(id, {
        id,
        material,
        descripcion: row['Texto breve de material'] || '',
        almacen,
        lote,
        ubicacion,
        um: row['Unidad medida base'] || '',
        cantidadSistema: 0,
      });
    }
    filas.get(id).cantidadSistema += stock;
  });
  return [...filas.values()].sort((a, b) => a.almacen.localeCompare(b.almacen) || a.material.localeCompare(b.material) || a.lote.localeCompare(b.lote));
}

// ============================================================
// Escritura DIRECTA sobre el XML de la plantilla (JSZip): así se conservan
// idénticos el formato, bordes, colores, anchos, fórmulas y firmas del
// documento original. (SheetJS gratuito pierde los estilos al guardar.)
// ============================================================
const NS_XLSX = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function indiceColumna(letras) {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function partirReferencia(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: m[1], fila: Number(m[2]) };
}
function serialExcel(fecha) {
  return Math.round((Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

async function abrirPlantillaZip(url) {
  if (typeof JSZip === 'undefined') throw new Error('Falta la librería JSZip (vendor/jszip.min.js).');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`No se pudo cargar la plantilla (${url}).`);
  return JSZip.loadAsync(await resp.arrayBuffer());
}

async function rutaDeHoja(zip, nombreHoja) {
  const wb = new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml');
  const hoja = [...wb.getElementsByTagName('sheet')].find((s) => s.getAttribute('name') === nombreHoja);
  if (!hoja) throw new Error(`La plantilla no tiene una hoja llamada "${nombreHoja}".`);
  const rid = hoja.getAttribute('r:id') || hoja.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rels = new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml');
  const rel = [...rels.getElementsByTagName('Relationship')].find((x) => x.getAttribute('Id') === rid);
  let destino = rel.getAttribute('Target');
  destino = destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino.replace(/^\.\//, '');
  return destino;
}

/** Escribe un valor en una celda conservando su estilo (atributo s). tipo: 'n' | 's' | 'vacio' */
function ponerCelda(doc, ref, tipo, valor) {
  const { col, fila } = partirReferencia(ref);
  const data = doc.getElementsByTagName('sheetData')[0];
  let rowEl = [...data.getElementsByTagName('row')].find((r) => Number(r.getAttribute('r')) === fila);
  if (!rowEl) {
    rowEl = doc.createElementNS(NS_XLSX, 'row');
    rowEl.setAttribute('r', String(fila));
    const siguiente = [...data.getElementsByTagName('row')].find((r) => Number(r.getAttribute('r')) > fila);
    data.insertBefore(rowEl, siguiente || null);
  }
  let cel = [...rowEl.getElementsByTagName('c')].find((c) => c.getAttribute('r') === ref);
  if (!cel) {
    cel = doc.createElementNS(NS_XLSX, 'c');
    cel.setAttribute('r', ref);
    const sig = [...rowEl.getElementsByTagName('c')].find((c) => indiceColumna(partirReferencia(c.getAttribute('r')).col) > indiceColumna(col));
    rowEl.insertBefore(cel, sig || null);
  }
  while (cel.firstChild) cel.removeChild(cel.firstChild);
  cel.removeAttribute('t');
  if (tipo === 'n') {
    const v = doc.createElementNS(NS_XLSX, 'v');
    v.textContent = String(valor);
    cel.appendChild(v);
  } else if (tipo === 's') {
    cel.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS_XLSX, 'is');
    const t = doc.createElementNS(NS_XLSX, 't');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = String(valor);
    is.appendChild(t);
    cel.appendChild(is);
  }
}


/**
 * Amplía una hoja de la plantilla insertando `extra` filas de datos (copias de la fila anterior
 * a la última) y desplaza hacia abajo todo lo que viene después: totales, fórmulas, celdas
 * combinadas, firmas y el área de impresión. Así la plantilla crece sin perder formato.
 */
async function ampliarPlantilla(zip, nombreHoja, filaFin, extra) {
  if (extra <= 0) return;
  const ruta = await rutaDeHoja(zip, nombreHoja);
  let xml = await zip.file(ruta).async('string');
  const refRe = /(?<![A-Za-z0-9_$.])(\$?[A-Z]{1,3}\$?)(\d+)(?![\d(A-Za-z_])/g;
  const mapFormula = (f, fn) => f.replace(refRe, (m, col, fila) => col + fn(Number(fila)));
  const desplazar = (n) => (n >= filaFin ? n + extra : n);

  const ini = xml.indexOf('<sheetData>') + '<sheetData>'.length;
  const fin = xml.indexOf('</sheetData>');
  const filasXml = xml.slice(ini, fin).match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || [];
  const reescribir = (rowXml, nuevoNum, mapaFila) =>
    rowXml
      .replace(/(<row\b[^>]*?\br=")\d+(")/, `$1${nuevoNum}$2`)
      .replace(/(<c\b[^>]*?\br="[A-Z]+)\d+(")/g, `$1${nuevoNum}$2`)
      .replace(/<f>([\s\S]*?)<\/f>/g, (m, f) => `<f>${mapFormula(f, mapaFila)}</f>`);
  const numDe = (r) => Number(/<row\b[^>]*?\br="(\d+)"/.exec(r)[1]);

  const plantilla = filasXml.find((r) => numDe(r) === filaFin - 1);
  if (!plantilla) throw new Error('No encontré la fila modelo de la plantilla para ampliarla.');
  const salida = [];
  filasXml.forEach((r) => {
    const n = numDe(r);
    if (n === filaFin) {
      for (let k = 0; k < extra; k++) {
        const nuevo = filaFin + k;
        salida.push(reescribir(plantilla, nuevo, (x) => (x === filaFin - 1 ? nuevo : desplazar(x))));
      }
    }
    salida.push(reescribir(r, desplazar(n), (x) => desplazar(x)));
  });
  xml = xml.slice(0, ini) + salida.join('') + xml.slice(fin);
  // celdas combinadas y dimensión
  xml = xml.replace(/<mergeCell ref="([^"]+)"\/>/g, (m, ref) => `<mergeCell ref="${mapFormula(ref, desplazar)}"/>`);
  xml = xml.replace(/<dimension ref="([^"]+)"\/>/, (m, ref) => `<dimension ref="${mapFormula(ref, desplazar)}"/>`);
  zip.file(ruta, xml);
  // área de impresión
  const wbRuta = 'xl/workbook.xml';
  let wb = await zip.file(wbRuta).async('string');
  wb = wb.replace(/(<definedName name="_xlnm\.Print_Area"[^>]*>)([^<]*)(<\/definedName>)/g, (m, a, ref, c) =>
    ref.includes(nombreHoja) ? a + mapFormula(ref, desplazar) + c : m);
  zip.file(wbRuta, wb);
}

/** edits: [{ hoja, celdas: [{ ref, tipo, valor }] }] */
async function aplicarEdicionesYDescargar(zip, edits, nombreArchivo) {
  for (const ed of edits) {
    const ruta = await rutaDeHoja(zip, ed.hoja);
    const doc = new DOMParser().parseFromString(await zip.file(ruta).async('string'), 'application/xml');
    ed.celdas.forEach((c) => ponerCelda(doc, c.ref, c.tipo, c.valor));
    zip.file(ruta, new XMLSerializer().serializeToString(doc));
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------- Conteo del operario (toma por categoría) ----------------
async function leerUltimoConteoEspecial(tipo) {
  if (!window.GitHubSync) return null;
  try {
    const archivos = await GitHubSync.listarCarpeta(GitHubSync.RUTA_RESULTADOS);
    const prefijo = `ESPECIAL-${tipo.toUpperCase()}_`;
    const candidatos = archivos.filter((f) => f.name.startsWith(prefijo)).sort((a, b) => b.name.localeCompare(a.name));
    if (!candidatos.length) return null;
    return await GitHubSync.leerJSONFresco(`${GitHubSync.RUTA_RESULTADOS}/${candidatos[0].name}`);
  } catch (e) {
    console.warn('No se pudo leer el conteo del operario:', e);
    return null;
  }
}

function infoConteo(conteo) {
  if (!conteo) return null;
  const contados = (conteo.items || []).filter((it) => it.cantidadFisica !== null && it.cantidadFisica !== undefined).length;
  return { contados, contadoPor: conteo.contadoPor || null, fecha: conteo.fecha || null };
}

// ---------------- COMBUSTIBLES (1 fila agregada por material) ----------------
function agregarStockPorMaterialL001(mb52Rows, material) {
  let stock = 0;
  let valor = 0;
  let descripcion = '';
  for (const row of mb52Rows) {
    if (String(row['Almacén'] || '').trim() !== 'L001') continue;
    if (String(row['Material'] || '').trim() !== material) continue;
    stock += Number(row['Libre utilización']) || 0;
    valor += Number(row['Valor libre util.']) || 0;
    if (!descripcion) descripcion = row['Texto breve de material'] || '';
  }
  return { stock, costoUnitario: stock > 0 ? valor / stock : 0, descripcion };
}

async function generarReporteCombustibles(mb52Rows) {
  const zip = await abrirPlantillaZip('templates/plantilla_combustibles.xlsx');
  const conteo = await leerUltimoConteoEspecial('combustibles');
  const hoy = new Date();
  const encontrados = [];
  const edits = [];

  FUENTES_COMBUSTIBLE.forEach((fuente) => {
    const { stock, costoUnitario, descripcion } = agregarStockPorMaterialL001(mb52Rows, fuente.material);
    const celdas = [
      { ref: 'E6', tipo: 'n', valor: serialExcel(hoy) },
      { ref: 'I9', tipo: 'n', valor: stock },
      { ref: 'N9', tipo: 'n', valor: costoUnitario },
    ];
    if (descripcion) celdas.push({ ref: 'G9', tipo: 's', valor: descripcion });

    // Lo que contó el operario para este combustible
    const items = conteo ? (conteo.items || []).filter((it) => it.material === fuente.material && it.cantidadFisica !== null && it.cantidadFisica !== undefined) : [];
    if (items.length) {
      const total = items.reduce((a, it) => a + (Number(it.cantidadFisica) || 0), 0);
      celdas.push({ ref: 'K9', tipo: 'n', valor: total });
      const lotes = [...new Set(items.map((it) => (it.loteFisico || '').trim()).filter(Boolean))];
      if (lotes.length) celdas.push({ ref: 'L9', tipo: 's', valor: lotes.join(', ') });
      const ubic = [...new Set(items.filter((it) => it.ubicacionFisica && it.ubicacionFisica !== it.ubicacionSistema).map((it) => it.ubicacionFisica))];
      if (ubic.length) celdas.push({ ref: 'R9', tipo: 's', valor: `Ubicación física: ${ubic.join(', ')}` });
    }
    edits.push({ hoja: fuente.sheet, celdas });
    encontrados.push({ hoja: fuente.sheet, material: fuente.material, stock, encontrado: stock > 0 || descripcion });
  });

  await aplicarEdicionesYDescargar(zip, edits, `Inventario_Combustibles_${hoy.toISOString().slice(0, 10)}.xlsx`);
  encontrados.conteo = infoConteo(conteo);
  return encontrados;
}

// ---------------- GASES / IQBF (una fila por lote) ----------------
function filtrarLotesMB52(mb52Rows, config) {
  return mb52Rows.filter((row) => {
    const material = String(row['Material'] || '').trim();
    const almacen = String(row['Almacén'] || '').trim();
    const ubicacion = String(row['Ubicación'] || '').trim();
    if (!config.materiales.includes(material)) return false;
    if (config.almacenes && !config.almacenes.includes(almacen)) return false;
    if (config.ubicacionExacta && ubicacion !== config.ubicacionExacta) return false;
    const stock = Number(row['Libre utilización']) || 0;
    return stock > 0; // no listamos lotes en cero
  });
}

async function generarReportePorLotes(mb52Rows, config, tipo, nombreArchivoSalida) {
  const zip = await abrirPlantillaZip(config.archivo);
  const conteo = await leerUltimoConteoEspecial(tipo);
  const lotes = filtrarLotesMB52(mb52Rows, config);

  // costo unitario promedio por material (para filas agregadas por el operario)
  const costoPorMaterial = {};
  lotes.forEach((l) => {
    const m = String(l['Material']).trim();
    const c = costoPorMaterial[m] || { stock: 0, valor: 0 };
    c.stock += Number(l['Libre utilización']) || 0;
    c.valor += Number(l['Valor libre util.']) || 0;
    costoPorMaterial[m] = c;
  });
  const infoMaterial = {};
  mb52Rows.forEach((row) => {
    const m = String(row['Material'] || '').trim();
    if (config.materiales.includes(m) && !infoMaterial[m]) {
      infoMaterial[m] = { descripcion: row['Texto breve de material'] || '', um: row['Unidad medida base'] || '' };
    }
  });

  // Conteo del operario indexado por material|lote|ubicación del sistema
  const conteoItems = conteo ? (conteo.items || []) : [];
  const usados = new Set();
  const clave = (a, m, l, u) => `${(a || '').trim()}|${m}|${(l || '').trim()}|${(u || '').trim()}`;
  const indice = new Map();
  conteoItems.forEach((it, i) => {
    if (!it.agregada) indice.set(clave(it.almacen, it.material, it.loteSistema, it.ubicacionSistema), i);
  });

  const filas = lotes.map((lote) => {
    const material = String(lote['Material']).trim();
    const loteSap = String(lote['Lote'] || '').trim();
    const ubic = String(lote['Ubicación'] || '').trim();
    const idx = indice.get(clave(String(lote['Almacén'] || '').trim(), material, loteSap, ubic));
    let conteoFila = null;
    if (idx !== undefined) { usados.add(idx); conteoFila = conteoItems[idx]; }
    const stock = Number(lote['Libre utilización']) || 0;
    const valor = Number(lote['Valor libre util.']) || 0;
    return {
      almacen: String(lote['Almacén'] || '').trim(), ubicacion: ubic, material,
      descripcion: lote['Texto breve de material'] || '', um: lote['Unidad medida base'] || '',
      cantidadSap: stock, loteSap, costo: stock > 0 ? valor / stock : 0, conteo: conteoFila,
    };
  });
  // Filas del conteo que no existen en el MB52 (lotes agregados por el operario)
  conteoItems.forEach((it, i) => {
    if (usados.has(i) || it.cantidadFisica === null || it.cantidadFisica === undefined) return;
    const c = costoPorMaterial[it.material];
    const inf = infoMaterial[it.material] || {};
    filas.push({
      almacen: it.almacen || 'L001', ubicacion: it.ubicacionFisica || it.ubicacionSistema || '', material: it.material,
      descripcion: it.descripcion || inf.descripcion || '', um: it.um || inf.um || '',
      cantidadSap: 0, loteSap: (it.loteSistema || '').trim(), costo: c && c.stock > 0 ? c.valor / c.stock : 0, conteo: it, agregada: true,
    });
  });

  let capacidad = config.filaFin - config.filaInicio + 1;
  if (filas.length > capacidad) {
    // más filas que espacio: la plantilla se amplía sola (conserva formato, totales y firmas)
    await ampliarPlantilla(zip, config.hoja, config.filaFin, filas.length - capacidad);
    capacidad = filas.length;
  }

  const hoy = new Date();
  const celdas = [{ ref: 'E6', tipo: 'n', valor: serialExcel(hoy) }];
  if (!config.almacenes) {
    const alms = [...new Set(filas.map((f) => f.almacen).filter(Boolean))].sort();
    celdas.push({ ref: 'M6', tipo: 's', valor: alms.join(', ') });
  }
  filas.forEach((f, i) => {
    const n = config.filaInicio + i;
    celdas.push(
      { ref: `C${n}`, tipo: 's', valor: 'TMAT' },
      { ref: `D${n}`, tipo: 's', valor: f.almacen },
      { ref: `E${n}`, tipo: 's', valor: f.ubicacion },
      { ref: `F${n}`, tipo: 'n', valor: Number(f.material) },
      { ref: `G${n}`, tipo: 's', valor: f.descripcion },
      { ref: `H${n}`, tipo: 's', valor: f.um },
      { ref: `I${n}`, tipo: 'n', valor: f.cantidadSap },
      { ref: `J${n}`, tipo: 's', valor: f.loteSap },
      { ref: `N${n}`, tipo: 'n', valor: f.costo }
    );
    const c = f.conteo;
    if (c && c.cantidadFisica !== null && c.cantidadFisica !== undefined) {
      celdas.push({ ref: `K${n}`, tipo: 'n', valor: Number(c.cantidadFisica) });
      const loteFis = String(c.loteFisico || '').trim();
      if (loteFis) celdas.push({ ref: `L${n}`, tipo: 's', valor: loteFis });
      const notas = [];
      if (c.ubicacionFisica && c.ubicacionFisica !== c.ubicacionSistema && !f.agregada) notas.push(`Ubicación física: ${c.ubicacionFisica}`);
      if (f.agregada) notas.push('Lote no registrado en SAP (agregado por el operario)');
      if (notas.length) celdas.push({ ref: `R${n}`, tipo: 's', valor: notas.join(' · ') });
    }
  });

  await aplicarEdicionesYDescargar(zip, [{ hoja: config.hoja, celdas }], `${nombreArchivoSalida}_${hoy.toISOString().slice(0, 10)}.xlsx`);
  return { totalLotes: filas.length, capacidad, conteo: infoConteo(conteo) };
}

async function generarReporteGases(mb52Rows) {
  return generarReportePorLotes(mb52Rows, CONFIG_GASES, 'gases', 'Inventario_Balones_Gases');
}

async function generarReporteIQBF(mb52Rows) {
  return generarReportePorLotes(mb52Rows, CONFIG_IQBF, 'iqbf', 'Inventario_IQBF');
}

window.ReportesInventario = {
  FUENTES_COMBUSTIBLE,
  MATERIALES_ESPECIALES,
  TOMAS_ESPECIALES,
  construirFilasToma,
  CONFIG_GASES,
  CONFIG_IQBF,
  generarReporteCombustibles,
  generarReporteGases,
  generarReporteIQBF,
};
