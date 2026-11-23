import type { SQL } from "bun";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import path from "node:path";
import { recrearEsquema } from "./base-de-pruebas";
import {
  construirAstro,
  esperarRespuesta,
  lanzar,
  puertoLibre,
  type ProcesoPrueba,
} from "./servidor";

const raiz = path.resolve(import.meta.dir, "../..");

/** `APP_ORIGIN` de la app de prueba: Better Auth rechaza peticiones con otro `Origin`. */
export const ORIGEN = "http://localhost:4321";
export const CONTRASENA = "Contrasena-de-prueba-1";

/**
 * Deja `traveltech_test` migrada, crea los usuarios con `bun run admin:create`, construye la app
 * REAL en modo producción (con el límite de intentos de Better Auth activo) y la arranca contra esa
 * base. Genera el `dist/` de la raíz: no ejecutar a la vez que otras pruebas que construyan.
 */
export async function prepararAplicacion(
  sql: SQL,
  db: BunSQLDatabase<Record<string, unknown>>,
  usuarios: Array<{ correo: string; rol: string }>,
) {
  await recrearEsquema(sql); // comprueba que la base es traveltech_test antes de borrar nada
  await migrate(db, { migrationsFolder: "./src/db/migrations" });

  const urlBase = process.env.TEST_DATABASE_URL!;
  const puerto = await puertoLibre();
  const demo = new URL(urlBase);
  demo.pathname = "/traveltech_demo"; // otra base: la configuración exige que difieran
  const entorno = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: urlBase,
    DEMO_DATABASE_URL: demo.toString(),
    AUTH_SECRET: "ci-auth-secret-ficticio-solo-para-ci-0123456789",
    APP_ORIGIN: ORIGEN,
    PRIVATE_STORAGE_DIR: "./storage/private",
    DEMO_STORAGE_DIR: "./storage/demo",
    AGENCY_TIMEZONE: "America/Mexico_City",
    HOST: "127.0.0.1",
    PORT: String(puerto),
  };

  for (const { correo, rol } of usuarios) {
    const crear = lanzar(
      [
        process.execPath,
        "run",
        "admin:create",
        "--email",
        correo,
        "--password",
        CONTRASENA,
        "--role",
        rol,
        "--yes",
      ],
      { cwd: raiz, env: entorno },
    );
    const codigo = await crear.salio;
    if (codigo !== 0) throw new Error(`admin:create falló para ${correo}:\n${crear.salida()}`);
  }

  const procesos: ProcesoPrueba[] = [];
  await construirAstro({ cwd: raiz, env: entorno, registrar: (p) => procesos.push(p) });
  procesos.push(lanzar([process.execPath, "scripts/start.ts"], { cwd: raiz, env: entorno }));
  const origen = `http://127.0.0.1:${puerto}`;
  await esperarRespuesta(`${origen}/api/health`);

  return { origen, detener: () => Promise.all(procesos.map((p) => p.detener())) };
}
