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
- **Expiración perezosa, sin cron ni colas.** Una `pendiente` con `expires_at <= ahora` ya no retiene lugares aunque su estado no se haya actualizado. Dentro de toda transacción que bloquea la salida (crear, cancelar, reactivar o regenerar una reserva, y editar o cancelar la salida) se materializan como `expirada`, con evento `expirada` y actor `sistema`. `en_revision` nunca expira. **Un rechazo de negocio (409/422) no revierte esas expiraciones:** el rechazo se devuelve como valor dentro de la transacción y se lanza tras el commit, así que lo materializado persiste y la operación rechazada no deja ninguna otra escritura. Un error inesperado sí revierte todo. Lecturas (GET, pantalla de admin, consulta del comprador) nunca escriben: muestran la pendiente vencida como `expirada`.
- Cancelación y cambios manuales quedan auditados.

## Pagos
- SPEI: comprador reporta pago y adjunta evidencia; solo administrador verifica recepción real.
- Efectivo: solo administrador registra cobro.
- Comprobante rechazado no genera ingreso verificado. Reemplazar evidencia no duplica dinero.
- Liquidación = suma neta de movimientos verificados aplicables, no suma de importes reportados.
- Una reserva solo produce boletos al estar completamente liquidada y vigente según política.
- La política de anticipos/parcialidades sigue **pendiente**; se pueden mostrar varios eventos sin prometer que un pago parcial autoriza boleto.

## Asignación bancaria
1. Ordenar cuentas elegibles por prioridad.
2. Calcular capacidad mensual de cada una según importes comprometidos y reglas de liberación.
3. Elegir la primera que soporte el importe **completo**.
4. Crear asignación y snapshot inmutable de instrucciones en transacción.
5. Si ninguna es elegible, registrar excepción administrativa; no inventar cuenta ni dividir pago.
6. Cambios posteriores de prioridad no reescriben instrucciones emitidas.

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
Verificación/rechazo de pagos, movimientos de cuentas, cancelación/reactivación, emisión/invalidez de boletos, check-in, cambios de permisos, invitaciones y revocaciones. El log no almacena tokens, contraseñas ni archivos sensibles.
