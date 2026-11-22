# 10 — Pruebas y calidad

## Pirámide
- **Unitarias:** cálculo de precios, ocupación, elegibilidad bancaria, liquidación, transición de estados.
- **Integración con PostgreSQL:** transacciones, locks, restricciones, expiración, idempotencia, acceso a archivos.
- **E2E:** reserva → evidencia → verificación → boleto → abordaje; visitante invitado → consulta → intento de escritura denegado.

## Casos críticos
| ID | Prueba | Resultado requerido |
|---|---|---|
| INV-01 | Dos reservas compiten por el último lugar | Solo una confirma |
| INV-02 | Comprobante pendiente al vencer | Retención permanece |
| INV-03 | Reactivación sin capacidad | Rechazo sin sobreventa |
| PAY-01 | Reemplazar comprobante rechazado | Un solo ingreso verificado |
| PAY-02 | Asignaciones concurrentes cerca de límite | Ningún límite superado |
| PAY-03 | Sin cuenta elegible | Alerta, sin instrucciones inventadas |
| TKT-01 | Pago incompleto | Sin boleto individual |
| BRD-01 | Doble escaneo simultáneo | Un solo abordaje |
| BRD-02 | QR de reserva | No autoriza abordaje |
| AUTH-01 | Operador intenta aprobar pago | 403, sin mutación |
| DEMO-01 | Visitante invoca POST directo | 403, sin mutación |
| DEMO-02 | Reutilizar invitación | Denegado |
| DEMO-03 | Sesión de 2 h vencida | Lecturas protegidas denegadas |
| DEMO-04 | Consultar QR ficticio | Respuesta correcta, sin check-in |
| SEED-01 | Regenerar con misma semilla y T0 | Escenarios reproducibles |
| SEED-02 | Validar 250 reservas y 30 flyers | Totales y referencias correctos |

## Calidad no funcional
- Formularios con etiquetas, errores accesibles y navegación por teclado.
- UI adaptable a móvil para escáner y manifiestos.
- Sin secretos en cliente, logs o QR.
- Consultas paginadas para tablas de reservas y pagos.
- Copia/restauración probada de BD y archivos antes de cambios destructivos.
- Reportes de fallos de seed con IDs y regla infringida.

## Puerta de salida de la demo
No exponer acceso a visitantes hasta pasar pruebas de autorización, privacidad, consistencia semilla y caducidad de sesiones.
