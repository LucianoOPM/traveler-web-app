# 07 — Contratos de API propuestos

**Estado:** borrador orientativo; validar rutas, códigos y esquemas al implementar. JSON con validación de servidor con Zod desde `astro/zod` ([ADR-024](../05-decisiones/11-decisions-and-risks.md)).

> Ya implementado fuera de `/api/v1/` (H2, #55): `GET /api/media/<uuid>` sirve las portadas de paquetes (ver [06-security-and-access](06-security-and-access.md)); la subida es la Action `catalog.uploadCover`.

## Superficies de comunicación ([ADR-025](../05-decisiones/11-decisions-and-risks.md))
| Superficie | Uso |
|---|---|
| **Astro Actions** (`/_actions/<módulo>.<acción>`) | Operaciones internas y de formulario: CRUD, reservas, pagos, revisión, abordaje. Validan con Zod, comprueban el permiso en su handler y responden un resultado tipado `{ data, error }`; sus errores son `ActionError`/`ActionInputError`, no el JSON de la sección siguiente. |
| **SSR** | Lecturas de página (catálogo público, panel): consultan los servicios en el servidor. |
| **API Routes** (`/api/…`) | Solo necesidades HTTP específicas: archivos privados, QR para clientes externos, integraciones, Better Auth y salud. Usan el formato de error de abajo. |

Las Actions son endpoints públicos: cada una autoriza en su handler y se prueba con peticiones directas sin sesión (`401`) y con rol insuficiente (`403`). Un error inesperado nunca devuelve su mensaje original: pasa por un adaptador `AppError` → `ActionError` (ADR-025).

## Convenciones (API Routes)
- Prefijo `/api/v1/` para endpoints de negocio.
- Validación de entrada (ADR-024): esquemas Zod de `astro/zod`; `z.strictObject()` en cuerpos de escritura (un campo desconocido es un `400`), importes en centavos con `z.int()`, `z.uuid()` para identificadores y `z.iso.datetime()` para instantes. Los `details` de un `400` salen solo de `path` y `message` de Zod, nunca del valor enviado. Dentro de una Action la validación la hace su propio `input` (ADR-025); el helper que traduciría errores de Zod a `ValidationError` solo aplicaría a una API Route con cuerpo y no existe.
- Identificadores opacos; nunca exponer tokens de sesión o hashes.
- Respuestas de error con `{ "error": { "code": "...", "message": "..." } }` (implementado en la issue #6, [ADR-019](../05-decisiones/11-decisions-and-risks.md)). `code` es estable y en `snake_case`: cada clase de error tiene uno por defecto (`validation_error`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `business_rule_violation`, `internal_error`) y quien lanza el error puede usar uno específico (`capacity_exceeded`, `already_boarded`). Solo los errores de validación (`400`) añaden `"details": [{ "field": "...", "message": "..." }]`; solo se serializan `field` y `message`, y quien lanza el error es responsable de que no incluyan valores de entrada (el código no puede comprobarlo). Un error inesperado responde siempre `500` con `internal_error` y un mensaje genérico.
- Códigos: `400` entrada inválida, `401` sin sesión, `403` sin permiso, `404` no visible/no existe, `409` conflicto de estado/capacidad, `422` regla de negocio, `429` exceso de solicitudes (`TooManyRequestsError`, código `rate_limited`; en una Action sale como `TOO_MANY_REQUESTS`; hoy solo lo aplica `bookings.create`, ver abajo). Hoy las rutas `/api/` inexistentes (`404`) o con método no permitido (`405`) siguen respondiendo con el formato de Astro, no con este JSON.
- Para acciones financieras y de abordaje: idempotencia, auditoría y transacción.

## Estado real de H3
Actions de reservas implementadas: `bookings.create` (pública), `bookings.cancel`, `bookings.reactivate` y `bookings.regenerateToken` (solo admin), descritas más abajo. Páginas: `/reservar/<salida>`, `/reservas/<token>` y `/admin/catalogo/salidas/<id>/reservas`. Permisos comprobados por petición directa (`tests/integration/reservas-seguridad.test.ts`, con una tabla explícita de Actions), errores inesperados con mensaje genérico y GET sin escrituras de negocio. Lo demás de esta página sigue siendo propuesta.

## Endpoints iniciales (propuesta original)
Esta tabla es la propuesta original en forma de rutas REST. Con el [ADR-025](../05-decisiones/11-decisions-and-risks.md), las operaciones internas y de formulario (CRUD, reservas, pagos, revisión, abordaje) se implementan como Actions y las lecturas de página como SSR; permanecen como API Routes solo las que necesiten HTTP propio. Se confirma la superficie de cada operación al implementar su hito.

| Método | Ruta | Uso | Actor |
|---|---|---|---|
| GET | `/api/v1/packages` | Catálogo | Público/según contexto |
| GET | `/api/v1/departures/:id` | Salida y disponibilidad | Público/según contexto |
| POST | `/api/v1/bookings` | Crear reserva | Comprador / admin |
| GET | `/api/v1/bookings/access` | Consulta con credencial limitada | Comprador |
| POST | `/api/v1/bookings/:id/cancel` | Cancelar | Admin |
| POST | `/api/v1/payments/reports` | Reportar SPEI y evidencia | Comprador autorizado |
| POST | `/api/v1/payments/:id/review` | Aprobar/rechazar | Admin |
| POST | `/api/v1/payments/cash` | Registrar efectivo | Admin |
| GET | `/api/v1/departures/:id/manifest` | Manifiesto | Admin/operador; demo ficticia por ruta separada |
| POST | `/api/v1/boarding/check-in` | Abordaje atómico | Operador |
| POST | `/api/v1/demo/invitations/redeem` | Consumir invitación | Visitante con token |
| GET | `/api/v1/demo/tickets/validate` | Validación ficticia de solo lectura | Visitante demo |
| GET | `/api/v1/demo/departures/:id/manifest` | Manifiesto ficticio | Visitante demo |

## Checkout invitado (#69)
- **Action pública `bookings.create`** (`/_actions/bookings.create`, sin sesión; ADR-025). Entrada `z.strictObject`: `departureId` y `boardingPointId` (UUID), `buyerName` (máx. 120), `buyerPhone` (máx. 30), `buyerEmail` (correo, máx. 254) y `passengers` (1 a 10: `fullName` máx. 120 y `fareCategory` `adulto | menor | infante`). Cualquier clave desconocida (`role`, `demoMode`, `database`…) es `400`; la base la elige solo el servidor y no existe contexto demo hasta H7. Las edades no se capturan ni validan (PEN-16 abierto). Respuesta: `{ reference, token, totalCents, expiresAt }`; **el token solo sale aquí, una vez**. Errores: `400` forma (por campo, sin reflejar valores), `409 capacity_exceeded`, `422` salida, paquete, fecha o punto inválidos, `429`.
- **Límite de solicitudes:** 5 por hora por IP (`LIMITE_RESERVAS`, `src/modules/bookings/domain/rate-limit.ts`). Cuenta toda solicitud con forma válida —cree o no la reserva— y no cuenta las rechazadas por forma. La IP es `clientAddress` de Astro (socket); **no se leen cabeceras reenviadas** (`X-Forwarded-For`). Limitaciones conocidas: ventana en memoria del proceso (se reinicia con él y no se comparte entre instancias); tras un proxy inverso todas las peticiones compartirían una IP hasta configurar la confianza en el proxy; mejorar al decidir hosting (PEN-08).
- **Páginas SSR:** `/reservar/<departureId>` (checkout; `404` uniforme si la salida no existe, no está publicada, su paquete no lo está o ya empezó) y `/reservas/<token>` (consulta, solo lectura: estado, vencimiento, pasajeros, punto de abordaje y total; `Cache-Control: no-store` y `Referrer-Policy: no-referrer`; `404` idéntico para token inexistente, inválido o malformado; el token se busca por hash).
- **DTO público del catálogo:** las salidas del detalle incluyen su `id` y sus puntos de abordaje `{ id, name }` (UUID opacos, no credenciales) porque el checkout los necesita.

## Reservas: acciones de administrador (#70)
Actions **solo admin** (sin sesión `401`, operador o vetado `403`; el permiso se comprueba en cada handler). Entrada `z.strictObject({ bookingId: uuid, reason: 1–500 caracteres sin solo espacios })`: cualquier otra clave (p. ej. un `actorUserId` o un `role`) es `400`; el actor sale de la sesión del servidor. Reserva inexistente: `404`.
- `bookings.cancel`: `pendiente`/`en_revision` → `cancelada`; repetida sobre una `cancelada`: `200` idempotente sin evento; desde `expirada`: `409`. Respuesta `{ status, cambio }`.
- `bookings.reactivate`: `expirada`/`cancelada` → `pendiente` con nuevo vencimiento; sin capacidad `409 capacity_exceeded`; salida cancelada, iniciada o con paquete no publicado `422`; repetida sobre `pendiente`/`en_revision`: `200` idempotente, sin renovar el vencimiento ni evento. Respuesta `{ status, expiresAt, cambio }`.
- `bookings.regenerateToken`: solo reservas vigentes (`pendiente` no vencida o `en_revision`; si no, `409`). Respuesta `{ token }`: **se muestra una sola vez**; el hash anterior queda reemplazado en la misma operación y el evento `token_regenerado` no guarda token ni hash.
- Pantalla `/admin/catalogo/salidas/<id>/reservas` (solo admin por el middleware de `/admin/catalogo`; operador `403`): estado, vencimiento, contacto completo, pasajeros, total, punto de abordaje y las acciones permitidas, cada una con su motivo. Es de solo lectura al cargarse.

## Cuentas bancarias (#83)
Actions **solo admin** de `src/actions/payments.ts` (sin sesión `401`, operador o vetado `403`; el permiso se comprueba en cada handler). Entrada `z.strictObject`: cualquier otra clave (`role`, `actorUserId`…) es `400`; el actor de la auditoría sale de la sesión del servidor. Importes en centavos enteros (`<= 2147483647`); la conversión pesos → centavos la hace la pantalla con `pesosACentavos`.
- Datos de cuenta (`createAccount` y `editAccount`): `name`, `bankName`, `accountHolder` (texto no vacío), `clabe` (texto de 18 dígitos, sin dígito verificador), `priority` (entero `>= 0`; menor = primero) y `monthlyLimitCents` (entero `> 0`). Regla inválida: `422` con mensaje fijo que nunca repite la CLABE ni el titular.
- `payments.createAccount`: crea la cuenta habilitada y devuelve la fila. Audita `bank_account.created`.
- `payments.editAccount` (`id` + datos): sin cambios efectivos `200` sin escribir ni auditar. Bajar `monthlyLimitCents` por debajo de lo comprometido por la cuenta en el mes vigente (`AGENCY_TIMEZONE`) → `409`; hasta lo comprometido, inclusive, se permite. Audita `bank_account.updated`. No modifica asignaciones ni `instruction_snapshot`.
- `payments.setAccountEligible` (`id`, `isEligible`): habilita o deshabilita. Idempotente: repetir el estado actual es `200` sin evento. Audita `bank_account.enabled` / `bank_account.disabled`.
- `payments.deleteAccount` (`id`): solo sin asignaciones; con cualquiera (también liberada) → `409` pidiendo deshabilitar la cuenta (la FK `restrict` es la última defensa). Respuesta `{ id }`. Audita `bank_account.deleted` conservando `entity_id`.
- Cuenta inexistente: `404`. Todo ocurre en una transacción que bloquea la fila de `bank_accounts` con `FOR UPDATE` (el mismo protocolo que usará la asignación bancaria); si falla la auditoría se revierte el cambio, y lo rechazado no deja registro.
- Páginas SSR solo admin (middleware: sin sesión `302 /login`, operador `403`): `/admin/cuentas` (límite, comprometido del mes y disponible por cuenta, sin datos bancarios), `/admin/cuentas/nueva` y `/admin/cuentas/<id>` (`404` si el id no es UUID o no existe). Son de solo lectura al cargarse.

## Instrucciones SPEI (#84)
- **Action pública `payments.requestInstructions`** (`/_actions/payments.requestInstructions`, sin sesión; la única credencial es el token de consulta). Entrada `z.strictObject({ token })`; cualquier otra clave es `400`. Límite propio de 20 solicitudes por hora por IP (en memoria; `429`). Respuesta: `{ instructions: { bankName, accountHolder, clabe, reference, amountCents, calendarMonth }, pendingCents }`: `instructions` es el snapshot congelado (`amountCents` = importe comprometido) y `pendingCents` el saldo por pagar.
- Idempotente: una asignación vigente por reserva; repetir devuelve el mismo snapshot sin evento ni auditoría. Errores: `404` uniforme (token mal formado, inexistente o regenerado, también si se regenera durante la solicitud), `409` si la reserva no admite instrucciones (`pagada`, `expirada`, `cancelada`; `en_revision` sin asignación) o `409 no_eligible_account` si ninguna cuenta soporta el importe completo (queda una alerta abierta, sin instrucciones inventadas).
- `GET /reservas/<token>` muestra las instrucciones ya emitidas mientras la reserva admita pagar y, si no hay ninguna, el botón que llama a la Action; es de solo lectura (no asigna, no materializa expiraciones, no abre alertas).
- Alertas: sección «Reservas sin cuenta elegible» en `/admin/cuentas` (solo admin).

## Salud
`GET /api/health` (fuera de `/api/v1/`, implementado en la issue #8): `200` con `{ "status": "ok" }` y `Cache-Control: no-store`; sin efectos secundarios y sin exponer configuración, secretos ni versiones. Indica que el servidor arrancó con configuración válida; con configuración inválida responde `500 internal_error` (ver [ADR-019](../05-decisiones/11-decisions-and-risks.md)). No comprueba la base de datos: si la salud la incluirá o habrá un endpoint de *readiness* aparte (H1) **no está decidido**.

## Autenticación de personal
`/api/auth/*` (fuera de `/api/v1/`, issue #44) lo atiende Better Auth: `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session`, etc. **Sus respuestas de error usan el formato de Better Auth, no el JSON uniforme de [ADR-019](../05-decisiones/11-decisions-and-risks.md).** El registro público (`/api/auth/sign-up/*`) está cerrado. Con `NODE_ENV=production` aplica un límite de intentos por IP (`429`); ver la [guía de desarrollo](../04-ingenieria/09-development-guide.md).

## Ejemplo de validación de boleto
Solicitud `GET /api/v1/demo/tickets/validate?code=...` (código ficticio opaco, sin datos personales).

```json
{
  "ticketReference": "DEMO-T001",
  "result": "valid",
  "passenger": { "displayName": "Pasajero ficticio" },
  "departure": { "reference": "DEMO-D008" },
  "canRegisterBoarding": false
}
```

Resultados posibles: `valid`, `already_boarded`, `not_eligible`, `invalid`, `expired`. La respuesta de demo nunca cambia el estado.

## Reglas de diseño
- No confiar en `role`, `demoMode` o `database` enviados por cliente.
- No devolver datos financieros al operador ni al visitante.
- Nunca usar GET para una mutación.
- El check-in privado requiere token válido, autorización de operador, salida correcta y restricción única en BD.
- Carga de evidencias: validar tamaño/tipo, almacenar en ruta privada, asociar a reserva autorizada.
