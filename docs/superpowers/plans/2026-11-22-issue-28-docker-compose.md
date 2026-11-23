# Issue #28 — Docker Compose con PostgreSQL y las tres bases — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up -d` deja PostgreSQL sano con `traveltech_private`, `traveltech_demo` y `traveltech_test`, con volumen persistente, y el proyecto lo documenta y lo protege con pruebas estáticas.

**Architecture:** Un único servicio `postgres` en `docker-compose.yml`; un script SQL de inicialización montado en `/docker-entrypoint-initdb.d` crea las tres bases; la contraseña llega por `POSTGRES_PASSWORD` del `.env`. Una prueba unitaria de texto fija las propiedades que no deben romperse (etiqueta exacta, puerto solo local, nombres de bases coherentes con `.env.example`). No cambia el código de la aplicación ni `loadConfig`.

**Tech Stack:** Docker Compose, imagen `postgres:17.10-alpine` (etiqueta verificada en el registro el 2026-11-22), `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-22-h1-issues-1-4-base-de-datos-design.md` (sección «Issue 1»). Issue de GitHub: #28.

## Global Constraints
- Etiqueta de imagen **exacta** (`postgres:17.10-alpine`), nunca `latest` ni una etiqueta mayor (ADR-015).
- Puerto publicado solo en `127.0.0.1:5432`.
- Bases: `traveltech_private`, `traveltech_demo`, `traveltech_test` (REC-001 y PEN-15).
- `POSTGRES_PASSWORD` es solo para Compose y `TEST_DATABASE_URL` es opcional: **ninguna entra en las 8 variables de `loadConfig`**; `src/lib/config.ts` no se modifica.
- Sin tecnologías nuevas: nada de dependencias npm, ni scripts de `package.json` (los comandos son `docker compose ...`).
- Sin Python; scripts solo en Node/Bun/bash. Commits en Conventional Commits. Documentación en español.
- Rama `chore/h1-docker-compose` desde `dev`; PR hacia `dev` con `Closes #28`. No hacer push ni abrir el PR sin confirmación del responsable.

## Review Focus
1. **Volumen ya existente:** el script de inicialización solo corre con el volumen vacío; añadir una base después no la crea. Se documenta y se verifica que `down` (sin `-v`) + `up` conserva los datos (Task 2).
2. **Falta `POSTGRES_PASSWORD`:** Compose debe fallar con un mensaje claro y no arrancar con contraseña vacía (Task 2).
3. **«Sano» demasiado pronto:** durante la inicialización el servidor temporal escucha solo por socket; el `healthcheck` debe forzar TCP para que `--wait` solo termine cuando las tres bases existen (Task 2).
4. **Contraseña distinta entre Compose y las URLs:** da un fallo de autenticación confuso; se documenta y se verifica que con los valores de `.env.example` la conexión funciona (Task 2).
5. **`TEST_DATABASE_URL` activa por accidente:** si estuviera sin comentar en `.env.example`, `cp .env.example .env` haría depender las pruebas de PostgreSQL; una prueba exige que esté comentada (Task 1).

## Estructura de archivos
- Crear `docker-compose.yml`: servicio `postgres`, volumen con nombre, `healthcheck`.
- Crear `docker/postgres/init/01-crear-bases.sql`: tres `CREATE DATABASE`.
- Modificar `.env.example`: `POSTGRES_PASSWORD` y `TEST_DATABASE_URL` (comentada).
- Crear `tests/unit/docker-compose.test.ts`: prueba estática de los tres archivos anteriores.
- Modificar `README.md`, `docs/04-ingenieria/09-development-guide.md`, `docs/00-estado.md` y `CLAUDE.md` (solo la frase de «Estado»).

---

### Task 1: Archivos de Compose, plantilla de entorno y prueba estática

**Files:**
- Create: `tests/unit/docker-compose.test.ts`, `docker-compose.yml`, `docker/postgres/init/01-crear-bases.sql`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `loadConfig(raw, { projectRoot })` y `ConfigError` de `src/lib/config.ts` (sin cambios).
- Produces: los nombres de servicio y volumen (`postgres`, `traveltech_pgdata`), la ruta del script de inicialización y las dos variables nuevas, de los que dependen las issues #29 y #30.

- [ ] **Step 1: Crear la rama.** `git switch dev && git pull && git switch -c chore/h1-docker-compose`.

- [ ] **Step 2: Escribir la prueba que falla** en `tests/unit/docker-compose.test.ts`. Lee con `node:fs` los archivos desde la raíz (`path.resolve(import.meta.dir, "../..")`), sin analizador YAML (solo expresiones sobre el texto). Tests, con estas aserciones:
  - `"la imagen de PostgreSQL tiene etiqueta exacta"`: el compose coincide con `/^\s+image:\s*postgres:17\.10-alpine\s*$/m` y no contiene `latest`.
  - `"el puerto solo se publica en 127.0.0.1"`: contiene `127.0.0.1:5432:5432` y ninguna línea publica `5432:5432` sin `127.0.0.1` (regex `/^\s*-\s*["']?5432:5432/m` no coincide).
  - `"la contraseña es obligatoria"`: contiene `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?` (sintaxis de Compose que aborta si falta).
  - `"los datos viven en un volumen con nombre"`: contiene `traveltech_pgdata:/var/lib/postgresql/data` y una declaración de nivel superior `volumes:` con `traveltech_pgdata:`.
  - `"el healthcheck fuerza TCP"`: contiene `pg_isready` con `-h 127.0.0.1` (el servidor temporal de la inicialización no escucha por TCP).
  - `"el script de inicialización monta como solo lectura"`: contiene `./docker/postgres/init:/docker-entrypoint-initdb.d:ro`.
  - `"el script crea exactamente las tres bases"`: el SQL contiene `CREATE DATABASE traveltech_private;`, `CREATE DATABASE traveltech_demo;` y `CREATE DATABASE traveltech_test;`, y el número total de `CREATE DATABASE` es 3.
  - `".env.example: las bases de las URLs existen en el script"`: los nombres de base de `DATABASE_URL` y `DEMO_DATABASE_URL` (último segmento de la ruta) aparecen en el script.
  - `".env.example declara POSTGRES_PASSWORD"`: existe una línea `POSTGRES_PASSWORD=` sin comentar.
  - `".env.example deja TEST_DATABASE_URL comentada y apuntando a traveltech_test"`: hay una línea `# TEST_DATABASE_URL=` cuya ruta termina en `/traveltech_test` y **ninguna** línea `TEST_DATABASE_URL=` sin comentar.
  - `".env.example sigue siendo válido para loadConfig y no filtra las variables de Compose"`: se parsea `.env.example` (líneas `CLAVE=valor`, ignorando `#` y vacías), se sustituye `AUTH_SECRET` por un valor válido de 40 caracteres y `loadConfig(raw, { projectRoot })` no lanza; `JSON.stringify(config)` no contiene el valor de `POSTGRES_PASSWORD`.

- [ ] **Step 3: Ejecutar y comprobar que falla.** `bun test ./tests/unit/docker-compose.test.ts` → FALLA (los archivos no existen y `.env.example` no tiene las variables).

- [ ] **Step 4: Crear los archivos.**
  - `docker-compose.yml`: `name: traveltech`; servicio `postgres` con `image: postgres:17.10-alpine`, `restart: unless-stopped`, `environment` con `POSTGRES_USER: traveltech` y `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Define POSTGRES_PASSWORD en .env (ver .env.example)}`, `ports: ["127.0.0.1:5432:5432"]`, `volumes` con `traveltech_pgdata:/var/lib/postgresql/data` y `./docker/postgres/init:/docker-entrypoint-initdb.d:ro`, `healthcheck` con `["CMD-SHELL", "pg_isready -h 127.0.0.1 -U traveltech -d traveltech_test"]` (intervalo 5 s, 5 intentos, `start_period` 10 s) y el volumen declarado al final. Una línea de comentario aclara que el usuario `traveltech` es superusuario y que el puerto es solo local.
  - `docker/postgres/init/01-crear-bases.sql`: los tres `CREATE DATABASE`, con un comentario que explique que solo se ejecuta con el volumen vacío.
  - `.env.example`: añadir, tras `DEMO_DATABASE_URL`, `POSTGRES_PASSWORD=CHANGE_ME` con un comentario («solo para Docker Compose; debe coincidir con la contraseña de las URLs») y, al final, `# TEST_DATABASE_URL=postgresql://traveltech:CHANGE_ME@localhost:5432/traveltech_test` con un comentario («opcional: pruebas con PostgreSQL; descomentar con la base en marcha»).

- [ ] **Step 5: Ejecutar y comprobar que pasa.** `bun test ./tests/unit/docker-compose.test.ts` → todas pasan. Luego `bun run format`, `bun run lint`, `bun run check` y `bun run test` → verdes (la suma de pruebas sube respecto de las 99 actuales).

- [ ] **Step 6: Commit.** `git add docker-compose.yml docker .env.example tests/unit/docker-compose.test.ts && git commit -m "chore(h1): añadir Docker Compose con PostgreSQL y las bases privada, demo y de pruebas"`.

---

### Task 2: Verificación real con Docker

No cambia código salvo que aparezca un fallo; entonces se corrige con una prueba estática que lo cubra y se repite desde el paso que falló. Se ejecuta con un `.env` de prueba (copia de `.env.example` con el `AUTH_SECRET` reemplazado), **sin tocar datos existentes**: si ya hay un contenedor o volumen `traveltech_*`, detenerse y consultar.

- [ ] **Step 1: Sintaxis y variables.** `docker compose config` con `.env` válido → imprime la configuración con la etiqueta `postgres:17.10-alpine` y el puerto `127.0.0.1`. Con `POSTGRES_PASSWORD` ausente (renombrar `.env` temporalmente) → **falla** con el mensaje «Define POSTGRES_PASSWORD en .env».
- [ ] **Step 2: Arranque y espera.** `docker compose up -d --wait` → termina con el servicio `healthy`; `docker compose ps` lo confirma. La orden solo debe terminar cuando ya existen las tres bases (el `healthcheck` usa TCP).
- [ ] **Step 3: Las tres bases.** `docker compose exec postgres psql -U traveltech -d postgres -Atc "select datname from pg_database where datname like 'traveltech_%' order by 1"` → `traveltech_demo`, `traveltech_private`, `traveltech_test`.
- [ ] **Step 4: Conexión con las URLs de `.env.example`.** Desde el anfitrión, `psql` con `DATABASE_URL` (o, sin `psql` local, `docker compose exec` usando `-h 127.0.0.1` y la contraseña del `.env`) → `select current_database()` devuelve el nombre esperado en las tres bases.
- [ ] **Step 5: Persistencia.** Crear una tabla temporal real en `traveltech_test` (`create table prueba_persistencia(id int)`), `docker compose down` (sin `-v`), `docker compose up -d --wait` → la tabla sigue existiendo. Después borrarla.
- [ ] **Step 6: Recreación.** `docker compose down -v` borra el volumen; `up -d --wait` vuelve a crear las tres bases. Anotar el tiempo de arranque en frío.
- [ ] **Step 7: Apagado.** `docker compose down` (con `-v` si fue una verificación desechable) y dejar el entorno como estaba. Anotar versión de Docker, resultados y los límites (p. ej., solo probado en Windows con Docker Desktop, puerto 5432 libre) para la documentación del Task 3.

---

### Task 3: Documentación y estado

**Files:**
- Modify: `README.md`, `docs/04-ingenieria/09-development-guide.md`, `docs/00-estado.md`, `CLAUDE.md`

- [ ] **Step 1: README.** Reemplazar la línea «Docker y PostgreSQL aún no se usan» por los requisitos reales (Docker con Compose para la base local). Añadir una sección «Base de datos local» con: `docker compose up -d --wait`, qué crea (tres bases), que `POSTGRES_PASSWORD` debe coincidir con la contraseña de las URLs, `docker compose down` (conserva datos) frente a `docker compose down -v` (**borra todos los datos locales**), y que añadir una base nueva a una instalación existente exige recrear el volumen. Actualizar la frase de «Estado» (H1 en curso; aún no hay esquema, migraciones ni autenticación) y mantener «Aún no existen `db:migrate`…».
- [ ] **Step 2: Guía de desarrollo.** Actualizar «Requisitos» (Docker ya se usa), la fila de PostgreSQL de la tabla (etiqueta fijada `17.10-alpine`), el bloque de variables (`POSTGRES_PASSWORD`, `TEST_DATABASE_URL` opcional y comentada) y la lista «Pendiente: todavía NO existe» (quitar `docker compose up -d`). Añadir la sección «Base de datos local (issue #28)» con los comandos, la recreación del volumen, el puerto solo local, el usuario superusuario solo de desarrollo, la solución de problemas (puerto 5432 ocupado, contraseña distinta entre Compose y las URLs, volumen ya inicializado) y los resultados verificados del Task 2 con sus límites.
- [ ] **Step 3: Estado.** En `docs/00-estado.md`: fecha, resumen, fila H1 «**En curso.** Issue #28: Docker Compose con PostgreSQL (verificado …); siguen #29, #30 y #31», y «Siguiente paso sugerido» apuntando a la issue #29. En `CLAUDE.md`, ajustar solo la frase de «Estado» para decir que existe PostgreSQL local con Docker Compose y que aún no hay esquema, migraciones ni autenticación. No se añade ADR (no cambia ninguna regla confirmada); las decisiones de variables quedan para el ADR-024 de la issue #30.
- [ ] **Step 4: Verificación final.** `bun run format:check`, `bun run lint`, `bun run check`, `bun run test` y `bun run build` con el entorno válido → verdes; `git status` limpio salvo lo esperado.
- [ ] **Step 5: Commit.** `git add README.md docs CLAUDE.md && git commit -m "docs(h1): documentar la base de datos local con Docker Compose"`.
- [ ] **Step 6: Entrega (con confirmación del responsable).** `git push -u origin chore/h1-docker-compose` y abrir el PR hacia `dev` con `Closes #28`; esperar `verificar` y `commits` en verde.

## Autorrevisión
- **Cobertura del diseño (Issue 1):** compose con etiqueta exacta, volumen, puerto local y `healthcheck` (Task 1); script de las tres bases (Task 1); variables fuera de `loadConfig` (Task 1, última prueba); documentación y recreación del volumen (Task 3); verificación manual con `psql` (Task 2). Cubierto.
- **Decisión del constructor añadida al diseño:** `TEST_DATABASE_URL` queda **comentada** en `.env.example` para que `cp .env.example .env` no vuelva obligatorio PostgreSQL en las pruebas locales; se informará al responsable al entregar.
- **Consistencia:** los nombres `postgres`, `traveltech_pgdata`, `docker/postgres/init/01-crear-bases.sql` y las tres bases coinciden en todas las tareas y serán los que usen #29 y #30.
