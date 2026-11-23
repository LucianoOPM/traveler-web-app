import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();
const TABLAS = ["boarding_points", "departure_boarding_points", "departures", "packages"];

// Igual que identidad.test.ts: en local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("esquema del catálogo en traveltech_test", () => {
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

  const nuevoPaquete = async (estado = "borrador") => {
    const [p] = await sql`insert into packages (name, summary, description, status)
      values ('Paquete', 'Resumen', 'Descripción', ${estado}) returning id`;
    return p.id as string;
  };
  // Salida válida por defecto; `cambios` pisa columnas para probar cada restricción.
  const nuevaSalida = async (paquete: string, cambios: Record<string, unknown> = {}) => {
    const d = {
      starts_at: "2027-01-10T10:00:00Z",
      ends_at: "2027-01-12T10:00:00Z",
      capacity: 40,
      adult_price_cents: 150000,
      child_price_cents: 100000,
      infant_price_cents: 0,
      status: "borrador",
      ...cambios,
    };
    const [s] = await sql`insert into departures
      (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents, infant_price_cents, status)
      values (${paquete}, ${d.starts_at}, ${d.ends_at}, ${d.capacity}, ${d.adult_price_cents},
              ${d.child_price_cents}, ${d.infant_price_cents}, ${d.status}) returning id`;
    return s.id as string;
  };

  test("existen las cuatro tablas del catálogo", async () => {
    const filas = await sql`select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('boarding_points', 'departure_boarding_points', 'departures', 'packages')
      order by table_name`;
    expect(filas.map((f: { table_name: string }) => f.table_name)).toEqual(TABLAS);
  });

  test("tipos: id uuid, fechas timestamptz, tarifas y capacidad enteros", async () => {
    const cols: Array<{ table_name: string; column_name: string; data_type: string }> =
      await sql`select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public'
          and table_name in ('boarding_points', 'departure_boarding_points', 'departures', 'packages')`;
    const tipo = (t: string, c: string) =>
      cols.find((x) => x.table_name === t && x.column_name === c)?.data_type;
    for (const t of ["packages", "departures", "boarding_points"])
      expect(tipo(t, "id")).toBe("uuid");
    expect(tipo("departures", "package_id")).toBe("uuid");
    expect(tipo("departure_boarding_points", "departure_id")).toBe("uuid");
    expect(tipo("departure_boarding_points", "boarding_point_id")).toBe("uuid");
    for (const c of ["starts_at", "ends_at", "created_at", "updated_at"])
      expect(tipo("departures", c)).toBe("timestamp with time zone");
    for (const c of ["capacity", "adult_price_cents", "child_price_cents", "infant_price_cents"])
      expect(tipo("departures", c)).toBe("integer");
  });

  test("claves foráneas: restrict en paquete y punto, cascade en salida", async () => {
    const fks: Array<{ tabla: string; columna: string; destino: string; borrado: string }> =
      await sql`select c.conrelid::regclass::text as tabla, a.attname as columna,
             c.confrelid::regclass::text as destino, c.confdeltype as borrado
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.conrelid::regclass::text in ('departures', 'departure_boarding_points')
      order by 1, 2`;
    expect(fks).toEqual([
      {
        tabla: "departure_boarding_points",
        columna: "boarding_point_id",
        destino: "boarding_points",
        borrado: "r",
      },
      {
        tabla: "departure_boarding_points",
        columna: "departure_id",
        destino: "departures",
        borrado: "c",
      },
      { tabla: "departures", columna: "package_id", destino: "packages", borrado: "r" },
    ]);
  });

  test("únicos, clave de la relación N:M e índice de salidas", async () => {
    const unicos = await sql`select conname from pg_constraint
      where contype = 'u' and conrelid::regclass::text = 'boarding_points'`;
    expect(unicos.map((f: { conname: string }) => f.conname)).toEqual([
      "boarding_points_name_unique",
    ]);
    const columnas = await sql`select a.attname as columna
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'p' and c.conrelid::regclass::text = 'departure_boarding_points'
      order by 1`;
    expect(columnas.map((f: { columna: string }) => f.columna)).toEqual([
      "boarding_point_id",
      "departure_id",
    ]);
    const [idx] = await sql`select indexdef from pg_indexes
      where indexname = 'departures_package_id_starts_at_idx'`;
    expect(idx.indexdef).toContain("(package_id, starts_at)");
  });

  test("acepta datos válidos y los estados por defecto son borrador", async () => {
    const paquete = await nuevoPaquete();
    const salida = await nuevaSalida(paquete, { capacity: 0 });
    const [fila] = await sql`select p.status as paquete, d.status as salida
      from departures d join packages p on p.id = d.package_id where d.id = ${salida}`;
    expect(fila).toEqual({ paquete: "borrador", salida: "borrador" });
  });

  test("rechaza capacidad negativa", async () => {
    const paquete = await nuevoPaquete();
    await expect(nuevaSalida(paquete, { capacity: -1 })).rejects.toThrow(
      /departures_capacity_check/,
    );
  });

  test.each(["adult_price_cents", "child_price_cents", "infant_price_cents"])(
    "rechaza %s negativa",
    async (columna) => {
      const paquete = await nuevoPaquete();
      await expect(nuevaSalida(paquete, { [columna]: -1 })).rejects.toThrow(
        /departures_prices_check/,
      );
    },
  );

  test("rechaza ends_at anterior o igual a starts_at", async () => {
    const paquete = await nuevoPaquete();
    await expect(
      nuevaSalida(paquete, { starts_at: "2027-01-12T10:00:00Z", ends_at: "2027-01-10T10:00:00Z" }),
    ).rejects.toThrow(/departures_dates_check/);
    await expect(
      nuevaSalida(paquete, { starts_at: "2027-01-10T10:00:00Z", ends_at: "2027-01-10T10:00:00Z" }),
    ).rejects.toThrow(/departures_dates_check/);
  });

  test("rechaza estados inexistentes (los de H5 aún no existen)", async () => {
    await expect(nuevoPaquete("eliminado")).rejects.toThrow(/packages_status_check/);
    const paquete = await nuevoPaquete();
    for (const estado of ["eliminada", "publicado", "en_abordaje", "finalizada"])
      await expect(nuevaSalida(paquete, { status: estado })).rejects.toThrow(
        /departures_status_check/,
      );
    await nuevaSalida(paquete, { status: "publicada" });
    await nuevaSalida(paquete, { status: "cancelada" });
  });

  test("no se borra un paquete con salidas (restrict)", async () => {
    const paquete = await nuevoPaquete("publicado");
    await nuevaSalida(paquete);
    await expect(sql`delete from packages where id = ${paquete}`).rejects.toThrow(
      /departures_package_id_packages_id_fk/,
    );
  });

  test("punto de abordaje: nombre único, pareja única y borrados", async () => {
    const paquete = await nuevoPaquete();
    const salida = await nuevaSalida(paquete);
    const [punto] =
      await sql`insert into boarding_points (name) values ('Terminal Norte') returning id`;
    await expect(sql`insert into boarding_points (name) values ('Terminal Norte')`).rejects.toThrow(
      /boarding_points_name_unique/,
    );
    await sql`insert into departure_boarding_points (departure_id, boarding_point_id)
      values (${salida}, ${punto.id})`;
    await expect(
      sql`insert into departure_boarding_points (departure_id, boarding_point_id)
        values (${salida}, ${punto.id})`,
    ).rejects.toThrow(/departure_boarding_points_departure_id_boarding_point_id_pk/);
    await expect(sql`delete from boarding_points where id = ${punto.id}`).rejects.toThrow(
      /departure_boarding_points_boarding_point_id_boarding_points_id_/,
    );
    await sql`delete from departures where id = ${salida}`;
    const [{ total }] = await sql`select count(*)::int as total from departure_boarding_points`;
    expect(total).toBe(0);
  });
});
