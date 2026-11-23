# Issue #11 — README de arranque y cierre del hito H0 (diseño)

**Aprobado por el responsable en la conversación (2026-11-22): opción A para el estado de H0 y sin más preguntas.** Tamaño: cambio pequeño (solo documentación, sin código ni dependencias). Rama: `docs/h0-readme-cierre`, desde `dev`.

## Intención
Que cualquier integrante pueda clonar, instalar y ejecutar una prueba de salud local siguiendo solo el `README.md` (criterio de salida de H0), y que la documentación solo presente como ejecutable lo que existe.

## Metas
- `README.md` raíz: requisitos, instalación, entorno, `bun run test:health`, comandos habituales y enlaces a `docs/`.
- Guía de desarrollo y doc de pruebas con comandos reales y conteos reales (64 unitarias + 35 de integración = 99).
- Verificación desde un clon limpio en otra carpeta, documentada con exactitud.
- `docs/00-estado.md`: H0 = **"Completo en dev; cierre formal pendiente de integración a main"**, con resultados de la verificación y condiciones pendientes.

## No metas
Código, scripts, dependencias o `docker-compose`; afirmar que existen `db:migrate`, `admin:create`, `demo:seed` o PostgreSQL local; afirmar una verificación en otra máquina; marcar H0 como "Cerrado"; tocar rulesets.

## Anti-metas
Que el README prometa que `dev` funciona tras copiar `.env.example` sin más (el `AUTH_SECRET` de ejemplo se rechaza); que un comando futuro parezca ejecutable.

## Hechos verificados (2026-11-22)
- No existen `README.md`, `docker-compose` ni scripts `db:*`, `admin:create`, `demo:seed`.
- Conteos: unitarias 14+16+19+5+1+9 = 64; integración 9 (`api-errors`) + 6 (salud) + 14 (hook) + 6 (`validar-commits`) = 35.
- `test:health` construye y arranca la app con su propio entorno y no necesita `.env`; `dev`, `build` y `start` validan la configuración y sí lo necesitan; `AUTH_SECRET` de `.env.example` es un marcador rechazado.
- `docs/04-ingenieria/09-development-guide.md` presenta como "Inicio recomendado" `docker compose up -d`, `db:migrate` y `admin:create`, que no existen.

## Decisiones tomadas (del responsable)
- Estado de H0: "Completo en dev; cierre formal pendiente de integración a main"; pasa a "Cerrado" con un commit de documentación solo tras `dev → main` y la CI de `main` (jobs `verificar` y `commits`) en verde.
- Documentar comandos futuros solo como pendientes; verificar en clon limpio en otra carpeta sin afirmar otra máquina.

## Decisiones mías (a revisar)
- Para generar `AUTH_SECRET` el README usa un comando de Bun (`bun -e`), no `openssl`, porque no hay garantía de que exista; se verifica que funcione.
- Los conteos se actualizan a las cifras reales (no se eliminan), siguiendo el estilo actual de la guía.
- La sección "Estado" de `CLAUDE.md` se actualiza con una línea (CI y README), porque resume el estado del proyecto y quedó atrasada desde la issue #10.
- Las filas de la tabla de versiones de la guía que aún no están instaladas (Drizzle, Better Auth, `pg`, PostgreSQL) se marcan con una nota, sin quitarlas (son las versiones validadas de ADR-015).

## Enfoques
1. **README breve que enlaza a la guía (elegido):** una sola fuente de detalle (la guía) y un README que lleva de cero a la prueba de salud.
2. **README completo que duplica la guía:** más autocontenido, pero dos fuentes que se desfasan.

## A cargo del constructor
Redacción del README y de las notas; verificación literal de los pasos del README en el clon limpio.
