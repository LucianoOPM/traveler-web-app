# Pendientes — lista única

> Fuente única de lo que **aún no está decidido**. No inventar estas respuestas: si una tarea depende de un punto de esta lista, preguntar al usuario y, al resolverlo, moverlo a un ADR en [11-decisions-and-risks.md](11-decisions-and-risks.md) y borrarlo de aquí.

## Negocio y pagos
| ID | Pendiente | Bloquea | Referencias |
|---|---|---|---|
| PEN-01 | Política de anticipos, pagos parciales, devoluciones y sobrepagos | Hito H4 (liquidación), H5 (emisión de boletos) | [05-business-rules](../02-diseno/05-business-rules.md) (sección Pagos) |
| PEN-02 | Definición explícita de contabilidad operacional: importes comprometidos / reportados / verificados / liberados | Servicio de asignación bancaria (H4) | [04-domain-and-database](../02-diseno/04-domain-and-database.md) (Nota de diseño) |
| PEN-03 | Importes exactos y estados administrativos de las 3 cuentas ficticias | Seed (H6) | [08-demo-seed-and-content](../03-demo/08-demo-seed-and-content.md) |

## Datos semilla y demo
| ID | Pendiente | Bloquea |
|---|---|---|
| PEN-04 | Proporción de pasajeros por reserva, abordajes y ausencias | Seed (H6) |
| PEN-05 | Distribución interna de las 22 salidas restantes (flexible) | Seed (H6) |
| PEN-06 | Alcance exacto de campos del manifiesto ampliado | Demo (H7) |
| PEN-07 | Permisos opcionales de marketing para el operador | Marketing (H6) |

## Infraestructura y operación
| ID | Pendiente | Bloquea |
|---|---|---|
| PEN-08 | Estrategia final de hosting, correo, IA, almacenamiento cloud y procesos programados | Despliegue (posterior a la demo local) |
| PEN-09 | Política de conservación de evidencias, registros de auditoría e invitaciones en producción | Despliegue |
| PEN-10 | Biblioteca de validación de API (no fijada) | Endpoints (H1+) — ver [07-api-contracts](../02-diseno/07-api-contracts.md) |
