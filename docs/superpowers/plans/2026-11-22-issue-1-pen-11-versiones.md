# Issue #1 — Resolver PEN-11 y fijar versiones: Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan checkboxes (`- [ ]`).

**Goal:** Cerrar PEN-11 fijando, con evidencia verificada, las versiones de Bun, Astro, React, Drizzle y Better Auth, y dejarlas documentadas.

**Architecture:** Trabajo de investigación y documentación, sin código de producto. Se verifica cada versión contra el registro y Context7, se prueba la compatibilidad en un proyecto desechable fuera del repo, se acuerdan las versiones con el responsable y solo entonces se editan los docs.

**Tech Stack:** Bun, `bun pm view` (registro), Context7 MCP, proyecto de prueba en el scratchpad.

**Spec:** Issue #1 (`gh issue view 1`), `docs/05-decisiones/pendientes.md` (PEN-11), `docs/01-producto/02-roadmap.md` (H0).

## Global Constraints

- Nada de Python (`CLAUDE.md` global): solo Node/Bun/bash.
- Respuestas y docs en español; commits en Conventional Commits.
- Lo no decidido no se inventa: las versiones y el driver se acuerdan con el usuario antes de escribir en docs (`CLAUDE.md` del proyecto).
- Al resolver un pendiente: registrar ADR y **borrarlo** de `pendientes.md` (así lo exige el encabezado de ese archivo; la issue dice "marcar como resuelto").
- No afirmar que existen `db:migrate`, `admin:create`, `demo:seed`.
- Prohibido tocar `package.json` o lockfile: pertenecen a la issue #2.

## Review Focus

- Astro 6 exige Node >= 22.23.4 (Context7); Bun como runtime del servidor puede no ser lo mismo que "Bun como gestor". Comportamiento esperado: documentar qué versión de Node se necesita y si el servidor corre en Bun o en Node.
- El driver `drizzle-orm/bun-sql` solo figura con el tag `@rc` (1.0 RC); en estable 0.45 el driver documentado es `pg`/node-postgres. Esperado: decisión explícita, no implícita.
- El adaptador de Better Auth para Drizzle declara `drizzle-orm ^0.45.2 || >=1.0.0-rc.1 <2.0.0`; Esperado: la versión elegida de Drizzle cae dentro de ese rango.
- Better Auth tiene varias líneas (1.6.x, 1.7.x) y el adaptador es un paquete aparte (`@better-auth/drizzle-adapter`) o `better-auth/adapters/drizzle` según versión. Esperado: la ruta de import queda registrada.
- Versiones "latest" de Context7 pueden ir por detrás o delante del registro. Esperado: el número final sale del registro y se fija exacto (sin `^`) en el ADR.

---

### Task 1: Verificar versiones vigentes y requisitos

**Files:**
- Create: `C:\Users\jesus\AppData\Local\Temp\claude\f11277bb7bb1d9fd\4179b91d-cbd8-482c-a3a1-30f74b87dddb\scratchpad\pen11-evidencia.md` (notas, no se commitea)

**Interfaces:**
- Produces: tabla `paquete → versión estable exacta → peerDependencies → fuente` que consumen las Tasks 2 y 3.

- [ ] **Step 1:** Ejecutar `bun --version` y `node --version` y anotar lo instalado en la máquina.
- [ ] **Step 2:** Por cada paquete (`astro`, `@astrojs/react`, `@astrojs/node`, `react`, `react-dom`, `drizzle-orm`, `drizzle-kit`, `better-auth`, `@better-auth/drizzle-adapter`, `pg`) ejecutar `bun pm view <paquete> version dist-tags peerDependencies engines` y anotar la salida.
- [ ] **Step 3:** Consultar Context7 (`/websites/astro_build_en`, `/better-auth/better-auth`, `/drizzle-team/drizzle-orm-docs`, `/oven-sh/bun`) para: requisitos de Node en Astro, peers de `@astrojs/react`, ruta de import del adaptador Drizzle en Better Auth, y plugin Admin (`better-auth/plugins` → `admin`). Anotar la fuente de cada dato.
- [ ] **Step 4:** Verificar: cada fila de la tabla tiene versión exacta y fuente. Cualquier celda vacía se resuelve antes de seguir.

### Task 2: Prueba de compatibilidad en proyecto desechable

**Files:**
- Create: `C:\Users\jesus\AppData\Local\Temp\claude\f11277bb7bb1d9fd\4179b91d-cbd8-482c-a3a1-30f74b87dddb\scratchpad\pen11-smoke\` (fuera del repo; se descarta)

**Interfaces:**
- Consumes: tabla de la Task 1.
- Produces: resultado pasa/falla por cada par: Astro+React, Astro+adaptador servidor bajo Bun, Drizzle+PostgreSQL con el driver candidato, Better Auth+Drizzle+Admin.

- [ ] **Step 1:** En el directorio smoke, `bun add` con las versiones exactas de la Task 1 y confirmar que la instalación no emite advertencias de peer dependencies.
- [ ] **Step 2:** Astro + React: una página con una island React (`client:load`) y `output: 'server'` con el adaptador Node en modo `standalone` (fuente: Context7). Ejecutar `bun run astro build` y esperar salida sin errores.
- [ ] **Step 3:** Arrancar el build con `bun ./dist/server/entry.mjs` y comprobar con `curl` que responde 200. Si falla, repetir con `node` y registrar cuál runtime funciona.
- [ ] **Step 4:** Drizzle: con un PostgreSQL de prueba (contenedor Docker desechable) conectar con `drizzle-orm/node-postgres` y, por separado, con `drizzle-orm/bun-sql`; ejecutar un `select 1`. Registrar qué driver funciona con qué versión de `drizzle-orm`.
- [ ] **Step 5:** Better Auth: configurar `betterAuth` con el adaptador Drizzle (`provider: "pg"`) y el plugin Admin, montar el handler en `src/pages/api/auth/[...all].ts` (patrón de Context7) y generar el esquema con la CLI de Better Auth. Esperado: el esquema se genera y `GET /api/auth/ok` responde.
- [ ] **Step 6:** Anotar en el archivo de evidencia el resultado de cada paso; sin un "pasa" explícito la combinación no se propone.

### Task 3: Acordar versiones con el responsable (puerta de decisión)

**Interfaces:**
- Consumes: evidencia de las Tasks 1 y 2.
- Produces: lista de versiones aprobadas y driver elegido; sin ella no se ejecuta la Task 4.

- [ ] **Step 1:** Presentar al usuario una tabla con versión propuesta, motivo y riesgo, resaltando las decisiones abiertas: (a) Drizzle estable 0.45.x con `pg` vs 1.0 RC con `bun-sql`; (b) runtime del servidor (Bun o Node) y versión mínima de Node; (c) línea de Better Auth.
- [ ] **Step 2:** Obtener aprobación explícita (AskUserQuestion). Si el usuario cambia algo, repetir la prueba de la Task 2 solo para lo cambiado.

### Task 4: Actualizar la documentación

**Files:**
- Modify: `docs/05-decisiones/11-decisions-and-risks.md` (tabla de ADR tras la fila ADR-014; añadir `ADR-015 | Versiones de Bun, Astro, React, Drizzle y Better Auth | Confirmada`; incluir el detalle con la plantilla ADR del propio archivo: contexto, decisión, alternativas, consecuencias, fecha 2026-11-22)
- Modify: `docs/05-decisiones/pendientes.md:26` (eliminar la fila PEN-11)
- Modify: `docs/04-ingenieria/09-development-guide.md:3-4` (sección Requisitos: tabla con las versiones exactas, versión mínima de Node si aplica, y driver de BD)
- Modify: `docs/00-estado.md` (fecha de última actualización y "Siguiente paso sugerido": quitar la mención a PEN-11)

**Interfaces:**
- Consumes: versiones aprobadas de la Task 3.

- [ ] **Step 1:** Editar los cuatro archivos con la herramienta Edit, copiando las versiones exactas aprobadas (nunca con `^` ni `latest`).
- [ ] **Step 2:** Verificar con `grep -rn "PEN-11" docs` que solo queda la referencia histórica en el ADR y ninguna en `pendientes.md` ni `00-estado.md`.
- [ ] **Step 3:** Verificar que cada versión citada en el ADR coincide letra por letra con la de `09-development-guide.md`.
- [ ] **Step 4:** Commit:

```bash
git add docs/05-decisiones docs/04-ingenieria docs/00-estado.md
git commit -m "docs: resolver PEN-11 y registrar ADR-015 de versiones"
```

### Task 5: Cierre de la issue

- [ ] **Step 1:** Comprobar el criterio de aceptación de la issue: PEN-11 cerrado, ADR registrado y versiones documentadas.
- [ ] **Step 2:** Pedir confirmación al usuario antes de hacer `git push` y de cerrar la issue (acción visible hacia afuera). Tras su visto bueno: `git push` y `gh issue close 1 --comment "Resuelto en <hash>; ver ADR-015."`.

---

## Autorrevisión

- Cubre las 5 tareas de la issue: consulta de docs (T1), compatibilidad (T2), acuerdo (T3), PEN-11 + ADR + guía (T4); el cierre queda en T5.
- Sin código de producto asumido: todo patrón de código proviene de Context7 y se valida en T2 antes de proponerse.
- Desviación a confirmar: la issue dice "marcar como resuelto", pero `pendientes.md` ordena borrar la fila; el plan sigue esa regla.
