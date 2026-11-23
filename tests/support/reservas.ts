import type { SQL } from "bun";

// Utilidades de las pruebas de checkout con la app real. Las salidas se siembran por SQL.

let contador = 0;

/** Paquete publicado + salida publicada lejana (adulto $1,500.00, menor $1,000.00, infante $0.00). */
export async function sembrarSalida(
  sql: SQL,
  {
    capacity,
    status = "publicada",
    paquete = "publicado",
  }: {
    capacity: number;
    status?: string;
    paquete?: string;
  },
) {
  const n = ++contador;
  const [p] = await sql`insert into packages (name, summary, description, status)
    values (${"Paquete checkout " + n}, 'Resumen', 'Descripción', ${paquete}) returning id`;
  const [d] = await sql`insert into departures
    (package_id, starts_at, ends_at, capacity, adult_price_cents, child_price_cents,
     infant_price_cents, status)
    values (${p.id}, '2099-01-10T10:00:00Z', '2099-01-12T10:00:00Z', ${capacity},
            150000, 100000, 0, ${status}) returning id`;
  const [b] = await sql`insert into boarding_points (name) values (${"Punto checkout " + n})
    returning id`;
  await sql`insert into departure_boarding_points (departure_id, boarding_point_id)
    values (${d.id}, ${b.id})`;
  return { departureId: d.id as string, boardingPointId: b.id as string };
}

export const cuerpoReserva = (
  s: { departureId: string; boardingPointId: string },
  extra: Record<string, unknown> = {},
) => ({
  ...s,
  buyerName: "Ana Pérez",
  buyerPhone: "5551234567",
  buyerEmail: "ana@example.com",
  passengers: [
    { fullName: "Ana Pérez", fareCategory: "adulto" },
    { fullName: "Bebé Pérez", fareCategory: "infante" },
  ],
  ...extra,
});

/** POST directo a la Action pública (sin sesión ni cookies). */
export async function reservar(origen: string, cuerpo: unknown) {
  const respuesta = await fetch(`${origen}/_actions/bookings.create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  return { status: respuesta.status, texto, ok: respuesta.ok };
}

/** El éxito viaja serializado con devalue (un arreglo): el token es la única cadena de 43 caracteres. */
export function tokenDe(texto: string): string {
  const valores = JSON.parse(texto) as unknown[];
  const token = valores.find((v) => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v));
  if (typeof token !== "string") throw new Error(`Sin token en la respuesta: ${texto}`);
  return token;
}

export const pagina = (origen: string, ruta: string) =>
  fetch(`${origen}${ruta}`, { redirect: "manual" });
