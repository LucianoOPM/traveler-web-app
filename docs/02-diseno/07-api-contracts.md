# 07 — Contratos de API propuestos

**Estado:** borrador orientativo; validar rutas, códigos y esquemas al implementar. JSON con validación de servidor. No se fija todavía biblioteca de validación.

## Convenciones
- Prefijo `/api/v1/` para endpoints de negocio.
- Identificadores opacos; nunca exponer tokens de sesión o hashes.
- Respuestas de error con `{ "error": { "code": "...", "message": "..." } }` (implementado en la issue #6, [ADR-019](../05-decisiones/11-decisions-and-risks.md)). `code` es estable y en `snake_case`: cada clase de error tiene uno por defecto (`validation_error`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `business_rule_violation`, `internal_error`) y quien lanza el error puede usar uno específico (`capacity_exceeded`, `already_boarded`). Solo los errores de validación (`400`) añaden `"details": [{ "field": "...", "message": "..." }]`; solo se serializan `field` y `message`, y quien lanza el error es responsable de que no incluyan valores de entrada (el código no puede comprobarlo). Un error inesperado responde siempre `500` con `internal_error` y un mensaje genérico.
- Códigos: `400` entrada inválida, `401` sin sesión, `403` sin permiso, `404` no visible/no existe, `409` conflicto de estado/capacidad, `422` regla de negocio, `429` exceso de solicitudes (reservado: aún no se implementa el límite de solicitudes). Hoy las rutas `/api/` inexistentes (`404`) o con método no permitido (`405`) siguen respondiendo con el formato de Astro, no con este JSON.
- Para acciones financieras y de abordaje: idempotencia, auditoría y transacción.

## Endpoints iniciales
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

## Salud
`GET /api/health` (fuera de `/api/v1/`, implementado en la issue #8): `200` con `{ "status": "ok" }` y `Cache-Control: no-store`; sin efectos secundarios y sin exponer configuración, secretos ni versiones. Indica que el servidor arrancó con configuración válida; con configuración inválida responde `500 internal_error` (ver [ADR-019](../05-decisiones/11-decisions-and-risks.md)). No comprueba la base de datos: si la salud la incluirá o habrá un endpoint de *readiness* aparte (H1) **no está decidido**.

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
