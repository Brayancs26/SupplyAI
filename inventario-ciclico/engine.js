// ============================================================
// MOTOR — Inventario Cíclico (Contar / Resultados)
// La generación del programa (agrupar zonas, repartir semanas) se
// mudó a Abastecimiento → Reportes de Inventario, que usa su propio
// engine.js porque ahí es donde vive el MB52 cargado. Este archivo
// solo tiene lo que Contar y Resultados necesitan localmente.
// ============================================================

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
  return (
    String(zona)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'ZONA'
  );
}

const CicloEngine = {
  semanaActualDelCiclo,
  calcularDiferencias,
  slugZona,
};

if (typeof module !== 'undefined' && module.exports) module.exports = CicloEngine;
if (typeof window !== 'undefined') window.CicloEngine = CicloEngine;
