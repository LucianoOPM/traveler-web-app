import { actions } from "astro:actions";
import { Button } from "@components/ui/button";
import { useState } from "react";
import type { Package } from "@modules/catalog/types";
import { Campo, ErrorGeneral, useEnvio } from "./comun";

/** Crea (sin `paquete`) o edita un paquete y, al editar, cambia su estado. Recarga tras escribir. */
export default function PaqueteForm({ paquete }: { paquete?: Package }) {
  const [name, setName] = useState(paquete?.name ?? "");
  const [summary, setSummary] = useState(paquete?.summary ?? "");
  const [description, setDescription] = useState(paquete?.description ?? "");
  const { errores, enviando, ejecutar } = useEnvio();
  const archivado = paquete?.status === "archivado";

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!paquete) {
      const creado = await ejecutar(() =>
        actions.catalog.createPackage({ name, summary, description }),
      );
      if (creado) location.assign(`/admin/catalogo/${creado.id}`);
      return;
    }
    const editado = await ejecutar(() =>
      actions.catalog.editPackage({ id: paquete.id, name, summary, description }),
    );
    if (editado) location.reload();
  }

  async function cambiarEstado(accion: "publishPackage" | "archivePackage") {
    if (paquete && (await ejecutar(() => actions.catalog[accion]({ id: paquete.id })))) {
      location.reload();
    }
  }

  async function eliminar() {
    if (!paquete || !confirm("¿Eliminar este borrador?")) return;
    if (await ejecutar(() => actions.catalog.deletePackage({ id: paquete.id }))) {
      location.assign("/admin/catalogo");
    }
  }

  return (
    <form onSubmit={guardar} noValidate>
      <Campo
        id="paquete-name"
        name="name"
        etiqueta="Nombre"
        value={name}
        onValor={setName}
        disabled={archivado}
        error={errores.campos.name}
      />
      <Campo
        id="paquete-summary"
        name="summary"
        etiqueta="Resumen"
        value={summary}
        onValor={setSummary}
        disabled={archivado}
        error={errores.campos.summary}
      />
      <Campo
        id="paquete-description"
        name="description"
        etiqueta="Descripción"
        multilinea
        value={description}
        onValor={setDescription}
        disabled={archivado}
        error={errores.campos.description}
      />
      <ErrorGeneral mensaje={errores.general} />
      <div className="flex flex-wrap gap-2">
        {!archivado && (
          <Button type="submit" disabled={enviando}>
            {paquete ? "Guardar cambios" : "Crear paquete"}
          </Button>
        )}
        {paquete?.status === "borrador" && (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={enviando}
              onClick={() => cambiarEstado("publishPackage")}
            >
              Publicar
            </Button>
            <Button type="button" variant="destructive" disabled={enviando} onClick={eliminar}>
              Eliminar borrador
            </Button>
          </>
        )}
        {paquete?.status === "publicado" && (
          <Button
            type="button"
            variant="outline"
            disabled={enviando}
            onClick={() => cambiarEstado("archivePackage")}
          >
            Archivar
          </Button>
        )}
      </div>
    </form>
  );
}
