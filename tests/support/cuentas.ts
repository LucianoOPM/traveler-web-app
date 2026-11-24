import type { SQL } from "bun";
import { utcALocal } from "@lib/fechas";
import { generarToken, hashDeToken } from "@modules/bookings/domain/access-token";
import { sembrarSalida } from "./reservas";

// Utilidades de las pruebas de cuentas bancarias. Todo se siembra por SQL (todavía no existe el
// servicio de asignación).

export const ZONA = "America/Mexico_City";
export const CLABE = "012345678901234567";
export const TITULAR = "Titular Ficticio SA de CV";

/** Mes vigente (`YYYY-MM`) en la zona de la agencia, como lo calcula el servicio. */
export const mesVigente = () => utcALocal(new Date(), ZONA).slice(0, 7);
/** Un mes distinto del vigente (el anterior; enero → diciembre del año previo). */
export function mesAnterior(mes = mesVigente()) {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

let contador = 0;

export async function sembrarCuenta(
  sql: SQL,
  campos: Partial<{
    name: string;
    clabe: string;
    priority: number;
    limite: number;
    elegible: boolean;
  }> = {},
) {
  const n = ++contador;
  const [f] = await sql`insert into bank_accounts
    (name, bank_name, account_holder, clabe, priority, monthly_limit_cents, is_eligible)
    values (${campos.name ?? "Cuenta " + n}, 'Banco Ficticio', ${TITULAR},
            ${campos.clabe ?? CLABE}, ${campos.priority ?? n}, ${campos.limite ?? 1_000_000},
            ${campos.elegible ?? true}) returning id`;
  return f.id as string;
}

/** Reserva sin asignación, por `monto` centavos. */
export async function sembrarReserva(sql: SQL, monto: number) {
  const { departureId, boardingPointId } = await sembrarSalida(sql, { capacity: 10 });
  const n = ++contador;
  const [reserva] = await sql`insert into bookings
    (reference, departure_id, buyer_name, buyer_phone, buyer_email, boarding_point_id, status,
     expires_at, total_cents, access_token_hash)
    values (${"TT-CTA" + n}, ${departureId}, 'Ana', '5551234567', 'ana@example.com',
            ${boardingPointId}, 'pendiente', now() + interval '1 day', ${monto},
            ${"hash-cuenta-" + n}) returning id`;
  return reserva.id as string;
}

/** Reserva + asignación de `monto` centavos a la cuenta, en `mes` y con el estado indicado. */
export async function sembrarAsignacion(
  sql: SQL,
  {
    cuentaId,
    monto,
    mes = mesVigente(),
    estado = "vigente",
  }: { cuentaId: string; monto: number; mes?: string; estado?: "vigente" | "liberada" },
) {
  const reservaId = await sembrarReserva(sql, monto);
  const liberada = estado === "liberada" ? sql`now()` : null;
  const [a] = await sql`insert into bank_allocations
    (booking_id, bank_account_id, amount_cents, calendar_month, status, instruction_snapshot,
     released_at)
    values (${reservaId}, ${cuentaId}, ${monto}, ${mes}, ${estado},
            ${{ clabe: CLABE, accountHolder: TITULAR }}::jsonb, ${liberada}) returning id`;
  return a.id as string;
}

// --- Asignación bancaria (#84): reservas con token real para ejercer el servicio ---

/**
 * Reserva con un token real (se devuelve en claro; en la base solo está su hash). Con `departureId`
 * comparte salida con otras reservas; si no, siembra una salida propia.
 */
export async function sembrarReservaConToken(
  sql: SQL,
  {
    monto,
    estado = "pendiente",
    expiraEn = new Date(Date.now() + 86_400_000),
    departureId,
  }: { monto: number; estado?: string; expiraEn?: Date; departureId?: string },
) {
  let salida = departureId;
  let punto: string;
  if (salida) {
    [{ id: punto }] = await sql`select boarding_point_id as id from departure_boarding_points
      where departure_id = ${salida} limit 1`;
  } else {
    const s = await sembrarSalida(sql, { capacity: 10 });
    salida = s.departureId;
    punto = s.boardingPointId;
  }
  const token = generarToken();
  const n = ++contador;
  const [r] = await sql`insert into bookings
    (reference, departure_id, buyer_name, buyer_phone, buyer_email, boarding_point_id, status,
     expires_at, total_cents, access_token_hash)
    values (${"TT-ASG" + n}, ${salida}, 'Ana', '5551234567', 'ana@example.com', ${punto},
            ${estado}, ${expiraEn}, ${monto}, ${hashDeToken(token)}) returning id`;
  return { id: r.id as string, token, departureId: salida };
}

/** Asignación directa para una reserva ya sembrada. */
export async function sembrarAsignacionDe(
  sql: SQL,
  reservaId: string,
  cuentaId: string,
  monto: number,
  mes = mesVigente(),
) {
  const [a] = await sql`insert into bank_allocations
    (booking_id, bank_account_id, amount_cents, calendar_month, instruction_snapshot)
    values (${reservaId}, ${cuentaId}, ${monto}, ${mes}, ${{ clabe: CLABE, accountHolder: TITULAR }}::jsonb)
    returning id`;
  return a.id as string;
}

/** Comprobante `pendiente` o `verificado` (con su revisión) de una reserva con asignación. */
export async function sembrarReporte(
  sql: SQL,
  reservaId: string,
  asignacionId: string,
  estado: "pendiente" | "verificado" | "rechazado",
) {
  const [m] = await sql`insert into media_assets (storage_key, content_type, size_bytes)
    values (${"media/asg-" + ++contador + ".png"}, 'image/png', 10) returning id`;
  const [r] = await sql`insert into payment_reports
    (booking_id, bank_allocation_id, reported_amount_cents, evidence_asset_id, status)
    values (${reservaId}, ${asignacionId}, 100, ${m.id}, ${estado}) returning id`;
  return r.id as string;
}
