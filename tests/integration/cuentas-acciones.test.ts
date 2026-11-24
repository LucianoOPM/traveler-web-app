import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { abrirBaseDePruebas } from "../support/base-de-pruebas";
import { CONTRASENA, ORIGEN, prepararAplicacion } from "../support/aplicacion";
import { CLABE, sembrarAsignacion, sembrarCuenta, TITULAR } from "../support/cuentas";

// Actions y pantallas de cuentas bancarias con la app REAL (build de producción). Construye
// `dist/`: no ejecutar a la vez que otras pruebas que construyan. Solo 2 inicios de sesión.

const ADMIN = "admin-cuentas-app@example.test";
const OPERADOR = "operador-cuentas-app@example.test";
const DESCONOCIDO = "5f1c1c0e-0000-4000-8000-0000000000ff";
const base = abrirBaseDePruebas();
let origen = "";
let detener = async () => {};
const cookies: Record<string, string> = {};

async function iniciarSesion(correo: string): Promise<string> {
  const respuesta = await fetch(`${origen}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGEN },
    body: JSON.stringify({ email: correo, password: CONTRASENA }),
  });
  expect(respuesta.status, `login de ${correo}`).toBe(200);
  return respuesta.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.includes("session_token"))!;
}

const llamar = async (accion: string, cuerpo: unknown, cookie?: string) => {
  const respuesta = await fetch(`${origen}/_actions/payments.${accion}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return {
    status: respuesta.status,
    texto,
    json: respuesta.ok || !texto.startsWith("{") ? undefined : JSON.parse(texto),
  };
};

const cuerpoCuenta = (extra: Record<string, unknown> = {}) => ({
  name: "Cuenta SPEI",
  bankName: "Banco Ficticio",
  accountHolder: TITULAR,
  clabe: CLABE,
  priority: 1,
  monthlyLimitCents: 500_000,
  ...extra,
});

describe.skipIf(!base && !process.env.CI)("cuentas bancarias: Actions y pantallas", () => {
  const { sql, db } = base ?? {};
  if (!sql || !db) {
    test("TEST_DATABASE_URL es obligatoria en CI", () => {
      throw new Error("Falta TEST_DATABASE_URL: en CI las pruebas con PostgreSQL no se omiten.");
    });
    return;
  }

  beforeAll(async () => {
    const app = await prepararAplicacion(sql, db, [
      { correo: ADMIN, rol: "admin" },
      { correo: OPERADOR, rol: "operator" },
    ]);
    origen = app.origen;
    detener = async () => void (await app.detener());
    cookies.admin = await iniciarSesion(ADMIN);
    cookies.operador = await iniciarSesion(OPERADOR);
  }, 180_000);
  afterAll(async () => {
    await detener();
    await sql.close();
  });

  const cuentaEn = async (id: string) =>
    (await sql`select * from bank_accounts where id = ${id}`)[0] as
      | { monthly_limit_cents: number; is_eligible: boolean; name: string; clabe: string }
      | undefined;
  const auditoria = async () =>
    (await sql`select action, entity_id, actor_user_id, before, after from audit_events
      order by created_at, id`) as Array<{
      action: string;
      entity_id: string;
      actor_user_id: string;
      before: unknown;
      after: unknown;
    }>;
  const crear = async (extra: Record<string, unknown> = {}) => {
    const r = await llamar("createAccount", cuerpoCuenta(extra), cookies.admin);
    expect(r.status, r.texto).toBe(200);
    // El cuerpo de éxito de una Action va serializado con devalue, no es JSON: el id se lee de la base.
    return (await sql`select id from bank_accounts order by created_at desc, id limit 1`)[0]
      .id as string;
  };

  const MUTACIONES: Array<[string, unknown]> = [
    ["createAccount", cuerpoCuenta()],
    ["editAccount", { id: DESCONOCIDO, ...cuerpoCuenta() }],
    ["setAccountEligible", { id: DESCONOCIDO, isEligible: false }],
    ["deleteAccount", { id: DESCONOCIDO }],
  ];

  test("sin sesión 401 y operador 403 en cada Action, sin tocar la base", async () => {
    for (const [accion, cuerpo] of MUTACIONES) {
      expect((await llamar(accion, cuerpo)).status, `${accion} sin sesión`).toBe(401);
      expect((await llamar(accion, cuerpo, cookies.operador)).status, `${accion} operador`).toBe(
        403,
      );
    }
    expect(await sql`select id from bank_accounts`).toHaveLength(0);
    expect(await auditoria()).toHaveLength(0);
  });

  test("las pantallas son solo de admin: sin sesión redirige, operador 403", async () => {
    const id = await sembrarCuenta(sql);
    for (const ruta of ["/admin/cuentas", "/admin/cuentas/nueva", `/admin/cuentas/${id}`]) {
      const sinSesion = await fetch(`${origen}${ruta}`, { redirect: "manual" });
      expect(sinSesion.status, ruta).toBe(302);
      expect(sinSesion.headers.get("location")).toBe("/login");
      const operador = await fetch(`${origen}${ruta}`, { headers: { cookie: cookies.operador! } });
      expect(operador.status, ruta).toBe(403);
      expect(await operador.text()).not.toContain(CLABE);
      const admin = await fetch(`${origen}${ruta}`, { headers: { cookie: cookies.admin! } });
      expect(admin.status, ruta).toBe(200);
    }
    // Id mal formado o inexistente: 404, no 500.
    for (const ruta of ["/admin/cuentas/no-es-uuid", `/admin/cuentas/${DESCONOCIDO}`]) {
      const r = await fetch(`${origen}${ruta}`, { headers: { cookie: cookies.admin! } });
      expect(r.status, ruta).toBe(404);
    }
    await sql`delete from bank_accounts where id = ${id}`;
  });

  test("el admin crea, edita, deshabilita, habilita y elimina; el actor sale de la sesión", async () => {
    const [{ id: adminId }] = await sql`select id from "user" where email = ${ADMIN}`;
    const id = await crear();
    expect((await cuentaEn(id))!.monthly_limit_cents).toBe(500_000);

    const editada = await llamar(
      "editAccount",
      { id, ...cuerpoCuenta({ name: "Renombrada", monthlyLimitCents: 150_050 }) },
      cookies.admin,
    );
    expect(editada.status, editada.texto).toBe(200);
    expect(await cuentaEn(id)).toMatchObject({ name: "Renombrada", monthly_limit_cents: 150_050 });

    for (const isEligible of [false, false, true]) {
      expect((await llamar("setAccountEligible", { id, isEligible }, cookies.admin)).status).toBe(
        200,
      );
    }
    expect((await llamar("deleteAccount", { id }, cookies.admin)).status).toBe(200);
    expect(await cuentaEn(id)).toBeUndefined();

    const eventos = await auditoria();
    expect(eventos.map((e) => e.action)).toEqual([
      "bank_account.created",
      "bank_account.updated",
      "bank_account.disabled",
      "bank_account.enabled",
      "bank_account.deleted",
    ]);
    for (const e of eventos) {
      expect(e.actor_user_id).toBe(adminId);
      expect(e.entity_id).toBe(id);
    }
    // Privacidad: ni la CLABE completa ni el titular llegan a la auditoría.
    const texto = JSON.stringify(eventos);
    expect(texto).not.toContain(CLABE);
    expect(texto).not.toContain(TITULAR);
    expect(texto).toContain("4567");
  });

  test("la pantalla lista importes en pesos con el comprometido del mes", async () => {
    await sql`delete from bank_allocations`;
    await sql`delete from bank_accounts`;
    const id = await sembrarCuenta(sql, { name: "Lista visible", limite: 150_050 });
    await sembrarAsignacion(sql, { cuentaId: id, monto: 50_000 });
    const html = await (
      await fetch(`${origen}/admin/cuentas`, { headers: { cookie: cookies.admin! } })
    ).text();
    expect(html).toContain("Lista visible");
    expect(html).toContain("$1,500.50"); // límite
    expect(html).toContain("$500.00"); // comprometido
    expect(html).toContain("$1,000.50"); // disponible
    expect(html).not.toContain(CLABE); // la lista no muestra datos bancarios
  });

  test("bajar el límite bajo lo comprometido: 409; hasta lo comprometido, sí; editar no toca snapshots", async () => {
    const id = await sembrarCuenta(sql, { limite: 500_000 });
    await sembrarAsignacion(sql, { cuentaId: id, monto: 300_000 });
    const snapshots = async () =>
      JSON.stringify(await sql`select id, instruction_snapshot from bank_allocations`);
    const antes = await snapshots();
    const eventosAntes = (await auditoria()).length;

    const rechazo = await llamar(
      "editAccount",
      { id, ...cuerpoCuenta({ monthlyLimitCents: 299_999 }) },
      cookies.admin,
    );
    expect(rechazo.status).toBe(409);
    expect((await cuentaEn(id))!.monthly_limit_cents).toBe(500_000);
    expect((await auditoria()).length).toBe(eventosAntes);

    const ok = await llamar(
      "editAccount",
      { id, ...cuerpoCuenta({ monthlyLimitCents: 300_000, clabe: "999999999999999999" }) },
      cookies.admin,
    );
    expect(ok.status, ok.texto).toBe(200);
    expect(
      (await llamar("setAccountEligible", { id, isEligible: false }, cookies.admin)).status,
    ).toBe(200);
    expect(await snapshots()).toBe(antes);
  });

  test("eliminar: con asignaciones (también liberadas) 409; sin ellas, sí", async () => {
    const vigente = await sembrarCuenta(sql);
    await sembrarAsignacion(sql, { cuentaId: vigente, monto: 1_000 });
    const liberada = await sembrarCuenta(sql);
    await sembrarAsignacion(sql, { cuentaId: liberada, monto: 1_000, estado: "liberada" });
    for (const id of [vigente, liberada]) {
      const r = await llamar("deleteAccount", { id }, cookies.admin);
      expect(r.status).toBe(409);
      expect(r.json.message).toContain("deshabilítala");
      expect(await cuentaEn(id)).toBeDefined();
    }
    const libre = await sembrarCuenta(sql);
    expect((await llamar("deleteAccount", { id: libre }, cookies.admin)).status).toBe(200);
    expect(await cuentaEn(libre)).toBeUndefined();
    expect((await llamar("deleteAccount", { id: DESCONOCIDO }, cookies.admin)).status).toBe(404);
  });

  test("entrada inválida: 400/422 sin persistir ni filtrar la CLABE", async () => {
    const antes = (await sql`select count(*)::int as n from bank_accounts`)[0].n;
    const eventosAntes = (await auditoria()).length;
    const casos: Array<[Record<string, unknown>, number]> = [
      [{ role: "admin" }, 400], // clave desconocida (strictObject)
      [{ monthlyLimitCents: 1.5 }, 400],
      [{ monthlyLimitCents: 2_147_483_648 }, 400],
      [{ priority: "uno" }, 400],
      [{ clabe: 123456789012345678 }, 400], // la CLABE es texto, no número
      [{ clabe: "0123456789012345" }, 422],
      [{ clabe: "01234567890123456x" }, 422],
      [{ monthlyLimitCents: 0 }, 422],
      [{ name: "   " }, 422],
    ];
    for (const [extra, status] of casos) {
      const r = await llamar("createAccount", cuerpoCuenta(extra), cookies.admin);
      expect(r.status, JSON.stringify(extra)).toBe(status);
      expect(r.texto).not.toContain(TITULAR);
      expect(r.texto).not.toContain(CLABE);
    }
    expect((await sql`select count(*)::int as n from bank_accounts`)[0].n).toBe(antes);
    expect((await auditoria()).length).toBe(eventosAntes);
  });

  test("un error inesperado no filtra su mensaje ni datos bancarios y no deja rastro", async () => {
    // Un NUL no es texto válido en PostgreSQL: el INSERT falla con un error interno del driver.
    const antes = (await sql`select count(*)::int as n from bank_accounts`)[0].n;
    const r = await llamar(
      "createAccount",
      cuerpoCuenta({ accountHolder: "Titular-Secreto\u0000X" }),
      cookies.admin,
    );
    expect(r.status).toBe(500);
    expect(r.json).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno del servidor",
    });
    expect(r.texto).not.toMatch(/utf8|byte|invalid|postgres|bank_accounts|insert|Secreto/i);
    expect(r.texto).not.toContain(CLABE);
    expect((await sql`select count(*)::int as n from bank_accounts`)[0].n).toBe(antes);
  });

  test("ningún GET escribe datos de negocio ni auditoría", async () => {
    const id = await sembrarCuenta(sql);
    await sembrarAsignacion(sql, { cuentaId: id, monto: 1_000 });
    const huella = async () => {
      const mapa: Record<string, string> = {};
      for (const tabla of ["bank_accounts", "bank_allocations", "audit_events", "bookings"]) {
        const [f] = await sql.unsafe(
          `select md5(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), '')) as h from ${tabla} t`,
        );
        mapa[tabla] = f.h;
      }
      return mapa;
    };
    const antes = await huella();
    for (const ruta of ["/admin/cuentas", "/admin/cuentas/nueva", `/admin/cuentas/${id}`]) {
      const r = await fetch(`${origen}${ruta}`, { headers: { cookie: cookies.admin! } });
      expect(r.status, ruta).toBe(200);
    }
    // Una Action invocada por GET tampoco muta nada.
    await fetch(`${origen}/_actions/payments.deleteAccount?id=${id}`, {
      headers: { cookie: cookies.admin! },
    });
    expect(await huella()).toEqual(antes);
  });
});
