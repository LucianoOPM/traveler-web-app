# 08 — Datos semilla y contenido de demostración

## Cantidades confirmadas
- **12 paquetes**, **30 salidas**, **250 reservaciones**, **30 flyers**.
- Reservas: **110 pagadas activas**, **55 activas pendientes**, **35 activas con comprobante en revisión**, **30 expiradas**, **20 canceladas**.
- Salidas: **2 en abordaje**, **6 finalizadas**, **22 restantes** (distribución interna aún flexible).
- **3 cuentas bancarias ficticias** con prioridad y límites mensuales.
- Pagos variados: SPEI verificado, en revisión, rechazado/reemplazado, múltiples eventos y efectivo administrativo.
- Bancos: asignación normal, cuenta principal saturada, cuenta temporalmente no elegible, ninguna cuenta elegible.
- QR ficticios consultables en solo lectura; manifiesto con nombres ficticios, categoría, punto y estado, sin contactos ni finanzas.

## Fechas relativas
Tomar `T0` una sola vez por ejecución. Derivar viajes pasados, actuales y futuros con fechas relativas. Registrar `seed_version`, `seed_reference_time` y semilla pseudoaleatoria para reproducibilidad. No regenerar automáticamente al abrir la aplicación.

## Secuencia de generación
1. Limpiar **solo** base de demo, con confirmación explícita de entorno y nombre de BD.
2. Insertar catálogo, puntos, tarifas, salidas y capacidad.
3. Insertar cuentas bancarias ficticias y límites.
4. Crear reservas y pasajeros respetando capacidad.
5. Generar asignaciones, reportes, evidencias sintéticas y verificaciones coherentes.
6. Emitir boletos únicamente a reservas completamente liquidadas.
7. Crear abordajes históricos y parciales para salidas apropiadas.
8. Generar proyectos/exportaciones de flyers con fechas y precios consistentes.
9. Validar integridad y producir reporte de seed.

## Validaciones obligatorias
- Totales exactos de paquetes, salidas, reservas y flyers.
- Capacidad retenida por salida <= capacidad.
- 35 comprobantes en revisión no provocan liberación automática.
- No duplicar ingresos por comprobantes rechazados/reemplazados.
- Ninguna asignación supera límite mensual.
- Ningún boleto de reserva sin liquidar.
- Ningún `ticket_id` repetido en abordajes.
- Los flyers corresponden a precios/fechas reales del catálogo semilla.
- Ausencia de PII, cuentas y comprobantes reales.

## Flyers
Distribución inicial recomendada: **15 cuadrados (1080×1080) y 15 verticales (1080×1920)**. Cada exportación referencia plantilla, proyecto, paquete y, si muestra fecha/precio, salida concreta. Regenerar flyers fechados junto con seed; no usar IA en vivo para visitantes.

## Precaución temporal
Con estrategia relativa, los datos quedan correctos respecto a `T0`, pero **envejecen después de generarse**. Mostrar la fecha de última regeneración en panel interno y ofrecer comando administrativo explícito para regenerar la demo cuando corresponda.
