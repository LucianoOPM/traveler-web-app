# Pantallas administrativas de paquetes y salidas (#53) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin cree, edite y publique paquetes con varias salidas (y sus puntos de abordaje) desde `/admin/catalogo`, con importes en pesos y fechas en la zona de la agencia; el operador no accede.

**Architecture:** Páginas Astro SSR bajo `/admin/catalogo` leen vía servicios (nuevos métodos `list*`). Las escrituras las hacen islands React (`client:load`) que llaman a `actions.catalog.*` (ya existen, #51/#52). Conversión pesos↔centavos y local↔UTC en funciones puras en `src/lib/`, usadas solo en la isla (las Actions siguen recibiendo centavos y UTC). El `403` para el operador se aplica en el middleware (los errores lanzados en una página fuera de `/api/` no se convierten en 403). Sin ADR, sin migración, sin dependencias nuevas.

**Tech Stack:** Astro 7 (Actions, `isInputError`), React 19, Drizzle, Bun test, `Intl.DateTimeFormat` (sin librería de fechas).

**Spec:** issue #53 (`gh issue view 53`); reglas en `docs/04-ingenieria/09-development-guide.md` y ADR-024/025/026.

## Global Constraints

- Dinero: centavos enteros, nunca floats; se parsea el **texto decimal** (sin `parseFloat` ni `* 100`).
- Fechas: se capturan en `AGENCY_TIMEZONE` y se envían a la Action como ISO UTC con `Z` (`z.iso.datetime()` rechaza offsets).
- Las páginas de catálogo exigen rol `admin` **en el servidor**: operador → `403`, sin sesión → `302 /login`. Ocultar el enlace en el layout no es la protección.
- Lógica de negocio en servicios/dominio, no en islands ni páginas (ADR-026). Las islands solo traducen formulario ↔ Action.
- Sin prueba de navegador (PEN-13): las pruebas de integración usan la app real y las Actions por HTTP.
- Fuera de alcance: imágenes, catálogo público, reservas, editar/borrar puntos de abordaje desde UI (solo crear y asignar/quitar).
- Comentarios y mensajes de UI en español; commits Conventional Commits; sin Python.

## Review Focus

- `"19.99"` debe dar `1999` (con `19.99*100` da `1998.999…`): cubierto en Task 1.
- `"1,500.50"` o `"1500,50"` (separadores de miles/coma decimal): se rechazan (`null`), no se adivinan: Task 1.
- Importe > `2_147_483_647` centavos: `null` (la Action lo rechazaría con 400 sin campo útil): Task 1.
- Hora inexistente (salto de primavera) → `null`; hora ambigua (fin de horario de verano) → la primera ocurrencia; 22:00 local que cae al día siguiente en UTC: Task 2.
- Clave desconocida en la Action (`z.strictObject`) llega sin `fields` (Zod la reporta con `path: []` → `formErrors`): mensaje general, no un campo vacío: Task 5.
- `/admin/catalogo/<no-uuid>` o paquete inexistente → `404`, no `500`: Task 6.
- Admin vetado (`banned`) y rol `"operator,admin"` en las rutas de catálogo: Task 4.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/importes.ts` (nuevo) | `pesosACentavos`, `centavosAPesos` |
| `src/lib/fechas.ts` (nuevo) | `localAUtc`, `utcALocal` |
| `src/lib/guards.ts` (mod) | exportar `esAdmin(user)` y reutilizarlo en `exigirAdmin` |
| `src/middleware.ts` (mod) | `403` a no-admin en `/admin/catalogo` |
| `src/layouts/AdminLayout.astro` (mod) | enlace «Catálogo» solo para admin |
| `src/modules/catalog/domain/{package,departure,boarding-point}-repository.ts` (mod) | métodos de lectura |
| `src/modules/catalog/infrastructure/drizzle-*-repository.ts` (mod) | implementarlos |
| `src/modules/catalog/application/*-service.ts` (mod) | exponer lecturas |
| `src/components/catalogo/errores.ts` (nuevo) | `erroresDeAccion`: error de Action → `{ campos, general }` (pura) |
| `src/components/catalogo/{PaqueteForm,SalidaForm,SalidaAcciones}.tsx` (nuevos) | islands de escritura |
| `src/pages/admin/catalogo/{index,nuevo,[id]}.astro` (nuevos) | lista, crear, vista del paquete |
| `tests/unit/{importes,fechas,errores-formulario}.test.ts` (nuevos) | pruebas puras |
| `tests/integration/pantallas-catalogo.test.ts` (nuevo) | rutas + recorrido |
| `docs/04-ingenieria/09-development-guide.md`, `docs/00-estado.md` (mod) | documentación |

---

### Task 1: Importes (pesos ↔ centavos)

**Files:**
- Create: `src/lib/importes.ts`
- Test: `tests/unit/importes.test.ts`

**Interfaces:**
- Produces: `pesosACentavos(texto: string): number | null` (entero ≥ 0 y ≤ 2_147_483_647, o `null` si es inválido); `centavosAPesos(centavos: number): string` (siempre dos decimales, sin separador de miles: `150050 → "1500.50"`, `0 → "0.00"`).

- [ ] **Step 1: Escribir la prueba que falla** (`tests/unit/importes.test.ts`), con estas aserciones exactas:
  - exactos: `"1500" → 150000`, `"1500.5" → 150050`, `"1500.50" → 150050`, `"0" → 0`, `"0.01" → 1`, `".5" → 50`, `"  12 " → 1200` (trim).
  - sin error de float: `"19.99" → 1999`, `"0.29" → 29`, `"1.15" → 115`.
  - decimales de más: `"1.005" → null`, `"1.999" → null`.
  - negativos: `"-1" → null`, `"-0.01" → null`, `"+5" → null`.
  - vacío/ruido: `"" → null`, `"   " → null`, `"abc" → null`, `"1e3" → null`, `"1,500.50" → null`, `"1500,50" → null`, `"1.2.3" → null`.
  - límite: `"21474836.47" → 2147483647`, `"21474836.48" → null`.
  - ida y vuelta: `centavosAPesos(150050) === "1500.50"`, `centavosAPesos(5) === "0.05"`, `centavosAPesos(0) === "0.00"`; `pesosACentavos(centavosAPesos(n)) === n` para `n ∈ {0, 1, 99, 100, 150050, 2147483647}`.
- [ ] **Step 2: Ejecutar** `bun test tests/unit/importes.test.ts` → FALLA (módulo inexistente).
- [ ] **Step 3: Implementar** las dos funciones en `src/lib/importes.ts`. `pesosACentavos`: `trim`, validar con la regex `^(\d+(\.\d{0,2})?|\.\d{1,2})$`, separar parte entera y decimal como texto, rellenar decimales a 2 dígitos, componer con `Number(entera) * 100 + Number(decimales)` (enteros, no floats) y rechazar si supera el máximo de `integer` de PostgreSQL. `centavosAPesos`: división entera y resto con `padStart(2, "0")`.
- [ ] **Step 4: Ejecutar** la prueba → PASA.
- [ ] **Step 5: Commit** `feat(h2): conversión de importes entre pesos y centavos` (`git add src/lib/importes.ts tests/unit/importes.test.ts`).

### Task 2: Fechas (zona de la agencia ↔ UTC)

**Files:**
- Create: `src/lib/fechas.ts`
- Test: `tests/unit/fechas.test.ts`

**Interfaces:**
- Produces: `localAUtc(local: string, zona: string): string | null` — `local` con formato de `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`); devuelve ISO UTC `YYYY-MM-DDTHH:mm:00.000Z` o `null` si el texto es inválido o la hora no existe en esa zona. `utcALocal(utc: Date | string, zona: string): string` — inverso, mismo formato `YYYY-MM-DDTHH:mm`.

- [ ] **Step 1: Escribir la prueba que falla** (`tests/unit/fechas.test.ts`), con estas aserciones:
  - `America/Mexico_City` (UTC−6 fijo desde 2022): `localAUtc("2027-01-10T10:00","America/Mexico_City") === "2027-01-10T16:00:00.000Z"`; `localAUtc("2027-01-10T22:00", …)` cae al día siguiente: `"2027-01-11T04:00:00.000Z"`.
  - `UTC`: identidad.
  - Cambio de horario con `America/New_York` (la prueba debe cubrir DST aunque la agencia no lo use): `"2027-03-14T02:30" → null` (no existe), `"2027-03-14T03:30" → "2027-03-14T07:30:00.000Z"`, `"2027-07-01T12:00" → "2027-07-01T16:00:00.000Z"`, `"2027-01-15T12:00" → "2027-01-15T17:00:00.000Z"`, ambigua `"2027-11-07T01:30" → "2027-11-07T05:30:00.000Z"` (primera ocurrencia, EDT).
  - Inválidos: `"" → null`, `"2027-02-30T10:00" → null`, `"2027-01-10" → null`, `"2027-01-10T25:00" → null`.
  - Vuelta: `utcALocal("2027-01-11T04:00:00.000Z","America/Mexico_City") === "2027-01-10T22:00"`; para cada caso válido anterior, `utcALocal(localAUtc(x, z)!, z) === x`.
- [ ] **Step 2: Ejecutar** `bun test tests/unit/fechas.test.ts` → FALLA.
- [ ] **Step 3: Implementar** con `Intl.DateTimeFormat(…, { timeZone, hourCycle: "h23", … }).formatToParts`: `utcALocal` formatea el instante en la zona; `localAUtc` valida la forma con regex y que la fecha exista, propone el instante como si fuera UTC, corrige por el desfase de la zona (`utcALocal` del candidato) y se queda con el candidato solo si `utcALocal(candidato) === local` (si no coincide → hora inexistente → `null`); para la hora ambigua probar primero el desfase más antiguo (primera ocurrencia). Comentario `shortcut:` si algún caso límite queda sin cubrir.
- [ ] **Step 4: Ejecutar** la prueba → PASA.
- [ ] **Step 5: Commit** `feat(h2): conversión de fechas entre la zona de la agencia y UTC`.

### Task 3: Lecturas del catálogo (repositorios y servicios)

**Files:**
- Modify: `src/modules/catalog/domain/package-repository.ts`, `departure-repository.ts`, `boarding-point-repository.ts`
- Modify: `src/modules/catalog/infrastructure/drizzle-package-repository.ts`, `drizzle-departure-repository.ts`, `drizzle-boarding-point-repository.ts`
- Modify: `src/modules/catalog/application/package-service.ts`, `departure-service.ts`, `boarding-point-service.ts`
- Test: `tests/integration/paquetes-repositorio.test.ts`, `tests/integration/salidas-repositorio.test.ts` (ampliar); `tests/unit/catalog/package-service.test.ts`, `departure-service.test.ts` (ampliar, repos falsos existentes)

**Interfaces:**
- Produces:
  - `PackageRepository.list(): Promise<Package[]>` (orden `createdAt` desc). `PackageService.list(): Promise<Package[]>` y `PackageService.get(id: string): Promise<Package>` (`NotFoundError("Paquete no encontrado")`; reutiliza el privado `cargar`, hazlo público como `get`).
  - `DepartureRepository.listByPackage(packageId: string): Promise<Array<Departure & { boardingPointIds: string[] }>>` (orden `startsAt` asc). `DepartureService.listByPackage(packageId)` lo delega.
  - `BoardingPointRepository.list(): Promise<BoardingPoint[]>` (orden `name`). `BoardingPointService.list()` lo delega.
- Consumes: servicios existentes y `crearCatalogo` (sin cambios de firma).

- [ ] **Step 1: Pruebas que fallan.** Unit: `PackageService.get` lanza `NotFoundError` si el repo devuelve `null`; `list` devuelve lo del repo. Integración (base de pruebas, mismo estilo que los archivos existentes): `list` ordena por fecha de creación descendente; `listByPackage` devuelve solo las salidas de ese paquete, ordenadas por `startsAt`, cada una con sus `boardingPointIds` (vacío si no tiene); `BoardingPointRepository.list` ordena por nombre.
- [ ] **Step 2: Ejecutar** `bun test tests/unit/catalog` y `bun test tests/integration/paquetes-repositorio.test.ts tests/integration/salidas-repositorio.test.ts` → FALLAN.
- [ ] **Step 3: Implementar** las interfaces anteriores. `listByPackage`: una consulta de salidas y otra de `departure_boarding_points` con `inArray(departureId, ids)` (omitir la segunda si no hay salidas); agrupar en memoria. Mantener los repos sin lógica de negocio (ADR-026).
- [ ] **Step 4: Ejecutar** las mismas pruebas → PASAN.
- [ ] **Step 5: Commit** `feat(h2): lecturas de paquetes, salidas y puntos de abordaje para el panel`.

### Task 4: Acceso solo admin en el catálogo y navegación

**Files:**
- Modify: `src/lib/guards.ts`, `src/middleware.ts`, `src/layouts/AdminLayout.astro`
- Test: `tests/unit/guards.test.ts` (ampliar)

**Interfaces:**
- Produces: `esAdmin(user: { role?: string | null; banned?: boolean | null } | null | undefined): boolean` en `guards.ts` (`true` solo con sesión, no vetado y `admin` entre los roles separados por coma). `exigirAdmin` mantiene su comportamiento (401 sin sesión, 403 si `!esAdmin`) apoyándose en ella.

- [ ] **Step 1: Prueba que falla** en `tests/unit/guards.test.ts`: `esAdmin(null) === false`, `esAdmin({role:"operator"}) === false`, `esAdmin({role:"admin",banned:true}) === false`, `esAdmin({role:"operator,admin"}) === true`; las pruebas existentes de `exigirAdmin` deben seguir pasando.
- [ ] **Step 2: Ejecutar** `bun test tests/unit/guards.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `esAdmin` y refactorizar `exigirAdmin`. En `middleware.ts`, dentro de la rama `esAdmin` (nombre de la variable local ya existente: renombrar a `enAdmin` para no chocar con el import), después de comprobar que es personal: si `ruta === "/admin/catalogo" || ruta.startsWith("/admin/catalogo/")` y `!esAdmin(user)` → `new Response("Prohibido", { status: 403 })`, conservando `Cache-Control: no-store`. En `AdminLayout.astro`, añadir `<a href="/admin/catalogo">Catálogo</a>` solo si `esAdmin(usuario)`.
- [ ] **Step 4: Ejecutar** `bun test tests/unit/guards.test.ts` → PASA. (El `403` por HTTP se cubre en Task 7.)
- [ ] **Step 5: Commit** `feat(h2): el catálogo del panel exige rol admin en el servidor`.

### Task 5: Errores de formulario e islands de escritura

**Files:**
- Create: `src/components/catalogo/errores.ts`, `PaqueteForm.tsx`, `SalidaForm.tsx`, `SalidaAcciones.tsx`
- Test: `tests/unit/errores-formulario.test.ts`

**Interfaces:**
- Produces: `erroresDeAccion(error: { message: string; fields?: Record<string, string[] | undefined> }, entradaInvalida: boolean): { campos: Record<string, string>; general: string | null }` — pura (sin importar `astro:actions`, para poder probarla con Bun). Regla: `campos[nombre]` = mensajes del campo unidos con `", "`; `general` = `null` si hay al menos un campo; si no hay campos y `entradaInvalida` → `"Revisa los datos enviados."` (no se muestra el mensaje crudo de Zod); si no es error de entrada → `error.message` (mensajes públicos de `AppError`: 401/403/404/409/422/500).
- Los componentes llaman `isInputError(error)` y pasan `entradaInvalida`. Props mínimas: `PaqueteForm({ paquete?: Package, editable: boolean })`; `SalidaForm({ paqueteId: string, salida?: Departure, zona: string })`; `SalidaAcciones({ salida, estadoPaquete, puntos, asignados, zona })`.

- [ ] **Step 1: Prueba que falla** (`tests/unit/errores-formulario.test.ts`): (a) con `fields: { name: ["Required"] }` → `campos.name === "Required"`, `general === null`; (b) varios mensajes se unen con `", "`; (c) `fields: {}` y `entradaInvalida: true` (clave desconocida) → `general === "Revisa los datos enviados."`, `campos` vacío; (d) `entradaInvalida: false` → `general === error.message`; (e) `fields` con valor `undefined` se ignora.
- [ ] **Step 2: Ejecutar** `bun test tests/unit/errores-formulario.test.ts` → FALLA.
- [ ] **Step 3: Implementar** `errores.ts` y las islands:
  - `PaqueteForm`: campos `name`, `summary`, `description`; crea (`actions.catalog.createPackage`, éxito → `location.assign('/admin/catalogo/' + data.id)`) o edita (`editPackage`, éxito → `location.reload()`). Con `editable` se muestran además publicar/archivar/eliminar según estado (`publishPackage`, `archivePackage`, `deletePackage` → éxito de eliminar redirige a `/admin/catalogo`). Un paquete archivado se muestra de solo lectura.
  - `SalidaForm`: `startsAt`/`endsAt` con `datetime-local` convertidos con `localAUtc(valor, zona)`; tarifas `adultPriceCents`/`childPriceCents`/`infantPriceCents` y capacidad como entradas de pesos/entero convertidas con `pesosACentavos`. Si la conversión devuelve `null`, el error se pinta junto al campo **sin llamar** a la Action. Los errores de la Action se asocian por el nombre del campo de la Action (`startsAt`, `adultPriceCents`…). Crear: `createDeparture`; editar: `editDeparture` enviando solo lo que cambió o todo el contenido (decisión: enviar todo el contenido; la Action ya ignora `undefined`). Valores iniciales con `utcALocal` y `centavosAPesos`.
  - `SalidaAcciones`: botones `publishDeparture` (deshabilitado con aviso si el paquete no está publicado), `cancelDeparture` (con `confirm`), `deleteDeparture` (solo borrador); `<select>` + botón para `assignBoardingPoint`; botón «Quitar» por punto asignado (`removeBoardingPoint`); campo para crear un punto nuevo (`createBoardingPoint`, luego recarga). Todas las salidas con `role="alert"` para el mensaje general y `aria-describedby`/`id` por campo (regla `jsx-a11y`).
  - Todas las llamadas desestructuran `{ data, error }`; ante `error` usan `erroresDeAccion(error, isInputError(error))`. Tras éxito, `location.reload()` salvo donde se indica.
- [ ] **Step 4: Ejecutar** `bun test tests/unit/errores-formulario.test.ts` → PASA, y `bun run check` + `bun run lint` sin errores.
- [ ] **Step 5: Commit** `feat(h2): islands de paquetes y salidas con errores por campo`.

### Task 6: Páginas administrativas

**Files:**
- Create: `src/pages/admin/catalogo/index.astro`, `nuevo.astro`, `[id].astro`

**Interfaces:**
- Consumes: `baseDelServidor()` (`src/db/servidor.ts`), `crearCatalogo(db)` → `packages.list/get`, `departures.listByPackage`, `boardingPoints.list`; islands de Task 5; `AdminLayout`. La zona se lee en el servidor con `process.env.AGENCY_TIMEZONE!` y se pasa como prop (no se expone otra configuración al cliente).

- [ ] **Step 1: `index.astro`**: tabla de paquetes (nombre, estado, enlace a `/admin/catalogo/{id}`) y enlace «Nuevo paquete»; estado vacío con texto («Aún no hay paquetes»).
- [ ] **Step 2: `nuevo.astro`**: `<PaqueteForm client:load />` en modo creación.
- [ ] **Step 3: `[id].astro`**: validar `Astro.params.id` con `z.uuid()`; si no es válido, o `get` lanza `NotFoundError`, devolver `new Response("No encontrado", { status: 404 })` (no relanzar: fuera de `/api/` sería `500`). Mostrar `PaqueteForm` (edición), la lista de salidas con fechas en la zona de la agencia (`utcALocal`) e importes (`centavosAPesos`), `SalidaForm` por salida más uno vacío para crear, y `SalidaAcciones` por salida. Las páginas usan `Astro.locals.user` ya resuelto por el middleware; no repetir la comprobación de rol (Task 4).
- [ ] **Step 4: Verificar** `bun run check` y `bun run lint` sin errores; arrancar `bun run dev` y abrir las tres rutas con un admin real (comprobación manual breve; el recorrido automatizado va en Task 7).
- [ ] **Step 5: Commit** `feat(h2): pantallas administrativas de paquetes y salidas`.

### Task 7: Pruebas de integración, documentación y cierre

**Files:**
- Create: `tests/integration/pantallas-catalogo.test.ts`
- Modify: `docs/04-ingenieria/09-development-guide.md` (sección «Pantallas», ~línea 141), `docs/00-estado.md`

**Interfaces:**
- Consumes: `prepararAplicacion`, `abrirBaseDePruebas`, `CONTRASENA`, `ORIGEN` (`tests/support`), patrón de `acciones-salidas.test.ts` (helper `llamar`, solo 2 inicios de sesión) y `pesosACentavos`/`localAUtc` de Tasks 1–2.

- [ ] **Step 1: Escribir la prueba** (misma estructura `describe.skipIf(!base && !process.env.CI)`, usuarios `admin-pantallas@example.test` y `operador-pantallas@example.test`):
  - Sin sesión: `GET /admin/catalogo`, `/admin/catalogo/nuevo`, `/admin/catalogo/{uuid}` con `redirect: "manual"` → `302` a `/login`.
  - Operador: las tres rutas → `403` y el cuerpo no contiene «Nuevo paquete».
  - Admin: `/admin/catalogo` → `200` con «Nuevo paquete»; `/admin/catalogo/no-es-uuid` y `/admin/catalogo/{uuid inexistente}` → `404`.
  - Recorrido «crear y publicar un paquete con varias salidas» por las Actions (`createPackage` → `editPackage` con resumen y descripción → `publishPackage` → dos `createDeparture` con importes de `pesosACentavos("1500.50")` y fechas de `localAUtc("2027-01-10T22:00","America/Mexico_City")` → `createBoardingPoint` + `assignBoardingPoint` → `publishDeparture` ×2), y comprobar en la base: `adult_price_cents = 150050`, `starts_at = 2027-01-11T04:00:00Z`, ambas salidas `publicada`. Luego `GET /admin/catalogo/{id}` → `200` y el HTML contiene el nombre del paquete y `1500.50` y `2027-01-10T22:00` (lectura SSR con conversión a zona agencia).
  - Entrada inválida: una Action con clave desconocida → `400` (ya cubierto en #52; aquí basta comprobar que `createPackage` con `{ name: "x", status: "publicado" }` no persiste).
- [ ] **Step 2: Ejecutar** `bun test tests/integration/pantallas-catalogo.test.ts` (construye `dist/`: **no** ejecutarlo a la vez que otras pruebas de integración que construyan) → PASA. Si falla por algo de Task 4 o 6, corregir allí.
- [ ] **Step 3: Documentación.** En la guía de desarrollo: rutas nuevas (`/admin/catalogo`, `/nuevo`, `/{id}`), que el `403` está en el middleware, dónde viven `importes.ts`/`fechas.ts` y sus decisiones (rechazo de coma/miles, hora inexistente → inválida, ambigua → primera), y que las islands recargan la página tras escribir. En `docs/00-estado.md`: fecha de actualización, #53 «hecho» en la fila H2, «Siguiente paso» → #54. **Sin ADR.**
- [ ] **Step 4: Verificación completa:** `bun run check && bun run lint && bun run format:check && bun run test` → todo verde.
- [ ] **Step 5: Commit** `docs(h2): guía y estado tras las pantallas administrativas`.

---

## Self-Review

- **Cobertura de la issue:** páginas/SSR/islands → Tasks 3, 5, 6; errores por campo y mensaje general → Task 5; importes → Task 1; fechas con DST → Task 2; admin en servidor + nav oculta → Task 4; pruebas con app real, operador 403, sin sesión `/login` → Task 7; guía y estado sin ADR → Task 7.
- **Consistencia:** `esAdmin` (Task 4), `pesosACentavos`/`localAUtc` (Tasks 1–2) y `erroresDeAccion` (Task 5) se usan con las mismas firmas en Tasks 5–7.
- **Decisiones que tomé y conviene confirmar:** (1) el `403` va en el middleware, no en cada página; (2) los puntos de abordaje solo se **crean** y asignan/quitan desde la vista del paquete (editar/borrar puntos queda fuera); (3) las islands recargan la página tras escribir en lugar de mantener estado local; (4) hora inexistente = inválida.
