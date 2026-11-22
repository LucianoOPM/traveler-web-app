# TravelTech — Documentación técnica

**Estado:** baseline de desarrollo v0.1 · **Producto:** plataforma para una sola agencia de viajes · **Objetivo inmediato:** demo local funcional y demo de visitantes controlada.

> Estos documentos son especificaciones iniciales, no evidencia de funcionalidades ya implementadas. Las decisiones de negocio confirmadas prevalecen sobre ejemplos y recomendaciones. Para saber qué existe realmente, ver [00-estado.md](00-estado.md).

## Mapa: qué leer según la tarea

| Si vas a... | Lee |
|---|---|
| Entender qué se construye y para quién | [01-producto/01-product-scope](01-producto/01-product-scope.md) |
| Saber en qué hito estamos / qué sigue | [00-estado](00-estado.md) y [01-producto/02-roadmap](01-producto/02-roadmap.md) |
| Decidir dónde va el código o cómo se conectan módulos | [02-diseno/03-architecture](02-diseno/03-architecture.md) |
| Crear tablas, migraciones o consultas | [02-diseno/04-domain-and-database](02-diseno/04-domain-and-database.md) |
| Implementar lógica de reservas, pagos, boletos, abordaje | [02-diseno/05-business-rules](02-diseno/05-business-rules.md) |
| Tocar autenticación, permisos, sesiones o demo | [02-diseno/06-security-and-access](02-diseno/06-security-and-access.md) |
| Crear o consumir endpoints | [02-diseno/07-api-contracts](02-diseno/07-api-contracts.md) |
| Generar o validar datos semilla, flyers | [03-demo/08-demo-seed-and-content](03-demo/08-demo-seed-and-content.md) |
| Levantar el entorno, convenciones, estructura de carpetas | [04-ingenieria/09-development-guide](04-ingenieria/09-development-guide.md) |
| Escribir pruebas o revisar criterios de aceptación | [04-ingenieria/10-testing-and-quality](04-ingenieria/10-testing-and-quality.md) |
| Ver por qué se decidió algo o qué riesgos hay | [05-decisiones/11-decisions-and-risks](05-decisiones/11-decisions-and-risks.md) |
| Saber qué **no** está decidido (no inventar) | [05-decisiones/pendientes](05-decisiones/pendientes.md) |

## Estructura

```text
docs/
  README.md              índice y glosario
  00-estado.md           hito actual y qué existe
  01-producto/           alcance y roadmap
  02-diseno/             arquitectura, dominio/BD, reglas, seguridad, API
  03-demo/               datos semilla y contenido
  04-ingenieria/         guía de desarrollo y pruebas
  05-decisiones/         ADR, riesgos y pendientes
```

## Fuente única de cada dato

Para no duplicar información, cada tema se define en un solo documento; los demás lo enlazan.

| Dato | Fuente única |
|---|---|
| Cifras del seed (paquetes, salidas, reservas, flyers, estados) | [03-demo/08](03-demo/08-demo-seed-and-content.md) |
| Invariantes y máquinas de estado | [02-diseno/05](02-diseno/05-business-rules.md) |
| Matriz de permisos | [02-diseno/06](02-diseno/06-security-and-access.md) |
| Decisiones confirmadas | [05-decisiones/11](05-decisiones/11-decisions-and-risks.md) |
| Cosas sin decidir | [05-decisiones/pendientes](05-decisiones/pendientes.md) |
| Avance real | [00-estado](00-estado.md) |

## Principios rectores
1. Un solo producto, una sola agencia: **no multitenencia**.
2. Reutilizar reglas de negocio; aislar datos y permisos de visitantes.
3. Priorizar invariantes financieros y de inventario frente a efectos visuales.
4. Demo privada funcional antes de la exposición a visitantes.
5. Sin servicios externos obligatorios para desarrollar localmente.
6. Los ejemplos de API, SQL y rutas son propuestas que deben validarse al implementar.

## Glosario
- **Privado:** aplicación operativa local para administradores y operadores, con escritura autorizada.
- **Visitante demo:** persona invitada con sesión temporal; lectura ficticia, formularios locales, sin persistencia.
- **T0:** instante único de referencia al generar los datos semilla.
- **Pago verificado:** dinero comprobado por un administrador, no simplemente un comprobante recibido.
- **Boleto:** credencial individual de pasajero emitida tras liquidación completa.
- **Liquidación:** suma neta de movimientos verificados aplicables; no es la suma de importes reportados.
- **QR de reserva:** solo consulta; no autoriza abordaje. Distinto del **boleto QR** individual.
- **Salida (departure):** instancia programada de un paquete, con capacidad y tarifas propias.
- **Hitos H0–H8:** fases del roadmap.
- **ADR / REC / PEN:** decisión confirmada / recomendación adoptada / pendiente sin decidir.

## Convención de mantenimiento
- Al cambiar una regla confirmada: registrar ADR y actualizar solo su fuente única.
- Al cerrar un hito: actualizar [00-estado](00-estado.md).
- Al resolver un pendiente: moverlo a ADR y borrarlo de `pendientes.md`.
