# TravelTech

Plataforma para una sola agencia de viajes: catálogo, salidas, reservaciones, pagos, boletos QR, abordaje y marketing. Tiene una experiencia privada (admin/operador) y una demo de visitantes de solo lectura con datos ficticios.

**Estado:** el hito H0 (preparación y disciplina) está cerrado (ya integrado en `main`, con la CI en verde). H1 (plataforma y autenticación) está cerrado: existe PostgreSQL local con Docker Compose. Hay Drizzle para las migraciones (ADR-023), identidad con Better Auth (migración `0000_identidad`, `bun run admin:create`, handler `/api/auth/*`), `/login` y el área `/admin` protegida, pero todavía **no hay** lógica de negocio ni contenido funcional en el panel. Detalle en [docs/00-estado.md](docs/00-estado.md).

## Requisitos
- [Git](https://git-scm.com/)
- [Bun](https://bun.sh/) **1.4.4** (runtime y gestor de paquetes)
- [Node.js](https://nodejs.org/) `^22.23.4 || ^24.16.0 || >=26.3.0` (las CLI de Astro, ESLint y Prettier corren con Node; versión validada: 24.22.0)

- [Docker](https://www.docker.com/) con Compose, solo para la base de datos local (H1; no hace falta para `bun run test` ni `bun run test:health`).

## Instalación y prueba de salud
```bash
git clone https://github.com/LucianoOPM/traveler-web-app.git
cd traveler-web-app
bun install
bun run test:health
```
- Para una instalación estrictamente reproducible, use `bun install --frozen-lockfile` (es lo que hace la CI).
- `bun run test:health` construye la aplicación, la arranca y comprueba `GET /api/health`. **No necesita `.env`**, PostgreSQL ni servicios externos. Genera el `dist/` de la raíz (ignorado por Git).
- Todas las pruebas: `bun run test`.

## Configuración del entorno
`bun run dev`, `bun run build` y `bun run start` **sí necesitan una configuración válida** y fallan a propósito si falta o es inválida. Los mensajes nombran la variable y la regla, nunca el valor.

1. Copiar la plantilla:
   - Bash: `cp .env.example .env`
   - PowerShell: `Copy-Item .env.example .env`
2. **Reemplazar `AUTH_SECRET`**: el valor de ejemplo es un marcador y se rechaza. Genere uno de al menos 32 caracteres:
   ```bash
   bun -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
   ```
   Pegue el resultado como valor de `AUTH_SECRET` en `.env`.
3. `bun run dev` sirve en `http://localhost:4321/`.

`.env` está ignorado por Git: no lo suba ni comparta secretos.

## Base de datos local
PostgreSQL corre en Docker solo para desarrollo (imagen `postgres:17.10-alpine`, puerto publicado únicamente en `127.0.0.1:5432`). Con el `.env` ya creado:
```bash
docker compose up -d --wait   # arranca y espera a que las tres bases existan
docker compose down           # detiene; conserva los datos (volumen persistente)
docker compose down -v        # detiene y BORRA todos los datos locales
```
- Crea `traveltech_private`, `traveltech_demo` y `traveltech_test`.
- **`POSTGRES_PASSWORD` (solo para Compose) debe coincidir con la contraseña de las URLs** de `DATABASE_URL` y `DEMO_DATABASE_URL`; sin ella, Compose se niega a arrancar.
- El script de inicialización solo corre con el volumen vacío: para añadir una base a una instalación existente hay que recrear el volumen con `down -v`.
- `TEST_DATABASE_URL` es opcional y está comentada en `.env.example`: apunta a `traveltech_test` y la usarán las pruebas con PostgreSQL.
- Más detalles y solución de problemas: [guía de desarrollo](docs/04-ingenieria/09-development-guide.md).

## Comandos disponibles
| Comando | Qué hace |
|---|---|
| `bun run dev` | Servidor de desarrollo (requiere `.env` válido) |
| `bun run build` | Compila la aplicación (requiere configuración válida) |
| `bun run start` | Sirve el build de producción; valida la configuración antes de escuchar |
| `bun run check` | Comprueba tipos con `astro check` |
| `bun run lint` | ESLint (cualquier advertencia es un fallo) |
| `bun run format` / `bun run format:check` | Prettier: reescribe / comprueba |
| `bun run test` | Pruebas unitarias y de integración |
| `bun run test:health` | Prueba de salud local |
| `bun run db:generate` | Genera migraciones con `drizzle-kit` a partir del esquema |
| `bun run db:migrate` / `bun run db:migrate:demo` | `drizzle-kit migrate` sobre la base privada / la demo |
| `bun run admin:create` | Crea el administrador inicial en la base privada (contraseña interactiva; no uses `--password`) |

**Aún no existe** `demo:seed` (se creará en H6). Lista completa y notas: [guía de desarrollo](docs/04-ingenieria/09-development-guide.md).

## Cómo trabajar
- Ramas: `main` es la de despliegue y `dev` la de desarrollo. Las ramas de trabajo (`feat/`, `fix/`, `chore/`, `docs/`) salen de `dev` y vuelven por PR.
- Commits en [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...) como recomendación; no hay validación automática.
- La CI (GitHub Actions) ejecuta formato, lint, tipos, pruebas y build. El check `verificar` es obligatorio para fusionar en `dev` y `main`.

## Documentación
Índice por tarea en [docs/README.md](docs/README.md). Lo que aún no está decidido está en [docs/05-decisiones/pendientes.md](docs/05-decisiones/pendientes.md).
