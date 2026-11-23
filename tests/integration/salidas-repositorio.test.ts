import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { BoardingPointService } from "../../src/modules/catalog/application/boarding-point-service";
import { DepartureService } from "../../src/modules/catalog/application/departure-service";
import { DrizzleBoardingPointRepository } from "../../src/modules/catalog/infrastructure/drizzle-boarding-point-repository";
import { DrizzleDepartureRepository } from "../../src/modules/catalog/infrastructure/drizzle-departure-repository";
import { abrirBaseDePruebas, recrearEsquema } from "../support/base-de-pruebas";

const base = abrirBaseDePruebas();

const contenido = {
  startsAt: new Date("2027-01-10T10:00:00Z"),
  endsAt: new Date("2027-01-12T10:00:00Z"),
  capacity: 10,
  adultPriceCents: 150000,
  childPriceCents: 100000,
  infantPriceCents: 0,
};

// En local se omite sin TEST_DATABASE_URL; en CI falla si falta.
describe.skipIf(!base && !process.env.CI)("repositorio de salidas en traveltech_test", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  const repo = new DrizzleDepartureRepository(db);
  const salidas = new DepartureService(repo);
  const puntos = new BoardingPointService(new DrizzleBoardingPointRepository(db));
  let paquete = "";

  beforeAll(async () => {
    await recrearEsquema(sql);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  });
  beforeEach(async () => {
    await sql`delete from departures`;
    await sql`delete from boarding_points`;
    await sql`delete from packages`;
    [{ id: paquete }] = await sql`insert into packages (name, summary, description, status)
      values ('Cancún', 's', 'd', 'publicado') returning id`;
  });
  afterAll(() => sql.close());

  test("crea, edita, publica y cancela con las transiciones del dominio", async () => {
    const creada = await salidas.create({ packageId: paquete, ...contenido });
    expect(creada).toMatchObject({ status: "borrador", capacity: 10, infantPriceCents: 0 });
    expect(creada.startsAt.toISOString()).toBe("2027-01-10T10:00:00.000Z");

    expect((await salidas.edit(creada.id, { capacity: 20 })).capacity).toBe(20);
    expect((await salidas.publish(creada.id)).status).toBe("publicada");
    expect((await salidas.cancel(creada.id)).status).toBe("cancelada");
    expect(await salidas.availableSeats(creada.id)).toBe(20);
  });

  test("publicar con el paquete sin publicar da 422", async () => {
    await sql`update packages set status = 'archivado' where id = ${paquete}`;
    const { id } = await salidas.create({ packageId: paquete, ...contenido });
    await expect(salidas.publish(id)).rejects.toMatchObject({ status: 422 });
  });

  test("update y delete son condicionales por estado", async () => {
    const { id } = await repo.create({ packageId: paquete, ...contenido });
    expect(await repo.update(id, "publicada", { capacity: 1 })).toBeNull();
    expect(await repo.delete(id, "publicada")).toBe(false);
    expect((await repo.find(id))?.capacity).toBe(10);
    expect(await repo.update(id, "borrador", { capacity: 1 })).toMatchObject({ capacity: 1 });
    expect(await repo.delete(id, "borrador")).toBe(true);
    expect(await repo.find(id)).toBeNull();
  });

  test("la base rechaza lo que el servicio ya rechaza (CHECK)", async () => {
    const insertar = (inicio: string, fin: string, capacidad: number, tarifa: number) =>
      sql`insert into departures (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents, infant_price_cents)
        values (${paquete}, ${inicio}, ${fin}, ${capacidad}, ${tarifa}, 0, 0)`;
    const ok = ["2027-01-10T10:00:00Z", "2027-01-12T10:00:00Z"] as const;
    await expect(insertar(ok[1], ok[0], 10, 1)).rejects.toThrow(/departures_dates_check/);
    await expect(insertar(ok[0], ok[0], 10, 1)).rejects.toThrow(/departures_dates_check/);
    await expect(insertar(...ok, -1, 1)).rejects.toThrow(/departures_capacity_check/);
    await expect(insertar(...ok, 10, -1)).rejects.toThrow(/departures_prices_check/);
  });

  test("asignar dos veces el mismo punto da 409; un punto inexistente da 404", async () => {
    const { id } = await salidas.create({ packageId: paquete, ...contenido });
    const punto = await puntos.create("Terminal Norte");
    await salidas.assignBoardingPoint(id, punto.id);
    await expect(salidas.assignBoardingPoint(id, punto.id)).rejects.toMatchObject({ status: 409 });
    await expect(
      salidas.assignBoardingPoint(id, "5f1c1c0e-0000-4000-8000-0000000000ff"),
    ).rejects.toMatchObject({ status: 404 });
    expect(await sql`select 1 from departure_boarding_points`).toHaveLength(1);
    await salidas.removeBoardingPoint(id, punto.id);
    expect(await sql`select 1 from departure_boarding_points`).toHaveLength(0);
  });

  test("una cancelación concurrente impide asignar y quitar puntos (FOR UPDATE)", async () => {
    const { id } = await salidas.create({ packageId: paquete, ...contenido });
    await salidas.publish(id);
    const asignado = await puntos.create("Asignado");
    const nuevo = await puntos.create("Nuevo");
    await salidas.assignBoardingPoint(id, asignado.id);

    // Una transacción cancela la salida y la mantiene abierta; mientras tanto otra operación intenta
    // modificar los puntos. Debe esperar el bloqueo y, al verla cancelada, rechazar la escritura.
    let confirmar!: () => void;
    const espera = new Promise<void>((resolver) => (confirmar = resolver));
    let cancelada!: () => void;
    const yaCancelo = new Promise<void>((resolver) => (cancelada = resolver));
    const cancelando = sql.begin(async (tx) => {
      await tx`update departures set status = 'cancelada' where id = ${id}`;
      cancelada();
      await espera;
    });
    await yaCancelo;
    const asignando = repo.addBoardingPoint(id, nuevo.id);
    const quitando = repo.removeBoardingPoint(id, asignado.id);
    await Bun.sleep(150); // dan tiempo a que ambas queden esperando el bloqueo
    confirmar();
    await cancelando;

    expect(await asignando).toBe("cancelada");
    expect(await quitando).toBe("cancelada");
    const filas = await sql`select boarding_point_id from departure_boarding_points`;
    expect(filas.map((f: { boarding_point_id: string }) => f.boarding_point_id)).toEqual([
      asignado.id,
    ]);
  });

  test("listByPackage devuelve solo las salidas del paquete, por fecha, con sus puntos", async () => {
    const [{ id: otro }] = await sql`insert into packages (name, summary, description)
      values ('Otro', 's', 'd') returning id`;
    const tarde = await salidas.create({
      packageId: paquete,
      ...contenido,
      startsAt: new Date("2027-03-10T10:00:00Z"),
      endsAt: new Date("2027-03-12T10:00:00Z"),
    });
    const temprano = await salidas.create({ packageId: paquete, ...contenido });
    await salidas.create({ packageId: otro, ...contenido });
    const punto = await puntos.create("Terminal Norte");
    await salidas.assignBoardingPoint(temprano.id, punto.id);

    const lista = await salidas.listByPackage(paquete);
    expect(lista.map((s) => s.id)).toEqual([temprano.id, tarde.id]);
    expect(lista.map((s) => s.boardingPointIds)).toEqual([[punto.id], []]);
    expect(await salidas.listByPackage(crypto.randomUUID())).toEqual([]);
  });

  test("los puntos de abordaje se listan por nombre", async () => {
    await puntos.create("Terminal Sur");
    await puntos.create("Terminal Norte");
    expect((await puntos.list()).map((p) => p.name)).toEqual(["Terminal Norte", "Terminal Sur"]);
  });

  test("eliminar una salida borrador borra sus asignaciones (cascade)", async () => {
    const { id } = await salidas.create({ packageId: paquete, ...contenido });
    await salidas.assignBoardingPoint(id, (await puntos.create("Terminal Norte")).id);
    await salidas.delete(id);
    expect(await sql`select 1 from departure_boarding_points`).toHaveLength(0);
  });

  test("nombre de punto duplicado da 409; eliminar un punto asignado da 409", async () => {
    const punto = await puntos.create("Terminal Norte");
    await expect(puntos.create("Terminal Norte")).rejects.toMatchObject({ status: 409 });
    const otro = await puntos.create("Terminal Sur");
    await expect(puntos.edit(otro.id, "Terminal Norte")).rejects.toMatchObject({ status: 409 });

    const { id } = await salidas.create({ packageId: paquete, ...contenido });
    await salidas.assignBoardingPoint(id, punto.id);
    await expect(puntos.delete(punto.id)).rejects.toMatchObject({ status: 409 });
    expect(await sql`select 1 from boarding_points where id = ${punto.id}`).toHaveLength(1);

    await puntos.delete(otro.id);
  });
});
