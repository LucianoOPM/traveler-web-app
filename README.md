# TravelTech

Plataforma para una sola agencia de viajes: catálogo, salidas, reservaciones, pagos, boletos QR, abordaje y marketing. Tiene una experiencia privada (admin/operador) y una demo de visitantes de solo lectura con datos ficticios.

**Estado:** el hito H0 (preparación y disciplina) está completo en `dev`; el cierre formal queda pendiente de integrar a `main`. Todavía **no hay** lógica de negocio, base de datos ni autenticación. Detalle en [docs/00-estado.md](docs/00-estado.md).

## Requisitos
- [Git](https://git-scm.com/)
- [Bun](https://bun.sh/) **1.4.4** (runtime y gestor de paquetes)
- [Node.js](https://nodejs.org/) `^22.23.4 || ^24.16.0 || >=26.3.0` (las CLI de Astro, ESLint y Prettier corren con Node; versión validada: 24.22.0)

Docker y PostgreSQL **aún no se usan**: llegan con el hito H1.

## Instalación y prueba de salud
```bash
git clone https://github.com/LucianoOPM/traveler-web-app.git
cd traveler-web-app
bun install
bun run test:health
```
- `bun install` también activa el hook local de commits (`core.hooksPath=.githooks`). Para una instalación estrictamente reproducible, use `bun install --frozen-lockfile` (es lo que hace la CI).
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

**Aún no existen** `db:migrate`, `admin:create` ni `demo:seed` (se crearán en H1 y H6). Lista completa y notas: [guía de desarrollo](docs/04-ingenieria/09-development-guide.md).

## Cómo trabajar
- Ramas: `main` es la de despliegue y `dev` la de desarrollo. Las ramas de trabajo (`feat/`, `fix/`, `chore/`, `docs/`) salen de `dev` y vuelven por PR.
- Commits en [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...); el hook local los valida.
- La CI (GitHub Actions) ejecuta formato, lint, tipos, pruebas y build, y valida los commits de cada PR. Ambos checks (`verificar` y `commits`) son obligatorios para fusionar en `dev` y `main`.

## Documentación
Índice por tarea en [docs/README.md](docs/README.md). Lo que aún no está decidido está en [docs/05-decisiones/pendientes.md](docs/05-decisiones/pendientes.md).
