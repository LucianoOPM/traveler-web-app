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

## Cómo se ejecutan las pruebas (issue #7, [ADR-020](../05-decisiones/11-decisions-and-risks.md))
El runner oficial es `bun test` (integrado en Bun, TypeScript nativo, API compatible con Jest), sin `bunfig.toml` ni cobertura con umbrales por ahora. Las rutas de los scripts llevan `./` a propósito: sin él, `bun test tests/unit` es un **filtro por subcadena** y recogería también, por ejemplo, `tests/unit-legacy/` o `src/tests/unit/` (verificado); con `./tests/unit` solo se ejecuta esa carpeta.

| Script | Qué ejecuta | Hoy |
|---|---|---|
| `bun run test:unit` | `./tests/unit` | 64 pruebas (~0,8 s) |
| `bun run test:integration` | `./tests/integration` | 35 pruebas (~17 s): las 9 de `api-errors` (construyen `tests/fixtures/api-errors/` con `astro build --root` y lo sirven de verdad; la primera ejecución en un clon recién instalado tardó ~12 s), las 6 de salud, las 14 del hook de commits y las 6 del CLI de validación de commits de un PR (ambas con repositorios Git temporales reales) |
| `bun run test:health` | `./tests/integration/health.test.ts` | 6 pruebas (~4 s): la prueba de salud local de la app real (`GET /api/health` y fallo con configuración inválida) |
| `bun run test` | las dos anteriores, en ese orden | 99 pruebas (64 + 35); si falla la unitaria no se ejecuta la integración |

Ninguna prueba actual requiere `.env`, PostgreSQL ni servicios externos (verificado en un clon limpio con el entorno saneado y sin PostgreSQL). Por defecto `bun test` ejecuta los archivos **en serie**, y las pruebas de un archivo una tras otra; `--parallel` (archivos en procesos) y `--concurrent` (pruebas dentro de un archivo) son opcionales y cambian lo que debe prever la estrategia de bases de datos de abajo. Según la documentación de Bun, `--isolate` aísla el estado global y los registros de módulos entre archivos, de modo que sin él todos los archivos los comparten (p. ej., un pool de conexiones creado como singleton se compartiría), y `test.concurrent` o `--randomize` cambian el orden de ejecución. `tests/e2e/` solo contiene un `.gitkeep`.

### Integración con PostgreSQL (propuesta para H1, [PEN-15](../05-decisiones/pendientes.md); **no implementada**)
Se activa en H1, cuando exista la base de datos. Propuesta pendiente de confirmar:
- Una base `traveltech_test` independiente de la privada y la demo, en la misma instancia Docker (extiende REC-001 con una base solo de pruebas), con migraciones (`drizzle-kit migrate`) aplicadas sobre ella.
- Una variable `TEST_DATABASE_URL` exclusiva de pruebas, fuera de las 8 obligatorias de la aplicación.
- Las pruebas PostgreSQL se omiten (`describe.skipIf`) si no hay configuración de pruebas habilitada, de modo que `bun run test` siga pasando sin base de datos.
- **Requisito obligatorio de H1:** no basta con que exista `TEST_DATABASE_URL` para permitir operaciones destructivas. Debe implementarse una validación explícita que impida ejecutar limpieza o migraciones de prueba sobre las bases privada o demo, siempre antes de cualquier operación destructiva. La comprobación fiable es exigir un nombre de base de pruebas reconocible y verificarlo **en la propia conexión** (p. ej. `SELECT current_database()`); comparar URLs es frágil (`localhost` frente a `127.0.0.1`, otro usuario, parámetros), `DATABASE_URL` y `DEMO_DATABASE_URL` pueden no existir en CI y `bun test` carga `.env`/`.env.test` automáticamente. Este requisito es parte de los criterios de salida de H1 (ver el roadmap).
- **Aislamiento:** transacciones con reversión cuando sea viable; limpieza o recreación controlada para las pruebas de concurrencia (INV-01, BRD-01), que necesitan transacciones reales confirmadas en conexiones separadas. No limpiar tablas compartidas entre archivos que puedan ejecutarse en paralelo: produce resultados intermitentes.

### E2E (pendiente, [PEN-13](../05-decisiones/pendientes.md))
No hay herramienta E2E instalada ni pruebas E2E. Candidatos recomendados: Playwright + `@axe-core/playwright`; la decisión definitiva se toma cuando exista la primera interfaz real (H1).

## Calidad no funcional
- Formularios con etiquetas, errores accesibles y navegación por teclado. El lint estático (ADR-018) solo detecta parte (p. ej. `<label>` sin control, `<img>` sin `alt`); la garantía completa requiere pruebas E2E con axe, pendientes de decidir ([PEN-13](../05-decisiones/pendientes.md)).
- UI adaptable a móvil para escáner y manifiestos.
- Sin secretos en cliente, logs o QR.
- Consultas paginadas para tablas de reservas y pagos.
- Copia/restauración probada de BD y archivos antes de cambios destructivos.
- Reportes de fallos de seed con IDs y regla infringida.

## Puerta de salida de la demo
No exponer acceso a visitantes hasta pasar pruebas de autorización, privacidad, consistencia semilla y caducidad de sesiones.
