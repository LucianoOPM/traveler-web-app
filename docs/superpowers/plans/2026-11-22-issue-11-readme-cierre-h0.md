# Issue #11 — README de arranque y cierre del hito H0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (el responsable pidió ejecución sin más preguntas). Steps use checkbox (`- [ ]`) syntax.

**Goal:** README raíz y documentación con solo comandos reales, verificados desde un clon limpio, y H0 registrado como "Completo en dev; cierre formal pendiente de integración a main".

**Architecture:** Solo documentación. El README lleva de cero a `bun run test:health` y enlaza a la guía; la verificación se hace siguiendo literalmente el README en un clon limpio.

**Tech Stack:** Markdown, Bun 1.4.4, Git. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-22-issue-11-readme-cierre-h0-design.md`

## Global Constraints
- Solo documentación: sin código, scripts, dependencias ni `docker-compose`.
- Presentar como ejecutable únicamente lo que existe; `db:migrate`, `admin:create`, `demo:seed`, Docker y PostgreSQL local solo como pendientes.
- No afirmar verificación en otra máquina; no marcar H0 como "Cerrado".
- Conteos reales: 64 unitarias, 35 de integración, 99 en total.
- Sin Python; Node/Bun/bash. Commits en Conventional Commits; prosa en español.
- No tocar los rulesets; no hacer `git push` ni abrir PR sin la autorización explícita del responsable para esta issue (punto de parada de la Task 4).

## Review Focus
1. El README seguido literalmente desde un clon limpio funciona (instalación congelada y `test:health` sin `.env`).
2. Copiar `.env.example` sin reemplazar `AUTH_SECRET` hace fallar `dev`/`start`; el README lo dice y el comando para generarlo funciona.
3. Ningún comando inexistente aparece como paso ejecutable en README, guía o estado.
4. El estado no dice "Cerrado" ni afirma verificación en otra máquina.

---

### Task 1: README.md
**Files:** Create `README.md`.
- [ ] **Step 1:** Escribir `README.md` con: qué es el proyecto (una frase, enlazando `docs/README.md`); requisitos (Git, Bun 1.4.4, Node `^22.23.4 || ^24.16.0 || >=26.3.0`; Docker/PostgreSQL aún no se usan); pasos: clonar, `bun install` (también instala el hook de commits), `bun run test:health` (no necesita `.env`); entorno (`.env.example` → `.env`, reemplazar `AUTH_SECRET` con el comando de Bun, necesario para `dev`/`build`/`start`); tabla breve de comandos reales (`dev`, `build`, `start`, `check`, `lint`, `format`, `format:check`, `test`); "Aún no existe" (`db:migrate`, `admin:create`, `demo:seed`, base de datos, autenticación); flujo de ramas/commits/CI en pocas líneas con enlaces; enlaces a estado y guía.
- [ ] **Step 2:** Verificar que el comando de generación de `AUTH_SECRET` produce ≥ 32 caracteres. Expected: longitud ≥ 32.

### Task 2: Guía de desarrollo y doc de pruebas
**Files:** Modify `docs/04-ingenieria/09-development-guide.md`, `docs/04-ingenieria/10-testing-and-quality.md`.
- [ ] **Step 1 (guía):** "Requisitos": decir que hoy hacen falta Git, Bun y Node y que Docker/PostgreSQL llegan con H1; nota tras la tabla de versiones: las filas de Drizzle, drizzle-kit, pg, Better Auth y PostgreSQL son versiones validadas (ADR-015) **aún no instaladas**.
- [ ] **Step 2 (guía):** Reemplazar "Inicio recomendado (comandos orientativos)" por "Inicio rápido" con los pasos reales (los del README) y una subsección "Pendiente (no existe todavía)" con `docker compose up -d`, `db:migrate`, `admin:create`, `demo:seed`, marcados como no funcionales; actualizar las cifras de `test`, `test:unit` y `test:integration` (64, 35, 99; integración: 9 + 6 + 14 + 6 de `validar-commits`).
- [ ] **Step 3 (pruebas):** Actualizar las cifras de `10-testing-and-quality.md` (64, 35, 99) e incluir las 6 de `validar-commits` en la descripción de integración.
- [ ] **Step 4:** Run `git grep -nE "\b(84|55)\b.*(pruebas|unitarias)|29 (pruebas|de integración)" -- docs ':!docs/superpowers' ':!docs/05-decisiones'`. Expected: sin resultados.
- [ ] **Step 5: Commit** `docs(h0): añadir README de arranque y alinear la guía con los comandos reales`.

### Task 3: Verificación en clon limpio
**Files:** ninguno (la salida se documenta en la Task 4).
- [ ] **Step 1:** Clonar la rama (commit de la Task 2) en una carpeta nueva y seguir el README literalmente, con entorno saneado y sin `.env`: `bun install --frozen-lockfile` (`bun.lock` intacto, hook instalado), `bun run test:health` (6 pruebas) y `bun run test` (99 pruebas); anotar duraciones. Expected: exit 0 y `git status` limpio.
- [ ] **Step 2:** Comprobar el flujo de entorno: sin reemplazar el marcador, `bun run build` falla con un error que nombra `AUTH_SECRET` sin mostrar su valor; tras copiar `.env.example` y reemplazar `AUTH_SECRET` con el comando del README, `bun run build` termina bien y `GET /` y `GET /api/health` responden 200 con `bun run start` y con `bun run dev` (puerto libre, usando `tests/support/servidor.ts` para lanzar y detener). Expected: según lo descrito.
- [ ] **Step 3:** Limpiar el clon y los procesos.

### Task 4: Estado, CLAUDE.md, ledger y PR
**Files:** Modify `docs/00-estado.md`, `CLAUDE.md`.
- [ ] **Step 1 (estado):** Fecha; H0 = "Completo en dev; cierre formal pendiente de integración a main" (issue #11 incluida); resultados exactos de la verificación (qué se probó, dónde: otra carpeta de esta máquina, y la limitación: no se probó en otra máquina ni en un navegador); condiciones pendientes: PR `dev → main` y CI de `main` en verde (`verificar` y `commits`), tras lo cual se marca "Cerrado" con un commit de documentación; "Siguiente paso": integración a main y luego H1. Ajustar el resumen (README).
- [ ] **Step 2 (CLAUDE.md):** En "Estado", añadir una línea sobre CI y README.
- [ ] **Step 3:** `bun run format:check && bun run lint && bun run check && bun run test`. Expected: exit 0.
- [ ] **Step 4: Commit** `docs(h0): registrar el estado de H0 y la verificación en clon limpio`; commitear también spec y plan.
- [ ] **Step 5:** **PUNTO DE PARADA:** pedir al responsable autorización para `git push` y abrir el PR hacia `dev`. Con ella: push, PR (`Closes #11`) y comprobar `verificar` y `commits` en verde. No fusionar.

## Criterios de aceptación
- Entregables de la issue #11 completos y verificaciones locales satisfactorias.
- H0 **no** "Cerrado": pendiente de `dev → main` y de la CI en `main`; luego, commit de documentación a "Cerrado".
