# Imágenes locales de paquetes (#55) — Plan

**Meta:** el admin sube la portada de un paquete (jpeg, png o webp validados por firma), se guarda fuera de `public/` y solo se sirve por un controlador: público si el paquete está publicado, 404 en otro caso (el admin autenticado ve borradores). La portada aparece en el panel y en el catálogo público. Con esto se cierra H2. Sin galería, miniaturas, redimensionado, flyers (H6) ni demo (H7). Sin ADR, sin dependencias nuevas.

**Verificado en la documentación (Astro docs y Context7, Astro 7.4.13):**
- `defineAction({ accept: "form", input: z.object({ file: z.instanceof(File) }) })`; un campo vacío llega como `null` y falla la validación. Desde React: `actions.catalog.uploadCover(formData)`.
- **`security.actionBodySizeLimit`: 1 MB por defecto** (Astro ≥ 5.18). Sin subirlo, una portada de 2 MB se rechaza antes del handler.
- `@astrojs/node` `bodySizeLimit`: 1 GB por defecto → bajarlo a lo necesario.
- Un endpoint devuelve un `Response` con `Content-Type` propio; `HEAD` lo atiende Astro a partir de `GET`.

## Decisiones (confirmadas por el usuario)
1. **Módulo dueño de `media_assets` (confirmado):** nuevo `src/modules/media/` (schema, `AlmacenArchivos`, servicio, firma). Marketing lo reutilizará en H6 sin depender de `catalog`. `catalog` solo guarda `packages.cover_asset_id`.
2. **Tamaño máximo:** 5 MiB (constante `TAMANO_MAXIMO`). `actionBodySizeLimit` y `bodySizeLimit` del adaptador = 6 MiB (margen de multipart).
3. **Texto alternativo:** derivado del nombre (`Portada de {name}`); sin columna nueva.
4. **Clave de almacenamiento:** `media/<uuid>.<ext>` bajo `PRIVATE_STORAGE_DIR`, generada por el servidor; el nombre del cliente se descarta.
5. **FK `packages.cover_asset_id → media_assets.id` con `ON DELETE restrict`** (se borra primero la referencia y luego el asset; un olvido falla en vez de dejar un puntero colgado).
6. **Visibilidad:** público solo si el asset es la portada de un paquete `publicado` (archivado → 404). Con sesión de admin se sirve también el de borradores (`Cache-Control: private, no-store`); el operador no.
7. **Caché (confirmada por el usuario):** portadas públicas `public, max-age=0, must-revalidate`; las que solo ve el admin `no-store`. Nunca `immutable`: tras archivar o despublicar un paquete nada debe seguir saliendo de caché.
8. **Rama:** `feat/h2-55-imagenes-paquetes` desde `origin/dev` (la actual es la de #54; `tsconfig.json` modificado sin relación, no se incluye).

## Cambios por archivo
**Media (nuevo)**
- `src/modules/media/schema.ts`: `media_assets` (`id`, `storage_key` único, `content_type`, `size_bytes`, `created_at`; CHECK de tipo en lista y `size_bytes > 0`). Se añade a `src/db/schema.ts`.
- `src/modules/media/domain/firma.ts`: `detectarTipoImagen(bytes)` pura. jpeg `FF D8 FF` + `FF D9` final; png firma de 8 bytes + `IEND` final; webp `RIFF`…`WEBP` con el tamaño de RIFF = longitud − 8. `shortcut: no decodifica la imagen; subir si se admiten formatos más complejos`.
- `src/modules/media/domain/almacen-archivos.ts`: interfaz `AlmacenArchivos` (`guardar(clave, bytes)`, `leer(clave)`, `borrar(clave)`).
- `src/modules/media/infrastructure/almacen-en-disco.ts`: implementación con `node:fs/promises`; resuelve `path.resolve(raiz, clave)` y rechaza cualquier ruta fuera de la raíz; `borrar` ignora `ENOENT`; escribe con `flag: "wx"`.
- `src/modules/media/application/media-service.ts`: `guardar(archivo)` (vacío → 422, > máximo → 422, firma inválida → 422; el tipo declarado por el cliente se ignora), `abrir(id)`, `eliminar(id)` (archivo y luego fila). Errores tipados de `src/lib/errors.ts` con mensajes públicos fijos.
- `src/modules/media/container.ts`: `crearMedia(db, dir)`; `dir` sale de `process.env.PRIVATE_STORAGE_DIR` en el servidor.

**Catálogo**
- `src/modules/catalog/schema.ts`: `packages.coverAssetId` (uuid, nullable, FK restrict). `types.ts` se actualiza solo (inferido).
- `drizzle-kit generate` → `src/db/migrations/0002_imagenes.sql` (revisar el SQL; nunca `auth migrate`). `db:migrate:demo` igual.
- `PackageRepository` / `DrizzlePackageRepository`: `update` acepta `coverAssetId`; `listPublished` y `find` ya devuelven la columna.
- `PackageService`: nuevo `setCover(id, archivo)` y `delete`. Constructor recibe `media: Pick<MediaService, "guardar" | "eliminar">`.
  - `setCover`: `comprobarEditable` (archivado no se edita) → `media.guardar` → `repo.update` condicional por estado; si falla, `media.eliminar(nuevo)`; **solo tras confirmar** se llama a `media.eliminar(anterior)`.
  - `delete`: tras `repo.delete` correcto, `media.eliminar(paquete.coverAssetId)`.
  - `shortcut: si el proceso muere entre confirmar y borrar queda un archivo huérfano; añadir un barrido si llega a importar`.
- `PublicCatalogService`: `PaqueteEnLista` y `PaqueteDetalle` ganan `portadaUrl: string | null` (`/api/media/<id>`); el id de asset sale solo como URL.
- `src/modules/catalog/container.ts`: recibe `media` y lo inyecta en `PackageService`.

**Actions y rutas**
- `src/actions/catalog.ts`: `uploadCover` con `accept: "form"`, `input: z.object({ id: z.uuid(), file: z.instanceof(File) })`, `exigirAdmin` y `conErrores`.
- `src/pages/api/media/[id].ts` (API Route, ADR-025): `GET` valida UUID (si no, 404), resuelve el registro y la regla de visibilidad, lee del almacén y responde con `Content-Type` guardado, `X-Content-Type-Options: nosniff` y caché. 404 uniforme (`NotFoundError`) para inexistente, no publicado e id inválido; la ruta del disco nunca sale.
- `src/middleware.ts`: resolver sesión también en `/api/media/` (hoy solo `/admin`, `/login` y `/_actions/`); no aplica el guard de `/admin`.
- `astro.config.mjs`: `security.actionBodySizeLimit` y `adapter: node({ bodySizeLimit })` a 6 MiB.

**Interfaz**
- `src/components/catalogo/PortadaForm.tsx` (island, mismo patrón que `PaqueteForm`: `useEnvio`, `ErrorGeneral`): input file `accept="image/jpeg,image/png,image/webp"`, `FormData`, recarga al terminar. Oculto si el paquete está archivado.
- `src/pages/admin/catalogo/[id].astro`: `<img>` de la portada con `alt` y el island.
- `src/pages/index.astro` y `src/pages/paquetes/[id].astro`: `<img src={portadaUrl} alt="Portada de …">` si existe, con `width`/`height` o `loading="lazy"` en la lista.

## Tareas (TDD: prueba primero)
1. **Firma:** pruebas unitarias de `detectarTipoImagen` (válidas de los 3 tipos, extensión/tipo falso con bytes de otro formato, vacío, truncado, texto/HTML/SVG renombrado) → implementación.
2. **Almacén:** prueba con directorio temporal (guardar, leer, borrar, `ENOENT`, clave con `..` y absoluta rechazadas).
3. **`MediaService` y `PackageService.setCover/delete`:** unitarias con almacén y repos en memoria (límite, vacío, orden «borrar anterior solo tras confirmar», fallo del update borra el nuevo, archivado rechaza).
4. **Esquema + migración `0002_imagenes`:** generar y revisar; prueba de integración del repositorio (FK restrict, `cover_asset_id` actualizable).
5. **Action + ruta + middleware + config:** implementar.
6. **Integración con la app real** (`tests/integration/imagenes-paquetes.test.ts`). `prepararAplicacion` debe aceptar un `PRIVATE_STORAGE_DIR` temporal (hoy fija `./storage/private`). Casos: subida válida (admin), extensión falsa, > 5 MiB (handler), > 6 MiB (límite de Astro; comprobar el código real que devuelve), vacío, sin sesión 401, operador 403, lectura pública de portada publicada (200, `Content-Type`, `nosniff`, `Cache-Control`), borrador sin sesión 404, borrador con admin 200, archivado público 404, recorrido de rutas (`..%2F`, UUID inválido) 404, reemplazo borra el archivo anterior, eliminar un borrador borra su archivo y la fila.
7. **UI:** portada en panel y catálogo; extender `pantallas-catalogo` / `catalogo-publico` para comprobar `<img>` con `alt`. Validación manual de la island en Chrome (igual que #53; sin prueba de navegador, PEN-13).
8. **Docs:** guía de desarrollo (sección «Imágenes (#55)»: almacenamiento, límites, ruta de lectura), `06-security-and-access.md` (controlador, firma, visibilidad), `04-domain-and-database.md` (`media_assets`, `cover_asset_id`), `07-api-contracts.md` si lista rutas, y **cerrar H2 en `docs/00-estado.md`** (resumen, tabla, siguiente paso). Sin ADR.
9. **Verificación:** `bun run lint`, `check`, `format:check`, `test`, `build`.

## Riesgos y huecos conocidos
- `actionBodySizeLimit` aplica a **todas** las Actions: se sube a 6 MiB globalmente (las demás son JSON pequeñas).
- Dos subidas concurrentes de portada: gana la última; la condición por estado no detecta cambio de portada. Aceptable con una sola agencia; un `where cover_asset_id = anterior` lo resolvería si se quiere.
- Sin barrido de huérfanos ni limpieza si el proceso muere a mitad.
- DEMO_STORAGE_DIR no se usa todavía (H7).

## Fuera de alcance
Galería, miniaturas/redimensionado, quitar portada sin reemplazarla, imágenes de flyers (H6), modo demo (H7), Tailwind/shadcn (ADR-027).
