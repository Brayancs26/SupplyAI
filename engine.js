// ============================================================
// MOTOR DE CÁLCULO ESTACIONAL — Abastecimiento (TASA)
// Puerto del notebook Python. Corre 100% en el navegador.
// ============================================================

const CODIGOS_CONSUMO = new Set([201, 202, 261, 262, 281, 282, 601, 602]);
const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function toISODate(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function diffDiasISO(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

/**
 * Filtra los movimientos crudos de DATA a "consumo real" (demanda que rompe
 * stock), quedándose solo con el almacén indicado y los códigos relevantes.
 * Devuelve filas planas {material, fechaISO, demanda}.
 */
function filtrarConsumoReal(dataRows, almacen) {
  const out = [];
  for (const row of dataRows) {
    if (String(row['Almacén']).trim() !== almacen) continue;
    const clase = Number(row['Clase de movimiento']);
    if (!CODIGOS_CONSUMO.has(clase)) continue;
    const fecha = row['Fe.contabilización'];
    const fechaISO = fecha instanceof Date ? toISODate(fecha) : toISODate(new Date(fecha));
    if (!fechaISO) continue;
    const cantidad = Number(row['Ctd.en UM entrada']) || 0;
    out.push({
      material: String(row['Material']).trim(),
      fechaISO,
      demanda: -cantidad,
    });
  }
  return out;
}

/**
 * Índice de estacionalidad por mes-calendario (1-12): consumo promedio de ese
 * mes a través de todos los años presentes en los datos, dividido entre el
 * promedio general. >1 significa por encima del promedio.
 */
function calcularIndiceEstacional(consumoReal) {
  const sumaPorMes = new Array(13).fill(0); // índice 1-12
  const mesesVistos = new Array(13).fill(null).map(() => new Set());

  for (const r of consumoReal) {
    const d = new Date(r.fechaISO + 'T00:00:00');
    const mes = d.getMonth() + 1;
    const anioMes = `${d.getFullYear()}-${mes}`;
    sumaPorMes[mes] += r.demanda;
    mesesVistos[mes].add(anioMes);
  }

  const promedioPorMes = new Array(13).fill(0);
  for (let m = 1; m <= 12; m++) {
    const nOcurrencias = mesesVistos[m].size || 1;
    promedioPorMes[m] = sumaPorMes[m] / nOcurrencias;
  }
  const promedioGeneral = promedioPorMes.slice(1).reduce((a, b) => a + b, 0) / 12;

  const indice = {};
  for (let m = 1; m <= 12; m++) {
    indice[m] = promedioGeneral > 0 ? promedioPorMes[m] / promedioGeneral : 0;
  }
  return indice;
}

function clasificarTemporadas(indice, umbralAlta, umbralBaja) {
  const mesATemporada = {};
  for (let m = 1; m <= 12; m++) {
    const v = indice[m];
    mesATemporada[m] = v >= umbralAlta ? 'Alta' : v < umbralBaja ? 'Baja' : 'Media';
  }
  return mesATemporada;
}

/**
 * Días calendario totales por temporada, contando cada día del rango
 * observado (fechaMin..fechaMax) según a qué mes-temporada pertenece.
 */
function diasPorTemporada(fechaMinISO, fechaMaxISO, mesATemporada) {
  const conteo = { Alta: 0, Media: 0, Baja: 0 };
  const min = new Date(fechaMinISO + 'T00:00:00');
  const max = new Date(fechaMaxISO + 'T00:00:00');
  for (let d = new Date(min); d <= max; d.setDate(d.getDate() + 1)) {
    const temp = mesATemporada[d.getMonth() + 1];
    conteo[temp] += 1;
  }
  return conteo;
}

/**
 * Estadísticas de demanda diaria por material, segmentadas por temporada.
 * Usa la técnica de suma / suma-de-cuadrados para no tener que materializar
 * un arreglo denso día por día (rápido incluso con miles de materiales).
 */
function calcularStatsPorTemporada(consumoReal, mesATemporada, diasTemporada) {
  // agregamos primero por (material, fechaISO) para netear consumo+reverso del mismo día
  const porDia = new Map(); // material -> Map(fechaISO -> demandaNeta)
  for (const r of consumoReal) {
    if (!porDia.has(r.material)) porDia.set(r.material, new Map());
    const m = porDia.get(r.material);
    m.set(r.fechaISO, (m.get(r.fechaISO) || 0) + r.demanda);
  }

  const resultado = new Map();
  for (const [material, mapaFechas] of porDia.entries()) {
    const acumulado = {
      Alta: { suma: 0, sumaSq: 0, diasConConsumo: 0 },
      Media: { suma: 0, sumaSq: 0, diasConConsumo: 0 },
      Baja: { suma: 0, sumaSq: 0, diasConConsumo: 0 },
    };
    let ultimaFecha = null;

    for (const [fechaISO, demanda] of mapaFechas.entries()) {
      const mes = Number(fechaISO.slice(5, 7));
      const temp = mesATemporada[mes];
      acumulado[temp].suma += demanda;
      acumulado[temp].sumaSq += demanda * demanda;
      if (demanda > 0) {
        acumulado[temp].diasConConsumo += 1;
        if (!ultimaFecha || fechaISO > ultimaFecha) ultimaFecha = fechaISO;
      }
    }

    const porTemporada = {};
    for (const temp of ['Alta', 'Media', 'Baja']) {
      const totalDias = diasTemporada[temp] || 1;
      const { suma, sumaSq, diasConConsumo } = acumulado[temp];
      const media = suma / totalDias;
      let varianza = (sumaSq - totalDias * media * media) / Math.max(totalDias - 1, 1);
      if (varianza < 0 || !isFinite(varianza)) varianza = 0;
      porTemporada[temp] = {
        demandaDiariaPromedio: media,
        demandaDiariaDesvest: Math.sqrt(varianza),
        diasConConsumo,
      };
    }
    resultado.set(material, { ...porTemporada, ultimaFechaConsumo: ultimaFecha });
  }
  return resultado;
}

function confianza(diasConConsumo) {
  if (!diasConConsumo) return 'Sin datos';
  if (diasConConsumo < 10) return 'Baja';
  if (diasConConsumo < 30) return 'Media';
  return 'Alta';
}

/**
 * Determina qué temporada debe regir el punto de pedido HOY, mirando hacia
 * adelante la ventana [hoy, hoy+leadTime]: si en ese rango aparece un día de
 * Temporada Alta, se usa Alta (hay que llegar con stock antes de que empiece).
 */
function temporadaObjetivo(leadTimeDias, hoyISO, mesATemporada) {
  const hoy = new Date(hoyISO + 'T00:00:00');
  const vistas = new Set();
  for (let i = 0; i <= Math.round(leadTimeDias); i++) {
    const d = new Date(hoy);
    d.setDate(d.getDate() + i);
    vistas.add(mesATemporada[d.getMonth() + 1]);
  }
  if (vistas.has('Alta')) return 'Alta';
  if (vistas.has('Media')) return 'Media';
  return 'Baja';
}

/**
 * Agrega MB52 (multi-lote) por material: stock físico total y costo unitario
 * ponderado (valor total / stock total), filtrando al almacén indicado.
 */
function agregarMB52(mb52Rows, almacen) {
  const acc = new Map(); // material -> {stock, valor}
  for (const row of mb52Rows) {
    if (String(row['Almacén']).trim() !== almacen) continue;
    const material = String(row['Material']).trim();
    const stock = Number(row['Libre utilización']) || 0;
    const valor = Number(row['Valor libre util.']) || 0;
    if (!acc.has(material)) acc.set(material, { stock: 0, valor: 0 });
    const a = acc.get(material);
    a.stock += stock;
    a.valor += valor;
  }
  const resultado = new Map();
  for (const [material, { stock, valor }] of acc.entries()) {
    resultado.set(material, {
      stockFisico: stock,
      costoUnitario: stock > 0 ? valor / stock : null,
    });
  }
  return resultado;
}

/**
 * Calcula SS, ROP, EOQ y riesgo para todos los materiales del MRP.
 */
function calcularMateriales(mrpRows, statsPorTemporada, mesATemporada, mb52Map, params, hoyISO) {
  const { Z, S, H, diasAnio } = params;

  return mrpRows.map((m) => {
    const material = String(m['Material']).trim();
    const lt = Number(m['Plazo entrega prev.']) || 0;
    const tempObjetivo = temporadaObjetivo(lt, hoyISO, mesATemporada);

    const stat = statsPorTemporada.get(material);
    const bucket = stat ? stat[tempObjetivo] : null;
    const ssActual = Number(m['Stock de seguridad']) || 0;
    const ropActual = Number(m['Punto de pedido']) || 0;

    const diasConConsumo = bucket ? bucket.diasConConsumo : 0;
    const conf = confianza(diasConConsumo);
    const media = bucket ? bucket.demandaDiariaPromedio : 0;
    const desvest = bucket ? bucket.demandaDiariaDesvest : 0;

    const ssCalculado = conf === 'Sin datos' ? ssActual : Z * desvest * Math.sqrt(lt);
    const ropCalculado = media * lt + ssCalculado;

    const mb52 = mb52Map.get(material) || { stockFisico: 0, costoUnitario: null };
    const demandaAnual = media * diasAnio;
    const eoq =
      mb52.costoUnitario && mb52.costoUnitario > 0 && H > 0
        ? Math.sqrt((2 * demandaAnual * S) / (H * mb52.costoUnitario))
        : null;

    let riesgo;
    if (mb52.stockFisico < ropCalculado) riesgo = 'ROJO';
    else if (mb52.stockFisico < ropCalculado * 1.2) riesgo = 'AMARILLO';
    else riesgo = 'VERDE';

    const ultimaFechaConsumo = stat ? stat.ultimaFechaConsumo : null;
    const diasSinMovimiento = ultimaFechaConsumo ? diffDiasISO(ultimaFechaConsumo, hoyISO) : null;

    return {
      material,
      descripcion: m['Texto breve de material'],
      clasificacion: m['Den.Clasificación'] || 'Sin Clasificar',
      unidadNegocio: m['Unidad de Negocio'] || 'Sin Asignar',
      unidadMedida: m['Unidad medida base'],
      grupoArticulo: m['Grupo de artículos'],
      denomGrupoArticulo: m['Denom.gr-artículos'] || '',
      leadTime: lt,
      temporadaObjetivo: tempObjetivo,
      stockFisico: mb52.stockFisico,
      costoUnitario: mb52.costoUnitario,
      ssActual,
      ropActual,
      diasConConsumo,
      confianza: conf,
      demandaDiariaPromedio: media,
      demandaDiariaDesvest: desvest,
      ssCalculado,
      ropCalculado,
      difSS: ssCalculado - ssActual,
      difROP: ropCalculado - ropActual,
      demandaAnual,
      eoq,
      riesgo,
      ultimaFechaConsumo,
      diasSinMovimiento,
    };
  });
}

function calcularInmovilizados(calculados, umbralModerado, umbralCritico, totalDiasObservados) {
  return calculados
    .filter((m) => m.stockFisico > 0)
    .map((m) => {
      const dias = m.diasSinMovimiento === null ? totalDiasObservados : m.diasSinMovimiento;
      let severidad = 'Activo';
      if (dias >= umbralCritico) severidad = 'Crítico';
      else if (dias >= umbralModerado) severidad = 'Moderado';
      const valorInmovilizado = m.costoUnitario ? m.costoUnitario * m.stockFisico : null;
      return { ...m, diasSinMovimientoEfectivo: dias, severidadInmovilizado: severidad, valorInmovilizado };
    })
    .filter((m) => m.severidadInmovilizado !== 'Activo')
    .sort((a, b) => b.diasSinMovimientoEfectivo - a.diasSinMovimientoEfectivo);
}

/**
 * Serie mensual de consumo real para UN material específico — usada en la
 * pestaña "Tendencia por Producto". Devuelve [{mes:'YYYY-MM', total}, ...]
 * ordenado cronológicamente, solo con los meses donde hubo al menos un
 * movimiento (no rellena huecos con cero, a diferencia del cálculo de SS).
 */
function serieMensualPorMaterial(consumoReal, material) {
  const mapa = new Map();
  for (const r of consumoReal) {
    if (r.material !== material) continue;
    const clave = r.fechaISO.slice(0, 7);
    mapa.set(clave, (mapa.get(clave) || 0) + r.demanda);
  }
  return Array.from(mapa.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([mes, total]) => ({ mes, total }));
}

/**
 * Estadísticas de demanda diaria GENERALES (sin segmentar por temporada) —
 * se usan para el coeficiente de variación del análisis XYZ, que mide
 * variabilidad de la demanda a través de todo el período, no de una sola
 * temporada.
 */
function calcularStatsGenerales(consumoReal, totalDias) {
  const porDia = new Map();
  for (const r of consumoReal) {
    if (!porDia.has(r.material)) porDia.set(r.material, new Map());
    const m = porDia.get(r.material);
    m.set(r.fechaISO, (m.get(r.fechaISO) || 0) + r.demanda);
  }

  const resultado = new Map();
  for (const [material, mapaFechas] of porDia.entries()) {
    let suma = 0;
    let sumaSq = 0;
    let diasConConsumo = 0;
    for (const demanda of mapaFechas.values()) {
      suma += demanda;
      sumaSq += demanda * demanda;
      if (demanda > 0) diasConConsumo += 1;
    }
    const media = suma / totalDias;
    let varianza = (sumaSq - totalDias * media * media) / Math.max(totalDias - 1, 1);
    if (varianza < 0 || !isFinite(varianza)) varianza = 0;
    resultado.set(material, { media, desvest: Math.sqrt(varianza), diasConConsumo });
  }
  return resultado;
}

/**
 * Categoriza un material en Combustibles / Insumos / Otros a partir de su
 * "Denom.gr-artículos" (grupo de artículos de SAP) — así el diesel/petróleo
 * no distorsiona el ranking de valor de los repuestos e insumos de almacén.
 */
function categorizarMaterial(denomGrupoArticulo) {
  const d = (denomGrupoArticulo || '').toUpperCase();
  if (/PETROLEO|COMBUST|DIESEL|GAS/.test(d)) return 'Combustibles';
  if (/INSUMO|QUIMIC|REACTIVO/.test(d)) return 'Insumos';
  return 'Otros';
}

/**
 * Clasificación ABC (por valor de consumo anual: costo unitario × demanda
 * anual estimada) y XYZ (por coeficiente de variación de la demanda diaria,
 * medido sobre todo el período — no por temporada).
 *
 * El ABC corre el Pareto POR SEPARADO dentro de cada categoría (Combustibles /
 * Insumos / Otros), para que un material de muy alto valor (ej. diesel) no
 * arrastre a todo lo demás a la categoría C solo por dominar el valor total.
 *
 * ABC: Pareto clásico 80/95 — A = primer 80% del valor acumulado DE SU
 * CATEGORÍA, B = siguiente 15% (hasta 95%), C = el resto (incluye
 * materiales sin costo unitario conocido).
 *
 * XYZ: X = CV ≤ 0.5 (demanda predecible), Y = 0.5–1.0 (variable),
 * Z = CV > 1.0 (errática). N/D = menos de 5 días con consumo registrado.
 */
function calcularABCXYZ(calculados, statsGenerales) {
  const conCategoria = calculados.map((m) => ({
    ...m,
    categoria: categorizarMaterial(m.denomGrupoArticulo),
  }));

  const valorPorMaterial = new Map();
  conCategoria.forEach((m) => {
    const valor = m.costoUnitario && m.demandaAnual ? m.costoUnitario * m.demandaAnual : 0;
    valorPorMaterial.set(m.material, valor);
  });

  const claseABC = new Map();
  const categorias = [...new Set(conCategoria.map((m) => m.categoria))];
  categorias.forEach((cat) => {
    const items = conCategoria.filter((m) => m.categoria === cat);
    const ordenado = items
      .map((m) => [m.material, valorPorMaterial.get(m.material)])
      .sort((a, b) => b[1] - a[1]);
    const totalValor = ordenado.reduce((acc, [, v]) => acc + v, 0) || 1;
    let acumulado = 0;
    for (const [material, valor] of ordenado) {
      const pctAcumAntes = acumulado / totalValor;
      let clase;
      if (valor === 0) clase = 'C';
      else if (pctAcumAntes < 0.8) clase = 'A';
      else if (pctAcumAntes < 0.95) clase = 'B';
      else clase = 'C';
      claseABC.set(material, clase);
      acumulado += valor;
    }
  });

  const claseXYZ = new Map();
  for (const [material, s] of statsGenerales.entries()) {
    if (s.diasConConsumo < 5 || s.media <= 0) {
      claseXYZ.set(material, 'N/D');
      continue;
    }
    const cv = s.desvest / s.media;
    claseXYZ.set(material, cv <= 0.5 ? 'X' : cv <= 1.0 ? 'Y' : 'Z');
  }

  return conCategoria.map((m) => ({
    ...m,
    valorConsumoAnual: valorPorMaterial.get(m.material) || 0,
    claseABC: claseABC.get(m.material) || 'C',
    claseXYZ: claseXYZ.get(m.material) || 'N/D',
  }));
}

const SupplyEngine = {
  NOMBRES_MES,
  CODIGOS_CONSUMO,
  toISODate,
  filtrarConsumoReal,
  calcularIndiceEstacional,
  clasificarTemporadas,
  diasPorTemporada,
  calcularStatsPorTemporada,
  temporadaObjetivo,
  agregarMB52,
  calcularMateriales,
  calcularInmovilizados,
  serieMensualPorMaterial,
  calcularStatsGenerales,
  calcularABCXYZ,
  categorizarMaterial,
  confianza,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SupplyEngine;
}
if (typeof window !== 'undefined') {
  window.SupplyEngine = SupplyEngine;
}
