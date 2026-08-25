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
  almacenes: ['L001', 'L004'],
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

function actualizarCelda(ws, direccion, nuevaCelda) {
  const existente = ws[direccion] || {};
  ws[direccion] = { ...existente, ...nuevaCelda };
  delete ws[direccion].w; // texto formateado cacheado — que Excel lo recalcule al abrir
}

// ---------------- COMBUSTIBLES ----------------
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
  const resp = await fetch('templates/plantilla_combustibles.xlsx');
  if (!resp.ok) throw new Error('No se pudo cargar la plantilla de combustibles.');
  const buffer = await resp.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellStyles: true, cellDates: true });

  const hoy = new Date();
  const encontrados = [];

  FUENTES_COMBUSTIBLE.forEach((fuente) => {
    const ws = wb.Sheets[fuente.sheet];
    if (!ws) return;
    const { stock, costoUnitario, descripcion } = agregarStockPorMaterialL001(mb52Rows, fuente.material);

    actualizarCelda(ws, 'E6', { t: 'd', v: hoy });
    actualizarCelda(ws, 'I9', { t: 'n', v: stock });
    actualizarCelda(ws, 'N9', { t: 'n', v: costoUnitario });
    if (descripcion) actualizarCelda(ws, 'G9', { t: 's', v: descripcion });

    encontrados.push({ hoja: fuente.sheet, material: fuente.material, stock, encontrado: stock > 0 || descripcion });
  });

  const fechaArchivo = hoy.toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Inventario_Combustibles_${fechaArchivo}.xlsx`, { cellStyles: true });
  return encontrados;
}

// ---------------- GASES / IQBF (una fila por lote) ----------------
function filtrarLotesMB52(mb52Rows, config) {
  return mb52Rows.filter((row) => {
    const material = String(row['Material'] || '').trim();
    const almacen = String(row['Almacén'] || '').trim();
    const ubicacion = String(row['Ubicación'] || '').trim();
    if (!config.materiales.includes(material)) return false;
    if (!config.almacenes.includes(almacen)) return false;
    if (config.ubicacionExacta && ubicacion !== config.ubicacionExacta) return false;
    const stock = Number(row['Libre utilización']) || 0;
    return stock > 0; // no listamos lotes en cero
  });
}

async function generarReportePorLotes(mb52Rows, config, nombreArchivoSalida) {
  const resp = await fetch(config.archivo);
  if (!resp.ok) throw new Error(`No se pudo cargar la plantilla (${config.archivo}).`);
  const buffer = await resp.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellStyles: true, cellDates: true });
  const ws = wb.Sheets[config.hoja];
  if (!ws) throw new Error(`La plantilla no tiene una hoja llamada "${config.hoja}".`);

  const lotes = filtrarLotesMB52(mb52Rows, config);
  const capacidad = config.filaFin - config.filaInicio + 1;
  if (lotes.length > capacidad) {
    throw new Error(
      `Encontré ${lotes.length} lotes pero la plantilla solo tiene espacio para ${capacidad} filas — avísame para ampliarla.`
    );
  }

  const hoy = new Date();
  actualizarCelda(ws, 'E6', { t: 'd', v: hoy });

  lotes.forEach((lote, i) => {
    const fila = config.filaInicio + i;
    const stock = Number(lote['Libre utilización']) || 0;
    const valor = Number(lote['Valor libre util.']) || 0;
    const costoUnitario = stock > 0 ? valor / stock : 0;

    actualizarCelda(ws, `C${fila}`, { t: 's', v: 'TMAT' });
    actualizarCelda(ws, `D${fila}`, { t: 's', v: String(lote['Almacén'] || '').trim() });
    actualizarCelda(ws, `E${fila}`, { t: 's', v: String(lote['Ubicación'] || '').trim() });
    actualizarCelda(ws, `F${fila}`, { t: 'n', v: Number(lote['Material']) });
    actualizarCelda(ws, `G${fila}`, { t: 's', v: lote['Texto breve de material'] || '' });
    actualizarCelda(ws, `H${fila}`, { t: 's', v: lote['Unidad medida base'] || '' });
    actualizarCelda(ws, `I${fila}`, { t: 'n', v: stock });
    actualizarCelda(ws, `J${fila}`, { t: 's', v: String(lote['Lote'] || '').trim() });
    actualizarCelda(ws, `N${fila}`, { t: 'n', v: costoUnitario });
    // K (Cantidad Física) y L (Lote Físico) quedan en blanco — se llenan a mano tras el conteo.
  });

  const fechaArchivo = hoy.toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${nombreArchivoSalida}_${fechaArchivo}.xlsx`, { cellStyles: true });
  return { totalLotes: lotes.length, capacidad };
}

async function generarReporteGases(mb52Rows) {
  return generarReportePorLotes(mb52Rows, CONFIG_GASES, 'Inventario_Balones_Gases');
}

async function generarReporteIQBF(mb52Rows) {
  return generarReportePorLotes(mb52Rows, CONFIG_IQBF, 'Inventario_IQBF');
}

window.ReportesInventario = {
  FUENTES_COMBUSTIBLE,
  CONFIG_GASES,
  CONFIG_IQBF,
  generarReporteCombustibles,
  generarReporteGases,
  generarReporteIQBF,
};
