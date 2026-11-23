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
| `bun run test:unit` | `./tests/unit` | Configuración, errores y protección de la base de pruebas |
| `bun run test:integration` | `./tests/integration` | Errores de `/api/` (construyen `tests/fixtures/api-errors/` con `astro build --root` y lo sirven de verdad), salud, protección de la base de pruebas y esquema de identidad (migración aplicada sobre `traveltech_test` recreado) , `bun run admin:create` y autenticación de personal (app real en modo producción: login, registro cerrado, cierre de sesión y límite de intentos) y control de acceso por ruta de `/admin` (sin sesión, admin, operador, rol ajeno, vetado y cierre de sesión), ambas con la app real; arrancan con `tests/support/aplicacion.ts` y, como `test:health`, generan el `dist/` de la raíz. Se omiten sin `TEST_DATABASE_URL` (se omiten sin `TEST_DATABASE_URL`) |
| `bun run test:health` | `./tests/integration/health.test.ts` | Prueba de salud local de la app real (`GET /api/health` y fallo con configuración inválida) |
| `bun run test` | las dos anteriores, en ese orden | Si falla la unitaria no se ejecuta la integración |

En local ninguna prueba requiere `.env`, PostgreSQL ni servicios externos: las de PostgreSQL se omiten sin `TEST_DATABASE_URL` (verificado en un clon limpio con el entorno saneado y sin PostgreSQL). Por defecto `bun test` ejecuta los archivos **en serie**, y las pruebas de un archivo una tras otra; `--parallel` (archivos en procesos) y `--concurrent` (pruebas dentro de un archivo) son opcionales y cambian lo que debe prever la estrategia de bases de datos de abajo. Según la documentación de Bun, `--isolate` aísla el estado global y los registros de módulos entre archivos, de modo que sin él todos los archivos los comparten (p. ej., un pool de conexiones creado como singleton se compartiría), y `test.concurrent` o `--randomize` cambian el orden de ejecución. `tests/e2e/` solo contiene un `.gitkeep`.

### Integración con PostgreSQL
- Base `traveltech_test` independiente de la privada y la demo (Docker Compose, issue #28) y variable `TEST_DATABASE_URL`, solo de pruebas (fuera de las variables de la aplicación).
- **Protección obligatoria:** `asegurarBaseDePruebas` (`tests/support/base-de-pruebas.ts`) comprueba `select current_database()` en la propia conexión y rechaza cualquier base que no sea `traveltech_test`; se llama antes de cualquier limpieza o recreación. Las bases privada y demo nunca se tocan en pruebas.
- Las pruebas con PostgreSQL se omiten sin `TEST_DATABASE_URL` en local (`describe.skipIf(!url && !process.env.CI)`, sin envoltorio compartido); en CI (`CI=true`) nunca se omiten y fallan con error explícito si falta.
- **CI:** el job `verificar` levanta un servicio `postgres:17.10-alpine`, crea las tres bases con `docker/postgres/init/01-crear-bases.sql` (el mismo script de Compose) antes de `bun run test` y define `TEST_DATABASE_URL` hacia `traveltech_test`. La prueba `tests/integration/base-de-pruebas.test.ts` comprueba con conexiones reales que `asegurarBaseDePruebas` acepta `traveltech_test` y rechaza `traveltech_private` y `traveltech_demo`.
- Aislamiento: recrear el esquema de `traveltech_test` (`recrearEsquema`) al empezar un archivo de pruebas; las pruebas de concurrencia (INV-01, BRD-01) usan conexiones separadas con transacciones reales.

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
