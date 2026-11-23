// Fechas de la agencia: el admin las escribe en `AGENCY_TIMEZONE` y se guardan en UTC. Sin librerías:
// solo `Intl.DateTimeFormat`. Formato local = el de `<input type="datetime-local">`.
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Hora de pared del instante en `zona`, como `YYYY-MM-DDTHH:mm`. */
export function utcALocal(utc: Date | string | number, zona: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utc));
  const v = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

/**
 * Hora de pared en `zona` → ISO UTC. `null` si el texto es inválido o la hora no existe (salto de
 * primavera). En una hora ambigua (fin del horario de verano) devuelve la primera ocurrencia.
 */
export function localAUtc(local: string, zona: string): string | null {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const [a, mes, d, h, min] = m.slice(1).map(Number) as [number, number, number, number, number];
  const comoUtc = Date.UTC(a, mes - 1, d, h, min);
  // `Date.UTC` normaliza fechas imposibles (30 de febrero, hora 25): si no se conserva, es inválida.
  if (new Date(comoUtc).toISOString().slice(0, 16) !== local) return null;

  // El desfase de la zona puede ser el de ayer, el de hoy o el de mañana (cambio de horario).
  const desfase = (t: number) => Date.parse(`${utcALocal(t, zona)}:00Z`) - t;
  const candidatos = [-DIA_MS, 0, DIA_MS]
    .map((delta) => comoUtc - desfase(comoUtc + delta))
    .filter((t) => utcALocal(t, zona) === local);
  return candidatos.length ? new Date(Math.min(...candidatos)).toISOString() : null;
}

/** Fecha y hora para mostrar al público, en la zona de la agencia: `10 de enero de 2027, 22:00`. */
export function formatearFecha(utc: Date | string | number, zona: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: zona,
    hourCycle: "h23",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(utc));
}
