import { actions } from "astro:actions";
import { useState } from "react";
import { Button } from "@components/ui/button";
import { Campo, ErrorGeneral, useEnvio } from "@components/catalogo/comun";

type Accion = "cancelar" | "reactivar" | "regenerar";
type Props = { bookingId: string; acciones: Accion[] };

const ETIQUETAS: Record<Accion, string> = {
  cancelar: "Cancelar reserva",
  reactivar: "Reactivar reserva",
  regenerar: "Regenerar enlace",
};

/** Acciones de administrador sobre una reserva; todas exigen un motivo que queda en la auditoría. */
export default function ReservaAcciones({ bookingId, acciones }: Props) {
  const [motivo, setMotivo] = useState("");
  const [enlace, setEnlace] = useState<string | null>(null);
  const { errores, enviando, ejecutar } = useEnvio();

  if (acciones.length === 0)
    return <span className="text-sm text-muted-foreground">Sin acciones</span>;

  async function aplicar(accion: Accion) {
    const previos: Record<string, string> =
      motivo.trim() === "" ? { reason: "El motivo es obligatorio" } : {};
    const entrada = { bookingId, reason: motivo };
    if (accion === "regenerar") {
      const r = await ejecutar(() => actions.bookings.regenerateToken(entrada), previos);
      // El enlace nuevo se muestra una sola vez; el anterior ya dejó de funcionar.
      if (r) setEnlace(`${location.origin}/reservas/${r.token}`);
      return;
    }
    const llamada = accion === "cancelar" ? actions.bookings.cancel : actions.bookings.reactivate;
    if (await ejecutar(() => llamada(entrada), previos)) location.reload();
  }

  if (enlace) {
    return (
      <div className="grid gap-2" role="status">
        <p className="text-sm">
          <strong>Enlace nuevo, visible solo ahora.</strong> El anterior ya no funciona y no se
          envía por correo.
        </p>
        <input
          readOnly
          aria-label="Enlace nuevo de la reserva"
          value={enlace}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        />
        <Button type="button" variant="outline" onClick={() => location.reload()}>
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Campo
        id={`motivo-${bookingId}`}
        name="reason"
        etiqueta="Motivo (obligatorio)"
        maxLength={500}
        value={motivo}
        onValor={setMotivo}
        error={errores.campos.reason}
      />
      <ErrorGeneral mensaje={errores.general} />
      <div className="flex flex-wrap gap-2">
        {acciones.map((accion) => (
          <Button
            key={accion}
            type="button"
            variant={accion === "cancelar" ? "outline" : "default"}
            disabled={enviando}
            onClick={() => aplicar(accion)}
          >
            {ETIQUETAS[accion]}
          </Button>
        ))}
      </div>
    </div>
  );
}
