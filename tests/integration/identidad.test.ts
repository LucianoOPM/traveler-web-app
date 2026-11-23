import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();
const TABLAS = ["account", "session", "user", "verification"];

// Igual que base-de-pruebas.test.ts: en local se omite sin TEST_DATABASE_URL; en CI falla si falta.
// 0001_catalogo vive en la misma base: cada consulta se limita a las tablas de identidad.
describe.skipIf(!base && !process.env.CI)("esquema de identidad en traveltech_test", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  });
  afterAll(() => sql.close());

  test("existen las cuatro tablas de Better Auth", async () => {
    const filas = await sql`select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('account', 'session', 'user', 'verification') order by table_name`;
    expect(filas.map((f: { table_name: string }) => f.table_name)).toEqual(TABLAS);
  });

  test("los id son uuid y todas las fechas son timestamptz", async () => {
    const columnas: Array<{ table_name: string; column_name: string; data_type: string }> =
      await sql`select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name in ('account', 'session', 'user', 'verification')`;
    const tipos = (esFecha: boolean) =>
      new Set(
        columnas
          .filter((c) =>
            esFecha
              ? c.column_name.endsWith("_at") || c.column_name === "ban_expires"
              : c.column_name === "id",
          )
          .map((c) => c.data_type),
      );
    expect(tipos(false)).toEqual(new Set(["uuid"]));
    expect(tipos(true)).toEqual(new Set(["timestamp with time zone"]));
  });

  test("claves foráneas a user con borrado en cascada", async () => {
    const fks: Array<{ tabla: string; columna: string; destino: string; borrado: string }> =
      await sql`
      select c.conrelid::regclass::text as tabla, a.attname as columna,
             c.confrelid::regclass::text as destino, c.confdeltype as borrado
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.conrelid::regclass::text in ('account', 'session', '"user"', 'verification') order by 1`;
    expect(fks).toEqual([
      { tabla: "account", columna: "user_id", destino: '"user"', borrado: "c" },
      { tabla: "session", columna: "user_id", destino: '"user"', borrado: "c" },
    ]);
  });

  test("únicos (email, token) e índices de Better Auth", async () => {
    const unicos = await sql`select conname from pg_constraint
      where contype = 'u' and connamespace = 'public'::regnamespace
        and conrelid::regclass::text in ('account', 'session', '"user"', 'verification') order by 1`;
    expect(unicos.map((f: { conname: string }) => f.conname)).toEqual([
      "session_token_unique",
      "user_email_unique",
    ]);
    const indices = await sql`select indexname from pg_indexes
      where schemaname = 'public' and indexname like '%\\_idx'
        and tablename in ('account', 'session', 'user', 'verification') order by 1`;
    expect(indices.map((f: { indexname: string }) => f.indexname)).toEqual([
      "account_userId_idx",
      "session_userId_idx",
      "verification_identifier_idx",
    ]);
  });

  test("el id de user se genera como uuid", async () => {
    const [fila] = await sql`insert into "user" (name, email, created_at, updated_at)
      values ('Prueba', 'prueba@example.test', now(), now()) returning id`;
    expect(fila.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
