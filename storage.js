// ============================================================
// STORAGE — persiste los archivos cargados en IndexedDB, así
// quedan disponibles la próxima vez que se abra la página sin
// tener que volver a arrastrarlos.
// ============================================================

const DB_NAME = 'abastecimiento_l001_db';
const DB_VERSION = 1;
const STORE = 'archivos';

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'tipo' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function guardarArchivo(tipo, nombreArchivo, filas) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      tipo,
      nombreArchivo,
      filas,
      numFilas: filas.length,
      fechaCarga: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function obtenerArchivo(tipo) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(tipo);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function obtenerTodos() {
  try {
    const [MRP, DATA, MB52, MONITOR] = await Promise.all([
      obtenerArchivo('MRP'),
      obtenerArchivo('DATA'),
      obtenerArchivo('MB52'),
      obtenerArchivo('MONITOR'),
    ]);
    return { MRP, DATA, MB52, MONITOR };
  } catch (err) {
    console.warn('No se pudo leer IndexedDB (¿modo incógnito?):', err);
    return { MRP: null, DATA: null, MB52: null, MONITOR: null };
  }
}

async function borrarArchivo(tipo) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(tipo);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function borrarTodo() {
  await Promise.all([borrarArchivo('MRP'), borrarArchivo('DATA'), borrarArchivo('MB52'), borrarArchivo('MONITOR')]);
}

window.Storage = { guardarArchivo, obtenerArchivo, obtenerTodos, borrarArchivo, borrarTodo };
