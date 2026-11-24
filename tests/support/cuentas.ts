import type { SQL } from "bun";
import { utcALocal } from "@lib/fechas";
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
