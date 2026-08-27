// ============================================================
// PARSER DE ARCHIVOS — lee los .xlsx soltados por el usuario y
// detecta automáticamente si son MRP, DATA (movimientos) o MB52
// mirando los encabezados de columna.
// ============================================================

function leerArchivoComoWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        resolve(wb);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo ' + file.name));
    reader.readAsArrayBuffer(file);
  });
}

function workbookAJson(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
}

function detectarTipo(filas) {
  if (!filas || filas.length === 0) return 'DESCONOCIDO';
  const headers = new Set(Object.keys(filas[0]));
  if (headers.has('Libre utilización') && headers.has('Valor libre util.')) return 'MB52';
  if (headers.has('Punto de pedido') && headers.has('Stock de seguridad')) return 'MRP';
  if (headers.has('Clase de movimiento') && headers.has('Ctd.en UM entrada')) return 'DATA';
  if (headers.has('Importe') && headers.has('Nombre del usuario')) return 'MONITOR';
  return 'DESCONOCIDO';
}

/**
 * Procesa una lista de File. Devuelve { MRP, DATA, MB52, MONITOR, desconocidos }
 * con las filas ya parseadas (o null si no se detectó ese tipo).
 */
async function procesarArchivos(fileList) {
  const resultado = { MRP: null, DATA: null, MB52: null, MONITOR: null, desconocidos: [], errores: [] };

  for (const file of fileList) {
    if (!/\.xlsx?$/i.test(file.name)) {
      resultado.errores.push(`${file.name}: no es un archivo Excel (.xlsx)`);
      continue;
    }
    try {
      const wb = await leerArchivoComoWorkbook(file);
      const filas = workbookAJson(wb);
      const tipo = detectarTipo(filas);
      if (tipo === 'DESCONOCIDO') {
        resultado.desconocidos.push(file.name);
        continue;
      }
      resultado[tipo] = { nombreArchivo: file.name, filas };
    } catch (err) {
      resultado.errores.push(`${file.name}: ${err.message}`);
    }
  }
  return resultado;
}

window.FileParser = { procesarArchivos, detectarTipo };
