import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { baseDelServidor } from "@db/servidor";
import { NotFoundError } from "@lib/errors";
import { esAdmin } from "@lib/guards";
import { noEncontrado } from "@lib/no-encontrado";
import { crearCatalogo } from "@modules/catalog/container";

// Lectura de imágenes privadas (ADR-025: API Route porque devuelve bytes). GET no muta. El UUID se
// resuelve a un registro; la ruta del disco nunca sale. Público solo si es la portada de un paquete
// publicado; el admin autenticado ve también las de borradores y archivados. Todo lo demás es el
// mismo 404 (id inválido, inexistente o no autorizado: no se revela que existe).
// El 404 se devuelve, no se lanza: con rutas como `..%5C..%5Cx` el middleware ve otra ruta que la
// que enruta Astro, no reconoce `/api/` y un error lanzado terminaría en un 500 vacío.
const CACHE = {
  // Se revalida siempre: tras archivar o despublicar un paquete no debe seguir saliendo de caché.
  publica: "public, max-age=0, must-revalidate",
  privada: "no-store",
};

export const GET: APIRoute = async ({ params, locals }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) return noEncontrado();

  const { publico, media } = crearCatalogo(await baseDelServidor());
  const visibilidad = await publico.visibilidadPortada(id.data, esAdmin(locals.user));
  if (!visibilidad) return noEncontrado();

  try {
    const { asset, bytes } = await media.abrir(id.data);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": CACHE[visibilidad],
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return noEncontrado();
    throw error;
  }
};
