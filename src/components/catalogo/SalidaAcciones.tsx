import { actions } from "astro:actions";
import { Button } from "@components/ui/button";
import { useState } from "react";
import type { BoardingPoint, Departure, PackageStatus } from "@modules/catalog/types";
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
    <div className="grid gap-3">
      <ErrorGeneral mensaje={errores.general ?? Object.values(errores.campos)[0] ?? null} />
      <div className="flex flex-wrap items-center gap-2">
        {salida.status === "borrador" && (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={enviando || estadoPaquete !== "publicado"}
              onClick={() => recargar(() => actions.catalog.publishDeparture({ id: salida.id }))}
            >
              Publicar salida
            </Button>
            {estadoPaquete !== "publicado" && (
              <small className="text-muted-foreground">Publica primero el paquete.</small>
            )}
            <Button
              type="button"
              variant="destructive"
              disabled={enviando}
              onClick={() =>
                confirm("¿Eliminar este borrador?") &&
                recargar(() => actions.catalog.deleteDeparture({ id: salida.id }))
              }
            >
              Eliminar borrador
            </Button>
          </>
        )}
        {salida.status === "publicada" && (
          <Button
            type="button"
            variant="outline"
            disabled={enviando}
            onClick={() =>
              confirm("¿Cancelar esta salida? No se puede reabrir.") &&
              recargar(() => actions.catalog.cancelDeparture({ id: salida.id }))
            }
          >
            Cancelar salida
          </Button>
        )}
      </div>

      <h4 className="font-medium">Puntos de abordaje</h4>
      <ul className="grid gap-2">
        {puntos
          .filter((p) => asignados.includes(p.id))
          .map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              {p.name}
              {!cancelada && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={enviando}
                  onClick={() => recargar(() => actions.catalog.removeBoardingPoint(par(p.id)))}
                >
                  Quitar
                </Button>
              )}
            </li>
          ))}
        {asignados.length === 0 && <li>Sin puntos asignados</li>}
      </ul>
      {!cancelada && libres.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            Agregar punto
            <select
              value={elegido}
              onChange={(e) => setElegido(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Elige uno…</option>
              {libres.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={enviando || !elegido}
            onClick={() => recargar(() => actions.catalog.assignBoardingPoint(par(elegido)))}
          >
            Asignar
          </Button>
        </div>
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
      <Button type="submit" disabled={enviando}>
        Crear punto
      </Button>
    </form>
  );
}
