import { actions } from "astro:actions";
import { useState } from "react";
import { Button } from "@components/ui/button";
import { Campo, ErrorGeneral, useEnvio } from "@components/catalogo/comun";
import { formatearFecha } from "@lib/fechas";
import { formatearPesos } from "@lib/importes";

type Categoria = { valor: "adulto" | "menor" | "infante"; etiqueta: string; tarifa: string };
type Props = {
  departureId: string;
  puntos: { id: string; name: string }[];
  categorias: Categoria[];
  maxPasajeros: number;
  zona: string;
};
type Creada = { reference: string; token: string; totalCents: number; expiresAt: Date };
type Pasajero = { fullName: string; fareCategory: Categoria["valor"] };

const SELECT =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

/** Checkout invitado: contacto, punto de abordaje y pasajeros. El total lo calcula el servidor. */
export default function CheckoutForm({
  departureId,
  puntos,
  categorias,
  maxPasajeros,
  zona,
}: Props) {
  const [contacto, setContacto] = useState({ buyerName: "", buyerPhone: "", buyerEmail: "" });
  const [boardingPointId, setPunto] = useState("");
  const [pasajeros, setPasajeros] = useState<Pasajero[]>([
    { fullName: "", fareCategory: "adulto" },
  ]);
  const [creada, setCreada] = useState<Creada | null>(null);
  const [copiado, setCopiado] = useState(false);
  const { errores, enviando, ejecutar } = useEnvio();

  const cambiarPasajero = (i: number, cambios: Partial<Pasajero>) =>
    setPasajeros((lista) => lista.map((p, j) => (j === i ? { ...p, ...cambios } : p)));
  const poner = (campo: keyof typeof contacto) => (valor: string) =>
    setContacto((c) => ({ ...c, [campo]: valor }));

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const resultado = await ejecutar(() =>
      actions.bookings.create({ departureId, boardingPointId, ...contacto, passengers: pasajeros }),
    );
    if (resultado) setCreada(resultado);
  }

  if (creada) {
    // El enlace se muestra una sola vez: el servidor solo guarda su hash y no se envía por correo.
    const enlace = `${location.origin}/reservas/${creada.token}`;
    return (
      <section aria-labelledby="reserva-creada" className="grid gap-3">
        <h2 id="reserva-creada" className="text-2xl font-semibold">
          Reserva creada
        </h2>
        <p>
          Referencia <strong>{creada.reference}</strong> · Total{" "}
          <strong>{formatearPesos(creada.totalCents)}</strong> · Vigente hasta{" "}
          {formatearFecha(creada.expiresAt, zona)}
        </p>
        <p role="alert" className="rounded-lg border border-destructive p-3 text-sm">
          <strong>Guarda este enlace ahora.</strong> Es la única forma de consultar tu reserva. No
          lo enviamos por correo y no se vuelve a mostrar.
        </p>
        <input
          readOnly
          aria-label="Enlace de consulta de la reserva"
          value={enlace}
          onFocus={(e) => e.currentTarget.select()}
          className={SELECT}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(enlace);
              setCopiado(true);
            }}
          >
            {copiado ? "Enlace copiado" : "Copiar enlace"}
          </Button>
          <a
            href={enlace}
            className="inline-flex h-8 items-center rounded-lg border px-2.5 text-sm underline-offset-4 hover:underline"
          >
            Abrir mi reserva
          </a>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={enviar} noValidate>
      <Campo
        id="co-nombre"
        name="buyerName"
        etiqueta="Nombre de contacto"
        autoComplete="name"
        value={contacto.buyerName}
        onValor={poner("buyerName")}
        error={errores.campos.buyerName}
      />
      <Campo
        id="co-telefono"
        name="buyerPhone"
        etiqueta="Teléfono"
        type="tel"
        autoComplete="tel"
        value={contacto.buyerPhone}
        onValor={poner("buyerPhone")}
        error={errores.campos.buyerPhone}
      />
      <Campo
        id="co-correo"
        name="buyerEmail"
        etiqueta="Correo"
        type="email"
        autoComplete="email"
        value={contacto.buyerEmail}
        onValor={poner("buyerEmail")}
        error={errores.campos.buyerEmail}
      />

      <div className="mb-4 grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-medium">
          Punto de abordaje
          <select
            name="boardingPointId"
            value={boardingPointId}
            className={SELECT}
            aria-invalid={errores.campos.boardingPointId ? true : undefined}
            onChange={(e) => setPunto(e.target.value)}
          >
            <option value="">Selecciona un punto</option>
            {puntos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {errores.campos.boardingPointId && (
          <span role="alert" className="text-sm text-destructive">
            {errores.campos.boardingPointId}
          </span>
        )}
      </div>

      <fieldset className="mb-4 grid gap-3">
        <legend className="mb-1 text-sm font-medium">
          Pasajeros (todos ocupan lugar, infantes incluidos)
        </legend>
        {pasajeros.map((p, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
          >
            <Campo
              id={`co-pasajero-${i}`}
              name={`passengers.${i}.fullName`}
              etiqueta={`Pasajero ${i + 1}`}
              value={p.fullName}
              onValor={(v) => cambiarPasajero(i, { fullName: v })}
            />
            <label className="mb-4 grid gap-1.5 text-sm font-medium">
              Categoría
              <select
                value={p.fareCategory}
                className={SELECT}
                onChange={(e) =>
                  cambiarPasajero(i, { fareCategory: e.target.value as Pasajero["fareCategory"] })
                }
              >
                {categorias.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.etiqueta} · {c.tarifa}
                  </option>
                ))}
              </select>
            </label>
            {pasajeros.length > 1 && (
              <Button
                type="button"
                variant="outline"
                className="mb-4"
                onClick={() => setPasajeros((l) => l.filter((_, j) => j !== i))}
              >
                Quitar
              </Button>
            )}
          </div>
        ))}
        {errores.campos.passengers && (
          <span role="alert" className="text-sm text-destructive">
            {errores.campos.passengers}
          </span>
        )}
        {pasajeros.length < maxPasajeros && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setPasajeros((l) => [...l, { fullName: "", fareCategory: "adulto" }])}
          >
            Agregar pasajero
          </Button>
        )}
      </fieldset>

      <ErrorGeneral mensaje={errores.general} />
      <Button type="submit" disabled={enviando}>
        Reservar
      </Button>
    </form>
  );
}
