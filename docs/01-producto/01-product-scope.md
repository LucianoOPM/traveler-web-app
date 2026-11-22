# 01 — Alcance del producto

## Visión
TravelTech administra el ciclo de vida de viajes turísticos de una sola agencia: catálogo, salidas, reservaciones, recepción y verificación de pagos, boletos, abordaje y producción de material de marketing.

## Actores
| Actor | Capacidades |
|---|---|
| Administrador | Gestión de catálogo, salidas, reservas, pagos, cuentas, marketing, auditoría |
| Operador | Consulta de salidas/manifiestos, validación de boletos y registro de abordaje; **sin pagos** |
| Comprador invitado | Reserva sin cuenta de personal y consulta su propia reserva mediante token seguro de alcance limitado |
| Visitante demo | Explora datos ficticios, formularios editables localmente y QR de solo lectura; sin escritura |

## Dos experiencias
- **Privada:** CRUD, transacciones reales locales, subida de comprobantes ficticios, verificaciones manuales, QR, abordaje y editor de flyers.
- **Demo visitantes:** invitación de un uso (24 h), sesión (2 h), marca de agua por sesión, datos precargados, formularios `interactive`, guardado con aviso y operaciones críticas bloqueadas. No se crea ni modifica ningún recurso persistente.

## Alcance funcional inicial
1. Catálogo de paquetes con varias salidas y tarifas adulto/menor/infante.
2. Reservaciones con todos los pasajeros, punto de abordaje único por reservación, inventario retenido y expiración controlada.
3. SPEI con comprobante y verificación manual; efectivo administrativo.
4. Asignación de cuenta bancaria por prioridad, límite mensual y elegibilidad.
5. QR de reservación no habilitante; boleto QR individual tras liquidación; manifiesto y check-in único.
6. Marketing con plantillas, edición y exportación; flyers pregenerados para visitantes (cifras en [08](../03-demo/08-demo-seed-and-content.md)).
7. Dashboard y auditoría de operaciones sensibles.

## Fuera de alcance de la primera entrega local
Integración bancaria real, pasarela de pago, envío real de correos, IA generativa en vivo, publicación automática en redes, R2, Redis/colas y despliegue productivo. Pueden retomarse después sin bloquear la demo.

## Éxito de la primera demo
Un administrador puede crear un paquete, programar una salida, recibir una reserva, verificar pago, emitir boletos y registrar un abordaje; un visitante puede recorrer los mismos datos ficticios sin escribir en el servidor.
