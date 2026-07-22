# Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (puede ser privado si prefieres que no sea público).
2. Sube todos los archivos de esta carpeta a ese repositorio (arrastra y suelta en la web
   de GitHub, o `git add . && git commit -m "primera version" && git push` si usas Git).
3. Entra a **Settings → Pages** del repositorio.
4. En "Build and deployment", elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
5. Guarda. En un par de minutos tu app queda publicada en:
   `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`

## Compartir por link (sin Supabase, usando el propio GitHub)

Ahora la app tiene una pestaña **Compartir** que sube los resultados calculados
al mismo repositorio donde vive la página — no hace falta ningún servicio externo.

**Cómo funciona:**
- Tú (el único que publica) cargas tus 3 archivos, revisas el dashboard, y en la
  pestaña Compartir le das a "Publicar esta versión". Eso sube un archivo
  `data/snapshot.json` al repo con los resultados ya calculados.
- Cualquiera que abra el link de GitHub Pages ve automáticamente un aviso
  "Hay una versión publicada" y puede verla con un clic — **sin tocar ningún
  archivo de SAP ni configurar nada**. Solo lee ese JSON directo del repo.

**Para poder publicar, necesitas un token de GitHub (una sola vez):**
1. En GitHub: `Settings` (de tu cuenta, no del repo) → `Developer settings` →
   `Personal access tokens` → `Fine-grained tokens` → `Generate new token`.
2. En "Repository access", elige **"Only select repositories"** y selecciona
   únicamente este repositorio (nunca des acceso a todos tus repos).
3. En "Permissions" → "Repository permissions", busca **"Contents"** y ponlo en
   **"Read and write"**. Deja todo lo demás en "No access".
4. Genera el token y cópialo (empieza con `github_pat_...`). Solo se muestra una vez.
5. En la app, pestaña Compartir, pega tu usuario, el nombre del repo y el token,
   dale "Guardar configuración" (queda solo en tu navegador, nunca se sube a
   ningún lado) y luego "Publicar esta versión".

**Importante sobre el repositorio:**
- Para que cualquiera pueda *ver* el link sin token, el repositorio debe ser
  **público**. Si tus datos de inventario son sensibles y prefieres que sea
  privado, el link va a funcionar igual para ti, pero otras personas necesitarían
  su propio token con acceso de lectura a ese repo para ver la versión publicada
  — en ese caso probablemente te convenga volver a la opción de Supabase.
- El archivo publicado (`data/snapshot.json`) solo contiene los resultados ya
  calculados (SS, ROP, EOQ, riesgo, inmovilizados) — no los 60,000 movimientos
  crudos de SAP, así que pesa poco (~300-400 KB) y no expone el detalle
  transaccional completo.

## Sobre los archivos que quedan solo en tu navegador (no publicados)

Los 3 archivos que sueltas (MRP, DATA, MB52) se guardan en el navegador que estés usando
(IndexedDB), **no se suben a GitHub ni a ningún servidor**. Eso significa:

- Si abres la app desde el mismo navegador y computadora, la próxima vez que entres
  va a recordar los archivos que cargaste la última vez.
- Si la abres desde otro navegador o computadora, no va a tener esos datos — vas a
  tener que soltarlos de nuevo ahí (una sola vez, después también queda guardado en ese equipo).
- Usa el botón "Reemplazar" junto a cada archivo para actualizar solo ese uno cuando
  te llegue una versión nueva de SAP, sin tener que volver a subir los otros dos.
- "Borrar todos los datos guardados en este navegador" limpia el caché si quieres
  empezar de cero o si vas a compartir el equipo con alguien más.
