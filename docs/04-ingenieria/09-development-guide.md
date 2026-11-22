# 09 — Guía de desarrollo local

## Requisitos
Bun, Docker con Compose y Git. Versiones concretas se fijarán en `package.json`, lockfile y documentación tras validar compatibilidad de Astro, React, Drizzle y Better Auth.

## Variables propuestas
```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_private
DEMO_DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_demo
AUTH_SECRET=GENERATE_A_LONG_RANDOM_SECRET
APP_ORIGIN=http://localhost:4321
PRIVATE_STORAGE_DIR=./storage/private
DEMO_STORAGE_DIR=./storage/demo
AGENCY_TIMEZONE=America/Mexico_City
```
No subir `.env`, contraseñas, cookies, tokens ni comprobantes al repositorio. `.env.example` solo contiene valores ilustrativos.

## Inicio recomendado (comandos orientativos)
```bash
bun install
docker compose up -d
bun run db:migrate
bun run admin:create
bun run dev
```
Los scripts `db:migrate`, `admin:create` y `demo:seed` se crearán en H1/H6; **no se afirma que existan todavía**.

## Estructura
```text
src/
  pages/              # Rutas Astro y endpoints
  components/         # UI e islands React
  modules/
    catalog/           # schema, domain, service, repository
    bookings/
    payments/
    tickets/
    operations/
    marketing/
    identity/
    demo/
    audit/
  db/                 # conexiones, migraciones, seed
  lib/                # permisos, errores, storage, utilidades
scripts/              # administración local
storage/              # archivos privados ignorados por Git
tests/                # unit, integration, e2e
docs/
```

## Convenciones de trabajo
- Caso de uso primero, endpoint delgado, servicio transaccional, pruebas del invariante.
- Migraciones versionadas y revisadas; no editar tablas manualmente fuera de migraciones.
- Un módulo no consulta tablas ajenas sin contrato de servicio o consulta explícitamente justificada.
- Evitar lógica financiera en React; los componentes solo muestran resultados.
- Para cambiar reglas confirmadas, registrar una decisión en [11-decisions-and-risks](../05-decisiones/11-decisions-and-risks.md); si algo no está decidido, consultar [pendientes](../05-decisiones/pendientes.md).
- No usar archivos privados en `public/`; rutas de storage configurables y validadas.

## Definición de terminado de una historia
Código + prueba de éxito + prueba de error/permisos + migración (si aplica) + auditoría (si aplica) + documentación breve.
