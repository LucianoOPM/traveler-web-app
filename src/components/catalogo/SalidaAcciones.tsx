import { actions } from "astro:actions";
import { useState } from "react";
import type { BoardingPoint, Departure, PackageStatus } from "../../modules/catalog/types";
import { Campo, ErrorGeneral, useEnvio } from "./comun";

type Props = {
  salida: Departure;
  estadoPaquete: PackageStatus;
  puntos: BoardingPoint[];
  asignados: string[];
};

/** Publicar, cancelar o eliminar una salida y asignar o quitar sus puntos de abordaje. */
export default function SalidaAcciones({ salida, estadoPaquete, puntos, asignados }: Props) {
  const [elegido, setElegido] = useState("");
  const { errores, enviando, ejecutar } = useEnvio();
  const cancelada = salida.status === "cancelada";
  const libres = puntos.filter((p) => !asignados.includes(p.id));

  const recargar = async (llamada: Parameters<typeof ejecutar>[0]) => {
    if (await ejecutar(llamada)) location.reload();
  };
  const par = (boardingPointId: string) => ({ departureId: salida.id, boardingPointId });

  return (
    <div>
      <ErrorGeneral mensaje={errores.general ?? Object.values(errores.campos)[0] ?? null} />
      {salida.status === "borrador" && (
        <>
          <button
            type="button"
            disabled={enviando || estadoPaquete !== "publicado"}
            onClick={() => recargar(() => actions.catalog.publishDeparture({ id: salida.id }))}
          >
            Publicar salida
          </button>
          {estadoPaquete !== "publicado" && <small> Publica primero el paquete.</small>}
          <button
            type="button"
            disabled={enviando}
            onClick={() =>
              confirm("¿Eliminar este borrador?") &&
              recargar(() => actions.catalog.deleteDeparture({ id: salida.id }))
            }
          >
            Eliminar borrador
          </button>
        </>
      )}
      {salida.status === "publicada" && (
        <button
          type="button"
          disabled={enviando}
          onClick={() =>
            confirm("¿Cancelar esta salida? No se puede reabrir.") &&
            recargar(() => actions.catalog.cancelDeparture({ id: salida.id }))
          }
        >
          Cancelar salida
        </button>
      )}

      <h4>Puntos de abordaje</h4>
      <ul>
        {puntos
          .filter((p) => asignados.includes(p.id))
          .map((p) => (
            <li key={p.id}>
              {p.name}{" "}
              {!cancelada && (
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => recargar(() => actions.catalog.removeBoardingPoint(par(p.id)))}
                >
                  Quitar
                </button>
              )}
            </li>
          ))}
        {asignados.length === 0 && <li>Sin puntos asignados</li>}
      </ul>
      {!cancelada && libres.length > 0 && (
        <p>
          <label>
            Agregar punto{" "}
            <select value={elegido} onChange={(e) => setElegido(e.target.value)}>
              <option value="">Elige uno…</option>
              {libres.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>{" "}
          <button
            type="button"
            disabled={enviando || !elegido}
            onClick={() => recargar(() => actions.catalog.assignBoardingPoint(par(elegido)))}
          >
            Asignar
          </button>
        </p>
      )}
    </div>
  );
}

/** Crea un punto de abordaje del catálogo (luego se asigna a las salidas). */
export function NuevoPunto() {
  const [name, setName] = useState("");
  const { errores, enviando, ejecutar } = useEnvio();

  async function crear(evento: React.FormEvent) {
    evento.preventDefault();
    if (await ejecutar(() => actions.catalog.createBoardingPoint({ name }))) location.reload();
  }

  return (
    <form onSubmit={crear} noValidate>
      <Campo
        id="punto-name"
        name="name"
        etiqueta="Nuevo punto de abordaje"
        value={name}
        onValor={setName}
        error={errores.campos.name}
      />
      <ErrorGeneral mensaje={errores.general} />
      <button type="submit" disabled={enviando}>
        Crear punto
      </button>
    </form>
  );
}
