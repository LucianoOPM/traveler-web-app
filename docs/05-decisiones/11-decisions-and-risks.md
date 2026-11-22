# 11 — Registro de decisiones y riesgos

Los **pendientes** viven en [pendientes.md](pendientes.md). Las **cifras del seed** viven solo en [08-demo-seed-and-content](../03-demo/08-demo-seed-and-content.md).

## Decisiones confirmadas (ADR resumidos)
| ID | Decisión | Estado |
|---|---|---|
| ADR-001 | Una agencia, no multitenencia | Confirmada |
| ADR-002 | Astro + React islands + Bun | Confirmada |
| ADR-003 | PostgreSQL + Drizzle; Docker solo para BD | Confirmada |
| ADR-004 | Better Auth + Admin plugin para personal | Confirmada |
| ADR-005 | Monolito modular | Confirmada |
| ADR-006 | Archivos locales para fase demo | Confirmada |
| ADR-007 | Invitación un uso/24 h; sesión 2 h; watermark único | Confirmada |
| ADR-008 | Formularios visitante interactivos sin persistencia; acciones mixtas | Confirmada |
| ADR-009 | Seed PostgreSQL con fechas relativas a T0 | Confirmada |
| ADR-010 | Volumen del seed: paquetes, salidas, reservas y flyers (cifras en doc 08) | Confirmada |
| ADR-011 | Distribución de estados de reservas (cifras en doc 08) | Confirmada |
| ADR-012 | Salidas en abordaje y finalizadas (cifras en doc 08) | Confirmada |
| ADR-013 | Pagos variados y 3 cuentas ficticias con excepciones | Confirmada |
| ADR-014 | QR de visitante consultable, solo lectura | Confirmada |
| ADR-015 | Versiones del stack (Bun 1.4.4, Astro 7.4.13, React 19.3.1, Drizzle 0.45.4, Better Auth 1.7.27; paquetes exactos) y driver `bun-sql` | Confirmada |

### ADR-015 — Versiones del stack y driver de PostgreSQL
Estado: confirmada
Contexto: PEN-11 bloqueaba H0 (no se podía fijar `package.json`). La documentación de Context7 iba por detrás del registro (indicaba Astro 6 y que `bun-sql` solo existía en Drizzle RC), por lo que las versiones se tomaron del registro npm y se probaron juntas.
Decisión: fijar exactas Bun 1.4.4, Astro 7.4.13, @astrojs/node 11.1.14, @astrojs/react 7.1.9, React y react-dom 19.3.1, drizzle-orm 0.45.4, drizzle-kit 0.31.11, better-auth y @better-auth/drizzle-adapter 1.7.27. Servidor ejecutado con Bun; driver de la aplicación `drizzle-orm/bun-sql`; `pg` 8.23.1 como devDependency solo para `drizzle-kit` (verificado: sin `pg`, `drizzle-kit migrate` falla con "please install either of 'pg', 'postgres'..." tanto con Node como con `--bun`); CLI `auth` 1.7.27 como devDependency para generar el esquema de Better Auth. Node >= 22.23.4 (requisito `engines` de Astro; solo se validó con v24.22.0) y PostgreSQL 17.10 (`postgres:17-alpine` al validar; fijar la etiqueta exacta al crear el `docker-compose`). Tabla completa en [09-development-guide](../04-ingenieria/09-development-guide.md).
Validación (proyecto desechable, PostgreSQL 17 en Docker): instalación sin advertencias de peers; `astro build` con island React y adaptador Node; servidor responde 200 en Bun y Node; `drizzle-kit generate/migrate` con el esquema de Better Auth + plugin `admin`; registro por `/api/auth/sign-up/email` correcto con `node-postgres` (Bun y Node) y con `bun-sql` (Bun).
Alternativas consideradas: Node + `pg` y Bun + `pg` (también pasaron la prueba; descartadas por coherencia con ADR-002 y porque el driver nativo de Bun evita `pg` en tiempo de ejecución, aunque `pg` sigue siendo necesario para `drizzle-kit`); Drizzle 1.0 RC (soportado por Better Auth pero pre-release y no probado).
Consecuencias: actualizar versiones requiere repetir la validación y un nuevo ADR; el esquema generado por `auth generate` debe pasarse a `drizzle()`; el comportamiento de `bun-sql` bajo carga y transacciones concurrentes (reservas atómicas, P0) debe cubrirse con pruebas en H3.
Fecha: 2026-11-22

## Recomendaciones adoptadas para arrancar
| ID | Decisión | Motivo |
|---|---|---|
| REC-001 | Dos bases PostgreSQL (privada/demo) en misma instancia local | Aislamiento de datos |
| REC-002 | UUID, centavos enteros, UTC + zona de agencia | Integridad y consistencia |
| REC-003 | Manifiesto visitante con datos ficticios completos sin contacto/finanzas | Demostración útil y prudente |
| REC-004 | Flyers repartidos entre cuadrado y vertical (cifras en doc 08) | Cobertura de formatos |
| REC-005 | Seed determinista y regeneración explícita | Reproducibilidad |
| REC-006 | Endpoints demo separados para lectura de QR/manifiestos | Menor riesgo de escritura |

## Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Sobreventa por concurrencia | Transacción, locks y prueba paralela |
| Límite bancario excedido | Reserva atómica de capacidad mensual |
| Confundir reporte con ingreso | Eventos de revisión y contabilidad neta |
| Fuga de datos entre experiencias | Bases separadas y autorización de servidor |
| Acceso por enlace robado | Expiración, consumo único, revocación, rate limit |
| Captura de demo | Watermark; asumir que no puede impedirse |
| Seed envejecido | T0 registrado y regeneración manual |
| Flyer con fecha incorrecta | Render desde datos de salida en cada seed |
| Dependencia prematura de SaaS | Adaptadores y ejecución local |
| Comportamiento de `drizzle-orm/bun-sql` con transacciones concurrentes y dos conexiones (privada/demo) no probado (ADR-015) | Pruebas de concurrencia de reserva en H3 y de aislamiento de bases en H7; alternativa probada: `pg` |

## Plantilla ADR
```md
# ADR-XXX — Título
Estado: propuesta | confirmada | reemplazada
Contexto:
Decisión:
Alternativas consideradas:
Consecuencias:
Fecha:
```
