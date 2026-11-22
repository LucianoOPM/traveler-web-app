# TravelTech (traveler-web-app)

Plataforma para **una sola agencia de viajes**: catálogo, salidas, reservaciones, pagos SPEI/efectivo, boletos QR, abordaje y marketing (flyers). Dos experiencias: **privada** (admin/operador) y **demo de visitantes** (solo lectura sobre datos ficticios).

## Estado
Hay documentación en `docs/` y un proyecto Astro mínimo (página de inicio con una island React; scripts `dev`, `build`, `preview`, `check`, `start`, `format`, `format:check`, `lint`, `test`, `test:unit`, `test:integration`, `test:health`; configuración validada al arrancar en `src/lib/config.ts`; errores tipados en `src/lib/errors.ts`; `GET /api/health`; hook `commit-msg` de Conventional Commits en `.githooks/`, instalado por `bun install`). Aún no hay lógica de negocio, base de datos ni autenticación. Consultar `docs/00-estado.md` antes de asumir que algo existe. Los ejemplos de API/SQL/rutas son propuestas.

## Stack (confirmado)
Astro full-stack + React islands · Bun · PostgreSQL + Drizzle (Docker solo para la BD) · Better Auth + Admin plugin · monolito modular · archivos privados en disco local.

## Invariantes que nunca se rompen (P0)
- **Una agencia, sin multitenencia**: nada de `organization_id` ni tablas de tenants.
- **Dinero**: centavos enteros, nunca floats. Comprobante reportado ≠ ingreso; solo un admin verifica. Liquidación = suma neta de movimientos verificados.
- **Inventario**: todos los pasajeros (incluidos infantes) ocupan lugar. Reservar y retener es atómico (transacción/locks). Reserva con comprobante en revisión no expira sola.
- **Boletos**: solo tras liquidación completa verificada. QR de reserva solo consulta; no aborda. Abordaje atómico y único (`boarding_records.ticket_id` único).
- **Banco**: una cuenta por reserva por el importe completo, sin dividir; respetar límite mensual; instrucciones congeladas.
- **Seguridad**: tokens solo como hash. Nunca confiar en `role`, `demoMode` o `database` del cliente. Operador sin acceso a pagos.
- **Demo**: dos bases (`traveltech_private`, `traveltech_demo`) elegidas solo en servidor; visitante sin escritura alguna; datos 100% ficticios.
- GET nunca muta. Acciones financieras y de abordaje: idempotentes, auditadas y transaccionales.
- Convenciones: UUID, UTC + zona de agencia, errores tipados, lógica financiera fuera de React.

## Dónde buscar (docs/)
Índice con "qué leer según la tarea": `docs/README.md`.
- Alcance/roadmap → `docs/01-producto/`
- Arquitectura, BD, reglas, seguridad, API → `docs/02-diseno/`
- Seed y flyers → `docs/03-demo/`
- Entorno, convenciones, pruebas → `docs/04-ingenieria/`
- Decisiones (ADR), riesgos → `docs/05-decisiones/11-decisions-and-risks.md`
- **Lo no decidido → `docs/05-decisiones/pendientes.md`: no inventar; preguntar al usuario.**

## Reglas de trabajo
- Cifras del seed solo en `docs/03-demo/08-demo-seed-and-content.md`; no duplicarlas en otros docs.
- Al cambiar una regla confirmada: registrar ADR. Al cerrar un hito: actualizar `docs/00-estado.md`.
- Un hito no se cierra con capturas: exige funcionalidad, prueba automatizada, migración, errores controlados y docs al día.
- No existen aún los scripts `db:migrate`, `admin:create`, `demo:seed`; no afirmarlo.
- Entorno del usuario: sin Python. Usar Node/Bun/bash. Commits en Conventional Commits. Responder en español.
