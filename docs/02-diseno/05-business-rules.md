# 05 — Reglas de negocio e invariantes

## Inventario y reservas
- Una salida tiene capacidad y tarifas propias; todos los pasajeros, incluidos infantes, ocupan asiento.
- Una reserva contiene todos los nombres de pasajeros y **un punto de abordaje**.
- Crear reserva y retener lugares es atómico. El precio queda congelado en la reserva.
- El plazo de retención es configurable; una reserva con comprobante en revisión **no se libera automáticamente**.
- Expirar una reserva libera inventario cuando corresponda. Reactivar requiere verificar disponibilidad en transacción.
- **Ciclo de vida de la reserva (#70).** Solo el administrador cancela, reactiva o regenera el enlace, con un **motivo obligatorio** (1 a 500 caracteres, sin solo espacios) y el actor tomado de la sesión. Cada cambio deja su evento en `booking_events`; ningún evento guarda tokens ni hashes.

  | Operación | `pendiente` vigente | `en_revision` | `expirada` (o `pendiente` vencida) | `cancelada` |
  |---|---|---|---|---|
  | Cancelar | → `cancelada` | → `cancelada` | `409` | idempotente, sin evento |
  | Reactivar | idempotente, sin renovar vencimiento ni evento | idempotente | → `pendiente` si hay capacidad | → `pendiente` si hay capacidad |
  | Regenerar enlace | nuevo token (el anterior deja de funcionar al instante) | nuevo token | `409` | `409` |

  Reactivar exige salida `publicada`, con paquete `publicado` y que no haya empezado (`422`), y que quepan los pasajeros de la reserva (`409 capacity_exceeded`); el nuevo `expires_at` es `min(ahora + BOOKING_HOLD_HOURS, starts_at)`. Una operación repetida cuyo destino ya está alcanzado es idempotente y no genera eventos; una transición incompatible con el estado actual da `409`.
- **Con pagos (H4, ADR-029)** la tabla de arriba se amplía con `parcial` y `pagada`: cancelar se permite también desde ellas (liberación de la asignación en [Asignación bancaria](#asignación-bancaria-y-contabilidad-operacional-adr-029); la devolución queda fuera de H4); reactivar y regenerar el enlace en `parcial`/`pagada` siguen la fila de `en_revision` (idempotente y permitido).
- **Expiración perezosa, sin cron ni colas.** Una `pendiente` con `expires_at <= ahora` ya no retiene lugares aunque su estado no se haya actualizado. Dentro de toda transacción que bloquea la salida (crear, cancelar, reactivar o regenerar una reserva, y editar o cancelar la salida) se materializan como `expirada`, con evento `expirada` y actor `sistema`. `en_revision` nunca expira. **Un rechazo de negocio (409/422) no revierte esas expiraciones:** el rechazo se devuelve como valor dentro de la transacción y se lanza tras el commit, así que lo materializado persiste y la operación rechazada no deja ninguna otra escritura. Un error inesperado sí revierte todo. Lecturas (GET, pantalla de admin, consulta del comprador) nunca escriben: muestran la pendiente vencida como `expirada`.
- Cancelación y cambios manuales quedan auditados.

## Pagos (ADR-029)
- **Anticipos y pagos parciales** permitidos, por SPEI o en efectivo, sin porcentaje mínimo. Cada pago SPEI se revisa por separado.
- SPEI: el comprador reporta el pago y adjunta evidencia; **solo un administrador** verifica la recepción real.
- Efectivo: **solo un administrador** registra el cobro. No consume capacidad bancaria.
- **Liquidación = suma neta de movimientos verificados**; lo reportado no cuenta. Sin sobrepagos: el importe verificado no puede superar el saldo pendiente (`total_cents` − verificado).
- Un comprobante rechazado no genera ingreso. Reemplazar un comprobante conserva el historial y no duplica movimientos.
- Todos los pagos SPEI de una reserva usan la **misma cuenta** asignada.
- **Devoluciones fuera de H4.** Cuando existan serán movimientos negativos auditados; nunca se borran ni editan movimientos históricos.
- Una reserva solo produce boletos al estar completamente liquidada (`pagada`) y vigente.
- **Estados con pagos** (`retienen` todos y ninguno expira): `en_revision` = hay al menos un comprobante pendiente de revisión; `parcial` = hay pagos verificados y saldo pendiente, sin comprobantes pendientes; `pagada` = saldo cero. Al resolver una revisión, la reserva pasa a `parcial`, `pagada` o, si no hay nada verificado ni pendiente, de vuelta a `pendiente` con `expires_at = min(ahora + BOOKING_HOLD_HOURS, starts_at)`. Una reserva `cancelada` conserva su estado al resolver comprobantes.

## Asignación bancaria y contabilidad operacional (ADR-029)
Definiciones. **Comprometido:** importe total de una asignación vigente; es lo único que consume el límite mensual. **Reportado:** declarado por el comprador y pendiente de revisión; no consume límite ni liquida. **Verificado:** confirmado por un admin; liquida y no vuelve a consumir lo ya comprometido. **Liberado:** comprometido que deja de consumir capacidad.

`capacidad_disponible = limite_mensual − suma de importes comprometidos del mes`. Nunca se calcula sumando reportes ni revisiones.

1. La asignación se crea **al pedir las instrucciones SPEI** (no al crear la reserva), por el importe **completo** de la reserva y de forma idempotente (una vigente por reserva).
2. Ordenar cuentas elegibles por prioridad y recalcular su capacidad **dentro de la transacción** con bloqueos de PostgreSQL.
3. Elegir la primera que soporte el importe completo.
4. Crear la asignación y el snapshot inmutable de instrucciones. El mes se fija al crearla con `AGENCY_TIMEZONE`.
5. Si ninguna es elegible: excepción administrativa (alerta); sin dividir el importe ni instrucciones ficticias.
6. Cambios de prioridad, elegibilidad o datos bancarios, y el cambio de mes, no reescriben asignaciones ni snapshots emitidos.

| Evento | ¿Libera la asignación? |
|---|---|
| Rechazar o reemplazar un comprobante; verificar un pago (parcial o total) | No |
| Cancelar o expirar sin pagos SPEI verificados ni comprobantes pendientes | Sí |
| Cancelar con algún pago SPEI verificado | No; queda un caso para resolución administrativa |
| Cancelar con comprobantes pendientes | No mientras haya alguno sin resolver; al resolver el último se aplican las dos filas anteriores (si todos se rechazan y no hay SPEI verificado, se libera; si algún SPEI está verificado, permanece y queda el caso administrativo) |
| Liquidar toda la reserva en efectivo sin transferencias verificadas ni pendientes | Sí |

- **Quién puede pedir instrucciones (#84).** `pendiente` no vencida y `parcial`: crean la asignación; `en_revision`: solo recupera la existente; `pagada`, `expirada` y `cancelada`: no (`409`). La asignación compromete siempre el importe **completo** de la reserva; el **saldo pendiente** (total − SPEI verificados − efectivo) se calcula aparte y no altera la asignación ni su snapshot.
- **Expiración perezosa.** Una `pendiente` vencida y no materializada sigue consumiendo capacidad hasta que la expiración se materializa y se libera su asignación (limitación aceptada: sin cron ni bloqueo de otras salidas). No hay otra definición de «vigente».
- **Liberación (#84).** `liberarAsignaciones` es condicional (sin comprobante pendiente ni SPEI verificado), idempotente y auditada; la ejecutan `expirarVencidas` (actor `sistema`) y `cancel` (actor admin con su motivo). Reactivar no recrea la asignación.
- **Resolver un comprobante de una reserva `cancelada`** (verificar o rechazar) nunca la reactiva ni habilita boletos; el estado sigue siendo `cancelada`. Las devoluciones siguen fuera de H4.
- **Mes de recepción distinto al de asignación.** El consumo del límite pertenece **siempre al mes de la asignación** (`calendar_month`, fijado al crearla). La fecha de verificación se guarda aparte, no mueve ni libera nada y no consume el límite del mes en que se verifica (el importe ya estaba comprometido).
- **Cuentas.** No se puede bajar `monthly_limit_cents` por debajo de lo ya comprometido por la cuenta en el mes vigente (`AGENCY_TIMEZONE`). Una cuenta con asignaciones no se elimina físicamente: se deshabilita (`is_eligible = false`), lo que no afecta a las asignaciones existentes.
- **Fuente de verdad financiera.** Los pagos SPEI verificados y los cobros en efectivo del admin; el historial y la conciliación se derivan de ellos y de las revisiones, sin libro mayor aparte. Un movimiento verificado es **inmutable** (no se edita ni se borra; una corrección futura será un movimiento negativo) y se conserva el historial de reportes, revisiones, rechazos y reemplazos.

Asignar, liberar y verificar son transaccionales, idempotentes y auditados. Orden de bloqueos (evita interbloqueos): primero la fila de la **salida** (como en H3), luego las cuentas bancarias por `id`. Una reserva `expirada` o `cancelada` ya liberada que se reactive vuelve a `pendiente` sin asignación; el comprador pide instrucciones de nuevo.

## QR y abordaje
- QR de reserva solo sirve para consulta.
- Boleto QR es individual, emitido tras pago completo verificado.
- Validación de QR comprueba token, tipo, boleto, reserva, salida, pago y uso previo.
- Operador registra abordaje en una única operación atómica; segundo escaneo devuelve `already_boarded` sin duplicar fila.
- Una reserva expirada no permite abordaje; nunca autorizar solo por apariencia del QR.

## Demo visitante
- Puede leer datos ficticios y editar formularios en memoria del navegador.
- Guardar valida y muestra aviso de **no persistencia**.
- Confirmar pagos, eliminar, cambiar bancos, generar IA y registrar abordaje quedan bloqueados.
- La validación QR de demo es solo lectura; no produce eventos de abordaje.
- No exponer datos bancarios reales, contactos reales, recibos reales ni secretos.

## Auditoría mínima
Verificación/rechazo de pagos, movimientos de cuentas, cancelación/reactivación, emisión/invalidez de boletos, check-in, cambios de permisos, invitaciones y revocaciones. El log no almacena tokens, contraseñas ni archivos sensibles. Los cambios de cuentas bancarias se registran en `audit_events` (#83) con la CLABE enmascarada (últimos 4 dígitos) y sin titular.
