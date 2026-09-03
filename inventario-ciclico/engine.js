// ============================================================
// MOTOR — Inventario Cíclico
// Agrupa el MB52 (almacén L001) por Ubicación (zona física) y
// reparte esas zonas entre las semanas del ciclo, en partes
// parejas por carga de trabajo (cantidad de materiales).
// ============================================================

/**
 * Agrupa el MB52 por zona (Ubicación) dentro de un almacén, sumando el
 * stock de cada material por zona (por si un material tiene varios lotes
 * en la misma ubicación).
 */
function agruparPorZona(mb52Rows, almacen) {
  const mapa = new Map(); // zona -> Map(material -> {descripcion, um, cantidadSistema})
  for (const row of mb52Rows) {
    if (String(row['Almacén'] || '').trim() !== almacen) continue;
    const zona = String(row['Ubicación'] || '').trim() || 'Sin Ubicación';
    const material = String(row['Material'] || '').trim();
    if (!material) continue;
    const cantidad = Number(row['Libre utilización']) || 0;

    if (!mapa.has(zona)) mapa.set(zona, new Map());
    const materiales = mapa.get(zona);
    if (!materiales.has(material)) {
      materiales.set(material, {
        material,
        descripcion: row['Texto breve de material'] || '',
        um: row['Unidad medida base'] || '',
        cantidadSistema: 0,
      });
    }
    materiales.get(material).cantidadSistema += cantidad;
  }

  const zonas = [];
  for (const [zona, materiales] of mapa.entries()) {
    zonas.push({
      zona,
      materiales: [...materiales.values()].sort((a, b) => a.material.localeCompare(b.material)),
    });
  }
  return zonas.sort((a, b) => a.zona.localeCompare(b.zona));
}

/**
 * Extrae la "zona" de una Ubicación cruda de MB52, según el nivel de
 * agrupación elegido: 0 = ubicación completa (un casillero = una zona),
 * 1-3 = cantidad de segmentos (separados por punto) a tomar desde la
 * izquierda. Las ubicaciones con nombre propio (no empiezan con número,
 * ej. "I.Q.B.F.", "PLANTA") no se cortan, quedan enteras.
 */
function extraerZona(ubicacionCruda, nivel) {
  const s = String(ubicacionCruda || '').trim();
  if (!s) return 'SIN UBICACIÓN';
  if (nivel === 0) return s;
  if (!/^[0-9]/.test(s)) return s;
  const partes = s.split('.');
  if (partes.length <= nivel) return s;
  return partes.slice(0, nivel).join('.');
}

/**
 * Igual que agruparPorZona, pero primero colapsa la Ubicación cruda al
 * nivel de agrupación elegido (ver extraerZona).
 */
function agruparPorZonaConNivel(mb52Rows, almacen, nivel) {
  const mapa = new Map();
  for (const row of mb52Rows) {
    if (String(row['Almacén'] || '').trim() !== almacen) continue;
    const zona = extraerZona(row['Ubicación'], nivel);
    const material = String(row['Material'] || '').trim();
    if (!material) continue;
    const cantidad = Number(row['Libre utilización']) || 0;

    if (!mapa.has(zona)) mapa.set(zona, new Map());
    const materiales = mapa.get(zona);
    if (!materiales.has(material)) {
      materiales.set(material, {
        material,
        descripcion: row['Texto breve de material'] || '',
        um: row['Unidad medida base'] || '',
        cantidadSistema: 0,
      });
    }
    materiales.get(material).cantidadSistema += cantidad;
  }

  const zonas = [];
  for (const [zona, materiales] of mapa.entries()) {
    zonas.push({
      zona,
      materiales: [...materiales.values()].sort((a, b) => a.material.localeCompare(b.material)),
    });
  }
  return zonas.sort((a, b) => a.zona.localeCompare(b.zona));
}

/**
 * Reparte las zonas entre las semanas del ciclo — reparto "greedy" por
 * carga de trabajo (cantidad de materiales), no solo por cantidad de
 * zonas, para que ninguna semana quede con muchísimo más trabajo que otra.
 */
function asignarSemanas(zonas, cicloSemanas) {
  const ordenado = [...zonas].sort((a, b) => b.materiales.length - a.materiales.length);
  const cargaPorSemana = new Array(cicloSemanas).fill(0);

  const resultado = ordenado.map((z) => {
    let semanaMin = 0;
    for (let s = 1; s < cicloSemanas; s++) {
      if (cargaPorSemana[s] < cargaPorSemana[semanaMin]) semanaMin = s;
    }
    cargaPorSemana[semanaMin] += z.materiales.length;
    return { ...z, semana: semanaMin + 1 };
  });

  return resultado.sort((a, b) => a.semana - b.semana || a.zona.localeCompare(b.zona));
}

/**
 * A partir de una fecha de inicio del programa, calcula en qué semana del
 * ciclo estamos hoy (1..cicloSemanas) y cuántas vueltas completas
 * (ciclos) ya se dieron.
 */
function semanaActualDelCiclo(fechaInicioISO, cicloSemanas, hoyISO) {
  const inicio = new Date(fechaInicioISO + 'T00:00:00');
  const hoy = new Date((hoyISO || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  const diffDias = Math.floor((hoy - inicio) / 86400000);
  const semanaAbsoluta = Math.floor(diffDias / 7);
  const semanaEnCiclo = (((semanaAbsoluta % cicloSemanas) + cicloSemanas) % cicloSemanas) + 1;
  const numeroDeVuelta = Math.floor(semanaAbsoluta / cicloSemanas) + 1;
  return { semanaEnCiclo, numeroDeVuelta, diffDias };
}

/**
 * Compara cantidad de sistema vs. cantidad física contada, para la
 * pantalla de Resultados.
 */
function calcularDiferencias(items) {
  return items.map((it) => {
    const diferencia = it.cantidadFisica - it.cantidadSistema;
    const pct = it.cantidadSistema !== 0 ? (diferencia / it.cantidadSistema) * 100 : it.cantidadFisica !== 0 ? 100 : 0;
    return { ...it, diferencia, pctDiferencia: pct };
  });
}

function slugZona(zona) {
  return String(zona)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'ZONA';
}

const CicloEngine = {
  agruparPorZona,
  agruparPorZonaConNivel,
  extraerZona,
  asignarSemanas,
  semanaActualDelCiclo,
  calcularDiferencias,
  slugZona,
};

if (typeof module !== 'undefined' && module.exports) module.exports = CicloEngine;
if (typeof window !== 'undefined') window.CicloEngine = CicloEngine;
