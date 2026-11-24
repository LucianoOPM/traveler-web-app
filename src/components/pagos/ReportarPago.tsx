import { actions } from "astro:actions";
import { useRef, useState } from "react";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { Campo, ErrorGeneral, useEnvio } from "@components/catalogo/comun";
import { pesosACentavos } from "@lib/importes";

/**
 * Reporta un pago SPEI con su evidencia. La clave de intento (`requestKey`) se conserva mientras no
 * cambien los datos: reintentar el mismo envío no crea otro reporte. Las reglas viven en el servidor.
 */
export default function ReportarPago({ token }: { token: string }) {
  const [importe, setImporte] = useState("");
  const [referencia, setReferencia] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const clave = useRef(crypto.randomUUID());
  const { errores, enviando, ejecutar } = useEnvio();

  // Cualquier cambio de datos es otro intento: clave nueva (reutilizarla con datos distintos daría 409).
  const cambiar =
    <T,>(poner: (valor: T) => void) =>
    (valor: T) => {
      clave.current = crypto.randomUUID();
      poner(valor);
    };

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    const previos: Record<string, string> = {};
    const centavos = pesosACentavos(importe);
    if (centavos === null || centavos === 0) previos.amountCents = "Escribe un importe válido";
    if (!archivo || archivo.size === 0) previos.file = "Adjunta el comprobante";
    const datos = new FormData();
    datos.set("token", token);
    datos.set("requestKey", clave.current);
    datos.set("amountCents", String(centavos ?? 0));
    if (referencia.trim() !== "") datos.set("trackingReference", referencia);
    if (archivo) datos.set("file", archivo);
    if (await ejecutar(() => actions.payments.reportPayment(datos), previos)) location.reload();
  }

  return (
    <form onSubmit={enviar} noValidate className="grid max-w-xl gap-1">
      <Campo
        id="reporte-importe"
        name="amountCents"
        etiqueta="Importe transferido (pesos)"
        inputMode="decimal"
        value={importe}
        onValor={cambiar(setImporte)}
        error={errores.campos.amountCents}
      />
      <Campo
        id="reporte-referencia"
        name="trackingReference"
        etiqueta="Clave de rastreo o referencia SPEI (opcional)"
        maxLength={40}
        value={referencia}
        onValor={cambiar(setReferencia)}
        error={errores.campos.trackingReference}
      />
      <div className="mb-4 grid gap-1.5">
        <label htmlFor="reporte-archivo" className="grid gap-1.5 text-sm font-medium">
          Comprobante (JPEG, PNG, WebP o PDF, máx. 5 MiB)
          <Input
            id="reporte-archivo"
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            aria-invalid={errores.campos.file ? true : undefined}
            aria-describedby={errores.campos.file ? "reporte-archivo-error" : undefined}
            onChange={(e) => cambiar(setArchivo)(e.target.files?.[0] ?? null)}
          />
        </label>
        {errores.campos.file && (
          <span id="reporte-archivo-error" role="alert" className="text-sm text-destructive">
            {errores.campos.file}
          </span>
        )}
      </div>
      <ErrorGeneral mensaje={errores.general} />
      <div>
        <Button type="submit" disabled={enviando}>
          Enviar comprobante
        </Button>
      </div>
    </form>
  );
}
