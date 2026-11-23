import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { abrirBase } from "../../src/db/conexion";
import { CARPETA_MIGRACIONES } from "../../src/db/migraciones";
import { migrar } from "../../src/db/migrar";
import { RollbackError, revertirUltimaMigracion } from "../../src/db/rollback";
import { abrirBaseDePruebas, reiniciarEsquema, urlDePruebas } from "../support/base-de-pruebas";

const fixture = (caso: string) => path.resolve(import.meta.dir, "../fixtures/migraciones", caso);

describe.skipIf(!urlDePruebas())(
  "migraciones y rollback contra PostgreSQL (traveltech_test)",
  () => {
    // Los archivos con base de datos corren en serie (comportamiento por defecto de `bun test`).
    let sql: SQL;
    let db: ReturnType<typeof abrirBase>["db"];

    async function filasDeHistorial(): Promise<number> {
      const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      return n as number;
    }
    const existeTabla = async () =>
      (await sql`select to_regclass('public.prueba_h1') as t`)[0]!.t !== null;

    beforeAll(async () => {
      ({ sql, db } = await abrirBaseDePruebas());
    });

    beforeEach(async () => {
      await reiniciarEsquema(sql);
    });

    afterAll(async () => {
      await sql?.close();
    });

    test("migrar aplica la carpeta y registra una fila en el historial", async () => {
      expect(await migrar(db, fixture("reversible"))).toBe(1);
      expect(await existeTabla()).toBe(true);
      expect(await filasDeHistorial()).toBe(1);
    });

    test("ciclo: migrar → revertir → migrar de nuevo", async () => {
      await migrar(db, fixture("reversible"));
      const revertida = await revertirUltimaMigracion(sql, fixture("reversible"));
      expect(revertida).toEqual({ tag: "0000_prueba" });
      expect(await existeTabla()).toBe(false);
      expect(await filasDeHistorial()).toBe(0);

      await migrar(db, fixture("reversible"));
      expect(await existeTabla()).toBe(true);
      expect(await filasDeHistorial()).toBe(1);
    });

    test("una migración irreversible se rechaza sin tocar nada", async () => {
      await migrar(db, fixture("irreversible"));
      const error = await revertirUltimaMigracion(sql, fixture("irreversible")).catch((e) => e);
      expect(error).toBeInstanceOf(RollbackError);
      expect(error.message).toContain("IRREVERSIBLE");
      expect(error.message).toContain("ejemplo de migración que pierde datos");
      expect(await existeTabla()).toBe(true);
      expect(await filasDeHistorial()).toBe(1);
    });

    test("si el down falla a mitad no cambia la tabla ni el historial", async () => {
      await migrar(db, fixture("down-roto"));
      await expect(revertirUltimaMigracion(sql, fixture("down-roto"))).rejects.toThrow();
      expect(await existeTabla()).toBe(true);
      expect(await filasDeHistorial()).toBe(1);
    });

    test("si el .sql cambió desde que se aplicó, no se revierte", async () => {
      await migrar(db, fixture("reversible"));
      const copia = mkdtempSync(path.join(tmpdir(), "traveltech-fixture-"));
      try {
        cpSync(fixture("reversible"), copia, { recursive: true });
        appendFileSync(path.join(copia, "0000_prueba.sql"), "-- alterado\n");
        await expect(revertirUltimaMigracion(sql, copia)).rejects.toBeInstanceOf(RollbackError);
        expect(await existeTabla()).toBe(true);
        expect(await filasDeHistorial()).toBe(1);
      } finally {
        rmSync(copia, { recursive: true, force: true });
      }
    });

    test("sin migraciones aplicadas se rechaza", async () => {
      await expect(revertirUltimaMigracion(sql, fixture("reversible"))).rejects.toBeInstanceOf(
        RollbackError,
      );
    });

    test("con la carpeta real sin migraciones, migrar no hace nada", async () => {
      expect(await migrar(db, CARPETA_MIGRACIONES)).toBe(0);
      const [{ t }] = await sql`select to_regnamespace('drizzle') as t`;
      expect(t).toBeNull();
    });
  },
);
