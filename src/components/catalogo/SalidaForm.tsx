import { actions } from "astro:actions";
import { useState } from "react";
import { utcALocal, localAUtc } from "../../lib/fechas";
import { centavosAPesos, pesosACentavos } from "../../lib/importes";
import type { Departure } from "../../modules/catalog/types";
import { Campo, ErrorGeneral, useEnvio } from "./comun";

type Props = { paqueteId: string; salida?: Departure; zona: string };

/** Crea (sin `salida`) o edita una salida. Fechas en la zona de la agencia, importes en pesos. */
export default function SalidaForm({ paqueteId, salida, zona }: Props) {
  const [valores, setValores] = useState({
    startsAt: salida ? utcALocal(salida.startsAt, zona) : "",
    endsAt: salida ? utcALocal(salida.endsAt, zona) : "",
    capacity: salida ? String(salida.capacity) : "",
    adultPriceCents: salida ? centavosAPesos(salida.adultPriceCents) : "",
    childPriceCents: salida ? centavosAPesos(salida.childPriceCents) : "",
    infantPriceCents: salida ? centavosAPesos(salida.infantPriceCents) : "",
  });
  const { errores, enviando, ejecutar } = useEnvio();
  const cancelada = salida?.status === "cancelada";
  const id = salida?.id ?? "nueva";
  const poner = (campo: keyof typeof valores) => (valor: string) =>
    setValores((v) => ({ ...v, [campo]: valor }));

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    // Las conversiones fallidas se muestran junto a su campo sin llamar a la Action.
    const previos: Record<string, string> = {};
    const fecha = (campo: "startsAt" | "endsAt") => {
      const utc = localAUtc(valores[campo], zona);
      if (!utc) previos[campo] = "Fecha y hora no válidas en la zona de la agencia";
      return utc ?? "";
    };
    const importe = (campo: "adultPriceCents" | "childPriceCents" | "infantPriceCents") => {
      const centavos = pesosACentavos(valores[campo]);
      if (centavos === null) previos[campo] = "Importe no válido (ej. 1500.50)";
      return centavos ?? 0;
    };
    const capacidad = /^\d{1,10}$/.test(valores.capacity.trim()) ? Number(valores.capacity) : null;
    if (capacidad === null) previos.capacity = "Capacidad no válida (entero, 0 o más)";
    const contenido = {
      startsAt: fecha("startsAt"),
      endsAt: fecha("endsAt"),
      capacity: capacidad ?? 0,
      adultPriceCents: importe("adultPriceCents"),
      childPriceCents: importe("childPriceCents"),
      infantPriceCents: importe("infantPriceCents"),
    };
    const resultado = await ejecutar(
      () =>
        salida
          ? actions.catalog.editDeparture({ id: salida.id, ...contenido })
          : actions.catalog.createDeparture({ packageId: paqueteId, ...contenido }),
      previos,
    );
    if (resultado) location.reload();
  }

  const campo = (
    nombre: keyof typeof valores,
    etiqueta: string,
    extra: { type: string; inputMode?: "decimal" | "numeric" },
  ) => (
    <Campo
      id={`salida-${id}-${nombre}`}
      name={nombre}
      etiqueta={etiqueta}
      value={valores[nombre]}
      onValor={poner(nombre)}
      disabled={cancelada}
      error={errores.campos[nombre]}
      {...extra}
    />
  );

  return (
    <form onSubmit={guardar} noValidate>
      {campo("startsAt", `Salida (hora de ${zona})`, { type: "datetime-local" })}
      {campo("endsAt", `Regreso (hora de ${zona})`, { type: "datetime-local" })}
      {campo("capacity", "Capacidad (pasajeros, infantes incluidos)", {
        type: "text",
        inputMode: "numeric",
      })}
      {campo("adultPriceCents", "Tarifa adulto (MXN)", { type: "text", inputMode: "decimal" })}
      {campo("childPriceCents", "Tarifa menor (MXN)", { type: "text", inputMode: "decimal" })}
      {campo("infantPriceCents", "Tarifa infante (MXN)", { type: "text", inputMode: "decimal" })}
      <ErrorGeneral mensaje={errores.general} />
      {!cancelada && (
        <button type="submit" disabled={enviando}>
          {salida ? "Guardar salida" : "Crear salida"}
        </button>
      )}
    </form>
  );
}
