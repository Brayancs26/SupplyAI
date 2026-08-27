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
const CODIGOS_CONSUMO_COMBUSTIBLE_EXTRA = new Set([301, 302]); // despacho a embarcaciones

/**
 * Filtra los movimientos crudos de DATA a "consumo real":
 * - Siempre incluye el almacén principal (L001) con los códigos base.
 * - Para materiales de la categoría Insumos, TAMBIÉN incluye el almacén
 *   extra (PI01, "Planta") — así su consumo no se queda corto.
 * - Para materiales de la categoría Combustibles, TAMBIÉN cuenta el código
 *   301 ("Trasladar ce.a ce") como consumo real, porque en TASA ese código
 *   se usa para el despacho de combustible a las embarcaciones — es demanda
 *   real, no un traslado interno. Para el resto de materiales, 301 sigue
 *   excluido (ahí sí es un traslado normal entre almacenes).
 */
function filtrarConsumoReal(dataRows, almacenPrincipal, opciones = {}) {
  const almacenExtra = opciones.almacenExtra || 'PI01';
  const materialesCombustible = opciones.materialesCombustible || new Set();

  const out = [];
  for (const row of dataRows) {
    const almacenRow = String(row['Almacén']).trim();
    const material = String(row['Material']).trim();

    // L001 y PI01 SIEMPRE cuentan, para cualquier categoría — PI01 es donde
    // se registra el consumo operativo real de muchos materiales (no solo
    // insumos: por ejemplo el petróleo industrial consume casi todo ahí).
    if (almacenRow !== almacenPrincipal && almacenRow !== almacenExtra) continue;

    const clase = Number(row['Clase de movimiento']);
    const esConsumoBase = CODIGOS_CONSUMO.has(clase);
    const esDespachoCombustible = materialesCombustible.has(material) && CODIGOS_CONSUMO_COMBUSTIBLE_EXTRA.has(clase);
    if (!esConsumoBase && !esDespachoCombustible) continue;

    const fecha = row['Fe.contabilización'];
    const fechaISO = fecha instanceof Date ? toISODate(fecha) : toISODate(new Date(fecha));
    if (!fechaISO) continue;
    const cantidad = Number(row['Ctd.en UM entrada']) || 0;
    out.push({
      material,
      fechaISO,
      demanda: -cantidad,
      almacenOrigen: almacenRow,
      claseMovimiento: clase,
    });
  }
  return out;
}

/**
 * Devuelve el set de códigos de material del MRP que caen en una categoría
 * dada (Combustibles / Insumos / Otros), usando categorizarMaterial.
 * Se define más abajo, junto a categorizarMaterial — ver esa función para
 * el detalle de qué grupos de SAP caen en cada categoría.
 */
function materialesPorCategoria(mrpRows, categoriaObjetivo, materialesConConsumoPI01) {
  const set = new Set();
  for (const m of mrpRows) {
    const material = String(m['Material']).trim();
    if (categorizarMaterial(material, m['Denom.gr-artículos'], materialesConConsumoPI01) === categoriaObjetivo) set.add(material);
  }
  return set;
}

/**
 * Suma la columna "Trans./Trasl." (stock en tránsito) de MB52 por material.
 * No se filtra por almacén porque en la práctica esa columna no siempre
 * viene asociada a un almacén específico en el reporte.
 */
function extraerTransitoPorMaterial(mb52Rows) {
  const mapa = new Map();
  for (const row of mb52Rows) {
    const material = row['Material'] ? String(row['Material']).trim() : null;
    if (!material) continue;
    const transito = Number(row['Trans./Trasl.']) || 0;
    if (transito === 0) continue;
    mapa.set(material, (mapa.get(material) || 0) + transito);
  }
  return mapa;
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
 * Agrega MB52 (multi-lote) por material: stock físico total, costo unitario
 * ponderado (valor total / stock total), y la fecha de vencimiento más
 * próxima entre sus lotes (columna "Cad./FPC"), filtrando al almacén indicado.
 */
function agregarMB52(mb52Rows, almacen) {
  const acc = new Map(); // material -> {stock, valor, fechasVenc: []}
  for (const row of mb52Rows) {
    if (String(row['Almacén']).trim() !== almacen) continue;
    const material = String(row['Material']).trim();
    const stock = Number(row['Libre utilización']) || 0;
    const valor = Number(row['Valor libre util.']) || 0;
    if (!acc.has(material)) acc.set(material, { stock: 0, valor: 0, fechasVenc: [] });
    const a = acc.get(material);
    a.stock += stock;
    a.valor += valor;
    const fv = row['Cad./FPC'];
    if (fv) {
      const iso = toISODate(fv instanceof Date ? fv : new Date(fv));
      if (iso) a.fechasVenc.push(iso);
    }
  }
  const resultado = new Map();
  for (const [material, { stock, valor, fechasVenc }] of acc.entries()) {
    fechasVenc.sort();
    resultado.set(material, {
      stockFisico: stock,
      costoUnitario: stock > 0 ? valor / stock : null,
      fechaVencimiento: fechasVenc.length > 0 ? fechasVenc[0] : null,
    });
  }
  return resultado;
}

/**
 * Calcula SS, ROP, EOQ y riesgo para todos los materiales del MRP —
 * aplicando primero la política de tratamiento por clasificación:
 * Inactivo y Producción quedan fuera del cálculo, Estratégico siempre entra,
 * y Uso Inmediato se reclasifica según su histórico real de movimientos
 * (ver determinarTratamiento / calcularClasificacionMovimiento).
 */
function calcularMateriales(mrpRows, statsPorTemporada, mesATemporada, mb52Map, params, hoyISO, movClasificacionMap, materialesConConsumoPI01, simParams) {
  const { Z, S, H, diasAnio } = params;
  const leadTimeMult = simParams && simParams.leadTimeMult ? simParams.leadTimeMult : 1;
  const demandMult = simParams && simParams.demandMult ? simParams.demandMult : 1;

  return mrpRows.map((m) => {
    const material = String(m['Material']).trim();
    const lt = (Number(m['Plazo entrega prev.']) || 0) * leadTimeMult;
    const tempObjetivo = temporadaObjetivo(lt, hoyISO, mesATemporada);

    const clasificacionSAP = m['Den.Clasificación'] || 'Sin Clasificar';
    const movInfo = movClasificacionMap ? movClasificacionMap.get(material) : null;
    const tratamiento = determinarTratamiento(clasificacionSAP, movInfo);

    const stat = statsPorTemporada.get(material);
    const bucket = stat ? stat[tempObjetivo] : null;
    const ssActual = Number(m['Stock de seguridad']) || 0;
    const ropActual = Number(m['Punto de pedido']) || 0;

    const diasConConsumo = bucket ? bucket.diasConConsumo : 0;
    const conf = confianza(diasConConsumo);
    // El multiplicador de demanda escala la media directo, y la desviación
    // con la raíz cuadrada (mismo criterio que un pico de demanda conserva
    // la FORMA de la distribución, no la infla linealmente).
    const media = (bucket ? bucket.demandaDiariaPromedio : 0) * demandMult;
    const desvest = (bucket ? bucket.demandaDiariaDesvest : 0) * Math.sqrt(demandMult);

    const mb52 = mb52Map.get(material) || { stockFisico: 0, costoUnitario: null, fechaVencimiento: null };
    const demandaAnual = media * diasAnio;

    let ssCalculado = null;
    let ropCalculado = null;
    let eoq = null;
    let riesgo = 'N/A';
    let maxStock = null;
    let estadoSalud = 'N/A';

    if (tratamiento.incluido) {
      ssCalculado = conf === 'Sin datos' ? ssActual : Z * desvest * Math.sqrt(lt);
      ropCalculado = media * lt + ssCalculado;
      eoq =
        mb52.costoUnitario && mb52.costoUnitario > 0 && H > 0
          ? Math.sqrt((2 * demandaAnual * S) / (H * mb52.costoUnitario))
          : null;
      maxStock = eoq !== null ? Math.max(ropCalculado + eoq, ropCalculado * 1.5) : ropCalculado * 1.5;

      const coberturaDiasLocal = media > 0 ? mb52.stockFisico / media : mb52.stockFisico > 0 ? 999 : 0;

      // Estado de salud en 5 niveles (más específico que el semáforo simple):
      if (conf === 'Sin datos' && mb52.stockFisico > 0) {
        estadoSalud = 'DEAD_STOCK'; // stock físico pero sin ningún consumo real registrado
      } else if (mb52.stockFisico <= 0 || (coberturaDiasLocal < Math.max(3, lt * 0.35) && mb52.stockFisico < ssCalculado)) {
        estadoSalud = 'STOCKOUT_CRITICAL';
      } else if (mb52.stockFisico <= ropCalculado) {
        estadoSalud = 'REORDER_URGENT';
      } else if (mb52.stockFisico > maxStock) {
        estadoSalud = 'OVERSTOCK';
      } else {
        estadoSalud = 'OPTIMAL';
      }

      // 'riesgo' se conserva por compatibilidad con las vistas que agrupan en 3 niveles.
      if (estadoSalud === 'STOCKOUT_CRITICAL' || estadoSalud === 'REORDER_URGENT') riesgo = 'ROJO';
      else if (estadoSalud === 'OVERSTOCK' || estadoSalud === 'DEAD_STOCK') riesgo = 'AMARILLO';
      else riesgo = 'VERDE';
    }

    const ultimaFechaConsumo = stat ? stat.ultimaFechaConsumo : null;
    const diasSinMovimiento = ultimaFechaConsumo ? diffDiasISO(ultimaFechaConsumo, hoyISO) : null;

    return {
      material,
      descripcion: m['Texto breve de material'],
      clasificacion: clasificacionSAP,
      clasificacionFinal: tratamiento.clasificacionFinal,
      incluidoEnPlanificacion: tratamiento.incluido,
      reclasificadoDesdeUIN: tratamiento.reclasificado,
      motivoExclusion: tratamiento.motivo,
      unidadNegocio: m['Unidad de Negocio'] || 'Sin Asignar',
      unidadMedida: m['Unidad medida base'],
      grupoArticulo: m['Grupo de artículos'],
      denomGrupoArticulo: m['Denom.gr-artículos'] || '',
      categoria: categorizarMaterial(material, m['Denom.gr-artículos'], materialesConConsumoPI01),
      leadTime: lt,
      temporadaObjetivo: tempObjetivo,
      stockFisico: mb52.stockFisico,
      fechaVencimiento: mb52.fechaVencimiento,
      costoUnitario: mb52.costoUnitario,
      ssActual,
      ropActual,
      diasConConsumo,
      confianza: conf,
      demandaDiariaPromedio: media,
      demandaDiariaDesvest: desvest,
      ssCalculado,
      ropCalculado,
      difSS: ssCalculado !== null ? ssCalculado - ssActual : null,
      difROP: ropCalculado !== null ? ropCalculado - ropActual : null,
      demandaAnual,
      eoq,
      maxStock,
      riesgo,
      estadoSalud,
      ultimaFechaConsumo,
      diasSinMovimiento,
      stSAP: m['ST'] ?? null,
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
const ETIQUETAS_MOVIMIENTO = {
  201: 'Consumo centro de costo', 202: 'Anulación consumo centro de costo',
  261: 'Consumo orden de mantenimiento', 262: 'Anulación consumo orden',
  281: 'Consumo proyecto', 282: 'Anulación consumo proyecto',
  601: 'Salida por entrega', 602: 'Anulación salida entrega',
  301: 'Despacho a embarcación (combustible)', 302: 'Anulación despacho combustible',
};

/**
 * Serie mensual de consumo real para UN material específico, con el
 * detalle de movimientos que componen cada punto (fechas, cantidades y
 * clase de movimiento SAP) — para el tooltip interactivo del gráfico.
 */
function serieMensualPorMaterial(consumoReal, material) {
  const mapa = new Map(); // mes -> { total, movimientos: [{fechaISO, demanda, claseMovimiento}] }
  for (const r of consumoReal) {
    if (r.material !== material) continue;
    const clave = r.fechaISO.slice(0, 7);
    if (!mapa.has(clave)) mapa.set(clave, { total: 0, movimientos: [] });
    const entry = mapa.get(clave);
    entry.total += r.demanda;
    entry.movimientos.push({ fechaISO: r.fechaISO, demanda: r.demanda, claseMovimiento: r.claseMovimiento });
  }
  return Array.from(mapa.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([mes, e]) => {
      const porClase = new Map();
      e.movimientos.forEach((mv) => {
        porClase.set(mv.claseMovimiento, (porClase.get(mv.claseMovimiento) || 0) + mv.demanda);
      });
      const detalle = [...porClase.entries()]
        .map(([clase, total]) => ({ clase, etiqueta: ETIQUETAS_MOVIMIENTO[clase] || `Movimiento ${clase}`, total }))
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
      const ultimoMovimiento = [...e.movimientos].sort((a, b) => (a.fechaISO < b.fechaISO ? 1 : -1))[0];
      return {
        mes,
        total: e.total,
        numMovimientos: e.movimientos.length,
        detalle,
        ultimaFechaDelMes: ultimoMovimiento ? ultimoMovimiento.fechaISO : null,
      };
    });
}

/**
 * Estadísticas de demanda MENSUAL por material (no diaria) — la variabilidad
 * diaria de repuestos/insumos industriales es intrínsecamente enorme (la
 * mayoría de los días hay cero consumo), así que un CV diario clasifica
 * prácticamente todo como "errático" sin distinguir nada útil. La demanda
 * mensual agregada es la base estándar para análisis XYZ en este tipo de
 * inventario intermitente.
 */
function calcularStatsMensualesGenerales(consumoReal, fechaMinISO, fechaMaxISO) {
  const min = new Date(fechaMinISO + 'T00:00:00');
  const max = new Date(fechaMaxISO + 'T00:00:00');
  const mesesTotales = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1;

  const porMaterialMes = new Map();
  for (const r of consumoReal) {
    const mesKey = r.fechaISO.slice(0, 7);
    if (!porMaterialMes.has(r.material)) porMaterialMes.set(r.material, new Map());
    const m = porMaterialMes.get(r.material);
    m.set(mesKey, (m.get(mesKey) || 0) + r.demanda);
  }

  const resultado = new Map();
  for (const [material, mapaMeses] of porMaterialMes.entries()) {
    let suma = 0;
    let sumaSq = 0;
    let mesesConConsumo = 0;
    for (const v of mapaMeses.values()) {
      suma += v;
      sumaSq += v * v;
      if (v > 0) mesesConConsumo += 1;
    }
    const media = suma / mesesTotales;
    let varianza = (sumaSq - mesesTotales * media * media) / Math.max(mesesTotales - 1, 1);
    if (varianza < 0 || !isFinite(varianza)) varianza = 0;
    resultado.set(material, { media, desvest: Math.sqrt(varianza), mesesConConsumo, mesesTotales });
  }
  return resultado;
}

/**
 * Categoriza un material en Combustibles / Insumos / Otros:
 * - Combustibles: por el grupo de SAP (PETROLEO/GAS/DIESEL/COMBUST) — es
 *   una categoría física clara, no depende de dónde se consuma.
 * - Insumos: cualquier material (que no sea combustible) que SÍ tiene
 *   consumo real registrado en PI01 (almacén de Planta). PI01 es donde se
 *   registra el consumo operativo real de insumos/materia prima — usar el
 *   texto del grupo SAP no sirve porque etiquetas como "QUIMICOS Y
 *   REACTIVOS" mezclan reactivos de laboratorio con insumos reales.
 * - Otros: todo lo demás (repuestos, EPP, ferretería, etc.), que en la
 *   práctica se consume casi todo en L001.
 */
function categorizarMaterial(material, denomGrupoArticulo, materialesConConsumoPI01) {
  const d = (denomGrupoArticulo || '').toUpperCase();
  if (/PETROLEO|COMBUST|DIESEL|GAS/.test(d)) return 'Combustibles';
  if (materialesConConsumoPI01 && materialesConConsumoPI01.has(material)) return 'Insumos';
  return 'Otros';
}

/**
 * Devuelve el set de materiales que tienen al menos un movimiento de
 * "consumo real" (códigos base, sin contar el extra de combustibles)
 * registrado en el almacén indicado — se usa para detectar qué materiales
 * son Insumos reales (consumo en PI01).
 */
function materialesConConsumoEnAlmacen(dataRows, almacen) {
  const set = new Set();
  for (const row of dataRows) {
    if (String(row['Almacén']).trim() !== almacen) continue;
    const clase = Number(row['Clase de movimiento']);
    if (!CODIGOS_CONSUMO.has(clase)) continue;
    set.add(String(row['Material']).trim());
  }
  return set;
}

/**
 * Clasificación ABC (por valor de consumo anual: costo unitario × demanda
 * anual estimada) y XYZ (por coeficiente de variación de la demanda
 * MENSUAL, medido sobre todo el período).
 *
 * El ABC corre el Pareto POR SEPARADO dentro de cada categoría (Combustibles /
 * Insumos / Otros), para que un material de muy alto valor (ej. diesel) no
 * arrastre a todo lo demás a la categoría C solo por dominar el valor total.
 *
 * ABC: Pareto clásico 80/95 — A = primer 80% del valor acumulado DE SU
 * CATEGORÍA, B = siguiente 15% (hasta 95%), C = el resto (incluye
 * materiales sin costo unitario conocido).
 *
 * XYZ: en vez de umbrales fijos de manual (X≤0.5, Y≤1.0, Z>1.0 — pensados
 * para demanda tipo retail), se usan TERCILES calculados sobre la propia
 * distribución de CV mensual de tus materiales: el tercio con menor CV es
 * X (lo más predecible QUE TIENES), el tercio del medio es Y, el tercio
 * con mayor CV es Z. Así la clasificación siempre distingue algo útil, sin
 * importar qué tan intermitente sea tu demanda en términos absolutos.
 * N/D = menos de 3 meses con consumo registrado.
 */
function calcularABCXYZ(calculados, statsMensuales) {
  const conCategoria = calculados; // 'categoria' ya viene calculado desde calcularMateriales

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

  const cvPorMaterial = new Map();
  for (const [material, s] of statsMensuales.entries()) {
    if (s.mesesConConsumo < 3 || s.media <= 0) continue;
    cvPorMaterial.set(material, s.desvest / s.media);
  }

  const cvsOrdenados = [...cvPorMaterial.values()].sort((a, b) => a - b);
  const percentil = (p) => {
    if (cvsOrdenados.length === 0) return null;
    const idx = Math.min(cvsOrdenados.length - 1, Math.floor(p * cvsOrdenados.length));
    return cvsOrdenados[idx];
  };
  const corteX = percentil(1 / 3);
  const corteY = percentil(2 / 3);

  const claseXYZ = new Map();
  for (const m of conCategoria) {
    const cv = cvPorMaterial.get(m.material);
    if (cv === undefined || corteX === null) {
      claseXYZ.set(m.material, 'N/D');
      continue;
    }
    claseXYZ.set(m.material, cv <= corteX ? 'X' : cv <= corteY ? 'Y' : 'Z');
  }

  return conCategoria.map((m) => ({
    ...m,
    valorConsumoAnual: valorPorMaterial.get(m.material) || 0,
    claseABC: claseABC.get(m.material) || 'C',
    claseXYZ: claseXYZ.get(m.material) || 'N/D',
    cvMensual: cvPorMaterial.get(m.material) ?? null,
  }));
}

/**
 * Agrega el stock libre de MB52 por material Y por almacén (sin filtrar a
 * uno solo) — permite ver cuánto stock hay del mismo material en otros
 * almacenes distintos al principal (L001), para el monitor de traslados.
 */
function agregarStockPorAlmacenTodos(mb52Rows) {
  const mapa = new Map(); // material -> Map(almacen -> stock)
  for (const row of mb52Rows) {
    const material = String(row['Material']).trim();
    const almacen = String(row['Almacén'] || '').trim();
    if (!almacen) continue;
    const stock = Number(row['Libre utilización']) || 0;
    if (!mapa.has(material)) mapa.set(material, new Map());
    const m = mapa.get(material);
    m.set(almacen, (m.get(almacen) || 0) + stock);
  }
  return mapa;
}

/**
 * Calcula, para cada material, su "necesidad" en el almacén principal
 * (ROP calculado − stock real, nunca negativo) y cuánto de esa necesidad
 * podría cubrirse con stock libre que ya existe en OTROS almacenes —
 * candidato a traslado interno en vez de compra nueva.
 */
function enriquecerConTraslados(calculados, stockPorAlmacenTodos, almacenPrincipal) {
  return calculados.map((m) => {
    const necesidad = m.ropCalculado !== null ? Math.max(0, m.ropCalculado - m.stockFisico) : 0;
    const porAlmacen = stockPorAlmacenTodos.get(m.material);
    const detalleOtrosAlmacenes = [];
    let stockOtrosAlmacenes = 0;
    if (porAlmacen) {
      for (const [almacen, stock] of porAlmacen.entries()) {
        if (almacen === almacenPrincipal || stock <= 0) continue;
        detalleOtrosAlmacenes.push({ almacen, stock });
        stockOtrosAlmacenes += stock;
      }
      detalleOtrosAlmacenes.sort((a, b) => b.stock - a.stock);
    }
    return { ...m, necesidad, stockOtrosAlmacenes, detalleOtrosAlmacenes };
  });
}

/**
 * Agrega las columnas del "monitor de cobertura" al estilo del Excel de
 * Brayan: stock en Planta (PI01), stock en tránsito (MB52), stock ideal
 * (consumo promedio × cobertura ideal en días) y cobertura real en días
 * con el stock disponible total (Real + Planta + Tránsito).
 */
function enriquecerConCobertura(calculados, stockPorAlmacenTodos, transitoMap, almacenPrincipal, almacenPlanta, coberturaIdealDias) {
  return calculados.map((m) => {
    const porAlmacen = stockPorAlmacenTodos.get(m.material);
    const planta = porAlmacen && porAlmacen.has(almacenPlanta) ? porAlmacen.get(almacenPlanta) : 0;
    const transito = transitoMap.get(m.material) || 0;

    const stockIdeal = m.demandaDiariaPromedio * coberturaIdealDias;
    const stockDisponibleTotal = m.stockFisico + planta + transito;
    const coberturaDias = m.demandaDiariaPromedio > 0 ? stockDisponibleTotal / m.demandaDiariaPromedio : null;
    const solicitarCobertura = Math.max(0, stockIdeal - stockDisponibleTotal);

    return { ...m, planta, transito, stockIdeal, stockDisponibleTotal, coberturaDias, solicitarCobertura };
  });
}

/**
 * Clasificación de rotación basada en la frecuencia real de consumo
 * (no en el histórico completo agregado, sino en CUÁNTOS MESES DISTINTOS
 * tuvo consumo dentro del período observado):
 *   - Alta Rotación: consumió en ≥80% de los meses del período (consume casi todos los meses)
 *   - Baja Rotación: consumió en algunos meses, pero menos del 80%
 *   - Sin Movimiento: cero consumo en todo el período
 */
function calcularClasificacionMovimiento(consumoReal, fechaMinISO, fechaMaxISO) {
  const min = new Date(fechaMinISO + 'T00:00:00');
  const max = new Date(fechaMaxISO + 'T00:00:00');
  const mesesTotales = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1;

  const mesesPorMaterial = new Map();
  for (const r of consumoReal) {
    if (r.demanda <= 0) continue;
    if (!mesesPorMaterial.has(r.material)) mesesPorMaterial.set(r.material, new Set());
    mesesPorMaterial.get(r.material).add(r.fechaISO.slice(0, 7));
  }

  const resultado = new Map();
  for (const [material, meses] of mesesPorMaterial.entries()) {
    const n = meses.size;
    const pctMeses = n / mesesTotales;
    const clasificacionMovimiento = pctMeses >= 0.8 ? 'Alta Rotación' : 'Baja Rotación';
    resultado.set(material, { mesesConConsumo: n, mesesTotales, pctMeses, clasificacionMovimiento });
  }
  return resultado; // los materiales sin ninguna fila aquí = Sin Movimiento (se resuelve al consultar el mapa)
}

/**
 * Decide qué tratamiento recibe cada material según su clasificación SAP,
 * usando el histórico de movimientos para los casos que lo requieren
 * (Uso Inmediato). Devuelve si el material entra o no al cálculo de
 * SS/ROP/EOQ, con qué clasificación "final", y el motivo si queda fuera.
 */
function determinarTratamiento(clasificacionSAP, movInfo) {
  const sap = (clasificacionSAP || '').trim();

  if (sap === 'Inactivo') {
    return { clasificacionFinal: 'Inactivo', incluido: false, reclasificado: false, motivo: 'Inactivo — código sin uso, no requiere gestión de stock' };
  }
  if (sap === 'Produción' || sap === 'Producción') {
    return { clasificacionFinal: 'Producción', incluido: false, reclasificado: false, motivo: 'Uso en producción — requiere un módulo de planificación aparte, no se incluye aquí' };
  }
  if (sap === 'Estratégico') {
    return { clasificacionFinal: 'Estratégico', incluido: true, reclasificado: false, motivo: null };
  }
  if (sap === 'Uso Inmediato') {
    const clase = movInfo ? movInfo.clasificacionMovimiento : 'Sin Movimiento';
    if (clase === 'Alta Rotación' || clase === 'Baja Rotación') {
      return { clasificacionFinal: clase, incluido: true, reclasificado: true, motivo: `Reclasificado desde Uso Inmediato — el histórico muestra consumo en ${movInfo.mesesConConsumo} de ${movInfo.mesesTotales} meses` };
    }
    return { clasificacionFinal: 'Uso Inmediato (confirmado)', incluido: false, reclasificado: false, motivo: 'Sin consumo regular en el período — se confirma compra solo por reserva, no requiere stock' };
  }
  // Alta Rotación / Baja Rotación ya etiquetados por SAP, o sin clasificar -> tratamiento normal
  return { clasificacionFinal: sap || 'Sin Clasificar', incluido: true, reclasificado: false, motivo: null };
}

/**
 * Resumen comparativo para el Simulador de Escenarios: presupuesto de
 * compras requerido, materiales en riesgo de quiebre, capital en exceso
 * de stock (más del doble del ROP) y cobertura promedio en días.
 */
function calcularResumenSimulacion(planificados) {
  const conRiesgo = planificados.filter((m) => m.riesgo === 'ROJO' || m.riesgo === 'AMARILLO');
  const presupuestoCompras = conRiesgo.reduce((acc, m) => {
    const necesidad = m.ropCalculado !== null ? Math.max(0, m.ropCalculado - m.stockFisico) : 0;
    return acc + necesidad * (m.costoUnitario || 0);
  }, 0);

  const materialesEnRiesgo = planificados.filter((m) => m.riesgo === 'ROJO').length;

  const sobrestock = planificados.filter((m) => m.ropCalculado !== null && m.ropCalculado > 0 && m.stockFisico > m.ropCalculado * 2);
  const capitalSobrestock = sobrestock.reduce((acc, m) => {
    const exceso = m.stockFisico - m.ropCalculado * 2;
    return acc + exceso * (m.costoUnitario || 0);
  }, 0);

  const conCobertura = planificados.filter((m) => m.demandaDiariaPromedio > 0);
  const coberturaPromedio =
    conCobertura.length > 0
      ? conCobertura.reduce((acc, m) => acc + m.stockFisico / m.demandaDiariaPromedio, 0) / conCobertura.length
      : 0;

  return { presupuestoCompras, materialesEnRiesgo, capitalSobrestock, coberturaPromedio };
}

/**
 * Explica en una frase por qué un material quedó en su estado de salud —
 * se usa en la ficha de detalle por material.
 */
function generarDiagnostico(m) {
  if (!m.incluidoEnPlanificacion) {
    return m.motivoExclusion || 'Este material no está incluido en la planificación de SS/ROP.';
  }
  switch (m.estadoSalud) {
    case 'STOCKOUT_CRITICAL':
      return `Stock real (${Math.round(m.stockFisico)}) está en cero o por debajo del Stock de Seguridad (${Math.round(m.ssCalculado)}) con muy pocos días de cobertura — riesgo inmediato de quiebre.`;
    case 'REORDER_URGENT':
      return `Stock real (${Math.round(m.stockFisico)}) ya cruzó el Punto de Pedido (${Math.round(m.ropCalculado)}) — corresponde generar el pedido ahora.`;
    case 'OVERSTOCK':
      return `Stock real (${Math.round(m.stockFisico)}) supera el máximo recomendado (${Math.round(m.maxStock)}) — hay capital de más inmovilizado en este material.`;
    case 'DEAD_STOCK':
      return `Tiene stock físico (${Math.round(m.stockFisico)}) pero no registra ningún consumo real en el período analizado — revisar si sigue vigente.`;
    case 'OPTIMAL':
      return `Stock real (${Math.round(m.stockFisico)}) está dentro del rango saludable, entre el Punto de Pedido (${Math.round(m.ropCalculado)}) y el máximo recomendado (${Math.round(m.maxStock)}).`;
    default:
      return 'Sin información suficiente para diagnosticar.';
  }
}

// ============================================================
// VALORIZACIÓN EN DÓLARES — Almacén / PPTT / Monitor / % Vencido
// (usa el mismo MB52 ya cargado para el resto de la app, más un
// archivo Monitor/ZMMR0105 aparte, que sí es un archivo distinto)
// ============================================================

const ALMACENES_PPTT = ['C001', 'TK01', 'TK02', 'TK03', 'DK01', 'DK02', 'DK03', 'CL01'];
const ALMACENES_VENCIDO_SCOPE = ['L001', 'L002', 'L003', 'L004', 'L005', 'L006', 'L007', 'L008', 'L010'];

function sumValorPorAlmacenes(mb52Rows, almacenes) {
  let total = 0;
  for (const row of mb52Rows) {
    const alm = String(row['Almacén'] || '').trim();
    if (!almacenes.includes(alm)) continue;
    total += Number(row['Valor libre util.']) || 0;
  }
  return total;
}

function sumValorVencido(mb52Rows) {
  let total = 0;
  for (const row of mb52Rows) {
    const alm = String(row['Almacén'] || '').trim();
    const dias = Number(row['Días Res.']);
    if (!ALMACENES_VENCIDO_SCOPE.includes(alm)) continue;
    if (!(dias < 0)) continue;
    total += Number(row['Valor libre util.']) || 0;
  }
  return total;
}

function sumImporteMonitor(monitorRows) {
  let total = 0;
  for (const row of monitorRows) {
    total += Number(row['Importe']) || 0;
  }
  return total;
}

/**
 * Calcula los 5 KPIs de "Valorización en Dólares":
 * - Valorizado Almacén = Valor libre util. de L001, dividido entre el dólar.
 * - Valorizado PPTT = Valor libre util. de los almacenes de producto
 *   terminado (C001, TK01-03, DK01-03, CL01), dividido entre el dólar.
 * - % Vencido = Valor libre util. con Días Res. < 0 (en L001-L008, L010)
 *   dividido entre el Valor libre util. de L001 — ambos en soles, el
 *   tipo de cambio se cancela así que no hace falta convertir para este %.
 * - Valorizado Monitor = suma de Importe del Monitor — YA está en dólares.
 * - % Monitor = Valorizado Monitor (US$) entre Valorizado Almacén (US$).
 */
function calcularValorizacionReal(mb52Rows, monitorRows, tipoCambio) {
  const tc = tipoCambio > 0 ? tipoCambio : 1;

  const valorAlmacenSoles = sumValorPorAlmacenes(mb52Rows, ['L001']);
  const valorPPTTSoles = sumValorPorAlmacenes(mb52Rows, ALMACENES_PPTT);
  const valorVencidoSoles = sumValorVencido(mb52Rows);

  const valorizadoAlmacen = valorAlmacenSoles / tc;
  const valorizadoPPTT = valorPPTTSoles / tc;
  const valorizadoMonitor = sumImporteMonitor(monitorRows); // ya en USD

  const pctVencido = valorAlmacenSoles > 0 ? (valorVencidoSoles / valorAlmacenSoles) * 100 : 0;
  const pctMonitor = valorizadoAlmacen > 0 ? (valorizadoMonitor / valorizadoAlmacen) * 100 : 0;

  return { valorizadoAlmacen, valorizadoPPTT, valorizadoMonitor, pctMonitor, pctVencido };
}

/**
 * Stock de un conjunto de materiales/almacenes específicos (para las tablas
 * de "Stock de Aceite de Pescado" y "Stock de Harina de Pescado" — se
 * definen por almacén, no por categoría, tal como me indicaste).
 */
function stockPorAlmacenes(mb52Rows, almacenes) {
  const acc = new Map(); // material -> {descripcion, almacen, stock}
  for (const row of mb52Rows) {
    const almacen = String(row['Almacén'] || '').trim();
    if (!almacenes.includes(almacen)) continue;
    const material = String(row['Material'] || '').trim();
    const clave = material + '|' + almacen;
    const stock = Number(row['Libre utilización']) || 0;
    if (!acc.has(clave)) {
      acc.set(clave, {
        material,
        descripcion: row['Texto breve de material'] || '',
        almacen,
        stock: 0,
      });
    }
    acc.get(clave).stock += stock;
  }
  return [...acc.values()].sort((a, b) => b.stock - a.stock);
}

/**
 * Agrupa el Monitor (ZMMR0105) por Nombre del usuario, sumando Importe.
 */
function agruparMonitorPorUsuario(monitorRows) {
  const mapa = new Map();
  for (const row of monitorRows) {
    const usuario = String(row['Nombre del usuario'] || 'Sin usuario').trim();
    mapa.set(usuario, (mapa.get(usuario) || 0) + (Number(row['Importe']) || 0));
  }
  return [...mapa.entries()]
    .map(([usuario, importe]) => ({ usuario, importe }))
    .sort((a, b) => b.importe - a.importe);
}

/**
 * Detalle línea por línea del Monitor (ZMMR0105), para la tabla de detalle.
 */
function detalleMonitor(monitorRows) {
  return monitorRows
    .map((row) => ({
      // "Material" trae el código de referencia interno (ej. BSU-002025);
      // "Material_1" es el código real de SAP — el que se usa en todo el resto
      // de la app (Excel duplica el encabezado "Material" y SheetJS numera
      // la segunda ocurrencia con el sufijo _1 automáticamente).
      material: String(row['Material_1'] ?? row['Material'] ?? '').trim(),
      descripcion: row['Texto breve de material'] || '',
      stockNoVal: Number(row['Stock no Val']) || 0,
      importe: Number(row['Importe']) || 0,
      usuario: row['Nombre del usuario'] || '',
    }))
    .sort((a, b) => b.importe - a.importe);
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
  calcularStatsMensualesGenerales,
  calcularABCXYZ,
  categorizarMaterial,
  materialesConConsumoEnAlmacen,
  agregarStockPorAlmacenTodos,
  enriquecerConTraslados,
  enriquecerConCobertura,
  materialesPorCategoria,
  extraerTransitoPorMaterial,
  calcularClasificacionMovimiento,
  determinarTratamiento,
  calcularResumenSimulacion,
  generarDiagnostico,
  calcularValorizacionReal,
  stockPorAlmacenes,
  agruparMonitorPorUsuario,
  detalleMonitor,
  confianza,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SupplyEngine;
}
if (typeof window !== 'undefined') {
  window.SupplyEngine = SupplyEngine;
}
