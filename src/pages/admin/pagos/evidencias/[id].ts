import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { baseDelServidor } from "@db/servidor";
import { NotFoundError } from "@lib/errors";
import { esAdmin } from "@lib/guards";
import { noEncontrado } from "@lib/no-encontrado";
import { crearPagos } from "@modules/payments/container";

// Evidencias de pago: solo admin (el middleware exige rol `admin` en /admin/pagos; aquí se repite).
// El id es el del archivo y solo se sirve si es la evidencia de algún reporte: una portada u otro
// archivo privado da el mismo 404 que un id inválido o inexistente. GET no muta. Nombre de descarga
// generado por el servidor (nunca el del cliente); el PDF siempre como descarga, nunca en línea.
const EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const GET: APIRoute = async ({ params, locals }) => {
  if (!esAdmin(locals.user)) return new Response("Prohibido", { status: 403 });
  const id = z.uuid().safeParse(params.id);
  if (!id.success) return noEncontrado();
  try {
    const { asset, bytes } = await crearPagos(await baseDelServidor()).reports.evidence(id.data);
    const extension = EXTENSION[asset.contentType];
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${asset.contentType === "application/pdf" ? "attachment" : "inline"}; filename="evidencia-${asset.id}.${extension}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return noEncontrado();
    throw error;
  }
};
