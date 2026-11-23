import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";
import { lanzar } from "../support/servidor";

const base = abrirBaseDePruebas();
const CONTRASENA = "Contrasena-de-prueba-1";

// Igual que identidad.test.ts: en local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("bun run admin:create", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    await recrearEsquema(sql); // comprueba que la base es traveltech_test antes de borrar nada
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  });
  afterAll(() => sql.close());

  test("crea un admin verificado con la contraseña solo como hash", async () => {
    // `auth.ts` lee DATABASE_URL: se apunta a la base de pruebas, nunca a la privada.
    const proceso = lanzar(
      [
        process.execPath,
        "run",
        "admin:create",
        "--email",
        "admin@example.test",
        "--password",
        CONTRASENA,
        "--yes",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          AUTH_SECRET: "ci-auth-secret-ficticio-solo-para-ci-0123456789",
          APP_ORIGIN: "http://localhost:4321",
        },
      },
    );
    expect(await proceso.salio, proceso.salida()).toBe(0);

    const [usuario] =
      await sql`select id, role, email_verified from "user" where email = 'admin@example.test'`;
    expect(usuario.role).toBe("admin");
    expect(usuario.email_verified).toBe(true);

    const [cuenta] =
      await sql`select provider_id, password from account where user_id = ${usuario.id}`;
    expect(cuenta.provider_id).toBe("credential");
    expect(cuenta.password).not.toContain(CONTRASENA);
    expect(cuenta.password.length).toBeGreaterThan(CONTRASENA.length);
  }, 60_000);
});
