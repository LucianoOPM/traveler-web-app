import { actions } from "astro:actions";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { ErrorGeneral, useEnvio } from "./comun";

/** Sube o reemplaza la portada de un paquete (jpeg, png o webp; la validación real es del servidor). */
export default function PortadaForm({
  paqueteId,
  tienePortada,
}: {
  paqueteId: string;
  tienePortada: boolean;
}) {
  const { errores, enviando, ejecutar } = useEnvio();

  async function subir(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    datos.set("id", paqueteId);
    const archivo = datos.get("file");
    const previos: Record<string, string> =
      archivo instanceof File && archivo.size > 0 ? {} : { file: "Elige una imagen" };
    if (await ejecutar(() => actions.catalog.uploadCover(datos), previos)) location.reload();
  }

  return (
    <form onSubmit={subir} noValidate className="grid justify-items-start gap-4">
      <div className="grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-medium">
          {tienePortada ? "Reemplazar portada" : "Subir portada"} (JPEG, PNG o WebP, máx. 5 MiB)
          <Input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            aria-invalid={errores.campos.file ? true : undefined}
            aria-describedby={errores.campos.file ? "portada-error" : undefined}
          />
        </label>
        {errores.campos.file && (
          <span id="portada-error" role="alert" className="text-sm text-destructive">
            {errores.campos.file}
          </span>
        )}
      </div>
      <ErrorGeneral mensaje={errores.general} />
      <Button type="submit" disabled={enviando}>
        Subir
      </Button>
    </form>
  );
}
