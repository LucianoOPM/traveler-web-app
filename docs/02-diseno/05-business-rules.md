# 05 — Reglas de negocio e invariantes

## Inventario y reservas
- Una salida tiene capacidad y tarifas propias; todos los pasajeros, incluidos infantes, ocupan asiento.
- Una reserva contiene todos los nombres de pasajeros y **un punto de abordaje**.
- Crear reserva y retener lugares es atómico. El precio queda congelado en la reserva.
- El plazo de retención es configurable; una reserva con comprobante en revisión **no se libera automáticamente**.
- Expirar una reserva libera inventario cuando corresponda. Reactivar requiere verificar disponibilidad en transacción.
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
